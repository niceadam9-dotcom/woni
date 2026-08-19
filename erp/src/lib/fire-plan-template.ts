import 'server-only'

/** 소방계획서 표준양식(2025, 소방청) HTML 템플릿 — ERP 데이터 자동 채움 + 폼 입력 병합 (doc02 §8 A안)
 *  원본: erp_goal/_Data/25년 이후 소방계획서 양식.hwp 구조 추출본 기준.
 *  v1 범위: 표지·개정이력 + 서식 1.1/1.3/1.4/1.7/1.8/1.10.1/1.11.1 + 2.1/2.2 + 3.1/3.4
 *  v2 (소방계획서_7 H-12): 서식 입력 전 장 반영 — 1.5/1.6/1.10.2~4/1.11.2~4/1.12~1.15 +
 *  2장 자위소방대(일반현황·임무·초기대응) + 3장 3.2/3.3/3.5/3.6/3.7 + 지도·사진 슬롯(§5).
 *  데이터 없는 수기 서식은 빈 표로 출력(현행 SDK 생성본과 동등 — 인쇄 후 수기 기입). */

import type { LocationSection, FireAccessSection } from '@/components/customers/plan-form13'
import type { EvacFireSection, EvacMapRow } from '@/components/customers/plan-form15'
import type { EtcFacilitySection } from '@/components/customers/plan-form16'
import type { ManagerRow } from '@/components/customers/plan-form17'
import type { InspectionPlanSection, MultiUseSection, FireHistoryRow, DutyLogRow } from '@/components/customers/plan-form110'
import type { TrainingSection } from '@/components/customers/plan-form111'
import type { LogRow } from '@/components/customers/plan-form1215'
import type { EvacDetailRow, EvacPlanSection, VulnerableSection, EvacEquipRow } from '@/components/customers/plan-ch3'

export type BrigadeRow = { team: string; name: string; duty: string; phone: string }
export type EvacRow = { floor: string; route: string; guide: string; equip: string }
/** 서식 1.2.1 구역별 세부현황 */
export type ZoneRow = { zone: string; name: string; area: string; weekday: string; holiday: string; managerCo: string; contact: string }
/** 서식 1.2.2 화재취약장소 */
export type HazardRow = { place: string; location: string; factors: string[] }
/** 본문 삽입 사진 — path는 스토리지 경로, 생성 시 멀티파트 파일로 첨부 */
export type PlanPhoto = { path: string; kind: 'building' | 'map' | 'evacuation' | 'etc'; caption: string }

export const HAZARD_FACTORS = ['전기적 요인', '기계적 요인', '화학적 요인', '가스누출(폭발)', '부주의', '자연재해'] as const

/** M-8·A9-1(소방계획서_15): 소방안전관리자 = 서식 1.7 선임현황 1순위.
 *  '보조' 행을 제외한, 성명이 있는 첫 행을 선임자로 본다. 없으면 null — 호출부가 관계인 대표로 폴백(종전 동작).
 *  주의: 1.7에는 전화 열이 없다 — 선임자가 대표와 동일인이 아니면 대표 전화를 붙이지 말 것(타인 전화 오기재). */
export function pickFirePlanManager(managers?: ManagerRow[] | null): ManagerRow | null {
  if (!managers?.length) return null
  return managers.find(m => (m.name ?? '').trim() !== '' && !(m.role ?? '').includes('보조')) ?? null
}
export const PHOTO_KINDS: Array<{ value: PlanPhoto['kind']; label: string }> = [
  { value: 'building', label: '건물 전경' },
  { value: 'map', label: '위치도(지도)' },
  { value: 'evacuation', label: '피난경로도' },
  { value: 'etc', label: '기타' },
]

/** 서식 입력 저장소(fire_plan_forms.sections) 원본 — 고객 탭 컴포넌트 export 타입 재사용 (H-12)
 *  zones·hazards·revision·photos·evacPlan(경로/집결지)은 상위 FirePlanGenData에 매핑돼 있으므로 여기서는 나머지 장. */
export type FirePlanFormSections = {
  location?: LocationSection
  fireAccess?: FireAccessSection
  evacFire?: EvacFireSection
  evacMaps?: EvacMapRow[]
  etcFacility?: EtcFacilitySection
  managers?: ManagerRow[]
  inspection?: InspectionPlanSection
  multiUse?: MultiUseSection
  fireHistory?: FireHistoryRow[]
  dutyLog?: DutyLogRow[]
  training?: TrainingSection
  brigadeGeneral?: { type?: string }
  brigadeTeams?: Record<string, string>
  evacDetail?: EvacDetailRow[]
  evacHeadcount?: { note?: string }
  evacPlan?: EvacPlanSection
  vulnerable?: VulnerableSection
  vulnerableMethods?: Record<string, string>
  evacEquip?: EvacEquipRow[]
  fireworkLog?: LogRow[]
  constructionLog?: LogRow[]
  promoLog?: LogRow[]
  recoveryLog?: LogRow[]
  reportCover?: { company?: string; year?: string; sub?: string }  // 보고서 커버 (마지막 페이지, 2026-08-10)
  /** M-18(소방계획서_15, 2026-08-11 보강 확정): 선임·자위대 비상연락체계 — 서식 2.2 편성표 아래 인쇄 */
  emergencyContact?: string
}

/** 서식 1.1 운영현황·화재보험 (고객 마스터 — 워커 build_stage2 병합 항목의 TS 이식) */
export type FirePlanOpsInfo = {
  insuranceJoined: boolean | null
  insuranceCompany: string
  insurancePeriod: string
  insuranceAmountPerson: string
  insuranceAmountProperty: string
  opHoursWeekday: string
  opHoursHoliday: string
  headcountWorker: string
  headcountResident: string
  headcountMax: string
}

