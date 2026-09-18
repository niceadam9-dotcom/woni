import 'server-only'

/** 소방계획서 조립 (소방계획서_7 H-12·H-13 → 2026-09-02 보관함 폐지)
 *
 *  고객·건물·시설·관계인·자위소방대·fire_plan_forms.sections를 모아 렌더 재료를 만든다.
 *  종전의 저장 경로(generateFirePlanNow: Gotenberg PDF → 버킷 업로드 → fire_plans 등록 →
 *  개정이력 자동 기록)는 보관함 폐지로 전부 은퇴 — 소비처는 즉석 미리보기
 *  (previewFirePlanHtmlAction)와 즉석 PDF 라우트(/customers/[id]/fire-plan/pdf)뿐이고
 *  둘 다 파일을 만들지 않는다. 개정이력은 수동 기록(fire_plan_revisions)이 단일 창구다. */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  FACILITY_FORM,
  type FirePlanGenData, type FirePlanFormSections, type PlanPhoto,
} from '@/lib/fire-plan-template'
import { resolveFireSafetyManager, type ContactLite } from '@/lib/fire-safety-manager'
/* 대표동 판정 단일 원천 — 화면·별지 9호·갑지가 쓰는 그 함수(사본 금지) */
import { primaryBuilding } from '@/lib/primary-building'
/* 계단 4종 — 건물 값을 정본으로 쓰되 이관 전 고객은 1.5 탭 옛 JSON으로 폴백한다(마이그 165) */
import { STAIR_KINDS, stairCountsFromLegacyMap, type StairKind } from '@/lib/facility-status'
import type { ManagerRow } from '@/components/customers/plan-form17'
import { toStandardCodes } from '@/lib/facility-codes'
import { formatBizNo, formatTel } from '@/lib/format-contact'
import { listCustomerAssets, ASSET_BUCKET } from '@/lib/customer-assets'
import {
  planFirePlanImageRefs, collectFirePlanImages,
  type FirePlanAsset, type FirePlanImageRef,
} from '@/lib/fire-plan-image-refs'

type Admin = ReturnType<typeof createAdminClient>

const BUCKET = ASSET_BUCKET // 'fire-plans'

/** M-1(소방계획서_15): 서식 1.2는 짧은 라벨('전기')로 저장하는데 템플릿 체크박스는 긴 라벨('전기적 요인') 기준 includes 비교라
 *  실입력 체크가 전부 ☐로 인쇄됐다. 조립에서 짧은→긴 라벨로 정규화한다. 긴 라벨 저장분(폴백 프리셋·과거 데이터)은
 *  매핑에 없어 그대로 통과 — 양방향 호환, 데이터 마이그레이션 불필요. */
const HAZARD_LABEL_LONG: Record<string, string> = {
  '전기': '전기적 요인', '기계': '기계적 요인', '화학': '화학적 요인', '가스누출': '가스누출(폭발)',
}
const normHazardFactors = (risks: string[]) => risks.map(r => HAZARD_LABEL_LONG[r] ?? r)

export type { FirePlanAsset, FirePlanImageRef }

export type AssembledFirePlan = {
  data: FirePlanGenData
  images: FirePlanImageRef[]
  assets: FirePlanAsset[]
  missing: string[]
}

// loadPresetPairs 삭제(2026-08-19) — 공통 수기 프리셋 폐지. fire-plan-presets.ts 주석 참조.

/** 스토리지에서 바이트를 길어 오는 한 줄 — 수집 규칙(`collectFirePlanImages`)과 스토리지를 가르는 이음매.
 *  규칙 쪽이 supabase를 모르게 되어 DB·서버 없이 그대로 단언할 수 있다. */
const storageDownloader = (admin: Admin) => async (path: string): Promise<Uint8Array | null> => {
  const { data } = await admin.storage.from(BUCKET).download(path)
  return data ? new Uint8Array(await data.arrayBuffer()) : null
}

