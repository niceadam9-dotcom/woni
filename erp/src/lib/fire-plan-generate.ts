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
import type { ManagerRow } from '@/components/customers/plan-form17'
import { toStandardCodes } from '@/lib/facility-codes'
import { formatBizNo, formatTel } from '@/lib/format-contact'
import { listCustomerAssets, ASSET_BUCKET } from '@/lib/customer-assets'

type Admin = ReturnType<typeof createAdminClient>

const BUCKET = ASSET_BUCKET // 'fire-plans'

const IMG_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
}

/** M-1(소방계획서_15): 서식 1.2는 짧은 라벨('전기')로 저장하는데 템플릿 체크박스는 긴 라벨('전기적 요인') 기준 includes 비교라
 *  실입력 체크가 전부 ☐로 인쇄됐다. 조립에서 짧은→긴 라벨로 정규화한다. 긴 라벨 저장분(폴백 프리셋·과거 데이터)은
 *  매핑에 없어 그대로 통과 — 양방향 호환, 데이터 마이그레이션 불필요. */
const HAZARD_LABEL_LONG: Record<string, string> = {
  '전기': '전기적 요인', '기계': '기계적 요인', '화학': '화학적 요인', '가스누출': '가스누출(폭발)',
}
const normHazardFactors = (risks: string[]) => risks.map(r => HAZARD_LABEL_LONG[r] ?? r)

export type FirePlanAsset = { name: string; data: Uint8Array; mime: string }
export type FirePlanImageRef = { file: string; kind: string; caption: string }

export type AssembledFirePlan = {
  data: FirePlanGenData
  images: FirePlanImageRef[]
  assets: FirePlanAsset[]
  missing: string[]
}

// loadPresetPairs 삭제(2026-08-19) — 공통 수기 프리셋 폐지. fire-plan-presets.ts 주석 참조.

/** 스토리지 이미지 수집 — 경로 중복 제거, 실패 항목은 건너뜀(fail-soft) */
async function collectImages(
  admin: Admin,
  refs: Array<{ path: string; kind: string; caption: string }>,
): Promise<{ images: FirePlanImageRef[]; assets: FirePlanAsset[] }> {
  const images: FirePlanImageRef[] = []
  const assets: FirePlanAsset[] = []
  const seen = new Set<string>()
  let i = 0
  for (const r of refs) {
    const path = r.path?.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    const ext = (path.split('.').pop() ?? '').toLowerCase()
    const mime = IMG_MIME[ext]
    if (!mime) continue
    try {
      const { data } = await admin.storage.from(BUCKET).download(path)
      if (!data) continue
      const file = `img_${i++}.${ext}`
      assets.push({ name: file, data: new Uint8Array(await data.arrayBuffer()), mime })
      images.push({ file, kind: r.kind, caption: r.caption })
    } catch {
      /* 이미지 1장 실패로 생성을 막지 않음 */
    }
  }
  return { images, assets }
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
      .select('id, purpose, total_area, building_area, floors_above, floors_below, height, receiver_location, main_structure, roof_structure, '
        + 'stairs_count, ramp_count, evac_elevator_count, elevator_count, emergency_elevator_count')
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
    elevator_count: number | null; emergency_elevator_count: number | null
  }>
  const b = buildings[0]
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
    rampCount: nz(b?.ramp_count),
    elevators: {
      passenger: nz(b?.elevator_count),
      emergency: nz(b?.emergency_elevator_count),
      evac: nz(b?.evac_elevator_count),
    },
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
  // 소방계획서_11 §13-B: 종전에는 출처별로 그냥 쌓기만 해서 같은 용도의 이미지가 두 출처에 있으면
  // 문서에 2장 인쇄됐다(위치도 = 슬롯 + 서식 1.3, 피난안내도 = 슬롯 + 3.4).
  // 규칙 ① kind별로 **가장 상위 출처만** 인쇄 ② cover·map은 그 안에서도 1장만.
  //   우선순위 1 슬롯 자산(자동 생성·붙여넣기를 가진 단일 원천) > 2 서식 입력 > 3 삽입 사진(레거시)
  const PRIORITY_SLOT = 1
  const PRIORITY_FORM = 2
  const PRIORITY_PHOTO = 3
  const SINGLE_KINDS = new Set(['cover', 'map'])   // 문서에서 자리가 1칸인 용도

  const slotAssets = await listCustomerAssets(customerId).catch(() => [])
  const refs: Array<{ path: string; kind: string; caption: string; priority: number }> = []
  for (const a of slotAssets) {
    const kind = a.slot === 'cover' ? 'cover' : a.slot === 'map_location' ? 'map' : 'evacuation'
    refs.push({ path: a.path, kind, caption: '', priority: PRIORITY_SLOT })
  }
  const fSec = sections
  if (fSec.location?.mapImage) refs.push({ path: fSec.location.mapImage, kind: 'map', caption: '위치도', priority: PRIORITY_FORM })
  if (fSec.fireAccess?.routeImage) refs.push({ path: fSec.fireAccess.routeImage, kind: 'route', caption: '소방차 진입경로', priority: PRIORITY_FORM })
  for (const m of fSec.evacMaps ?? []) {
    if (m.image) refs.push({ path: m.image, kind: 'evacmap', caption: [m.floor, m.desc].filter(Boolean).join(' — '), priority: PRIORITY_FORM })
  }
  if (fSec.evacPlan?.mapImage) refs.push({ path: fSec.evacPlan.mapImage, kind: 'evacuation', caption: '피난경로도', priority: PRIORITY_FORM })
  for (const p of photos) refs.push({ path: p.path, kind: p.kind, caption: p.caption, priority: PRIORITY_PHOTO })

  const bestPriority = new Map<string, number>()
  for (const r of refs) bestPriority.set(r.kind, Math.min(bestPriority.get(r.kind) ?? 99, r.priority))
  const taken = new Set<string>()
  const dedupedRefs = refs
    .filter(r => r.priority === bestPriority.get(r.kind))
    .filter(r => {
      if (!SINGLE_KINDS.has(r.kind)) return true
      if (taken.has(r.kind)) return false
      taken.add(r.kind)
      return true
    })
  const { images, assets } = await collectImages(admin, dedupedRefs)

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
