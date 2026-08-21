import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { assembleOfficial, assembleDelegation } from '@/lib/annex-cover-official'
import { validateAnchors, SCRUB_NEEDLES } from '@/lib/xlsx-anchors'
import { injectWorkbook } from '@/lib/xlsx-inject'
import { buildWorkbookValues, toInjectTargets } from '@/lib/xlsx-workbook'

/** 갑지 통합 워크북(엑셀) 즉석 생성 (소방계획서_27 S4 — Phase 1: 개요 허브 + 공문·위임장·계약서)
 *
 *  PDF 번들과 달리 **손으로 고쳐 쓰는** 산출물이다 — 시스템이 채운 값을 담당자가 Excel에서
 *  수정·보완한 뒤 인쇄한다. 값의 원천은 PDF와 같은 assemble*(D-7)이므로 두 산출물이 갈라지지 않는다.
 *
 *  저장하지 않는다(D-5, bundle/route.ts:9와 같은 축) — 받아서 고치는 순간 서버 사본이 낡는다.
 *  fire_plan_gen_jobs에도 넣지 않는다(D-6) — 그 테이블은 {type}_{stamp}.pdf 파일 규약과 짝이라
 *  파일 없는 잡을 넣으면 문서 현황·번들 체크리스트가 어긋난다.
 *
 *  라우트 핸들러 = 공개 엔드포인트(소방계획서_17 교훈) — 세션·권한을 여기서 직접 검사한다. */

const TEMPLATE_PATH = join(process.cwd(), 'templates', 'report-workbook.xlsx')

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(profile.role as UserRole, 'inspection_register')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('id, customer_id, year, inspection_start_date, inspection_end_date')
    .eq('id', id).maybeSingle()
  if (!insp) return NextResponse.json({ error: '점검 건을 찾을 수 없습니다.' }, { status: 404 })
  const row = insp as {
    customer_id: string; year: number
    inspection_start_date: string | null; inspection_end_date: string | null
  }
  const { data: cust } = await admin.from('customers')
    .select('customer_name, address').eq('id', row.customer_id).maybeSingle()

  // 템플릿 로드 + 앵커 전수 검증 — 라벨이 하나라도 어긋나면 만들지 않는다(조용한 오적용 금지).
  // 서식이 갱신됐다는 신호이므로 scripts/build-workbook-template.mts 재실행(Q-4)을 안내한다.
  let template: Uint8Array
  try {
    template = new Uint8Array(readFileSync(TEMPLATE_PATH))
  } catch {
    return NextResponse.json(
      { error: '워크북 템플릿이 없습니다 — scripts/build-workbook-template.mts를 먼저 실행하세요.' },
      { status: 500 })
  }
  const check = validateAnchors(template)
  if (!check.ok) {
    return NextResponse.json(
      { error: `서식 앵커 불일치 — 갑지가 갱신된 듯합니다. 템플릿 재빌드·앵커 재승인이 필요합니다: ${check.failures.join(' · ')}` },
      { status: 500 })
  }
  if (check.healed.length > 0) {
    // 자가치유(S3-3)로 살아났다 = 서식이 밀렸다는 신호 — 산출은 계속하되 재승인을 재촉한다
    console.warn(`[workbook] 앵커 자가치유 ${check.healed.length}건 — 템플릿 재빌드·재실측 권장: ${check.healed.join(' · ')}`)
  }

  // 값의 원천은 PDF와 동일한 조립 함수 — annex_inputs 수동 오버레이까지 그대로 따라온다
  const [official, delegation] = await Promise.all([
    assembleOfficial(admin, row.customer_id, id),
    assembleDelegation(admin, row.customer_id, id),
  ])

  const values = buildWorkbookValues({
    official: official.data,
    delegation: delegation.data,
    customerAddress: (cust as { address: string | null } | null)?.address ?? '',
    startISO: row.inspection_start_date,
    endISO: row.inspection_end_date,
  })
  const { targets, unmapped } = toInjectTargets(values, check.anchors)
  if (unmapped.length > 0) {
    // 앵커에 있는데 값 맵에 없다 = 코드 결함(누락) — 공란으로 조용히 내보내지 않는다
    return NextResponse.json(
      { error: `주입 값 누락(코드 결함): ${unmapped.map(a => a.field).join(', ')}` }, { status: 500 })
  }

  // 안전망(S2-7/D-10) — 주입이 안 닿은 캐시에 표본 고객 흔적이 남았으면 비워서 내보낸다.
  // 지금 템플릿은 잔존 0이 검증돼 있지만(빌드 ⑥), 갱신된 템플릿이 이 부류를 되살릴 수 있다
  const result = await injectWorkbook(template, targets, { forbidden: SCRUB_NEEDLES })
  if (result.missed.length > 0) {
    return NextResponse.json(
      { error: `주입 대상 셀 미발견 — 서식 변경 의심: ${result.missed.join(', ')}` }, { status: 500 })
  }
  if (result.scrubbed.length > 0) {
    console.warn(`[workbook] 표본 흔적 캐시 ${result.scrubbed.length}칸 소거(D-10) — 템플릿 재점검 필요: ${result.scrubbed.join(', ')}`)
  }

  // 파일명 규약: 고객명_점검종류_연도(S4-4). 종류 라벨은 위임장 조립이 이미 판정한 것을 재사용
  const name = `${(cust as { customer_name: string } | null)?.customer_name ?? '점검'}_${delegation.data.typeLabel}결과보고서_${row.year}.xlsx`
  return new NextResponse(Buffer.from(result.bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      // 조립 함수가 알린 공란·누락 — 화면이 안내에 쓸 수 있게 헤더로 전달(S4-5)
      'X-Workbook-Missing': encodeURIComponent([...official.missing, ...delegation.missing].join(' | ')),
    },
  })
}