export type FirePlanGenData = {
  year: number
  revisionDate: string          // 표지 작성일 = 개정이력 최신 행의 개정일
  revisionNote: string          // (구) 이번 개정 내용 — 개정이력이 테이블로 승격돼 표에는 쓰이지 않는다
  /** 개정이력 (마이그레이션 120 fire_plan_revisions — 전 연도 시계열 오름차순, 소방계획서_17 §2-4) */
  revisions?: Array<{ date: string; note: string; author: string; reviewer?: string; approver?: string }>
  // 서식 1.1 건축물 일반현황
  buildingName: string
  address: string
  grade: string                 // 특급/1급/2급/3급
  purpose: string
  useApprovalDate: string
  totalArea: string             // ㎡
  buildingArea: string
  floors: string                // 예: 지하1층 / 지상5층
  height: string
  structure: string
  roof: string
  receiverLocation: string      // 수신기 위치
  ownerName: string
  ownerPhone: string
  managerName: string           // 소방안전관리자
  managerPhone: string
  managerSelectedAt: string     // 선임일자
  // 서식 1.3
  fireStation: string
  stationDistance: string       // km
  stationEta: string            // 분
  // 서식 1.4 — 설치된 소방시설명 목록 (체크 표시용)
  facilities: string[]
  /** M-4(소방계획서_15): 1.4 항목별 비고 — 설비 대장 detail.note */
  facilityNotes?: Array<{ name: string; note: string }>
  // ── M-2·M-3·M-10(소방계획서_15): 1.1 확장 — 없으면 종전 렌더(하위 호환) ──
  stairsCount?: string          // 계단 개소 (0·미입력은 '')
  rampCount?: string            // 경사로 개소
  elevators?: { passenger: string; emergency: string; evac: string }  // 승용·비상용·피난용 대수
  repRole?: string              // 대표자 구분 (소유자/관리자/점유자)
  managerGrade?: string         // 소방안전관리자 자격구분 (특급~3급)
  managerEduDate?: string       // 최근 강습교육 수료일 — 1.7 자동 폴백 행
  // M-6(소방계획서_15): 1.8 대행업체 대표자·사업자등록번호
  companyRep?: string
  companyBizNo?: string
  /** Q-1(M-15, 2026-08-11 사용자 확정): 조립 폴백으로 자동 채움된 구획 목록 —
   *  화면 미리보기에서만 노랗게 표시(@media screen), Gotenberg PDF(인쇄 매체)에는 나타나지 않는다 */
  autoFilled?: AutofillKey[]
  // 서식 1.8 업무대행 (관리업체)
  companyName: string
  companyAddress: string
  companyPhone: string
  contractStart: string
  inspectionCycle: string       // 매월 1회
  // 서식 1.10.1 자체점검
  operationMonth: string        // 작동점검 시기 (예: 2026년 7월)
  comprehensiveMonth: string    // 종합점검 시기 (종합 대상만, 없으면 '')
  // 서식 1.11.1 훈련·교육 연간계획 (실시 월 1~12) — forms.training이 있으면 그 월 배열 우선.
  // M-7(소방계획서_15): 미입력이면 null — 임의 월(구 11월 고정)을 ■로 인쇄하지 않고 전 월 ☐로 남긴다
  trainingMonth: number | null
  // 제2장 자위소방대
  brigade: BrigadeRow[]
  // 제3장 피난계획
  evacRoutes: EvacRow[]
  assembly: string              // 집결지
  evacNote: string              // 피난유도 방법 서술 (3.4 '화재 시')
  // 3.4 나머지 두 줄 — 종전엔 템플릿에 문자열로 박혀 있어 고객도 라이브러리도 손댈 수 없었고,
  // 공통 수기 프리셋의 전역 치환만이 유일한 변경 수단이었다(2026-08-19 프리셋 폐지로 데이터화)
  evacFalseAlarm: string        // 비화재보 대응
  evacMethod: string            // 대피방법
  // 서식 1.2 건축물 세부현황
  zones: ZoneRow[]
  hazards: HazardRow[]
  // 본문 삽입 사진
  photos: PlanPhoto[]
  // v2 확장 (H-12) — 없으면 v1과 동일 렌더(하위 호환)
  ops?: FirePlanOpsInfo
  forms?: FirePlanFormSections
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const v = (s: string | null | undefined, unit = '') => s?.trim() ? `${esc(s.trim())}${unit}` : '&nbsp;'
const ck = (on: boolean, label: string) => `<span class="ck">${on ? '■' : '☐'} ${esc(label)}</span>`

/** 서식 1.4 소방시설 고정 목록 — 표준 코드 상수 재수출 (마이그레이션 100 이후 DB 코드와 동일) */
import { FACILITY_STANDARD } from './facility-codes'
export const FACILITY_FORM = FACILITY_STANDARD

const GRADES = ['특급', '1급', '2급', '3급']

/** 2장 팀별 임무 — plan-ch2 TEAMS와 동일 키·표준 문구 (입력 없으면 표준 문구 출력) */
const BRIGADE_TEAMS: Array<{ key: string; label: string; preset: string }> = [
  { key: 'command', label: '지휘통제', preset: '자위소방대장은 화재 상황을 판단하고 대원 임무를 지휘·통제하며, 소방대 도착 시 현장 정보를 인계한다.' },
  { key: 'contact', label: '비상연락', preset: '화재 발견 즉시 119에 신고하고 관계인·인근 협력업체 등 비상연락망에 따라 상황을 전파한다.' },
  { key: 'extinguish', label: '초기소화', preset: '소화기·옥내소화전을 사용해 초기 진화를 실시하고, 확산 시 무리한 진압을 중단하고 대피한다.' },
  { key: 'evacuate', label: '피난유도', preset: '재실자를 피난계단으로 유도하고(엘리베이터 사용 금지) 집결지에서 인원을 확인한다.' },
  { key: 'rescue', label: '응급구조', preset: '부상자를 안전한 장소로 옮기고 응급처치를 실시하며, 구급대 도착 시 인계한다.' },
  { key: 'protect', label: '방호안전', preset: '전기·가스 등 위험 설비를 차단하고 위험물 안전조치와 출입 통제를 실시한다.' },
  { key: 'initial', label: '초기대응체계', preset: '근무 인원 중심으로 상시 초기대응체계를 유지하고, 근무시간 외에는 당직자가 초기 대응을 담당한다.' },
]

/** 1.11.3 훈련 시나리오 기본값 — 고객이 시나리오를 입력하지 않았을 때 인쇄되는 표준양식 예시 문구.
 *  종전엔 프리셋이 이 문구들을 유형별로 전역 치환했다(2026-08-19 폐지) — 이제 유형별 시나리오는
 *  '계획서 공통문구' 1.11 섹션의 대안 항목을 고객에게 주입해 training.scenario를 채우는 방식이다. */
const SCENARIO_DEFAULTS: Array<{ label: string; text: string }> = [
  { label: '훈련상황', text: '2층 주방 초기화재' },
  { label: '화재발생 인지', text: '1. 2층 세대에서 연기발생' },
  { label: '화재전파·신고', text: '1. 2층에서 화재발생 구두로 각 세대 전파' },
  { label: '초기소화', text: '소화기를 이용하여 화재진압 실시' },
  { label: '피난 확인', text: '자위소방대 피난유도팀은 피난이 안된 세대 확인 후 소방서 도착시 통보' },
  { label: '안내방송', text: '1층 화재 발생 (최대한 빨리 집결 요함)' },
]

// applyPresetPairs 삭제(2026-08-19) — 완성된 HTML에 find→value를 **문서 전역** 치환하던 함수.
// 폐지 이유: 섹션 범위가 없어 '1층 주차장'(6자) 같은 짧은 앵커가 문서 어디든 바꿨고,
// DB에 없는 문구가 인쇄물에만 존재해 화면과 제출 문서가 갈라졌다.
// 유형별 문구는 '계획서 공통문구'가 고객 서식 값으로 주입한다.

/** 행 수 보정 — 입력이 min행 미만이면 빈 행으로 채워 서식 모양 유지 */
function pad<T>(rows: T[], min: number, empty: T): T[] {
  return rows.length >= min ? rows : [...rows, ...Array.from({ length: min - rows.length }, () => empty)]
}

/** 자산 슬롯 자리표시 (§5) — 미등록이어도 생성은 막지 않음, 안내 1줄 */
function slotPlaceholder(label: string): string {
  return `<div class="slotbox">${esc(label)} 미등록 — 고객 상세 › 소방계획서 탭 › 1.3 위치·소방차진입의 [지도·사진]에서 등록하면 이 자리에 삽입됩니다.</div>`
}

type ImgRef = { file: string; kind: string; caption: string }

/** images: 생성 시 Gotenberg 멀티파트로 첨부되는 파일명 목록
 *  kind: cover(표지)·map(위치도)·building(전경)·route(진입경로)·evacmap(구획 현황도)·evacuation(피난경로도)·etc */
/** Q-1(M-15): 자동 채움 구획 키 — 조립(assembleFirePlan)의 폴백 지점과 1:1 */
export type AutofillKey = 'brigade' | 'evacRoutes' | 'assembly' | 'evacNote'
  | 'evacFalseAlarm' | 'evacMethod' | 'zones' | 'hazards' | 'station'
export const AUTOFILL_LABELS: Record<AutofillKey, string> = {
  brigade: '자위소방대 편성(2.2 기본 5행)',
  evacRoutes: '피난경로(3.4 전층·직통계단)',
  assembly: '집결지(3.4 1층 주차장)',
  evacFalseAlarm: '비화재보 대응(3.4)',
  evacMethod: '대피방법(3.4)',
  evacNote: '피난유도 절차(3.4 기본 문구)',
  zones: '소화·경보 구역(1.2.1 전층)',
  hazards: '화재위험요소(1.2.2 프리셋 3개소)',
  station: '소방서 최단거리·도착시간(1.3 자동조회 캐시)',  // B-5d(소방계획서_19 M-12, Q-4 확정)
}

export function buildFirePlanHtml(
  d: FirePlanGenData,
  images: ImgRef[] = [],
): string {
  const facSet = new Set(d.facilities)
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const f = d.forms ?? {}
  const ops = d.ops

  // Q-1(M-15): 자동 채움 구획의 <tr>에 표시 클래스 부여 — 화면 미리보기 전용(CSS @media screen)
  const af = (k: AutofillKey) => d.autoFilled?.includes(k) ? ' class="autofill"' : ''
  const afc = (k: AutofillKey) => d.autoFilled?.includes(k) ? ' autofill' : ''

  const imgsOf = (kind: string) => images.filter(i => i.kind === kind)
  const imgBlock = (list: Array<{ file: string; caption: string }>, maxH = 300) =>
    list.map(i => `<figure style="margin:6px 0;text-align:center;page-break-inside:avoid">
      <img src="${i.file}" style="max-width:100%;max-height:${maxH}px" />
      ${i.caption ? `<figcaption class="small" style="margin-top:2px">${esc(i.caption)}</figcaption>` : ''}
    </figure>`).join('')

  const zoneRows = (d.zones.length ? d.zones : [{ zone: '', name: '', area: '', weekday: '', holiday: '', managerCo: '', contact: '' }])
    .map(z => `<tr${af('zones')}><td>${v(z.zone)}</td><td class="l">${v(z.name)}</td><td>${v(z.area)}</td><td>${v(z.weekday)}</td><td>${v(z.holiday)}</td><td>${v(z.managerCo)}</td><td>${v(z.contact)}</td></tr>`).join('')

  const hazardRows = (d.hazards.length ? d.hazards : [{ place: '', location: '', factors: [] as string[] }])
    .map(h => `<tr${af('hazards')}><td>${v(h.place)}</td><td class="l">${v(h.location)}</td>
      <td class="l"><div class="ckgrid">${HAZARD_FACTORS.map(fa => ck(h.factors.includes(fa), fa)).join('')}</div></td></tr>`).join('')

  const facilityRows = FACILITY_FORM.map(g => `
    <tr><th class="cat">${esc(g.category)}</th><td><div class="ckgrid">${
      g.items.map(it => ck(facSet.has(it), it)).join('')
    }</div></td></tr>`).join('')

  const monthCells = (marks: number[]) => months.map(m => `<td class="c">${marks.includes(m) ? '■' : '☐'}</td>`).join('')
  const eduMonths = f.training?.eduMonths?.length ? f.training.eduMonths : d.trainingMonth != null ? [d.trainingMonth] : []
  const drillMonths = f.training?.drillMonths?.length ? f.training.drillMonths : d.trainingMonth != null ? [d.trainingMonth] : []

  const brigadeRows = (d.brigade.length ? d.brigade : [{ team: '', name: '', duty: '', phone: '' }])
    .map(b => `<tr${af('brigade')}><td>${v(b.team)}</td><td>${v(b.name)}</td><td class="l">${v(b.duty)}</td><td>${v(b.phone)}</td></tr>`).join('')

  const evacRows = (d.evacRoutes.length ? d.evacRoutes : [{ floor: '', route: '', guide: '', equip: '' }])
    .map(r => `<tr${af('evacRoutes')}><td>${v(r.floor)}</td><td class="l">${v(r.route)}</td><td>${v(r.guide)}</td><td>${v(r.equip)}</td></tr>`).join('')

  // ── 1.1 운영현황·화재보험 (ops 없으면 v1과 동일 빈 체크) ──
  const opsRow = ops
    ? `운영시간: ${ck(!!ops.opHoursWeekday, '평일')}${ops.opHoursWeekday ? `(${esc(ops.opHoursWeekday)})` : ''} ${ck(!!ops.opHoursHoliday, '휴일')}${ops.opHoursHoliday ? `(${esc(ops.opHoursHoliday)})` : ''} &nbsp;/&nbsp; `
      + `인원현황: ${ck(!!ops.headcountWorker, '근무인원')} (${v(ops.headcountWorker)}명) ${ck(!!ops.headcountResident, '거주인원')} (${v(ops.headcountResident)}명) ${ck(!!ops.headcountMax, '최대수용인원')} (${v(ops.headcountMax)}명)`
    : '운영시간: ☐ 평일 ☐ 휴일 &nbsp;/&nbsp; 인원현황: ☐ 근무인원 (&nbsp;&nbsp;&nbsp;명) ☐ 거주인원 (&nbsp;&nbsp;&nbsp;명) ☐ 최대수용인원 (&nbsp;&nbsp;&nbsp;명)'
  const insRow = ops
    ? `${ck(ops.insuranceJoined === true, '가입')} ${ck(ops.insuranceJoined === false, '미가입')} &nbsp; 보험사: ${v(ops.insuranceCompany)} &nbsp; 가입기간: ${v(ops.insurancePeriod)} &nbsp; 가입금액: 대인 ${v(ops.insuranceAmountPerson)} / 대물 ${v(ops.insuranceAmountProperty)}`
    : '☐ 가입 ☐ 미가입 &nbsp; 보험사: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 가입기간: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 가입금액: 대인&nbsp;&nbsp;&nbsp;&nbsp;원 / 대물&nbsp;&nbsp;&nbsp;&nbsp;원'

  // ── 1.3 위치·진입 (forms.location / forms.fireAccess) ──
  const loc = f.location
  const acc = f.fireAccess
  const fireStation = loc?.fireStation?.trim() ? loc.fireStation : d.fireStation
  const stationDistance = loc?.distance?.trim() ? loc.distance : d.stationDistance
  const stationEta = loc?.eta?.trim() ? loc.eta : d.stationEta

  // ── 1.5 피난·방화시설 ──
  const ef = f.evacFire
  const stairKinds = ['직통계단', '피난계단', '특별피난계단', '옥외계단']
  const etcEvacKinds = ['대피공간', '경량칸막이', '피난안전구역', '옥상광장']
  const compartmentLabel = (c: EvacFireSection['compartment'] | undefined) =>
    `${ck(c === 'none', '해당없음')} ${ck(c === 'area', '면적별')} ${ck(c === 'floor', '층별')}`
  const evacMaps = f.evacMaps ?? []

  // ── 1.6 기타시설 ──
  const etc = f.etcFacility
  // ── 1.10 ──
  const insp = f.inspection
  const opMonthText = insp?.opMonth?.trim() ? insp.opMonth : d.operationMonth
  const compMonthText = insp?.compMonth?.trim() ? insp.compMonth : d.comprehensiveMonth
  const opInspector = insp?.opInspector || '외주'
  const compInspector = insp?.compInspector || '외주'
  const dutyRows = pad(f.dutyLog ?? [], 5, { date: '', content: '', action: '', note: '' })
    .map(r => `<tr><td>${v(r.date)}</td><td class="l">${v(r.content)}</td><td class="l">${v(r.action)}</td><td>${v(r.note)}</td></tr>`).join('')
  const mu = f.multiUse
  const muCats = mu ? Object.entries(mu.categories ?? {}).map(([k, c]) => c ? `${k}(${c})` : k).join(', ') : ''
  const histRows = pad(f.fireHistory ?? [], 3, { kind: '화재', at: '', place: '', cause: '', action: '' } as FireHistoryRow)
    .map((r, i) => `<tr><td>${(f.fireHistory?.length ?? 0) > i ? v(r.kind) : '&nbsp;'}</td><td>${v(r.at)}</td><td>${v(r.place)}</td><td class="l">${v(r.cause)}</td><td class="l">${v(r.action)}</td></tr>`).join('')

  // ── 1.11 ──
  const tr = f.training
  // M-19(소방계획서_15): 종류·형태 구조화 표기 — 구조화 값 우선, 없으면 레거시 자유 텍스트(kind·form)
  const detailKind = (r: NonNullable<NonNullable<typeof tr>['details']>[number]) => {
    const parts = [r.kindPractice ? `실습(${r.kindPractice})` : '', r.kindTheory ? `이론(${r.kindTheory})` : ''].filter(Boolean)
    return parts.length ? parts.join('·') : r.kind
  }
  const detailForm = (r: NonNullable<NonNullable<typeof tr>['details']>[number]) => {
    const ft = r.formType || (r.form === '자체' || r.form === '합동' ? r.form : '')
    if (!ft) return r.form
    return ft === '합동' ? `합동${r.formPartner?.trim() ? `(${r.formPartner})` : ''}` : '자체'
  }
  const detailRows = (tr?.details ?? []).map(r =>
    `<tr><td>${v(r.name)}</td><td>${v(r.at)}</td><td>${v(r.place)}</td><td>${v(r.target)}</td><td>${v(detailKind(r))}</td><td>${v(detailForm(r))}</td><td class="l">${v(r.materials)}</td><td class="l">${v(r.plan)}</td></tr>`).join('')
  const recordRows = pad(tr?.records ?? [], 3, { at: '', kind: '', attendees: '', content: '', evaluation: '' })
    .map(r => `<tr><td>${v(r.at)}</td><td>${v(r.kind)}</td><td>${v(r.attendees)}</td><td class="l">${v(r.content)}</td><td class="l">${v(r.evaluation)}</td></tr>`).join('')

  // ── 1.12~1.15 기록부 (plan-form1215 CARDS와 동일 열) ──
  const logTable = (rows: LogRow[] | undefined, cols: Array<{ k: string; label: string; w?: string; l?: boolean }>, min = 3) => `
  <table class="small">
    <tr>${cols.map(c => `<th${c.w ? ` style="width:${c.w}"` : ''}>${esc(c.label)}</th>`).join('')}</tr>
    ${pad(rows ?? [], min, {} as LogRow).map(r =>
      `<tr>${cols.map(c => `<td${c.l ? ' class="l"' : ''}>${v(r[c.k])}</td>`).join('')}</tr>`).join('')}
  </table>`

  // ── 2장 ──
  const bg = f.brigadeGeneral?.type ?? ''
  const teamText = (key: string) => {
    const input = (f.brigadeTeams ?? {})[key]?.trim()
    return input || BRIGADE_TEAMS.find(t => t.key === key)?.preset || ''
  }
  const teamRows = BRIGADE_TEAMS
    .map(t => `<tr><th style="width:110px">${esc(t.label)}</th><td class="l">${v(teamText(t.key))}</td></tr>`).join('')

  // ── 3장 ──
  const detail3Rows = pad(f.evacDetail ?? [], 3, { facility: '', location: '', status: '' })
    .map(r => `<tr><td>${v(r.facility)}</td><td class="l">${v(r.location)}</td><td class="l">${v(r.status)}</td></tr>`).join('')
  const vul = f.vulnerable
  const vulTypes = ['노인', '어린이', '영유아', '임산부', '장애인', '기타']
  const methods = f.vulnerableMethods ?? {}
  const equipRows = pad(f.evacEquip ?? [], 3, { name: '', location: '', qty: '' })
    .map(r => `<tr><td class="l">${v(r.name)}</td><td class="l">${v(r.location)}</td><td>${v(r.qty)}</td></tr>`).join('')

  const coverImgs = imgsOf('cover')
  const mapImgs = imgsOf('map')
  const evacImgs = imgsOf('evacuation')

  // 보고서 커버 (마지막 페이지, 2026-08-10) — 빈 값은 자동값(연도=생성 연도, 업체명=고객명).
  // 앞표지 연도 표기도 이 값을 따라 앞뒤가 어긋나지 않게 한다 (생성 바 연도 입력칸 폐지의 단일 표기처).
  const rc = f.reportCover
  const coverYear = (rc?.year ?? '').trim() || String(d.year)
  const coverCompany = (rc?.company ?? '').trim() || d.buildingName

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; font-size: 10.5px; color: #111; margin: 0; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  h1 { font-size: 30px; text-align: center; margin: 36px 0 8px; letter-spacing: 6px; }
  h2 { font-size: 15px; border-left: 5px solid #333; padding-left: 8px; margin: 22px 0 8px; }
  h3 { font-size: 12px; margin: 14px 0 6px; }
  .formno { display: inline-block; border: 1.5px solid #333; padding: 2px 10px; font-weight: bold; font-size: 11px; margin: 14px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; table-layout: fixed; }
  th, td { border: 1px solid #555; padding: 4px 6px; text-align: center; vertical-align: middle; word-break: break-all; }
  th { background: #efefef; font-weight: 600; }
  td.l, th.l { text-align: left; }
  th.cat { width: 84px; }
  .ckgrid { display: flex; flex-wrap: wrap; gap: 3px 12px; text-align: left; }
  .ck { white-space: nowrap; }
  .note { font-size: 9.5px; color: #333; margin: 2px 0 10px; }
  .cover { text-align: center; padding-top: 110px; }
  .cover .name { font-size: 22px; margin: 24px 0 30px; }
  .cover .co { font-size: 14px; margin-top: 12px; }
  td.c { width: 22px; padding: 3px 0; }
  .small { font-size: 9.5px; }
  .slotbox { border: 1.5px dashed #999; border-radius: 6px; padding: 26px 10px; text-align: center; color: #666; font-size: 10px; margin: 8px 0; }
  /* Q-1(M-15): 자동 채움 표시 — 화면 미리보기 전용. Gotenberg PDF는 인쇄 매체라 @media screen 미적용 */
  .autofill-banner { display: none; }
  @media screen {
    .autofill { background: #fff7cc; box-shadow: inset 0 0 0 1px #e0c26a; }
    .autofill-banner { display: block; background: #fff7cc; border: 1px solid #e0c26a; border-radius: 6px;
      padding: 8px 12px; margin: 10px 0; font-size: 11px; color: #6b5900; }
  }
</style></head><body>
${(d.autoFilled?.length ?? 0) > 0
    ? `<div class="autofill-banner">⚠ 자동 채움(미입력 폴백): ${d.autoFilled!.map(k => AUTOFILL_LABELS[k]).join(', ')}
 — 노란 표시는 화면 미리보기 전용이며 PDF·인쇄물에는 나타나지 않습니다. 실제 값은 소방계획서 탭 해당 서식에서 입력하세요.</div>`
    : ''}

<!-- 표지 -->
<div class="page cover">
  <h1>소 방 계 획 서</h1>
  <p style="font-size:16px">${esc(coverYear)}년도</p>
  <p class="name">[ ${esc(d.buildingName)} ]</p>
  ${coverImgs.length ? imgBlock(coverImgs, 320) : slotPlaceholder('표지 건물 사진')}
  <p class="co">작성일: ${v(d.revisionDate)}</p>
  <p class="co">소방안전관리자: ${v(d.managerName)}</p>
  <p class="co">업무대행: ${v(d.companyName)}</p>
</div>

<!-- 개정이력 + 서식 1.1 -->
<div class="page">
  <h2>소방계획서 개정이력</h2>
  <table>
    <tr><th style="width:36px">순번</th><th style="width:70px">일자</th><th>주요 개정내용</th><th style="width:70px">작성자</th><th style="width:56px">검토</th><th style="width:56px">승인</th></tr>
    ${/* 개정이력은 전 연도 시계열 통합 — 화면만 연도별로 접어 보여준다(법정 서식은 문서 전체의 이력) */''}
    ${(d.revisions ?? []).map((r, i) => `<tr><td>${i + 1}</td><td>${v(r.date)}</td><td class="l">${v(r.note)}</td><td>${v(r.author)}</td><td>${v(r.reviewer ?? '')}</td><td>${v(r.approver ?? '')}</td></tr>`).join('')}
    ${Array.from({ length: 7 }, (_, i) => `<tr><td>${(d.revisions?.length ?? 0) + i + 1}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')}
  </table>

  <h2>제1장 소방안전관리계획</h2>
  <p class="formno">서식 1.1</p><h3 style="display:inline;margin-left:8px">건축물 일반현황</h3>
  <p class="note">※ □에는 해당되는 곳에 √표를 합니다.</p>
  <table>
    <tr><th style="width:80px">명칭</th><td colspan="3" class="l">${v(d.buildingName)}</td></tr>
    <tr><th>도로명주소</th><td colspan="3" class="l">${v(d.address)}</td></tr>
    <tr><th>연락처</th><td class="l">대표자(책임자): ${v(d.ownerName)}${d.repRole ? ` [${esc(d.repRole)}]` : ''} / ${v(d.ownerPhone)}</td>
        <td colspan="2" class="l">소방안전관리자: ${v(d.managerName)}${d.managerGrade ? ` (${esc(d.managerGrade)})` : ''} / ${v(d.managerPhone)}</td></tr>
    <tr><th rowspan="5">시설현황</th><td class="l">수신기위치: ${v(d.receiverLocation)}</td>
        <td colspan="2" class="l">대상물 급수: ${GRADES.map(g => ck(d.grade === g, g)).join(' ')}</td></tr>
    <tr><td class="l">주용도: ${v(d.purpose)}</td><td class="l">사용승인일: ${v(d.useApprovalDate)}</td><td class="l">연면적: ${v(d.totalArea, ' ㎡')}</td></tr>
    <tr><td class="l">건축면적: ${v(d.buildingArea, ' ㎡')}</td><td class="l">층수: ${v(d.floors)}</td><td class="l">높이: ${v(d.height, ' m')}</td></tr>
    <tr><td class="l">구조: ${v(d.structure)}</td><td colspan="2" class="l">지붕: ${v(d.roof)}</td></tr>
    ${/* M-2·M-10(소방계획서_15): 승강기 3종은 건물·고객 원천 연결(대수 병기), 계단·경사로 개소 병기 — 값 없으면 종전 ☐/미표기 */''}
    <tr><td colspan="3" class="l">승강기: ${ck(!!d.elevators?.passenger, '승용')}${d.elevators?.passenger ? `(${esc(d.elevators.passenger)}대)` : ''} ${ck(!!d.elevators?.emergency, '비상용')}${d.elevators?.emergency ? `(${esc(d.elevators.emergency)}대)` : ''} ${ck(!!d.elevators?.evac, '피난용')}${d.elevators?.evac ? `(${esc(d.elevators.evac)}대)` : ''} &nbsp;/&nbsp; 계단: ${stairKinds.map(k => ck(!!ef?.stairs?.[k], k)).join(' ')}${d.stairsCount ? ` (${esc(d.stairsCount)}개소)` : ''}${d.rampCount ? ` / 경사로 ${esc(d.rampCount)}개소` : ''}</td></tr>
    <tr><th>운영현황</th><td colspan="3" class="l">${opsRow}</td></tr>
    <tr><th>업무대행</th><td colspan="3" class="l">■ 해당 [서식1.8] 작성 &nbsp; ☐ 해당없음</td></tr>
    <tr><th>화재보험<br><span class="small">(관계인 기록)</span></th><td colspan="3" class="l">${insRow}</td></tr>
  </table>
</div>

<!-- 서식 1.2 건축물 세부현황 -->
<div class="page">
  <p class="formno">서식 1.2</p><h3 style="display:inline;margin-left:8px">건축물 세부현황</h3>
  <h3>1.2.1 구역별 세부현황</h3>
  <table class="small">
    <tr><th style="width:70px">구역별<br>(동/층)</th><th>명칭/용도</th><th style="width:70px">(바닥)면적</th>
        <th style="width:80px">인원 평일<br>(주간/야간)</th><th style="width:80px">인원 휴일<br>(주간/야간)</th>
        <th style="width:90px">관리주체<br>(입주사)</th><th style="width:100px">담당자<br>(연락처)</th></tr>
    ${zoneRows}
  </table>
  <p class="note">※ 비고 1. 소방안전관리자는 구역별 인원현황 및 운영현황을 주기적으로 확인해야 한다.
    2. 근무자·거주자 인원현황은 상시 근무·거주 인원을 파악하여 작성한다.</p>

  <h3>1.2.2 화재취약장소/인명피해우려장소 현황</h3>
  <p class="note">※ □에는 해당되는 곳에 √표를 합니다.</p>
  <table class="small">
    <tr><th style="width:90px">화재취약장소</th><th style="width:110px">위치</th><th>화재위험요소</th></tr>
    ${hazardRows}
  </table>
  <p class="note">※ 비고. 소방안전관리자는 대상물의 구역별(동별, 층별) 화재취약장소 및 인명피해우려장소에 대한 현황을 파악하고,
    이에 대한 화재예방대책, 자위소방대 운영계획 및 피난계획을 수립해야 한다.</p>
</div>

<!-- 서식 1.3 위치·운영현황·소방차 진입 -->
<div class="page">
  <p class="formno">서식 1.3</p><h3 style="display:inline;margin-left:8px">건축물 위치·운영현황 및 소방차 세부진입 계획</h3>
  <table>
    <tr><th style="width:130px">관할소방서<br><span class="small">(119안전센터)</span></th><td class="l">${v(fireStation)}</td>
        <th style="width:80px">최단거리</th><td${d.autoFilled?.includes('station') && !loc?.distance?.trim() ? ' class="autofill"' : ''}>${v(stationDistance, ' km')}</td>
        <th style="width:90px">예상도착시간</th><td${d.autoFilled?.includes('station') && !loc?.eta?.trim() ? ' class="autofill"' : ''}>${v(stationEta, ' 분')}</td></tr>
    <tr><th>수신기 위치</th><td class="l" colspan="3">${v(d.receiverLocation)}</td>
        <th>운영현황</th><td class="l">${v(loc?.operation)}</td></tr>
    <tr><th>주변 현황</th><td class="l" colspan="5">${v(loc?.surroundings)}</td></tr>
    <tr><th>소방차 진입경로</th><td class="l" colspan="5">${v(acc?.routeDesc)}</td></tr>
    <tr><th>진입 지점</th><td class="l" colspan="3">${v(acc?.entryPoint)}</td>
        <th>인근 소방시설</th><td class="l">${v(acc?.nearbyFacilities)}</td></tr>
  </table>
  <h3>건축물 위치도</h3>
  ${mapImgs.length ? imgBlock(mapImgs, 340) : slotPlaceholder('위치도(약도)')}
  ${imgsOf('route').length ? `<h3>소방차 진입경로</h3>${imgBlock(imgsOf('route'), 300)}` : ''}
  ${imgsOf('building').length ? `<h3>건물 전경</h3>${imgBlock(imgsOf('building'), 300)}` : ''}
</div>

<!-- 서식 1.4 + 1.7 + 1.8 -->
<div class="page">
  <p class="formno">서식 1.4</p><h3 style="display:inline;margin-left:8px">소방시설 현황</h3>
  <p class="note">■ 대상명 : ${esc(d.buildingName)} &nbsp;&nbsp; ※ □에는 해당되는 곳에 √표를 합니다.</p>
  <table>${facilityRows}</table>
  ${(d.facilityNotes?.length ?? 0) > 0
    ? `<p class="note">※ 항목별 비고: ${d.facilityNotes!.map(fn => `${esc(fn.name)} — ${esc(fn.note)}`).join(' &nbsp;/&nbsp; ')}</p>`
    : ''}
  <p class="note">※ 비고 1. 각 소방시설 설치장소·규격 등은 소방시설 자체점검표 참조 &nbsp; 2. 건물군 관리 시 대상물별 추가 작성</p>

  <p class="formno">서식 1.7</p><h3 style="display:inline;margin-left:8px">소방안전관리(보조)자 등 선임현황</h3>
  <table class="small">
    <tr><th>구분</th><th>소속</th><th>선임자 성명</th><th>선임일자</th><th style="width:76px">강습교육<br>수료일</th><th>담당업무</th></tr>
    ${(f.managers?.length ?? 0) > 0
      ? f.managers!.map(m => `<tr><td>${v(m.role)}</td><td>${v(m.affiliation)}</td><td>${v(m.name)}</td><td>${v(m.selectedAt)}</td><td>${v(m.eduAt)}</td><td class="l small">${v(m.duty)}</td></tr>`).join('')
      : `<tr><td>소방안전관리자</td><td>${v(d.buildingName)}</td><td>${v(d.managerName)}</td><td>${v(d.managerSelectedAt)}</td><td>${v(d.managerEduDate)}</td><td class="l small">소방안전관리자의 업무</td></tr>`}
  </table>

  <p class="formno">서식 1.8</p><h3 style="display:inline;margin-left:8px">업무대행 현황</h3>
  <table>
    <tr><th style="width:90px">대행여부</th><td class="l" colspan="3">■ 해당 (${GRADES.map(g => ck(d.grade === g, g)).join(' ')})</td></tr>
    <tr><th>업 체 명</th><td class="l">${v(d.companyName)}</td><th style="width:90px">연락처</th><td class="l">${v(d.companyPhone)}</td></tr>
    ${/* M-6(소방계획서_15): 대표자·사업자등록번호 — ERP 회사 정보에 있던 값이 유실되던 결함 복구 */''}
    <tr><th>대 표 자</th><td class="l">${v(d.companyRep)}</td><th>사업자등록번호</th><td class="l">${v(d.companyBizNo)}</td></tr>
    <tr><th>업체주소</th><td class="l" colspan="3">${v(d.companyAddress)}</td></tr>
    <tr><th>계약기간</th><td class="l">${v(d.contractStart)} ~</td><th>점검주기</th><td class="l">${v(d.inspectionCycle)}</td></tr>
    <tr><th>계약범위</th><td class="l" colspan="3">소방시설</td></tr>
    <tr><th>감독사항</th><td class="l" colspan="3">점검 후 소방안전관리업무 대행 점검표 확인 후 서명</td></tr>
  </table>
  <p class="note">※ 업무대행 점검 기술인력은 대행 시 '소방안전관리업무 대행 점검표'를 작성하고 소방안전관리자(또는 관계인)에게 점검결과를 설명·제출하여야 한다.</p>
</div>

<!-- 서식 1.5 피난·방화시설 -->
<div class="page">
  <p class="formno">서식 1.5</p><h3 style="display:inline;margin-left:8px">피난·방화시설 및 제연·방염 현황</h3>
  <h3>1.5.1 일반현황</h3>
  <table>
    <tr><th style="width:90px">계단</th><td class="l" colspan="3"><div class="ckgrid">${
      stairKinds.map(k => `${ck(!!ef?.stairs?.[k], k)}${ef?.stairs?.[k] ? ` <span class="small">(${esc(ef.stairs[k])}개소)</span>` : ''}`).join('')
    }</div></td></tr>
    <tr><th>기타 피난시설</th><td class="l" colspan="3"><div class="ckgrid">${
      etcEvacKinds.map(k => ck(!!ef?.etc?.includes(k), k)).join('')
    }</div>${ef?.etcNote?.trim() ? `<div class="small">${esc(ef.etcNote)}</div>` : ''}</td></tr>
    <tr><th>피난층</th><td class="l">위치: ${v(ef?.evacFloor?.location)}</td>
        <td class="l">출입구 수: ${v(ef?.evacFloor?.exits)}</td>
        <td class="l">개방 방식: ${v(ef?.evacFloor?.openMethod)}</td></tr>
    <tr><th>방화구획</th><td class="l" colspan="3">${compartmentLabel(ef?.compartment)}</td></tr>
    <tr><th>방화문</th><td class="l" colspan="3">${ck(!!ef?.fireDoor?.has, '설치')} ${ck(!!ef && !ef.fireDoor?.has, '미설치')}${ef?.fireDoor?.note?.trim() ? ` — ${esc(ef.fireDoor.note)}` : ''}</td></tr>
    <tr><th>제연설비</th><td class="l" colspan="3">${ck(!!ef?.smokeControl?.has, '설치')} ${ck(!!ef && !ef.smokeControl?.has, '미설치')}${ef?.smokeControl?.note?.trim() ? ` — ${esc(ef.smokeControl.note)}` : ''}</td></tr>
    <tr><th>방염</th><td class="l" colspan="3">${ck(!!ef?.flameRetardant?.has, '해당')} ${ck(!!ef && !ef.flameRetardant?.has, '해당없음')}${ef?.flameRetardant?.note?.trim() ? ` — ${esc(ef.flameRetardant.note)}` : ''}</td></tr>
  </table>

  <h3>1.5.2 방화·제연구획 현황도</h3>
  ${evacMaps.length ? `<table class="small">
    <tr><th style="width:80px">층</th><th>설명</th></tr>
    ${evacMaps.map(m => `<tr><td>${v(m.floor)}</td><td class="l">${v(m.desc)}</td></tr>`).join('')}
  </table>` : ''}
  ${imgsOf('evacmap').length ? imgBlock(imgsOf('evacmap'), 300) : (evacMaps.length ? '' : '<p class="note">※ 층별 방화·제연구획 현황도는 서식 1.5 입력에서 등록합니다.</p>')}

  <p class="formno">서식 1.6</p><h3 style="display:inline;margin-left:8px">기타시설 현황 (전기·가스·위험물)</h3>
  <table>
    <tr><th style="width:90px" rowspan="2">전기</th>
        <td class="l">수전용량: ${v(etc?.electric?.kw, ' kW')}</td>
        <td class="l">변압기용량: ${v(etc?.electric?.kva, ' kVA')}</td>
        <td class="l">위치: ${v(etc?.electric?.location)}</td></tr>
    ${/* M-17(소방계획서_15): 비상발전기 용량·위치·수량 구조화 인쇄 — 구조화 값 우선, 없으면 레거시 자유 텍스트 */''}
    <tr><td class="l">수량: ${v(etc?.electric?.qty)}</td>
        <td class="l">비상발전기: ${ck(!!etc?.electric?.generator, '설치')}${(() => {
          const e6 = etc?.electric
          const parts = [
            e6?.genKw?.trim() ? `${esc(e6.genKw)}kW` : '',
            e6?.genLocation?.trim() ? `위치 ${esc(e6.genLocation)}` : '',
            e6?.genQty?.trim() ? `${esc(e6.genQty)}대` : '',
          ].filter(Boolean)
          if (parts.length) return ` (${parts.join(' · ')})${e6?.generatorNote?.trim() ? ` — ${esc(e6.generatorNote)}` : ''}`
          return e6?.generatorNote?.trim() ? ` (${esc(e6.generatorNote)})` : ''
        })()}</td>
        <td class="l">비고: ${v(etc?.electric?.note)}</td></tr>
    <tr><th rowspan="2">가스</th>
        <td class="l">종류: ${v(etc?.gas?.kind)}</td>
        <td class="l">위치: ${v(etc?.gas?.location)}</td>
        <td class="l">용도: ${v(etc?.gas?.usage)}</td></tr>
    <tr><td class="l">정압기: ${ck(!!etc?.gas?.regulator, '있음')}${etc?.gas?.regulatorLocation?.trim() ? ` — 위치: ${esc(etc.gas.regulatorLocation)}` : ''}</td>
        <td class="l" colspan="2">차단밸브: ${ck(!!etc?.gas?.shutoff, '있음')}${etc?.gas?.shutoffLocation?.trim() ? ` — 위치: ${esc(etc.gas.shutoffLocation)}` : ''}</td></tr>
    <tr><th>위험물</th><td class="l" colspan="3">${ck(!!etc?.hazmat?.none, '해당없음')}${etc?.hazmat?.note?.trim() ? ` — ${esc(etc.hazmat.note)}` : ''}</td></tr>
  </table>
</div>

<!-- 서식 1.10 자체점검·업무수행 -->
<div class="page">
  <p class="formno">서식 1.10</p><h3 style="display:inline;margin-left:8px">소방안전관리자 자체점검 및 업무 수행</h3>
  <h3>1.10.1 연간 점검 계획</h3>
  ${/* B-5a(소방계획서_19 M-9): 최초점검 입력은 종합점검월이 비어도 독립 행으로 출력 — 종전엔 comp 블록 종속이라 통째 미출력 */''}
  <table>
    <tr><th style="width:90px" rowspan="${1 + (compMonthText ? 1 : 0) + (!compMonthText && insp?.isInitial ? 1 : 0)}">자체점검</th>
        <td class="l">■ 작동점검 — 점검시기: ${v(opMonthText)}</td>
        <td class="l">결과보고: 점검이 끝난 날부터 15일 이내</td>
        <td class="l">제출처: ${v(fireStation)}</td>
        <td class="l">점검자: ${ck(opInspector === '자체', '자체')} ${ck(opInspector === '외주', '외주')}</td></tr>
    ${compMonthText ? `<tr><td class="l">■ 종합점검 — 점검시기: ${v(compMonthText)}${insp?.comp2Month?.trim() ? ` / ${esc(insp.comp2Month)}` : ''}${insp?.isInitial ? ` <span class="small">(최초점검: ${v(insp.initialMonth)})</span>` : ''}</td>
        <td class="l">결과보고: 점검이 끝난 날부터 15일 이내</td>
        <td class="l">제출처: ${v(fireStation)}</td>
        <td class="l">점검자: ${ck(compInspector === '자체', '자체')} ${ck(compInspector === '외주', '외주')}</td></tr>` : ''}
    ${!compMonthText && insp?.isInitial ? `<tr><td class="l">■ 최초점검 — 점검시기: ${v(insp.initialMonth)}</td>
        <td class="l">결과보고: 점검이 끝난 날부터 15일 이내</td>
        <td class="l">제출처: ${v(fireStation)}</td>
        <td class="l">점검자: ${ck(compInspector === '자체', '자체')} ${ck(compInspector === '외주', '외주')}</td></tr>` : ''}
    <tr><th>일상점검</th><td class="l" colspan="4">■ 소방안전관리 업무수행 — 수행자: 소방안전관리자 / 수행주기: 매월 1회 이상</td></tr>
  </table>

  <h3>1.10.2 소방안전관리 업무수행 기록</h3>
  <table class="small">
    <tr><th style="width:76px">일자</th><th>수행 내용</th><th>조치사항</th><th style="width:90px">비고</th></tr>
    ${dutyRows}
  </table>

  <h3>1.10.3 다중이용업소 현황</h3>
  <table class="small">
    <tr><th style="width:90px">해당 여부</th><td class="l" colspan="3">${ck(mu?.applicable === true, '해당')} ${ck(!!mu && !mu.applicable, '해당없음')}</td></tr>
    ${mu?.applicable ? `
    <tr><th>사업장명</th><td class="l">${v(mu.bizName)}</td><th style="width:90px">업종(개소)</th><td class="l">${v(muCats)}</td></tr>
    <tr><th>위치</th><td class="l">${v(mu.location)}</td><th>영업주</th><td class="l">${v(mu.owner)}</td></tr>
    ${/* M-16(소방계획서_15): 영업시간 평일/휴일×주간/야간 세분 + 이용자 유형 체크 — 구조화 값 우선, 자유 텍스트는 폴백·병기 */''}
    <tr><th>연락처</th><td class="l">${v(mu.phone)}</td><th>영업시간</th><td class="l">${(() => {
      const hd = mu.hoursDetail
      if (hd && (hd.wkDay || hd.wkNight || hd.holDay || hd.holNight)) {
        const seg = (label: string, day: string, night: string) =>
          (day || night) ? `${label} ${ck(!!day, '주간')}${day ? `(${esc(day)})` : ''} ${ck(!!night, '야간')}${night ? `(${esc(night)})` : ''}` : ''
        return [seg('평일', hd.wkDay, hd.wkNight), seg('휴일', hd.holDay, hd.holNight)].filter(Boolean).join(' / ')
      }
      return v(mu.hours)
    })()}</td></tr>
    <tr><th>이용자</th><td class="l">${(mu.userTypes?.length || mu.users.trim())
      ? `${['노유자', '주취자', '청소년', '신체부자유자'].map(t => ck((mu.userTypes ?? []).includes(t), t)).join(' ')}${mu.users.trim() ? ` — ${esc(mu.users)}` : ''}`
      : v(mu.users)}</td><th>수용인원</th><td class="l">${v(mu.capacity)}</td></tr>` : ''}
  </table>

  <h3>1.10.4 화재/비화재보 이력</h3>
  <table class="small">
    <tr><th style="width:70px">구분</th><th style="width:90px">일시</th><th style="width:90px">장소</th><th>원인</th><th>조치사항</th></tr>
    ${histRows}
  </table>
</div>

<!-- 서식 1.11 훈련·교육 -->
<div class="page">
  <p class="formno">서식 1.11</p><h3 style="display:inline;margin-left:8px">소방훈련 및 교육</h3>
  <h3>1.11.1 연간계획</h3>
  ${tr?.headcount && (tr.headcount.worker || tr.headcount.resident || tr.headcount.brigade) ? `
  <table class="small">
    <tr><th style="width:110px">근무인원</th><td>${v(tr.headcount.worker, '명')}</td>
        <th style="width:110px">거주인원</th><td>${v(tr.headcount.resident, '명')}</td>
        <th style="width:130px">자위소방대 인원</th><td>${v(tr.headcount.brigade, '명')}</td></tr>
  </table>` : ''}
  <table class="small">
    <tr><th rowspan="2" style="width:90px">교육</th><th class="l" style="width:150px">구분</th><th colspan="12">연간계획(월)</th></tr>
    <tr>${months.map(m => `<th class="c">${m}</th>`).join('')}</tr>
    <tr><th rowspan="3">대상자</th><td class="l">소방교육</td>${monthCells(eduMonths)}</tr>
    <tr><td class="l">피난교육</td>${monthCells(eduMonths)}</tr>
    <tr><td class="l">자위소방대 및 초기대응체계</td>${monthCells(eduMonths)}</tr>
    <tr><th rowspan="2">훈련</th><td class="l">소방훈련</td>${monthCells(drillMonths)}</tr>
    <tr><td class="l">피난훈련</td>${monthCells(drillMonths)}</tr>
  </table>

  ${detailRows ? `<h3>1.11.2 세부계획</h3>
  <table class="small">
    <tr><th>명칭</th><th style="width:76px">일시</th><th style="width:80px">장소</th><th style="width:70px">대상</th><th style="width:60px">구분</th><th style="width:60px">형태</th><th>교보재</th><th>계획 내용</th></tr>
    ${detailRows}
  </table>` : ''}

  <h3>1.11.3 훈련 시나리오</h3>
  ${tr?.scenario?.trim()
    ? `<table><tr><th style="width:90px">시나리오${tr.scenarioType ? `<br><span class="small">(${esc(tr.scenarioType)})</span>` : ''}</th><td class="l">${esc(tr.scenario)}</td></tr></table>`
    : `<table class="small">
    ${SCENARIO_DEFAULTS.map(s => `<tr><th style="width:110px">${esc(s.label)}</th><td class="l">${esc(s.text)}</td></tr>`).join('')}
  </table>`}

  <h3>1.11.4 훈련·교육 결과 기록부 <span class="small">(2년 보관)</span></h3>
  <table class="small">
    <tr><th style="width:76px">일시</th><th style="width:80px">구분</th><th style="width:70px">참여인원</th><th>내용</th><th>평가</th></tr>
    ${recordRows}
  </table>
</div>

<!-- 서식 1.12~1.13 기록부 -->
<div class="page">
  <p class="formno">서식 1.12</p><h3 style="display:inline;margin-left:8px">화기취급 감독</h3>
  ${logTable(f.fireworkLog, [
    { k: 'date', label: '일자', w: '76px' }, { k: 'place', label: '작업 장소', w: '110px' },
    { k: 'work', label: '작업 내용', l: true }, { k: 'supervisor', label: '감독자', w: '80px' },
    { k: 'measure', label: '안전조치', l: true },
  ], 5)}

  <p class="formno">서식 1.13</p><h3 style="display:inline;margin-left:8px">소방시설 공사·정비 기록</h3>
  ${logTable(f.constructionLog, [
    { k: 'date', label: '일자', w: '76px' }, { k: 'facility', label: '대상 설비', w: '110px' },
    { k: 'content', label: '공사·정비 내용', l: true }, { k: 'company', label: '시공업체', w: '90px' },
    { k: 'note', label: '비고', w: '90px' },
  ], 5)}
</div>

<!-- 서식 1.14~1.15 기록부 -->
<div class="page">
  <p class="formno">서식 1.14</p><h3 style="display:inline;margin-left:8px">화재예방 및 홍보</h3>
  ${logTable(f.promoLog, [
    { k: 'date', label: '일자', w: '76px' }, { k: 'method', label: '방법(게시·방송·교육 등)', w: '150px' },
    { k: 'content', label: '내용', l: true }, { k: 'target', label: '대상', w: '90px' },
  ], 5)}

  <p class="formno">서식 1.15</p><h3 style="display:inline;margin-left:8px">피해 복구</h3>
  ${logTable(f.recoveryLog, [
    { k: 'date', label: '일자', w: '76px' }, { k: 'damage', label: '피해 내용', l: true },
    { k: 'recovery', label: '복구 조치', l: true }, { k: 'cost', label: '비용', w: '80px' },
  ], 3)}
</div>

<!-- 제2장 자위소방대 -->
<div class="page">
  <h2>제2장 자위소방대 운영계획</h2>
  <p class="formno">서식 2.1</p><h3 style="display:inline;margin-left:8px">자위소방대 및 초기대응체계 일반현황</h3>
  <table>
    <tr><th style="width:80px">명칭</th><td class="l">${v(d.buildingName)}</td><th style="width:80px">등급</th><td class="l">${GRADES.map(g => ck(d.grade === g, g)).join(' ')}</td></tr>
    <tr><th>도로명주소</th><td class="l" colspan="3">${v(d.address)}</td></tr>
    <tr><th>편성표서식</th><td class="l" colspan="3">
      ${ck(bg === 'I', 'Type-Ⅰ [서식 2.2.1]')} ${ck(bg === 'II', 'Type-Ⅱ [서식 2.2.2]')} ${ck(bg === 'III' || bg === '', 'Type-Ⅲ [서식 2.2.3]')}
      &nbsp;<span class="small">* Type-Ⅲ는 상시 근무인원 50명 미만 권장</span></td></tr>
  </table>
  <h3>자위소방대 임무</h3>
  <table class="small">
    ${teamRows}
  </table>

  <p class="formno">서식 2.2</p><h3 style="display:inline;margin-left:8px">자위소방대 및 초기대응체계 편성표${bg ? ` (Type-${bg === 'I' ? 'Ⅰ' : bg === 'II' ? 'Ⅱ' : 'Ⅲ'})` : ' (Type-Ⅲ)'}</h3>
  <table>
    <tr><th style="width:110px">구분</th><th style="width:90px">성명</th><th>개별임무</th><th style="width:110px">비상연락체계</th></tr>
    ${brigadeRows}
  </table>
  ${/* M-18(소방계획서_15): 비상연락체계 텍스트 — 서식 1.7 카드에서 입력(sections.emergencyContact) */''}
  ${f.emergencyContact?.trim() ? `<table class="small">
    <tr><th style="width:110px">비상연락체계</th><td class="l" style="white-space:pre-wrap">${esc(f.emergencyContact)}</td></tr>
  </table>` : ''}
  <h3>초기대응 개요</h3>
  <table class="small">
    <tr><th style="width:130px">초기소화 방법</th><td class="l">${v(teamTextOr(f.brigadeTeams, 'extinguish', '소화기를 이용하여 초기 진압 실시'))}</td></tr>
    <tr><th>가스시설 조치</th><td class="l">가스공급 밸브 차단</td></tr>
  </table>
  <h3>비상연락처</h3>
  <table class="small">
    <tr><th>${v(fireStation)}</th><td>119</td><th>${v(d.companyName)}</th><td>${v(d.companyPhone)}</td></tr>
    <tr><th>가스안전공사</th><td>031-798-0019</td><th>전기안전공사</th><td>1588-7500</td></tr>
  </table>
</div>

<!-- 제3장 피난계획 (3.1~3.3) -->
<div class="page">
  <h2>제3장 피난계획</h2>
  <p class="formno">서식 3.1</p><h3 style="display:inline;margin-left:8px">피난시설 및 기타시설 일반현황</h3>
  <table>
    <tr><th style="width:80px">명칭</th><td class="l">${v(d.buildingName)}</td><th style="width:80px">층수</th><td class="l">${v(d.floors)}</td></tr>
    <tr><th>구조</th><td class="l">${v(d.structure)}</td><th>용도</th><td class="l">${v(d.purpose)}</td></tr>
    <tr><th>계단</th><td class="l" colspan="3"><div class="ckgrid">${
      stairKinds.map(k => `${ck(!!ef?.stairs?.[k], k)}${ef?.stairs?.[k] ? ` <span class="small">(${esc(ef.stairs[k])}개소)</span>` : ''}`).join('')
    }</div></td></tr>
    <tr><th>피난안내</th><td class="l" colspan="3">■ 연 2회 피난안내 교육을 실시</td></tr>
  </table>
  <p class="note">※ 계단·피난시설 세부는 서식 1.5와 동일 데이터(수정은 1.5에서).</p>

  <p class="formno">서식 3.2</p><h3 style="display:inline;margin-left:8px">피난시설 및 기타시설 세부현황</h3>
  <table class="small">
    <tr><th style="width:110px">시설</th><th>위치</th><th>상태</th></tr>
    ${detail3Rows}
  </table>

  <p class="formno">서식 3.3</p><h3 style="display:inline;margin-left:8px">피난인원 현황</h3>
  <table class="small">
    <tr><th style="width:90px">근무인원</th><td>${v(ops?.headcountWorker, '명')}</td>
        <th style="width:90px">거주인원</th><td>${v(ops?.headcountResident, '명')}</td>
        <th style="width:110px">최대수용인원</th><td>${v(ops?.headcountMax, '명')}</td></tr>
    ${f.evacHeadcount?.note?.trim() ? `<tr><th>비고</th><td class="l" colspan="5">${esc(f.evacHeadcount.note)}</td></tr>` : ''}
  </table>
</div>

<!-- 제3장 (3.4~3.7) -->
<div class="page">
  <p class="formno">서식 3.4</p><h3 style="display:inline;margin-left:8px">피난유도 절차 및 피난경로(집결지) 설정</h3>
  <h3>1. 피난유도 절차</h3>
  <table>
    <tr><th style="width:90px">비화재보</th><td class="l${afc('evacFalseAlarm')}">${v(d.evacFalseAlarm)}</td></tr>
    <tr><th>화재 시</th><td class="l${afc('evacNote')}">${v(d.evacNote)}</td></tr>
    <tr><th>대피방법</th><td class="l${afc('evacMethod')}">${v(d.evacMethod)}</td></tr>
  </table>
  <h3>2. 피난경로</h3>
  <table>
    <tr><th style="width:90px">층별</th><th>피난경로</th><th style="width:110px">피난유도자</th><th style="width:110px">피난구조설비</th></tr>
    ${evacRows}
  </table>
  <h3>3. 집결지</h3>
  <table>
    <tr><th style="width:90px">장소</th><td class="l${afc('assembly')}">${v(d.assembly)}</td></tr>
  </table>
  <h3>피난경로도(피난안내도)</h3>
  ${evacImgs.length ? imgBlock(evacImgs, 320) : slotPlaceholder('피난안내도·평면도')}

  <p class="formno">서식 3.5</p><h3 style="display:inline;margin-left:8px">피난약자 현황</h3>
  <table class="small">
    <tr><th style="width:90px">해당 여부</th><td class="l" colspan="${vulTypes.length}">${ck(vul?.none === true, '해당없음')} ${ck(!!vul && !vul.none && Object.keys(vul.counts ?? {}).length > 0, '해당')}</td></tr>
    ${vul && !vul.none ? `
    <tr><th>유형</th>${vulTypes.map(t => `<th>${esc(t)}</th>`).join('')}</tr>
    <tr><th>근무</th>${vulTypes.map(t => `<td>${v(vul.counts?.[t]?.work)}</td>`).join('')}</tr>
    <tr><th>이용</th>${vulTypes.map(t => `<td>${v(vul.counts?.[t]?.use)}</td>`).join('')}</tr>` : ''}
  </table>
  ${vul && !vul.none && (vul.plans?.length ?? 0) > 0 ? `
  <table class="small">
    <tr><th style="width:90px">구역</th><th style="width:60px">인원</th><th style="width:70px">유형</th><th style="width:80px">보조자</th><th style="width:90px">장비</th><th>방법</th></tr>
    ${vul.plans.map(p => `<tr><td>${v(p.area)}</td><td>${v(p.count)}</td><td>${v(p.type)}</td><td>${v(p.helper)}</td><td>${v(p.equip)}</td><td class="l">${v(p.method)}</td></tr>`).join('')}
  </table>` : ''}

  ${Object.values(methods).some(m => m?.trim()) ? `
  <p class="formno">서식 3.6</p><h3 style="display:inline;margin-left:8px">피난약자 유형별 피난 방법</h3>
  <table class="small">
    <tr><th style="width:90px">유형</th><th>피난 방법</th></tr>
    ${vulTypes.filter(t => methods[t]?.trim()).map(t => `<tr><td>${esc(t)}</td><td class="l">${esc(methods[t])}</td></tr>`).join('')}
  </table>` : ''}

  <p class="formno">서식 3.7</p><h3 style="display:inline;margin-left:8px">피난용 기구·장비 현황</h3>
  <table class="small">
    <tr><th>기구·장비</th><th>위치</th><th style="width:80px">수량</th></tr>
    ${equipRows}
  </table>
  <p class="note">※ 비고. 소방안전관리자는 대상물의 구역별 화재취약장소 및 인명피해우려장소 현황을 파악하고, 이에 대한 피난계획을 수립해야 한다.</p>
</div>

${imgsOf('etc').length ? `<!-- 부속 사진 -->
<div class="page">
  <h2>부속 사진</h2>
  ${imgBlock(imgsOf('etc'), 420)}
</div>` : ''}

<!-- 보고서 커버 — 문서 마지막 페이지 (트리 '보고서 커버' 서식, 업체명·연도 표기) -->
<div class="page cover">
  <p style="font-size:18px;margin-top:40px">${esc(coverYear)}년도</p>
  <h1>소 방 계 획 서</h1>
  <p class="name">[ ${esc(coverCompany)} ]</p>
  <p class="co">${rc?.sub?.trim() ? esc(rc.sub) : v(d.companyName)}</p>
</div>

</body></html>`
}

/** 팀 임무 입력 우선, 없으면 기본 문구(프리셋 앵커) */
function teamTextOr(teams: Record<string, string> | undefined, key: string, fallback: string): string {
  return (teams ?? {})[key]?.trim() || fallback
}