/** 소방계획서 생성 데이터 조립 — 서버에서 완결 (워커 process()의 DB 조회 + getFirePlanGenDefaultsAction 매핑 통합) */
export async function assembleFirePlan(
  admin: Admin,
  customerId: string,
  year: number,
): Promise<AssembledFirePlan> {
  const [custRes, contactRes, bldRes, companyRes, formRes, brigadeRes, revRowsRes] = await Promise.all([
    admin.from('customers')
      .select('customer_name, address, use_approval_date, fire_station, inspection_type, plan_anchor_date, contract_date, '
        + 'building_grade, manager_selected_at, insurance_joined, insurance_company, insurance_period, '
        + 'insurance_amount_person, insurance_amount_property, op_hours_weekday, op_hours_holiday, '
        + 'headcount_worker, headcount_resident, headcount_max, '
        // M-3(소방계획서_15): 1.1 운영현황 확장 3컬럼 — 입력받고도 select 누락으로 본문에 나가지 않던 것
        // 145: 소방안전관리자로 지목된 관계인
        + 'rep_role, manager_license_grade, manager_edu_date, manager_contact_id')
      .eq('id', customerId).single(),
    admin.from('customer_contacts').select('id, role, name, phone, position').eq('customer_id', customerId),
    admin.from('buildings')
      // M-2·M-10(소방계획서_15): 계단·경사로·승강기 3종 — 전부 buildings 컬럼(104)이다.
      // ⚠ 2026-08-11 교정: 초기 구현이 stairs_count 등을 customers에서 select해 본문 생성이 통째로
      // 실패했다(컬럼 없음 → cust null → throw). 저장 경로(fire-plan-info-actions)·별지9호 조립 모두 buildings.
      // 🚨 2026-09-09: `parking_summary`가 **이 목록에 없어서** 건물 폼에 주차장을 채워도
      //    소방계획서 PDF·엑셀이 영영 공란이었다(양식 1.1 13행에 칸이 있다). 값 축·앵커를 아무리
      //    봐도 안 나오는 이유가 여기였다 — **조회하지 않은 컬럼은 아래 모든 층에서 없는 값이다.**
      // 🚨 2026-09-09: 여기만 `lib/primary-building`을 안 쓰는 **유일한 예외**였다. 화면·별지 9호·
      //    갑지는 전부 그 단일 원천(=`is_primary` 우선, 없으면 최고참)을 쓰는데 소방계획서만
      //    날것 `created_at` 최고참이라, 160이 적용되는 순간 **두 문서가 다른 동을 인쇄**하게 된다.
      //    ⚠ `select('*')`인 이유: `is_primary`를 이름으로 지목하면 160 적용 전 DB가 42703으로
      //      터진다(운영·스테이징 양쪽 미적용 실측). 정렬은 아래 JS가 한다.
      .select('*')
      .eq('customer_id', customerId).eq('is_active', true)
      .order('created_at', { ascending: true }),
    // M-6(소방계획서_15): 대표자·사업자등록번호 추가 — 1.8 표 유실 복구
    admin.from('company_profile').select('company_name, address, phone, representative, business_number').limit(1).maybeSingle(),
    admin.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle(),
    admin.from('fire_brigade_members').select('team, name, duty, phone').eq('customer_id', customerId).order('sort_order'),
    // 개정이력(120) — 인쇄는 전 연도 시계열 오름차순
    admin.from('fire_plan_revisions')
      .select('revised_on, content, author_name, reviewer_name, approver_name')
      .eq('customer_id', customerId)
      .order('year', { ascending: true }).order('seq', { ascending: true }),
  ])
  const cust = custRes.data as {
    customer_name: string; address: string | null; use_approval_date: string | null
    fire_station: string | null; inspection_type: string; plan_anchor_date: string | null; contract_date: string | null
    building_grade: string | null; manager_selected_at: string | null
    insurance_joined: boolean | null; insurance_company: string | null; insurance_period: string | null
    insurance_amount_person: string | null; insurance_amount_property: string | null
    op_hours_weekday: string | null; op_hours_holiday: string | null
    headcount_worker: number | null; headcount_resident: number | null; headcount_max: number | null
    rep_role: string | null; manager_license_grade: string | null; manager_edu_date: string | null
    manager_contact_id: string | null
  } | null
  if (!cust) throw new Error('고객을 찾을 수 없습니다')

  const contacts = (contactRes.data ?? []) as ContactLite[]
  const owner = contacts.find(c => c.role === '대표') ?? contacts[0]
  // 여러 줄 select 문자열은 PostgREST 타입 파서가 못 읽어 GenericStringError로 추론된다 — unknown 경유 캐스트
  const buildings = (bldRes.data ?? []) as unknown as Array<{
    id: string; purpose: string | null; total_area: number | null; building_area: number | null
    floors_above: number | null; floors_below: number | null
    height: number | string | null; receiver_location: string | null; main_structure: string | null; roof_structure: string | null
    stairs_count: number | null; ramp_count: number | null; evac_elevator_count: number | null
    /* 계단 4종(마이그 165) — 서식 1.1 15~16행의 원천. 종전엔 1.5 탭 JSON이 들고 있어서
     * **1.5를 안 쓴 302명은 계단칸이 영영 공란**이었다(2026-09-16 실측: 1.5 작성 4명).
     * 조회는 위 `select('*')`가 이미 한다 — 2026-09-09 `parking_summary` 사고를 되풀이하지 않는다. */
    stair_direct_count: number | null; stair_escape_count: number | null
    stair_special_count: number | null; stair_outdoor_count: number | null
    elevator_count: number | null; emergency_elevator_count: number | null
    parking_summary: string | null
    created_at?: string | null; is_primary?: boolean | null
  }>
  // 대표동 — 종전 `buildings[0]`을 단일 원천으로 대체. 160 적용 전에는 `is_primary`가 undefined라
  // 종전과 **같은 답**(최고참)이 나온다. 설비는 계속 전 동을 읽는다(서식 1.4는 대상물 단위).
  const b = primaryBuilding(buildings)
  const company = companyRes.data as {
    company_name: string; address: string | null; phone: string | null
    representative: string | null; business_number: string | null
  } | null

  const rawSections = ((formRes.data as { sections?: Record<string, unknown> } | null)?.sections) ?? {}
  const sections = rawSections as FirePlanFormSections & {
    revision?: { revisionDate?: string; revisionNote?: string }
    zones?: Array<{ zone: string; name: string; area: string; workersWeekday: string; workersHoliday: string; company: string; phone: string }>
    hazards?: Array<{ place: string; loc: string; risks: string[] }>
    photos?: Array<{ path: string | null; kind: string; caption: string }>
  }
  const revision = sections.revision ?? null

  // 소방안전관리자 — 별지 9·10·11호·외관·위임장과 **같은 해석기**(145 지목 → 1.7 → 대표).
  // (B-5b에서 개정이력 폴백 작성자로도 쓰므로 revisions보다 먼저 계산)
  const mgr = resolveFireSafetyManager({
    contacts, managerContactId: cust.manager_contact_id, managers: sections.managers,
  })
  const managerName = mgr.name
  const managerPhone = mgr.phone

  // 서식 1.7 표 = **주 선임자 1행(관계인 탭 파생) + 1.7의 보조자 행들**.
  // 1.7이 보조자 전용이 된 뒤로도 표에서 관리자 행이 사라지면 안 되므로 여기서 합성한다.
  // 저장소는 늘리지 않는다 — 주 선임자 행은 저장된 값이 아니라 매 생성 시 파생이다.
  const assistantRows = (sections.managers ?? []).filter(m => (m.role ?? '').includes('보조'))
  const managerRows: ManagerRow[] = [
    ...(managerName ? [{
      role: '소방안전관리자',
      // 소속 칸은 종전 폴백 행과 같은 값(대상물명)을 쓴다 — 서식 1.7 원문 관행
      affiliation: cust.customer_name,
      name: managerName,
      selectedAt: cust.manager_selected_at ?? '',
      eduAt: cust.manager_edu_date ?? '',
      duty: '소방안전관리 업무 총괄',
    }] : []),
    ...assistantRows,
  ]

  // 개정이력 — fire_plan_revisions(120, 수동 기록)가 단일 원천 (소방계획서_17 §2-4 → 2026-09-02).
  // 종전의 fire_plans 파생 폴백은 보관함 폐지로 제거 — 파일 행은 더 늘지 않는 낡은 축이라,
  // 이력이 없는 고객에게 옛 파일 등록 기록을 이력인 양 인쇄하는 것이 빈 표보다 나쁘다.
  const revisions = ((revRowsRes.data ?? []) as Array<{
    revised_on: string | null; content: string | null
    author_name: string | null; reviewer_name: string | null; approver_name: string | null
  }>).map(r => ({
    date: (r.revised_on ?? '').slice(0, 10),
    note: r.content ?? '',
    author: r.author_name ?? '',
    reviewer: r.reviewer_name ?? '',
    approver: r.approver_name ?? '',
  }))
  const brigadeRows = (brigadeRes.data ?? []) as Array<{ team: string; name: string; duty: string | null; phone: string | null }>

  // 설치 시설 → 서식 1.4 항목 — 표준 코드(100) 정확 일치, 레거시 잔존분은 toStandardCodes로 정규화
  // M-4(소방계획서_15): 항목별 비고(detail.note)도 함께 조회 — 설치 여부와 무관하게 비고가 있으면 인쇄
  let facilities: string[] = []
  let facCodes: string[] = []
  const facilityNotes: Array<{ name: string; note: string }> = []
  if (buildings.length > 0) {
    const { data: facRaw } = await admin.from('fire_facilities')
      .select('facility_code, installed, detail')
      .in('building_id', buildings.map(x => x.id))
    const facRows = (facRaw ?? []) as Array<{ facility_code: string; installed: boolean; detail: { note?: string } | null }>
    facCodes = facRows.filter(fc => fc.installed).map(fc => fc.facility_code)
    const codes = toStandardCodes(facCodes)
    const allItems = new Set(FACILITY_FORM.flatMap(g => g.items))
    facilities = codes.filter(c => allItems.has(c))
    for (const fc of facRows) {
      const note = fc.detail?.note?.trim()
      if (!note) continue
      const name = toStandardCodes([fc.facility_code])[0] ?? fc.facility_code
      if (!facilityNotes.some(n => n.name === name && n.note === note)) facilityNotes.push({ name, note })
    }
  }

  // 자체점검 시기 — 점검계획일 기준: 종합 고객은 종합=기준월·작동=+6개월, 작동 고객은 작동=기준월
  const anchorMonth = cust.plan_anchor_date ? new Date(cust.plan_anchor_date).getMonth() + 1 : null
  const plus6 = anchorMonth ? ((anchorMonth - 1 + 6) % 12) + 1 : null
  const isComprehensive = cust.inspection_type === '종합'
  const operationMonth = anchorMonth ? `${year}년 ${isComprehensive ? plus6 : anchorMonth}월` : ''
  const comprehensiveMonth = isComprehensive && anchorMonth ? `${year}년 ${anchorMonth}월` : ''

  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const floors = b ? `지하 ${b.floors_below ?? 0}층 / 지상 ${b.floors_above ?? 0}층` : ''
  const n = (x: number | null | undefined) => x != null ? String(x) : ''
  // 개수 표기 — 0·미입력은 빈 문자열(체크·개소 표기 안 함, 허위 ■ 방지)
  const nz = (x: number | null | undefined) => x != null && x > 0 ? String(x) : ''

  const photos = (sections.photos ?? []).filter((p): p is { path: string; kind: string; caption: string } => !!p.path)

  // B-5d(소방계획서_19 M-12, Q-4 확정): 1.3 미입력 고객은 자동 조회 캐시(sections.routeMeta,
  // 소방계획서_13 Directions 결과)를 폴백으로 쓴다 — 자동 채움 표시(M-15 규약) 동반.
  // 서식 1.3 입력값은 템플릿(fire-plan-template)이 항상 우선한다.
  const routeMeta = (rawSections as { routeMeta?: { distanceM?: number; durationMs?: number } }).routeMeta
  const cachedDistance = routeMeta?.distanceM != null ? (routeMeta.distanceM / 1000).toFixed(1) : ''
  const cachedEta = routeMeta?.durationMs != null ? String(Math.max(1, Math.round(routeMeta.durationMs / 60000))) : ''

  const data: FirePlanGenData = {
    year,
    // 표지 작성일 = 개정이력 최신 행의 개정일 → (구) sections.revision → 오늘
    revisionDate: revisions[revisions.length - 1]?.date || revision?.revisionDate || kstToday,
    revisionNote: revision?.revisionNote || `${year}년 소방계획서 작성`,
    buildingName: cust.customer_name,
    address: cust.address ?? '',
    grade: cust.building_grade ?? '',
    purpose: b?.purpose ?? '',
    useApprovalDate: cust.use_approval_date ?? '',
    totalArea: b?.total_area != null ? String(b.total_area) : '',
    buildingArea: b?.building_area != null ? String(b.building_area) : '',
    floors,
    floorsAbove: b?.floors_above ?? null,
    floorsBelow: b?.floors_below ?? null,
    height: b?.height != null && String(b.height).trim() !== '' ? String(b.height) : '',
    structure: b?.main_structure ?? '',
    roof: b?.roof_structure ?? '',
    receiverLocation: b?.receiver_location ?? '',
    ownerName: owner?.name ?? '',
    // 전화번호는 전부 formatTel을 거친다 — 종전엔 업무대행 업체 전화(companyPhone)만 포맷돼서
    // 같은 서식 1.1 안에 '01032162321'과 '031-772-3019'가 나란히 찍혔다. 판별 불가한 값은 원문 유지.
    ownerPhone: formatTel(owner?.phone),
    managerName,
    managerPhone: formatTel(managerPhone),
    // 선임일은 customers가 정본 — 1.7은 보조자 전용이 됐다(2026-08-20). managerRows[0]과 같은 값.
    managerSelectedAt: cust.manager_selected_at || '',
    fireStation: cust.fire_station ?? '',
    stationDistance: cachedDistance,
    stationEta: cachedEta,
    facilities,
    facilityNotes,                                    // M-4: 1.4 항목별 비고
    // M-2·M-10: 1.1 시설현황 확장 — 계단·경사로 개소, 승강기 3종 대수 (전부 buildings 원천)
    stairsCount: nz(b?.stairs_count),
    /* 계단 4종 — **한 번 해석해** 서식 1.1 엑셀과 PDF 1.5.1이 나눠 쓴다(마이그 165).
     *  표면마다 해석하면 「서식 1.1은 ☑인데 별지 9호는 공란」 같은 갈라짐이 다시 생긴다.
     *
     *  ⚠ 폴백이 있다: 건물 네 칸이 **모두 비었을 때만** 1.5 탭 옛 JSON을 읽는다. 마이그 165 백필은
     *    「활성 건물이 정확히 1동인 고객」만 옮겼으므로(고객 단위 JSON이 어느 동인지 말하지 않는다)
     *    다동 고객의 옛 입력이 이 폴백으로 계속 인쇄된다. 섞지 않고 **건물이 이기게** 둔 이유는,
     *    한 칸이라도 건물에 적었으면 그게 사람이 방금 말한 최신 사실이기 때문이다. */
    stairCounts: (() => {
      const own = {
        special: nz(b?.stair_special_count), direct: nz(b?.stair_direct_count),
        escape: nz(b?.stair_escape_count), outdoor: nz(b?.stair_outdoor_count),
      }
      if (Object.values(own).some(s => s !== '')) return own
      const legacy = stairCountsFromLegacyMap(sections.evacFire?.stairs)
      return Object.fromEntries(STAIR_KINDS.map(k => [k, String(legacy[k] ?? '')])) as Record<StairKind, string>
    })(),
    rampCount: nz(b?.ramp_count),
    elevators: {
      passenger: nz(b?.elevator_count),
      emergency: nz(b?.emergency_elevator_count),
      evac: nz(b?.evac_elevator_count),
    },
    // 주차장 — 양식 1.1 13행(승강기 바로 아래)이 같은 모양의 체크 행인데 이 값만 안 실려서
    // 건물 폼에 채워도 PDF·엑셀이 늘 공란이었다(2026-09-09). 원천은 승강기와 같은 `b`(대표동).
    parkingSummary: b?.parking_summary ?? '',
    // M-3: 1.1 운영현황 확장 — 대표자 구분·자격구분·강습교육 수료일(1.7 폴백 행)
    repRole: cust.rep_role ?? '',
    managerGrade: cust.manager_license_grade ?? '',
    managerEduDate: cust.manager_edu_date ?? '',
    companyName: company?.company_name ?? '',
    companyAddress: company?.address ?? '',
    companyPhone: formatTel(company?.phone),
    // M-6: 1.8 대행업체 대표자·사업자등록번호
    companyRep: company?.representative ?? '',
    companyBizNo: formatBizNo(company?.business_number),
    contractStart: cust.contract_date ?? '',
    inspectionCycle: '매월 1회',
    operationMonth,
    comprehensiveMonth,
    // M-7(소방계획서_15): 미입력 시 11월 고정 폴백 제거 — null이면 템플릿이 전 월 ☐로 렌더(허위 ■ 방지)
    trainingMonth: sections.training?.drillMonths?.[0] ?? sections.training?.eduMonths?.[0] ?? null,
    brigade: brigadeRows.length > 0
      ? brigadeRows.map(m => ({ team: m.team, name: m.name, duty: m.duty ?? '', phone: formatTel(m.phone) }))
      : [
        { team: '자위소방대장', name: '', duty: '관리구역 상황통제', phone: '' },
        { team: '부대장', name: '', duty: '대장 부재시 수행', phone: '' },
        { team: '비상연락', name: '', duty: '119신고 및 상황전파', phone: '' },
        { team: '초기소화', name: '', duty: '소화기 이용 초기소화', phone: '' },
        { team: '피난유도', name: '', duty: '피난층 또는 옥상으로 피난유도', phone: '' },
      ],
    // 3.4 — 고객 입력 > 양식 기본값. 종전엔 기본값을 프리셋(applyPresetPairs)이 유형별로 전역 치환했으나
    // 프리셋 폐지(2026-08-19)로 유형별 문구는 '계획서 공통문구'(plan_text_library)가 담당한다.
    evacRoutes: (sections.evacPlan?.routes?.length ?? 0) > 0
      ? sections.evacPlan!.routes!
      : [{ floor: '전층', route: '각 세대 출입구 앞 직통계단 이용', guide: '', equip: '' }],
    assembly: sections.evacPlan?.assembly || '1층 주차장',
    evacNote: sections.evacPlan?.procedure || '피난유도자 지시에 따라 최단 경로로 피난 실시, 피난 늦은 인원은 옥상 대피',
    // 비화재보·대피방법 — 종전엔 템플릿에 문자열로 박혀 고객도 못 고쳤다. 기본값 문구는 그대로라
    // 아무도 입력하지 않은 문서의 인쇄 결과는 바뀌지 않는다(주택형 기준 = 종전 양식 기본값)
    evacFalseAlarm: sections.evacPlan?.falseAlarm || '피난 실시 및 1층 주차장 대기 후 오동작 각 세대 전파',
    evacMethod: sections.evacPlan?.evacMethod || '2층 화재 초기에 1층 출입문으로 대피 및 피난 늦은 자는 옥상으로 대피',
    zones: (sections.zones?.length ?? 0) > 0
      ? sections.zones!.map(z => ({
        zone: z.zone, name: z.name, area: z.area,
        weekday: z.workersWeekday, holiday: z.workersHoliday, managerCo: z.company, contact: formatTel(z.phone),
      }))
      : [{
        zone: '전층', name: b?.purpose ?? '', area: b?.total_area != null ? String(b.total_area) : '',
        weekday: '', holiday: '', managerCo: '', contact: formatTel(owner?.phone),
      }],
    hazards: (sections.hazards?.length ?? 0) > 0
      ? sections.hazards!.map(h => ({ place: h.place, location: h.loc, factors: normHazardFactors(h.risks) }))
      : [
        { place: '보일러실', location: '', factors: ['전기적 요인', '가스누출(폭발)'] },
        { place: '주방', location: '', factors: ['부주의', '가스누출(폭발)'] },
        { place: '전기실', location: '', factors: ['전기적 요인'] },
      ],
    // Q-1(M-15, 2026-08-11 사용자 확정): 폴백 인쇄는 유지하되 자동 채움 구획을 미리보기에 표시
    autoFilled: (() => {
      const keys: NonNullable<FirePlanGenData['autoFilled']> = []
      if (brigadeRows.length === 0) keys.push('brigade')
      if ((sections.evacPlan?.routes?.length ?? 0) === 0) keys.push('evacRoutes')
      if (!sections.evacPlan?.assembly) keys.push('assembly')
      if (!sections.evacPlan?.procedure) keys.push('evacNote')
      if (!sections.evacPlan?.falseAlarm) keys.push('evacFalseAlarm')
      if (!sections.evacPlan?.evacMethod) keys.push('evacMethod')
      if ((sections.zones?.length ?? 0) === 0) keys.push('zones')
      if ((sections.hazards?.length ?? 0) === 0) keys.push('hazards')
      // B-5d: 1.3 거리·도착이 캐시 폴백으로 채워졌으면 표시 (서식 1.3 입력이 있으면 템플릿이 그 값 우선)
      if (!sections.location?.distance?.trim() && !sections.location?.eta?.trim() && (cachedDistance || cachedEta)) keys.push('station')
      return keys
    })(),
    revisions,
    photos: photos as PlanPhoto[],
    ops: {
      insuranceJoined: cust.insurance_joined,
      insuranceCompany: cust.insurance_company ?? '',
      insurancePeriod: cust.insurance_period ?? '',
      insuranceAmountPerson: cust.insurance_amount_person ?? '',
      insuranceAmountProperty: cust.insurance_amount_property ?? '',
      opHoursWeekday: cust.op_hours_weekday ?? '',
      opHoursHoliday: cust.op_hours_holiday ?? '',
      headcountWorker: n(cust.headcount_worker),
      headcountResident: n(cust.headcount_resident),
      headcountMax: n(cust.headcount_max),
    },
    // 1.7 managers만 합성본으로 갈아끼운다 — 나머지 장은 저장된 sections 그대로
    forms: { ...sections, managers: managerRows },
  }

  // ── 이미지 수집 (§5) — 슬롯 자산(cover/map_location/evac_*) + 서식 입력 이미지(plan-assets)·사진(photos) ──
  // **어느 그림이 어느 자리에 인쇄되는가**는 순수 함수 `lib/fire-plan-image-refs`가 정한다(2026-09-14 분리).
  // 여기 섞여 있을 때는 DB·스토리지 없이 단언할 길이 없어 이 축의 결함이 두 번 검사 밖에서 샜다.
  const slotAssets = await listCustomerAssets(customerId).catch(() => [])
  const dedupedRefs = planFirePlanImageRefs({ slotAssets, sections, photos })
  const { images, assets } = await collectFirePlanImages(storageDownloader(admin), dedupedRefs)

  // ── 누락 안내 — 워커 process() missing과 동일 어휘(fire-plan-readiness 계열) ──
  const missing = ([
    ['주소', !!cust.address],
    ['사용승인일', !!cust.use_approval_date],
    ['계약일', !!cust.contract_date],
    ['관계인', !!owner],
    ['건물 용도', !!b?.purpose],
    ['연면적', b?.total_area != null],
    ['층수', b?.floors_above != null || b?.floors_below != null],
    ['시설현황', facCodes.length > 0],
    ['수신기위치', !!b?.receiver_location],
    ['구조', !!b?.main_structure],
    ['지붕', !!b?.roof_structure],
    ['선임일', !!cust.manager_selected_at],
    ['급수', !!cust.building_grade],
    ['화재보험', cust.insurance_joined != null],
    ['운영시간', !!cust.op_hours_weekday],
    ['인원', cust.headcount_worker != null || cust.headcount_resident != null || cust.headcount_max != null],
    ['자위소방대', brigadeRows.length > 0],
  ] as Array<[string, boolean]>).filter(([, has]) => !has).map(([label]) => label)

  return { data, images, assets, missing }
}

// firePlanSourceHash·generateFirePlanNow 삭제(2026-09-02 보관함 폐지) —
// '저장본이 최신인가' 판정과 파일 등록(버킷 업로드 → fire_plans insert/reissue →
// appendGeneratedRevision 자동 이력)은 저장본 자체가 사라지며 성립하지 않는다.
// 즉석 PDF 라우트가 매번 assembleFirePlan → buildFirePlanHtml → Gotenberg로 만든다(항상 최신).
// lib/fire-plan-revisions.ts(자동 이력 헬퍼)도 함께 삭제 — 개정이력은 수동 기록만 남는다.
