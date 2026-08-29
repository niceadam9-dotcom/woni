import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { assembleOfficial, assembleDelegation } from '@/lib/annex-cover-official'
import { assembleReport9 } from '@/lib/report9-assemble'
import { validateAnchors, SCRUB_NEEDLES } from '@/lib/xlsx-anchors'
import { injectWorkbook, type InjectTarget } from '@/lib/xlsx-inject'
import { buildWorkbookValues, toInjectTargets } from '@/lib/xlsx-workbook'
import { donorGroupsToKeep, donorGapsForFacilities, allDonorSheets, DONOR_TOC_SHEET, BASE_TOC_SHEET, DONOR_TOC_BODY_CELLS } from '@/lib/xlsx-donors'
import { removeSheets } from '@/lib/xlsx-sheet-surgery'
import { planDonorInjection, donorInjectSummary } from '@/lib/xlsx-donor-inject'
import { sheetMatchesFacilities } from '@/lib/sheet-facility-map'
import { evacTypesFromSpecs } from '@/lib/facility-codes'
import { isMultiUseApplicable } from '@/lib/multi-use'

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

// Phase 5(S10)부터 전체 자산은 기저 26시트 + 목차 + 설비별 점검표 40시트(다중 포함) — 런타임은
// 고객 미설치 설비의 시트를 **제거**만 한다(이식은 스타일 병합이 걸린 빌드 1회 수술)
const TEMPLATE_PATH = join(process.cwd(), 'templates', 'report-workbook-full.xlsx')

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
  // 소재지·사용승인일은 조립 데이터에 없어 라우트가 직접 보탠다. 건축물 현황(S3-5 1차 확장)은
  // buildings 활성·최고참 1동 — report9-actions:225와 같은 축이라 별지 9호 PDF와 같은 동을 본다.
  // 전 동 id는 설치 설비(도너 시트 선별) 조회에 쓴다 — sheet-overview와 같은 고객 단위 축
  const [{ data: cust }, { data: blds, error: bldErr }, { data: formRow }] = await Promise.all([
    admin.from('customers')
      .select('customer_name, address, use_approval_date').eq('id', row.customer_id).maybeSingle(),
    admin.from('buildings')
      .select('id, purpose, total_area, building_area, floors_above, floors_below, height, households, building_count, permit_date')
      .eq('customer_id', row.customer_id).eq('is_active', true)
      .order('created_at', { ascending: true }),
    // 다중이용업소 판별 원천(1.10.3) — 다중1·2 시트 동봉 여부(S10-2 multiUse 축)
    admin.from('fire_plan_forms').select('sections').eq('customer_id', row.customer_id).limit(1).maybeSingle(),
  ])
  if (bldErr) {
    // error를 안 보면 없는 컬럼 하나가 '조용한 0행'이 된다 — 공란 인쇄로 새지 않게 여기서 끊는다
    return NextResponse.json({ error: `건축물 현황 조회 실패: ${bldErr.message}` }, { status: 500 })
  }
  type BldRow = {
    id: string; purpose: string | null; total_area: number | null; building_area: number | null
    floors_above: number | null; floors_below: number | null; height: number | null
    households: number | null; building_count: number | null; permit_date: string | null
  }
  const bldRows = (blds ?? []) as BldRow[]
  const bld = bldRows[0] ?? null

  // 설치 설비 — 도너 시트 선별 축(S10-2). 판정은 sheetMatchesFacilities 단일 원천(selectDonorGroups)
  const { data: facRaw, error: facErr } = bldRows.length
    ? await admin.from('fire_facilities').select('facility_code')
        .in('building_id', bldRows.map(b => b.id)).eq('installed', true)
    : { data: [], error: null }
  if (facErr) {
    return NextResponse.json({ error: `설치 설비 조회 실패: ${facErr.message}` }, { status: 500 })
  }
  const installedCodes = [...new Set((facRaw ?? []).map(f => (f as { facility_code: string }).facility_code))]

  // 다중이용업소 — sheet-overview ⑦·bundle-actions와 같은 판별 축(isMultiUseApplicable + 업종 개소 ≥1).
  // 비대상 고객에 다중1·2가 인쇄되면 안 되는 시트라 설비 코드가 아닌 이 축으로 가린다
  const mu = (((formRow as { sections: Record<string, unknown> | null } | null)?.sections)?.['multiUse'] ?? null) as
    { applicable?: boolean; categories?: Record<string, string> } | null
  const hasMultiUse = !!mu && isMultiUseApplicable(mu) && Object.values(mu.categories ?? {}).some(c => String(c ?? '').trim())

  // 템플릿 로드 + 앵커 전수 검증 — 라벨이 하나라도 어긋나면 만들지 않는다(조용한 오적용 금지).
  // 서식이 갱신됐다는 신호이므로 scripts/build-workbook-template.mts 재실행(Q-4)을 안내한다.
  let template: Uint8Array
  try {
    template = new Uint8Array(readFileSync(TEMPLATE_PATH))
  } catch {
    return NextResponse.json(
      { error: '워크북 템플릿이 없습니다 — scripts/build-workbook-template.mts → build-workbook-full.mts를 먼저 실행하세요.' },
      { status: 500 })
  }

  // 설비별 점검표 선별(S10-2) — 자산은 전 설비를 싣고 있고, 여기서 비대상 그룹을 **제거**한다.
  // 기타(always)는 상시 동봉이라 목차와 함께 항상 남고, 다중(multiUse)은 판별 플래그를 따른다
  const keptGroups = donorGroupsToKeep(k => sheetMatchesFacilities(k, installedCodes), hasMultiUse)
  // 설치했는데 기증 자산에 서식이 없는 설비 — 시트가 0장인 채 나가므로 헤더로 고지한다(S4-5 축)
  const donorGaps = donorGapsForFacilities(installedCodes, (k, code) => sheetMatchesFacilities(k, [code]))
  if (donorGaps.length) {
    console.warn(`[workbook] 동봉할 점검표 서식이 자산에 없는 설치 설비 ${donorGaps.length}종: ${donorGaps.join(', ')}`)
  }
  const keptSheets = new Set(keptGroups.flatMap(g => g.sheets))
  try {
    const cut = await removeSheets(template,
      allDonorSheets().filter(s => s !== DONOR_TOC_SHEET && !keptSheets.has(s)))
    template = cut.bytes
  } catch (e) {
    return NextResponse.json(
      { error: `설비 시트 선별 실패 — 자산·매핑 불일치 의심(build-workbook-full.mts 재실행): ${e instanceof Error ? e.message : String(e)}` },
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

  // 값의 원천은 PDF와 동일한 조립 함수 — annex_inputs 수동 오버레이까지 그대로 따라온다.
  // r9(별지 9호 조립, S7-0 추출본)는 점검 구분·점검자·동의·등급·교육이수일·점검인력 명단의 원천
  const [official, delegation, r9] = await Promise.all([
    assembleOfficial(admin, row.customer_id, id),
    assembleDelegation(admin, row.customer_id, id),
    assembleReport9(admin, row.customer_id, id),
  ])

  const values = buildWorkbookValues({
    official: official.data,
    delegation: delegation.data,
    report9: r9.data,
    customerAddress: (cust as { address: string | null } | null)?.address ?? '',
    startISO: row.inspection_start_date,
    endISO: row.inspection_end_date,
    useApprovalISO: (cust as { use_approval_date: string | null } | null)?.use_approval_date ?? null,
    // 별지 4호 1쪽 설치 체크칸(현황) — 도너 시트 선별과 **같은 목록**을 넘긴다. 두 벌로 조회하면
    // '점검표는 동봉됐는데 현황 쪽은 미설치'처럼 한 파일 안에서 모순될 수 있다
    installedCodes,
    // 피난기구 하위 3칸만 대장이 아니라 세부제원 축 — 별지 9호 3쪽 PDF와 같은 원천(D-7)
    evacTypes: evacTypesFromSpecs(r9.data.specs),
    building: bld && {
      purpose: bld.purpose, totalArea: bld.total_area, buildingArea: bld.building_area,
      floorsAbove: bld.floors_above, floorsBelow: bld.floors_below, height: bld.height,
      households: bld.households, buildingCount: bld.building_count, permitDateISO: bld.permit_date,
    },
  })
  const { targets, unmapped } = toInjectTargets(values, check.anchors)
  if (unmapped.length > 0) {
    // 앵커에 있는데 값 맵에 없다 = 코드 결함(누락) — 공란으로 조용히 내보내지 않는다
    return NextResponse.json(
      { error: `주입 값 누락(코드 결함): ${unmapped.map(a => a.field).join(', ')}` }, { status: 500 })
  }

  // 목차 재작성(S10-2) — 자산의 목차는 표본 구성이라 이 고객의 동봉 시트와 다르다.
  // 항목 칸(실측 23칸 = 그룹 수)을 남은 그룹의 tocLabel로 채우고 나머지는 명시적 공란으로 지운다.
  // 칸 수는 빌드 ⑤·test-xlsx-donors가 XML 실재로 고정한다. 그래도 넘치면(자산·그룹 불일치)
  // 자르되 경고 + missing 헤더에 남긴다(S8-2 규약과 같은 축) — 조용히 빠지지 않게
  const tocTitles = keptGroups.map(g => g.tocLabel)
  const tocOverflow = tocTitles.slice(DONOR_TOC_BODY_CELLS.length)
  if (tocOverflow.length) {
    console.warn(`[workbook] 목차 항목 칸 부족 — ${tocTitles.length}/${DONOR_TOC_BODY_CELLS.length}, 미표기: ${tocOverflow.join(' | ')}`)
  }
  // ⚠ 갑지의 기저 '목차'는 도너 '목 차'의 **복제본**이라 둘을 같이 채운다. 종전엔 도너 쪽만
  //   고쳐서, 소화기 하나만 설치한 고객 파일에도 기저 목차가 표본 구성 22항목을 그대로 나열했다
  //   (2026-08-24 독립 판정 — 코드가 이 시트를 한 번도 언급하지 않아 grep으로도 안 잡혔다)
  const tocTargets: InjectTarget[] = [DONOR_TOC_SHEET, BASE_TOC_SHEET].flatMap(sheet =>
    DONOR_TOC_BODY_CELLS.map((cell, i) => ({ sheet, cell, value: tocTitles[i] ?? null })))
  targets.push(...tocTargets)

  // 설비별 점검표 「점검결과」 주입(소방계획서_32 D트랙 / 30 S5-3) — 응답은 r9가 **이미 읽은 것**을
  // 그대로 쓴다(재조회 금지, D-7). 좌표는 빌드가 자산에서 뽑아 둔 매핑에서 온다(런타임 XML 파싱 0).
  // ⚠ keptSheets를 넘기는 이유: 응답이 있어도 그 설비가 미설치면 시트가 위에서 제거됐다. 그대로
  //   주입 대상에 넣으면 injectWorkbook이 missed로 잡아 **정상 시나리오가 500이 된다**(서림사는
  //   응답 243건 / 설치 14종이라 반드시 발생한다). 시트 선별과 주입이 같은 집합을 본다.
  const donorPlan = planDonorInjection(r9.sheetResponses, keptSheets)
  targets.push(...donorPlan.targets)
  if (donorPlan.notLanded.duplicated.length) {
    console.warn(`[workbook] 코드당 응답 복수로 미반영 ${donorPlan.notLanded.duplicated.length}건: ${donorPlan.notLanded.duplicated.slice(0, 6).join(', ')}`)
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
      // 조립 함수가 알린 공란·누락 + 목차 미표기 — 화면이 안내에 쓸 수 있게 헤더로 전달(S4-5).
      // r9.missing까지 실으면 길어질 수 있어 헤더 한도 보호로 600자에서 자른다.
      //
      // ⚠ **순서가 곧 생존 순위다.** 점검표 착지 집계를 맨 뒤에 뒀더니 앞선 r9.missing이 600자를
      //   다 채워 고지가 통째로 잘려 사라졌다(2026-08-29 라이브 실측 — 하필 '조용한 누락 금지'를
      //   구현하면서 그것을 위반했다). 착지 집계는 **맨 앞**에 둔다: 사용자가 신고한 바로 그 축이고,
      //   나머지는 개별 항목이라 일부가 잘려도 성격이 남지만 이건 유일한 전체 요약이라 잘리면 0이 된다.
      //   더해 잘렸다는 사실 자체를 '…(N자 생략)'으로 드러낸다 — 조용한 절단도 조용한 누락이다.
      'X-Workbook-Missing': encodeURIComponent((() => {
        const parts = [
          ...(donorInjectSummary(donorPlan) ? [donorInjectSummary(donorPlan)!] : []),
          ...official.missing, ...delegation.missing, ...r9.missing,
          ...(r9.data.assistants.length > 7
            ? [`보조 점검인력 ${r9.data.assistants.length}명 중 8번째부터 미표기(허브 7행)`] : []),
          ...tocOverflow.map(t => `목차 미표기: ${t}`),
          ...(donorGaps.length ? [`점검표 서식 미동봉(자산 없음): ${donorGaps.join(', ')}`] : []),
        ]
        const full = parts.join(' | ')
        if (full.length <= 600) return full
        const cut = full.slice(0, 580)
        return `${cut.slice(0, cut.lastIndexOf(' | ') > 0 ? cut.lastIndexOf(' | ') : 580)} | …외 ${full.length - cut.length}자 생략`
      })()),
    },
  })
}
