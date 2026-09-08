import { NextResponse, type NextRequest } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { assembleFirePlan } from '@/lib/fire-plan-generate'
import { validateAnchors } from '@/lib/xlsx-anchors'
import { toInjectTargets } from '@/lib/xlsx-workbook'
import { injectWorkbook } from '@/lib/xlsx-inject'
import { FIRE_PLAN_ANCHORS } from '@/lib/fire-plan-anchors'
import { buildFirePlanValues, missingValueFields, zoneRowOverflow } from '@/lib/fire-plan-xlsx-values'
import { FIRE_PLAN_MANIFEST } from '@/lib/fire-plan-xlsx-manifest'

/** 소방계획서 엑셀(xlsx) — 소방계획서_42 S6-1.
 *
 *  원형은 `inspections/[id]/workbook/route.ts`(갑지)다. 권한 → 템플릿 → **앵커 검증** → 값 →
 *  주입 → 스트리밍. PDF와 **같은 `assembleFirePlan()`** 을 먹으므로 두 산출물의 값이 갈라질 수
 *  없다. 파일은 저장하지 않는다(보관함 폐지 규약) — 고정 좌표는 생성 시점에만 유효하면 된다.
 *
 *  🚨 **조용한 오적용 금지.** 앵커 라벨 불일치·값 맵 구멍·미착지는 전부 **500으로 끊는다**.
 *    법정 서식에서 '거의 맞는 문서'는 틀린 문서이고, 200으로 나가면 아무도 모른다.
 *    뒤집어 말하면 이 라우트의 **200은 곧 전량 착지 단언**이다(S7-4가 그걸 판정축으로 쓴다).
 *
 *  라우트 핸들러 = 공개 엔드포인트(소방계획서_17 교훈) — 세션·권한을 여기서 직접 검사한다.
 */
export const runtime = 'nodejs'

const TEMPLATE = path.join(process.cwd(), 'templates', 'fire-plan-workbook.xlsx')

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(profile.role as UserRole, 'customer_manage')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })
  // 생성 연도 = 올해 자동 — PDF 라우트와 같은 축(KST 보정)
  const year = new Date(Date.now() + 9 * 3600_000).getFullYear()

  const admin = createAdminClient()
  try {
    const templateBytes = new Uint8Array(await readFile(TEMPLATE))

    // ① 앵커 검증 — 서식이 밀렸으면 **주입을 시작하지 않는다**.
    //    자가치유가 일어났다는 것은 좌표가 이미 밀렸다는 뜻이라 고지에 싣는다(S7-2와 같은 축).
    const check = validateAnchors(templateBytes, FIRE_PLAN_ANCHORS)
    if (!check.ok) {
      return NextResponse.json(
        { error: `소방계획서 서식 좌표가 어긋났습니다(${check.failures.length}건). 관리자에게 알려 주세요.`, detail: check.failures.slice(0, 8) },
        { status: 500 })
    }

    // ② 값 — PDF와 공유하는 단일 조립 결과만 먹는다(재조회 없음)
    const { data, missing } = await assembleFirePlan(admin, id, year)
    const values = buildFirePlanValues(data)

    // ③ 값 맵 완결성 — 앵커가 요구하는 필드가 하나라도 없으면 그 칸만 템플릿 잔재로 남는다
    const gaps = missingValueFields(values)
    if (gaps.length) {
      return NextResponse.json(
        { error: `소방계획서 값 매핑이 불완전합니다(${gaps.length}칸).`, detail: gaps.slice(0, 12) },
        { status: 500 })
    }

    // ④ 주입 — 값 없는 앵커는 명시적 공란(null)으로 완전 덮어쓰기(S5-4)
    const { targets, unmapped } = toInjectTargets(values, check.anchors)
    if (unmapped.length) {
      return NextResponse.json(
        { error: `주입 대상 누락 ${unmapped.length}칸`, detail: unmapped.slice(0, 12).map(a => `${a.sheet}!${a.cell}`) },
        { status: 500 })
    }
    const result = await injectWorkbook(templateBytes, targets)
    if (result.missed.length) {
      return NextResponse.json(
        { error: `소방계획서 값 주입 실패 ${result.missed.length}칸 — 미착지가 있으면 내보내지 않습니다.`, detail: result.missed.slice(0, 12) },
        { status: 500 })
    }

    const name = `${data.buildingName || '소방계획서'}_소방계획서_${year}.xlsx`
    return new NextResponse(Buffer.from(result.bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="fire-plan-${year}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
        // S6-2 고지 헤더 — 갑지 `X-Workbook-Missing`의 규약을 그대로 이식한다.
        // **순서가 곧 생존 순위다**: 앞이 살고 뒤가 잘린다. 자가치유는 서식이 이미 밀렸다는
        // 신호라 1순위, 넘쳐서 버린 구역은 잘린 채로도 인쇄물이 멀쩡해 보이므로 2순위.
        // 절단할 때는 **잘렸다는 사실 자체**를 드러낸다 — 조용한 절단도 조용한 누락이다.
        'X-FirePlan-Missing': encodeURIComponent(noticeHeader([
          ...check.healed.map(h => `서식 좌표 자가치유: ${h}`),
          ...(zoneRowOverflow(data) ? [`구역별 세부현황 ${zoneRowOverflow(data)}개 구역 미표기(양식 ${FIRE_PLAN_MANIFEST.scope} 고정 행 상한)`] : []),
          ...missing,
          // 1단계 범위 고지 — 받는 사람이 '왜 제2·3장이 없나'를 헤더에서 바로 알게 한다
          `범위: ${FIRE_PLAN_MANIFEST.scope}(시트 ${FIRE_PLAN_MANIFEST.sheets.length}장)`,
        ])),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/**
 * 고지 문자열 조립 — 600자 상한.
 *
 * ⚠ 생략 글자 수는 **실제로 남긴 것**을 기준으로 센다. 갑지에서 `full.length - 580`으로 세다가
 *   구분자까지 되감은 만큼을 놓쳐 '380자 생략'이라 적고 903자를 버린 적이 있다(실제의 42%만 신고).
 */
function noticeHeader(parts: string[]): string {
  const full = parts.filter(Boolean).join(' | ')
  if (full.length <= 600) return full
  const cut = full.slice(0, 580)
  const back = cut.lastIndexOf(' | ')
  const kept = back > 0 ? cut.slice(0, back) : cut
  return `${kept} | …외 ${full.length - kept.length}자 생략`
}
