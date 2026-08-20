import 'server-only'

/** 소방계획서 서버 동기 생성 (소방계획서_7 H-12·H-13)
 *
 *  기존 워커(scripts/fireplan-worker.py process — SDK HWP 병합)의 데이터 조립을 TS로 완결 이식:
 *  고객·건물·시설·관계인·자위소방대·fire_plan_forms.sections를 모아
 *  buildFirePlanHtml(웹 템플릿 v2) → Gotenberg PDF → fire-plans 버킷 업로드 → fire_plans 등록.
 *  §6: hwp_path는 신규 기록하지 않고 pdf_status는 즉시 'ready' (2단계 변환 없음). */

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { appendGeneratedRevision } from '@/lib/fire-plan-revisions'
import {
  buildFirePlanHtml, FACILITY_FORM, pickFirePlanManager,
  type FirePlanGenData, type FirePlanFormSections, type PlanPhoto,
} from '@/lib/fire-plan-template'
import { toStandardCodes } from '@/lib/facility-codes'
import { formatBizNo, formatTel } from '@/lib/format-contact'
import { convertHtmlToPdf } from '@/lib/pdf'
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
  const [custRes, contactRes, bldRes, companyRes, formRes, brigadeRes, plansRes, revRowsRes] = await Promise.all([
    admin.from('customers')
      .select('customer_name, address, use_approval_date, fire_station, inspection_type, plan_anchor_date, contract_date, '
        + 'building_grade, manager_selected_at, insurance_joined, insurance_company, insurance_period, '
        + 'insurance_amount_person, insurance_amount_property, op_hours_weekday, op_hours_holiday, '
        + 'headcount_worker, headcount_resident, headcount_max, '
        // M-3(소방계획서_15): 1.1 운영현황 확장 3컬럼 — 입력받고도 select 누락으로 본문에 나가지 않던 것
        + 'rep_role, manager_license_grade, manager_edu_date')
      .eq('id', customerId).single(),
    admin.from('customer_contacts').select('role, name, phone').eq('customer_id', customerId),
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
    admin.from('fire_plans').select('year, revision, note, created_at').eq('customer_id', customerId).order('created_at', { ascending: true }),
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
  } | null
  if (!cust) throw new Error('고객을 찾을 수 없습니다')

  const contacts = (contactRes.data ?? []) as Array<{ role: string; name: string; phone: string | null }>
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

  // M-8(소방계획서_15): 소방안전관리자 = 1.7 선임현황 1순위 → 관계인 대표 폴백(종전 동작).
  // 1.7에는 전화 열이 없어, 선임자가 대표와 동일인일 때만 대표 전화를 사용한다(타인 전화 오기재 방지).
  // (B-5b에서 개정이력 폴백 작성자로도 쓰므로 revisions보다 먼저 계산)
  const mgrRow = pickFirePlanManager(sections.managers)
  const managerName = mgrRow?.name ?? owner?.name ?? ''
  const managerPhone = managerName === (owner?.name ?? '') ? (owner?.phone ?? '') : ''

  // 개정이력 — 마이그레이션 120 fire_plan_revisions가 단일 원천 (소방계획서_17 §2-4).
  // 행이 하나도 없으면(백필 전·조회 실패) 종전 경로(fire_plans 파생)로 폴백해 표가 비지 않게 한다.
  // B-5b(소방계획서_19 M-13): 폴백 행 작성자도 공란 대신 소방안전관리자(선임자→대표) — 120 경로의
  // appendGeneratedRevision authorName 규약과 동일. 검토·승인은 수기 서명 운용이라 빈칸 유지.
  const revisions = revRowsRes.data && revRowsRes.data.length > 0
    ? (revRowsRes.data as Array<{
        revised_on: string | null; content: string | null
        author_name: string | null; reviewer_name: string | null; approver_name: string | null
      }>).map(r => ({
        date: (r.revised_on ?? '').slice(0, 10),
        note: r.content ?? '',
        author: r.author_name ?? '',
        reviewer: r.reviewer_name ?? '',
        approver: r.approver_name ?? '',
      }))
    : ((plansRes.data ?? []) as Array<{ year: number; revision: number; note: string | null; created_at: string }>)
      .map(p => ({
        date: p.created_at.slice(0, 10),
        note: p.note ?? `${p.year}년 소방계획서${p.revision > 1 ? ` (개정${p.revision})` : ' 작성'}`,
        author: managerName, reviewer: '', approver: '',
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
    managerSelectedAt: mgrRow?.selectedAt || cust.manager_selected_at || '',
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
    forms: sections,
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

/** 안정 직렬화 — 키 정렬 후 JSON. 같은 내용이면 항상 같은 문자열이 나와야 해시가 흔들리지 않는다
 *  (plan-text-sections.ts planTextBodyEquals의 키 정렬 비교가 선례) */
function stableStringify(v: unknown): string {
  if (v === null || v === undefined || typeof v !== 'object') return JSON.stringify(v ?? null) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
}

/** 조립 결과 해시 (소방계획서_21 R2 / #2 D-7) — 저장된 PDF가 최신인지 판정하는 단일 근거.
 *  fire_plan_forms.updated_at만 보면 고객·건물·설비 대장·자위소방대 변경을 놓치는데
 *  계획서 내용의 상당 부분이 거기서 온다. 인쇄 시 어차피 조립하므로 추가 비용이 거의 없다.
 *  사진(assets)은 **바이트까지** 넣는다 — 같은 파일명으로 교체해도 잡아야 하기 때문이다. */
export function firePlanSourceHash(a: {
  data: FirePlanGenData
  images: FirePlanImageRef[]
  assets: FirePlanAsset[]
}): string {
  const h = createHash('sha1')
  h.update(stableStringify(a.data))
  h.update(stableStringify(a.images))
  // presetPairs 축 제거(2026-08-19 프리셋 폐지) — 해시 입력이 바뀌므로 기존 fire_plans.source_hash는
  // 한 번 불일치로 판정된다. [인쇄]·[PDF]가 그때 한 번 다시 만들고 이후로는 안정된다(내용은 동일).
  for (const asset of [...a.assets].sort((x, y) => x.name.localeCompare(y.name))) {
    h.update(asset.name)
    h.update(asset.data)
  }
  return h.digest('hex')
}

export type FirePlanGenResult = { planId?: string; missing?: string[]; error?: string; sourceHash?: string }

/** 소방계획서 1건 서버 동기 생성 — HTML 렌더 → Gotenberg PDF → 업로드 → fire_plans 등록 (H-13)
 *  §6: hwp 신규 기록 없음, pdf_status 즉시 'ready'. 잡 행 기록은 호출자(액션)가 담당.
 *
 *  mode (소방계획서_21 R2 / #2 D-4·D-5):
 *   - 'revise'(기본)  = 개정 발행. 새 행 + revision +1 + 개정이력 1행 — 사람이 "이 내용으로 확정"할 때만.
 *   - 'reissue'       = **같은 행의 파일만 교체.** 차수·개정이력 불변. [인쇄]가 낡은 PDF를 말없이 갱신하는 경로다.
 *                       targetPlanId 필수. 옛 파일은 교체 성공 후 정리한다. */
export async function generateFirePlanNow(
  admin: Admin,
  opts: {
    customerId: string; year: number; requestedBy?: string | null
    mode?: 'revise' | 'reissue'
    /** mode='reissue'일 때 파일을 갈아끼울 대상 행 */
    targetPlanId?: string
  },
): Promise<FirePlanGenResult> {
  const { customerId, year } = opts
  const mode = opts.mode ?? 'revise'
  if (mode === 'reissue' && !opts.targetPlanId) return { error: '갱신 대상이 지정되지 않았습니다.' }
  try {
    const { data, images, assets, missing } = await assembleFirePlan(admin, customerId, year)
    const sourceHash = firePlanSourceHash({ data, images, assets })
    const html = buildFirePlanHtml(data, images)

    // P-3 생성 품질 게이트(워커 verify_merge 계열) — 값이 있는데 생성물에 없으면 병합 확인 실패
    const text = html.replace(/<[^>]+>/g, ' ')
    for (const [label, value] of [['고객명', data.buildingName], ['주소', data.address]] as Array<[string, string]>) {
      if (value.trim() && !text.includes(value.trim())) missing.push(`병합 확인 실패: ${label}`)
    }

    const pdf = await convertHtmlToPdf(html, assets, { marginMode: 'none', timeoutMs: 120_000 })

    const stamp = Date.now()
    const base = `${customerId}/${year}/generated_web_${stamp}`
    const upHtml = await admin.storage.from(BUCKET)
      .upload(`${base}.html`, new TextEncoder().encode(html), { contentType: 'text/html; charset=utf-8' })
    if (upHtml.error) return { error: `HTML 업로드 실패: ${upHtml.error.message}` }
    const upPdf = await admin.storage.from(BUCKET)
      .upload(`${base}.pdf`, pdf, { contentType: 'application/pdf' })
    if (upPdf.error) {
      await admin.storage.from(BUCKET).remove([`${base}.html`])
      return { error: `PDF 업로드 실패: ${upPdf.error.message}` }
    }

    // ── mode='reissue' — 대상 행의 파일만 교체. 차수·개정이력은 손대지 않는다 (#2 D-4) ──
    if (mode === 'reissue') {
      const { data: target } = await admin.from('fire_plans')
        .select('id, pdf_path, html_path').eq('id', opts.targetPlanId!).single()
      if (!target) {
        await admin.storage.from(BUCKET).remove([`${base}.pdf`, `${base}.html`])
        return { error: '갱신 대상을 찾을 수 없습니다.' }
      }
      const old = target as { id: string; pdf_path: string | null; html_path: string | null }
      const { error: updErr } = await admin.from('fire_plans').update({
        pdf_path: `${base}.pdf`, html_path: `${base}.html`, pdf_status: 'ready', source_hash: sourceHash,
      } as Record<string, unknown>).eq('id', old.id)
      if (updErr) {
        await admin.storage.from(BUCKET).remove([`${base}.pdf`, `${base}.html`])
        return { error: `보관함 갱신 실패: ${updErr.message}` }
      }
      // 교체가 확정된 뒤에만 옛 파일을 지운다 — 먼저 지우면 update 실패 시 복구 불가
      const stale = [old.pdf_path, old.html_path].filter((p): p is string => !!p && p !== `${base}.pdf` && p !== `${base}.html`)
      if (stale.length > 0) await admin.storage.from(BUCKET).remove(stale)
      return { planId: old.id, missing, sourceHash }
    }

    // 보관함 등록 — 개정 차수 = 같은 연도 기존 행 수 + 1 (워커와 동일 규약)
    const { data: existing } = await admin.from('fire_plans')
      .select('id').eq('customer_id', customerId).eq('year', year)
    const revisionNo = (existing?.length ?? 0) + 1
    const { data: inserted, error: insErr } = await admin.from('fire_plans').insert({
      customer_id: customerId,
      year,
      title: `${year}년 소방계획서`,
      pdf_name: `${year}년 소방계획서.pdf`,
      pdf_path: `${base}.pdf`,
      pdf_status: 'ready',
      html_path: `${base}.html`,
      hwp_name: null,
      hwp_path: null,
      revision: revisionNo,
      source_hash: sourceHash,
      note: '자동 생성 (표준양식 웹 템플릿)',
      uploaded_by: opts.requestedBy ?? null,
    } as Record<string, unknown>).select('id').single()
    if (insErr) {
      await admin.storage.from(BUCKET).remove([`${base}.pdf`, `${base}.html`])
      return { error: `보관함 등록 실패: ${insErr.message}` }
    }
    const planId = (inserted as { id: string }).id
    // 개정이력 1행 자동 기록 (120 — 소방계획서_17 §2-2). best-effort:
    // 이력 기록에 실패해도 생성 자체는 되돌리지 않는다(파일은 남는 편이 낫다).
    await appendGeneratedRevision(admin, {
      customerId, year, firePlanId: planId,
      content: `${year}년 소방계획서${revisionNo > 1 ? ` (개정${revisionNo})` : ' 작성'}`,
      source: 'generated',
      authorName: data.managerName,
      createdBy: opts.requestedBy ?? null,
    }).catch(() => {})
    return { planId, missing, sourceHash }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
