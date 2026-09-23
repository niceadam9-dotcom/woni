'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
// `Plus`는 [+ 건물 등록] 버튼과 한 몸이다 — 2026-09-11에 함께 빠졌다가 2026-09-15에 함께 돌아왔다
import { Plus, Search, Loader2, X } from 'lucide-react'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { ComboInput } from '@/components/ui/combo-input'
import { createBuildingAction, updateBuildingAction, deleteBuildingAction, setPrimaryBuildingAction } from '@/app/(dashboard)/buildings/actions'
import { fetchBuildingLedgerAction, checkAddressAction, type AddressDuplicateCustomer, type AddressDuplicateBuilding } from '@/app/(dashboard)/customers/actions'
import { AddressDuplicateDialog } from '@/components/customers/address-duplicate-dialog'
import { autoApplyLedgerEmptyAction } from '@/app/(dashboard)/customers/fire-plan-info-actions'
/* 시설현황 3행(승강기·주차장·계단) — 서식 1.1 배치를 그대로 옮긴 격자가 입력을 받는다.
 * ⚠ 판정 규칙은 여기에도 격자에도 없다. `lib/facility-status`(상자)와 `doc-templates/report9`
 *   (주차장 텍스트 해석)가 유일 원천이다 — 화면에 규칙을 적으면 검사가 붙을 자리가 없어진다. */
import { FacilityStatusGrid } from '@/components/customers/facility-status-grid'
import { stairsSumForAnnex9, type StairKind, type ElevatorKind } from '@/lib/facility-status'
import { primaryBuilding, FORM9_MAX_BUILDINGS } from '@/lib/primary-building'
import { findSameNameBuilding, normalizeBuildingName } from '@/lib/building-dup'
import { initialBuildingPanelTarget, shouldHideBuildingTable } from '@/lib/building-panel-open'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
import { useCustomerTabs } from '@/components/customers/customer-tabs'
import { GroupBox, SubRow, Cell, keyInputCls } from '@/components/customers/key-fields'

/** 건물 목록 + 인라인 등록·수정 패널 (설계 §5·§5-A) — /buildings/new·[id] 페이지 이동 대체.
 *  주소 상속('고객 주소와 동일') · Daum 주소 검색 시 bcode·지번 저장(092) · 건축물대장 자동 조회(빈 칸만). */

export type BuildingPanelRow = {
  id: string
  building_name: string
  address: string | null
  zipcode: string | null
  address_jibun: string | null
  bcode: string | null
  total_area: number | null
  floors_above: number | null
  floors_below: number | null
  purpose: string | null
  year_built: number | null
  notes: string | null
  is_active: boolean
  /** 별지 9호 2쪽 "건축물 정보" 항목 (소방계획서_9 B안) — 대장 자동 채움 + 수기 입력 */
  permit_date: string | null
  building_area: number | null
  building_count: number | null
  parking_summary: string | null
  height: number | null
  households: number | null
  elevator_count: number | null
  emergency_elevator_count: number | null
  /** 별지 9호 2쪽 잔여 항목(2026-09-05) — 소방계획서 1.1 일반현황 패널과 같은 컬럼을 이 폼에서도 입력 */
  main_structure: string | null
  roof_structure: string | null
  /** 직통+피난 합계 — 이제 사람이 적는 칸이 아니라 **파생 저장**이다(마이그 165).
   *  별지 9호 2쪽 「직통(또는 피난계단)」이 한 행이라 그 모양이 필요하다. 저장 때 함께 쓴다. */
  stairs_count: number | null
  /** 계단 4종 개소 — 서식 1.1 15~16행의 원천(마이그 165). 종전엔 1.5 탭 JSON이 들고 있었다 */
  stair_direct_count: number | null
  stair_escape_count: number | null
  stair_special_count: number | null
  stair_outdoor_count: number | null
  ramp_count: number | null
  evac_elevator_count: number | null
}

type FormState = {
  building_name: string
  zipcode: string
  address: string
  address_jibun: string
  bcode: string
  purpose: string
  total_area: string
  floors_above: string
  floors_below: string
  year_built: string
  notes: string
  is_active: boolean
  // 별지 9호 2쪽 항목
  permit_date: string
  building_area: string
  building_count: string
  parking_summary: string
  height: string
  households: string
  elevator_count: string
  emergency_elevator_count: string
  main_structure: string
  roof_structure: string
  stair_direct_count: string
  stair_escape_count: string
  stair_special_count: string
  stair_outdoor_count: string
  ramp_count: string
  evac_elevator_count: string
}

const EMPTY: FormState = {
  building_name: '', zipcode: '', address: '', address_jibun: '', bcode: '',
  purpose: '', total_area: '', floors_above: '', floors_below: '', year_built: '', notes: '', is_active: true,
  permit_date: '', building_area: '', building_count: '', parking_summary: '',
  height: '', households: '', elevator_count: '', emergency_elevator_count: '',
  main_structure: '', roof_structure: '', ramp_count: '', evac_elevator_count: '',
  stair_direct_count: '', stair_escape_count: '', stair_special_count: '', stair_outdoor_count: '',
}

/** 구조·지붕 제안 목록 — 소방계획서 1.1 패널(fire-plan-info-panel)과 같은 어휘. 서식 체크 판정은
 *  report9-assemble 키워드(콘크리트/철골/조적/목 · 슬래브|슬라브/기와/슬레이트, 그 외 = 기타)라
 *  목록 밖 자유 입력도 '기타' 체크로 안전하게 인쇄된다 */
const STRUCTURE_OPTIONS = ['철근콘크리트구조', '철골구조', '조적조', '목구조', '샌드위치판넬']
const ROOF_OPTIONS = ['슬래브', '기와', '슬레이트', '판넬', '징크']

/* 주차장 칩·대수칸은 2026-09-16에 `FacilityStatusGrid`로 옮겼다 — 서식 1.1 13·14행 배치를
 * 그대로 쓰는 격자 안에 있다. 여기에 남겨 두면 같은 축을 두 화면이 각자 그리게 된다. */

/** 서식 1.1 격자의 종류 열쇠 → 이 폼의 상태 이름.
 *  ⚠ 격자는 서식의 말(`direct`·`passenger`)을 쓰고 폼은 컬럼의 말(`stair_direct_count`)을 쓴다.
 *    둘을 잇는 표를 **한 곳**에 두어야 한쪽 이름만 바뀌었을 때 tsc가 잡는다. */
const STAIR_FORM_FIELD: Record<StairKind, 'stair_special_count' | 'stair_direct_count' | 'stair_escape_count' | 'stair_outdoor_count'> = {
  special: 'stair_special_count', direct: 'stair_direct_count',
  escape: 'stair_escape_count', outdoor: 'stair_outdoor_count',
}
const ELEVATOR_FORM_FIELD: Record<ElevatorKind, 'elevator_count' | 'emergency_elevator_count' | 'evac_elevator_count'> = {
  passenger: 'elevator_count', emergency: 'emergency_elevator_count', evac: 'evac_elevator_count',
}

/** 누락 칩(소방계획서 빠른 입력) → 이 폼 입력칸 id — erp:focus-missing 이벤트로 열고 포커스 */
export const BUILDING_FIELD_IDS: Record<string, string> = {
  '건축허가일': 'bf-permit-date', '건축면적': 'bf-building-area', '건물동수': 'bf-building-count',
  '주차장': 'bf-parking', '높이': 'bf-height', '세대수': 'bf-households', '승강기': 'bf-elevator',
  '건물 용도': 'bf-purpose', '연면적': 'bf-total-area', '층수': 'bf-floors-above',
  '건축물구조': 'bf-structure', '지붕구조': 'bf-roof', '계단': 'bf-stairs', '경사로': 'bf-ramp',
}

const inputCls = 'h-form-8 w-full rounded-lg border border-brand-line bg-surface px-2 text-form-sm outline-none focus:border-brand'
const labelCls = 'text-form-xs font-medium text-ink-sub'

/** 별지 9호 2쪽에 **인쇄되는** 칸의 라벨 — 비었을 때만 빨갛게 한다 (2026-09-15 사용자 요청).
 *
 *  ⚠ **상시 빨강으로 두지 않는다.** 실측(스테이징 활성 311동): 건축허가일 302동·건축면적 299동·
 *    높이 303동이 공란이고 **넷 다 채운 동은 6동(1.9%)**뿐이다. 상시 빨강이면 채운 6동에게도
 *    빨강이고 나머지에겐 늘 빨간 화면이라 아무 정보가 되지 않는다 —
 *    「경고가 상시화되면 진짜 위반이 그 안에 묻힌다」(test-all 머리주석과 같은 축).
 *
 *  ⚠ 별표(`*`)와 **뜻이 다르다**: 별표는 「필수인가」, 이 빨강은 「지금 비었는가」다. 그래서 둘을
 *    함께 둔다 — 별표만으로는 안 채워진다는 것이 이미 실증됐다(별표가 붙은 두 칸도 97%가 공란).
 *
 *  ⚠ 사용승인일은 이 화면에서 **고칠 수 없다**(고객 기본정보가 원천 — 점검 기산점 축).
 *    빨갛게만 해두면 고치려다 막히므로 갈 곳(placeholder «고객 정보에서 입력»)을 함께 남긴다. */
const a9Label = (blank: boolean) =>
  blank ? 'text-form-xs font-medium text-red-500' : labelCls
/** 문자·숫자 어느 쪽으로 와도 「비었는가」를 같은 규칙으로 판정한다(0은 채워진 것이다) */
const a9Blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

export function BuildingListPanel({ customerId, customerName, customerAddress, buildings, canManage, initialOpenId, initialNew, purposes = [], useApprovalDate = null }: {
  customerId: string
  customerName: string
  customerAddress: string | null
  buildings: BuildingPanelRow[]
  canManage: boolean
  initialOpenId?: string
  initialNew?: boolean
  /** 049 building_purposes — 관리자 > 건물 용도 관리 목록. datalist 제안(대장 자동값·신규 용도도 허용) */
  purposes?: string[]
  /** customers.use_approval_date — 별지 9호 2쪽 「사용승인일」의 원천. 점검 기산점 축이라 여기선 조회만(수정은 고객 정보) */
  useApprovalDate?: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const openPostcode = useDaumPostcode()
  const tabs = useCustomerTabs()
  // 주소 상속용: bcode가 저장된 첫 활성 건물 (§5-A-2)
  const inheritSrc = buildings.find(b => b.is_active && b.bcode) ?? null

  /* 등록 폼은 **접혀서 시작**한다 (2026-09-09 사용자 확정).
   *  종전엔 항상 펼쳐져 있었고, 그래서 기존 건물을 고치려던 입력이 그대로 **새 건물 등록**이 됐다
   *  (「규현빌라」가 두 번 생긴 실사고 — 화면·문서는 대표동만 보여 값이 사라진 것처럼 보였다).
   *  ⭐ [+ 건물 등록] 버튼은 원래 있었지만 `editing !== 'new'` 조건이라 **영원히 숨어 있었다** —
   *    폼을 접으니 그 버튼이 드러난다(사용자: "추가하는 버튼은 어디에 있어?").
   *  ⚠ 단 **건물이 하나도 없으면 열어 둔다** — 그때는 등록 말고 할 일이 없다.
   *
   *  🚨 그런데 그 변경이 **조회를 함께 지웠다**(2026-09-10 사용자 신고): 건축허가일·주차장은
   *    목록 표에 없고 **이 폼 안에만** 있어서, 폼이 접히자 볼 방법이 사라졌다. 규칙을
   *    `lib/building-panel-open`으로 빼고 **1동이면 그 동을 펼치는** 가지를 더했다 —
   *    거기 주석이 이 축의 정본이다(중복 사고를 되살리지 않는 이유도 거기 적혀 있다). */
  const initialEditing = initialBuildingPanelTarget({ initialNew, initialOpenId, buildings, canManage })
  const [editing, setEditing] = useState<string | null>(initialEditing)
  const [form, setForm] = useState<FormState>(() =>
    initialEditing && initialEditing !== 'new' ? toForm(buildings.find(b => b.id === initialEditing)) : newForm())
  const [sameAsCustomer, setSameAsCustomer] = useState(initialEditing === 'new' && !!customerAddress)
  const [ledgerNote, setLedgerNote] = useState('')
  const [error, setError] = useState('')
  // 저장 완료 표식 — 저장해도 폼이 안 접히므로(2026-09-20) 이 문구가 유일한 「저장됨」 피드백
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()
  // 주소 중복 안내 팝업 — 다른 고객의 고객/건물과 주소가 겹칠 때만 (같은 고객의 다른 동은 정상)
  const [dupInfo, setDupInfo] = useState<{ customer?: AddressDuplicateCustomer; building?: AddressDuplicateBuilding } | null>(null)
  const dupAckRef = useRef('')            // '계속 등록'으로 확인 완료된 주소
  const pendingSaveRef = useRef(false)    // 저장 시점 중복 확인 후 이어서 저장할지
  // 같은 이름 건물 확인 팝업 — 같은 고객 안에서 이름이 겹칠 때(다동은 정상이라 확인만 받는다)
  const [sameNameDup, setSameNameDup] = useState<BuildingPanelRow | null>(null)
  const sameNameAckRef = useRef('')       // '그래도 등록'으로 확인 완료된 이름(정규화형)
  // 폼을 연 시점의 bcode — 저장 후 대장 '전 필드' 반영은 **주소가 이 편집에서 새로 확정된 경우에만**.
  // 종전엔 bcode만 있으면 항상 mode:'all'이라, 방금 저장한 수기 값(주차장·구조 등)이 대장 값으로 되돌아갔다.
  const openBcodeRef = useRef(
    initialEditing && initialEditing !== 'new'
      ? (buildings.find(b => b.id === initialEditing)?.bcode ?? '')
      : (inheritSrc?.bcode ?? ''))

  function toForm(b?: BuildingPanelRow): FormState {
    if (!b) return { ...EMPTY }
    return {
      building_name: b.building_name, zipcode: b.zipcode ?? '', address: b.address ?? '',
      address_jibun: b.address_jibun ?? '', bcode: b.bcode ?? '',
      purpose: b.purpose ?? '', total_area: b.total_area != null ? String(b.total_area) : '',
      floors_above: b.floors_above != null ? String(b.floors_above) : '',
      floors_below: b.floors_below != null ? String(b.floors_below) : '',
      year_built: b.year_built != null ? String(b.year_built) : '',
      notes: b.notes ?? '', is_active: b.is_active,
      permit_date: b.permit_date ?? '',
      building_area: b.building_area != null ? String(b.building_area) : '',
      building_count: b.building_count != null ? String(b.building_count) : '',
      parking_summary: b.parking_summary ?? '',
      height: b.height != null ? String(b.height) : '',
      households: b.households != null ? String(b.households) : '',
      elevator_count: b.elevator_count != null ? String(b.elevator_count) : '',
      emergency_elevator_count: b.emergency_elevator_count != null ? String(b.emergency_elevator_count) : '',
      main_structure: b.main_structure ?? '',
      roof_structure: b.roof_structure ?? '',
      /* 계단은 종류별이 원천이다(마이그 165). 합계 `stairs_count`는 저장 때 파생으로 다시 쓰므로
       * 폼 상태로 들고 오지 않는다 — 들고 오면 「합계도 고칠 수 있는 칸」처럼 보여 두 벌이 된다. */
      stair_direct_count: b.stair_direct_count != null ? String(b.stair_direct_count) : '',
      stair_escape_count: b.stair_escape_count != null ? String(b.stair_escape_count) : '',
      stair_special_count: b.stair_special_count != null ? String(b.stair_special_count) : '',
      stair_outdoor_count: b.stair_outdoor_count != null ? String(b.stair_outdoor_count) : '',
      ramp_count: b.ramp_count != null ? String(b.ramp_count) : '',
      evac_elevator_count: b.evac_elevator_count != null ? String(b.evac_elevator_count) : '',
    }
  }

  // 신규 폼 — 고객 주소 자동 상속 (§5-A-2: 재검색 제거)
  function newForm(): FormState {
    return {
      ...EMPTY,
      building_name: customerName,
      address: customerAddress ?? '',
      address_jibun: inheritSrc?.address_jibun ?? '',
      bcode: inheritSrc?.bcode ?? '',
      zipcode: inheritSrc?.zipcode ?? '',
    }
  }

  // 누락 칩(소방계획서 빠른 입력) → 이 폼으로 진입 (소방계획서_9 B안).
  // 편집 패널이 닫혀 있으면 첫 활성 건물의 수정 폼을 열고 해당 입력칸에 스크롤·포커스한다.
  const editingRef = useRef(editing)
  useEffect(() => { editingRef.current = editing })
  useEffect(() => {
    function onFocusMissing(e: Event) {
      const id = (e as CustomEvent).detail?.id as string | undefined
      if (!id || !id.startsWith('bf-')) return
      // 기본 열림이 '건물 등록' 폼이 된 뒤에도 누락 칩은 기존 건물 수정 폼을 겨냥해야 한다
      if (!editingRef.current || editingRef.current === 'new') {
        const target = buildings.find(b => b.is_active) ?? buildings[0]
        if (!target) return
        openEdit(target)
      }
      // 폼이 이제 막 마운트되는 경우가 있어 폴링 (최대 8회 × 150ms)
      let tries = 0
      const tick = () => {
        const el = document.getElementById(id)
        if (!el) { if (++tries < 8) setTimeout(tick, 150); return }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.focus({ preventScroll: true })
        el.classList.add('ring-2', 'ring-amber-400')
        setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 2500)
      }
      setTimeout(tick, 60)
    }
    window.addEventListener('erp:focus-missing', onFocusMissing)
    return () => window.removeEventListener('erp:focus-missing', onFocusMissing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings])

  function syncUrl(next: string | null) {
    const sp = new URLSearchParams(window.location.search)
    sp.set('tab', 'buildings')
    sp.delete('b'); sp.delete('new')
    if (next === 'new') sp.set('new', '1')
    else if (next) sp.set('b', next)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  function openEdit(b: BuildingPanelRow) {
    const f = toForm(b)
    setForm(f); setEditing(b.id); setSameAsCustomer(false)
    openBcodeRef.current = b.bcode ?? ''
    setLedgerNote(''); setError(''); setSaved(false); syncUrl(b.id)
    // 건축허가일이 필수가 되면서(2026-09-05) 기존 건물 대다수가 공란 — 대장에서 빈 칸만 자동 보충해
    // 저장 차단에 걸리기 전에 채워준다(등록 폼 openNew와 같은 동작, 수기 값은 덮지 않음)
    if (canManage && !f.permit_date && b.bcode && b.address_jibun) fetchLedger(b.bcode, b.address_jibun, f)
  }
  /** 호출부 둘: 머리줄의 [+ 건물 등록] 버튼, 그리고 `initialNew`(URL 딥링크) 경로.
   *  ⚠ 2026-09-11~09-15 사이엔 버튼이 없어 딥링크 전용이었다 — 그때 이 함수를 **지우지 않고
   *    남겨 둔 덕분에** 복원이 JSX 한 블록으로 끝났다. 비슷한 결정을 만나면 같은 방식으로. */
  function openNew() {
    const f = newForm()
    setForm(f); setEditing('new'); setSameAsCustomer(!!customerAddress)
    openBcodeRef.current = f.bcode
    setLedgerNote(''); setError(''); setSaved(false); syncUrl('new')
    if (f.bcode && f.address_jibun) fetchLedger(f.bcode, f.address_jibun, f)
  }
  /* 닫기 = **완전히 접는다**(2026-09-09). 종전엔 여기서 다시 '건물 등록' 폼을 열었는데,
   * 수정을 마치고 닫은 자리에 빈 등록 폼이 나타나 **다음 입력이 새 건물이 되는** 통로였다. */
  function close() {
    setForm(newForm()); setEditing(null); setSameAsCustomer(false)
    openBcodeRef.current = ''
    setLedgerNote(''); setError(''); setSaved(false)
    tabs?.setTabDirty('buildings', false)
    syncUrl(null)
  }

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    tabs?.setTabDirty('buildings', true)
    setSaved(false)
    setForm(p => ({ ...p, [k]: v }))
  }

  // 건축물대장 자동 조회 — 빈 칸만 채움 (§5-A-4, 기존 값 미덮어씀)
  function fetchLedger(bcode: string, jibun: string, base?: FormState) {
    fetchBuildingLedgerAction(bcode, jibun).then(res => {
      if (res.unavailable || res.error || !res.info) {
        if (res.error) setLedgerNote(`건축물대장: ${res.error}`)
        return
      }
      const L = res.info
      const numStr = (v: number | null | undefined) => (v != null ? String(v) : '')
      setForm(prev => {
        const p = base ?? prev
        return {
          ...prev,
          purpose: p.purpose || (L.purpose ?? ''),
          total_area: p.total_area || numStr(L.total_area),
          floors_above: p.floors_above || numStr(L.floors_above),
          floors_below: p.floors_below || numStr(L.floors_below),
          year_built: p.year_built || (L.use_approval_date ? L.use_approval_date.slice(0, 4) : ''),
          // 별지 9호 2쪽 항목도 빈 칸만 채움 (소방계획서_9 B안 — 수기 입력분 보존)
          permit_date: p.permit_date || (L.permit_date ?? ''),
          building_area: p.building_area || numStr(L.building_area),
          building_count: p.building_count || numStr(L.building_count),
          parking_summary: p.parking_summary || (L.parking_summary ?? ''),
          height: p.height || numStr(L.height),
          households: p.households || numStr(L.households),
          elevator_count: p.elevator_count || numStr(L.elevator_count),
          emergency_elevator_count: p.emergency_elevator_count || numStr(L.emergency_elevator_count),
          main_structure: p.main_structure || (L.main_structure ?? ''),
          roof_structure: p.roof_structure || (L.roof_structure ?? ''),
        }
      })
      const got = [L.purpose && `용도 ${L.purpose}`, L.total_area != null && `연면적 ${L.total_area}㎡`,
        L.floors_above != null && `지상 ${L.floors_above}층`, L.main_structure && `구조 ${L.main_structure}`]
        .filter(Boolean).join(' · ')
      setLedgerNote(`건축물대장 자동 조회 완료${got ? ` — ${got} (빈 칸만 채움)` : ''}`)
    }).catch(() => null)
  }

  function handleAddressSearch() {
    openPostcode(data => {
      tabs?.setTabDirty('buildings', true)
      setSameAsCustomer(false)
      const next = {
        zipcode: data.zonecode, address: data.roadAddress,
        address_jibun: data.jibunAddress, bcode: data.bcode ?? '',
      }
      setForm(p => ({ ...p, ...next, building_name: p.building_name || data.buildingName || '' }))
      if (data.bcode) fetchLedger(data.bcode, data.jibunAddress)
      checkAddressAction(data.roadAddress, { excludeCustomerId: customerId }).then(res => {
        if (res.duplicate || res.duplicateBuilding) {
          setDupInfo({ customer: res.duplicate, building: res.duplicateBuilding })
        }
      }).catch(() => null)
    })
  }

  function toggleSameAsCustomer(checked: boolean) {
    setSameAsCustomer(checked)
    if (checked) {
      const f = newForm()
      setForm(p => ({ ...p, zipcode: f.zipcode, address: f.address, address_jibun: f.address_jibun, bcode: f.bcode }))
      if (f.bcode && f.address_jibun) fetchLedger(f.bcode, f.address_jibun)
    } else {
      // 해제 = 다른 주소의 건물 등록 의도 — 상속값을 남기면 주소 검색을 잊었을 때 엉뚱한 bcode로 저장됨
      setForm(p => ({ ...p, zipcode: '', address: '', address_jibun: '', bcode: '' }))
      setLedgerNote('')
    }
  }

  const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? undefined : n }
  const int = (s: string) => { const n = parseInt(s, 10); return isNaN(n) ? undefined : n }

  /* 주차장 칩 토글·대수칸 읽고쓰기는 `FacilityStatusGrid`로 옮겼다(2026-09-16).
   * 격자가 `parking_summary` 문자열 하나만 주고받는다 — 이 폼은 그 문자열의 보관자일 뿐이다. */

  function save() {
    if (!form.building_name.trim()) { setError('건물명을 입력해주세요.'); return }
    // 건축허가일 필수(2026-09-05) — 없으면 갑지 엑셀·별지 9호 2쪽이 공란으로 인쇄된다
    if (!isCompleteDate(form.permit_date)) {
      setError(form.permit_date
        ? '건축허가일이 완성되지 않았습니다 — YYYY-MM-DD 형식으로 입력해주세요.'
        : '건축허가일을 입력해주세요 — 주소 검색을 실행하면 건축물대장에서 자동으로 채워집니다.')
      const el = document.getElementById('bf-permit-date')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.focus({ preventScroll: true })
        el.classList.add('ring-2', 'ring-red-400')
        setTimeout(() => el.classList.remove('ring-2', 'ring-red-400'), 2500)
      }
      return
    }
    setError('')
    /* 같은 고객·**같은 이름** 건물 확인 (2026-09-09 사용자 확정) — 차단이 아니라 확인이다.
     * 주소 중복 팝업은 **다른 고객**과 겹칠 때만 뜨므로, 같은 고객 안에서 이름까지 같은 동이
     * 조용히 두 번 만들어졌다(실사고). 다동은 정상이니 「그래도 등록」으로 넘어갈 수 있다. */
    if (editing === 'new') {
      const nm = form.building_name.trim()
      if (sameNameAckRef.current !== normalizeBuildingName(nm)) {
        const dup = findSameNameBuilding(buildings, nm)
        if (dup) { setSameNameDup(dup); return }
      }
    }
    // 저장 시점 중복 재검증 (주소 수기 보정 대비) — 이미 확인한 주소는 통과
    const addr = form.address.trim()
    if (addr && dupAckRef.current !== addr) {
      startTransition(async () => {
        const res = await checkAddressAction(addr, { excludeCustomerId: customerId })
        if (res.duplicate || res.duplicateBuilding) {
          pendingSaveRef.current = true
          setDupInfo({ customer: res.duplicate, building: res.duplicateBuilding })
          return
        }
        dupAckRef.current = addr
        doSave()
      })
      return
    }
    doSave()
  }

  function doSave() {
    startTransition(async () => {
      setSaved(false)
      const common = {
        building_name: form.building_name.trim(),
        zipcode: form.zipcode || undefined,
        address: form.address || undefined,
        address_jibun: form.address_jibun || undefined,
        bcode: form.bcode || undefined,
        purpose: form.purpose || undefined,
        total_area: num(form.total_area),
        floors_above: int(form.floors_above),
        floors_below: int(form.floors_below),
        year_built: int(form.year_built),
        notes: form.notes || undefined,
        // 별지 9호 2쪽 항목 (소방계획서_9 B안) — 빈 문자열은 null로 지워지도록 항상 전송
        permit_date: form.permit_date || null,
        building_area: num(form.building_area),
        building_count: int(form.building_count),
        parking_summary: form.parking_summary || null,
        height: num(form.height),
        households: int(form.households),
        elevator_count: int(form.elevator_count),
        emergency_elevator_count: int(form.emergency_elevator_count),
        // 별지 9호 2쪽 잔여 항목(2026-09-05) — 구조·지붕·계단·경사로·피난용승강기
        main_structure: form.main_structure || null,
        roof_structure: form.roof_structure || null,
        /* 계단 4종이 원천이고 `stairs_count`는 **파생 저장**이다(마이그 165).
         * 합계를 여기서 함께 쓰는 덕분에 이 값을 읽는 네 곳(별지 9호 HTML·갑지 엑셀 2곳·소방계획서
         * PDF)은 한 줄도 안 고쳐도 된다 — 규칙은 `stairsSumForAnnex9` 한 곳에만 있다. */
        // `int()`는 빈 칸에서 `undefined`(=안 건드림)를 준다 — 비우기가 되려면 `null`이어야 한다
        stair_direct_count: int(form.stair_direct_count) ?? null,
        stair_escape_count: int(form.stair_escape_count) ?? null,
        stair_special_count: int(form.stair_special_count) ?? null,
        stair_outdoor_count: int(form.stair_outdoor_count) ?? null,
        /* ⚠ `null`을 그대로 보낸다. `?? undefined`로 접으면 액션이 「안 건드림」으로 읽어
         *   **계단을 다 지워도 옛 합계가 그대로 남는다**(별지 9호가 유령 개소를 계속 인쇄한다).
         *   위 형제 칸들이 「빈 문자열은 null로 지워지도록 항상 전송」인 것과 같은 이유다. */
        stairs_count: stairsSumForAnnex9({
          direct: form.stair_direct_count, escape: form.stair_escape_count,
        }),
        ramp_count: int(form.ramp_count),
        evac_elevator_count: int(form.evac_elevator_count),
      }
      /* 신규·수정의 반환형이 다르다(신규만 buildingId) — 합쳐 받으면 buildingId 접근이 좁혀지지 않는다 */
      let savedId: string | null = editing !== 'new' ? editing : null
      if (editing === 'new') {
        const res = await createBuildingAction({ customer_id: customerId, ...common })
        if (res.error) { setError(res.error); return }
        savedId = res.buildingId ?? null
      } else {
        const res = await updateBuildingAction({ id: editing!, is_active: form.is_active, ...common })
        if (res.error) { setError(res.error); return }
      }
      // 주소(bcode) 확정 시 소방계획서용 대장 확장 필드 반영 — 소방계획서 탭 버튼 클릭 불필요.
      // '전 필드'(대장이 정답, 2026-08-06 사용자 확정)는 **이 편집에서 주소가 새로 확정된 경우에만** —
      // 같은 주소 재저장까지 'all'로 돌리면 방금 저장한 수기 구조·주차장 값이 대장 값으로 되돌아간다(2026-09-05).
      if (form.bcode) {
        const mode = form.bcode !== openBcodeRef.current ? 'all' as const : 'empty' as const
        try { await autoApplyLedgerEmptyAction(customerId, { mode }) } catch { /* best-effort */ }
      }
      /* 저장해도 폼을 접지 않는다 (2026-09-20 사용자 요청 — 종전엔 close()로 접혀 이어서
       * 고치려면 [보기·수정]을 다시 눌러야 했다). 접힘이 곧 「저장됨」 피드백이었으므로
       * 대신 saved 문구가 그 역할을 맡는다.
       * ⚠ 신규 등록을 'new'인 채 열어 두면 다음 [저장]이 **같은 동을 한 번 더 만든다**
       *   (규현빌라 2중 등록 사고의 새 통로) — 방금 만든 동의 수정 폼으로 갈아탄다. */
      if (savedId) {
        setEditing(savedId)
        // 이 편집에서 확정된 주소는 이제 「연 시점의 주소」다 — 같은 주소 재저장이
        // mode:'all'로 돌아 방금 저장한 수기 값을 대장 값으로 되돌리지 않게 한다
        openBcodeRef.current = form.bcode
        tabs?.setTabDirty('buildings', false)
        setSaved(true)
        syncUrl(savedId)
      } else {
        // buildingId 없는 응답(구버전 폴백) — 신규 폼을 열어 두면 중복 등록 통로라 종전대로 접는다
        close()
      }
      router.refresh()
    })
  }

  // 대표동 — 규칙은 `lib/primary-building` 단일 원천(is_primary 우선, 없으면 종전 최고참).
  // 서버가 문서에 싣는 동과 **같은 규칙**이라 배지가 거짓말을 하지 않는다.
  const activeBuildings = buildings.filter(b => b.is_active)
  const activeCount = activeBuildings.length
  const primaryId = primaryBuilding(activeBuildings as unknown as Array<{
    id: string; is_active?: boolean | null; is_primary?: boolean | null; created_at?: string | null
  }>)?.id ?? null

  function makePrimary(b: BuildingPanelRow) {
    if (!window.confirm(`'${b.building_name}'동를 대표동으로 지정할까요?\n\n별지 9호 2쪽·소방계획서 1.1에 이 동의 값이 인쇄됩니다.`)) return
    startTransition(async () => {
      const res = await setPrimaryBuildingAction(customerId, b.id)
      // 마이그레이션 160 미적용 DB에서는 컬럼이 없어 실패한다 — 사용자에게 그대로 알린다
      // (조용히 삼키면 '눌렀는데 안 바뀐다'가 되고, 원인을 찾을 단서가 사라진다)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  function deactivate(b: BuildingPanelRow) {
    if (!window.confirm(`'${b.building_name}' 건물을 비활성화할까요? (목록에는 비활성으로 남습니다)`)) return
    startTransition(async () => {
      const res = await deleteBuildingAction(b.id)
      if (res.error) { setError(res.error); return }
      if (editing === b.id) close()
      router.refresh()
    })
  }

  return (
    <div id="buildings-panel" className="scroll-mt-4">
      {/* 「건물 목록」 → 「건물정보」 (2026-09-11 사용자 확정: "다동 고객은 없어, 별지와 소방계획서와
          동일하게 건물정보만 추가가 되면 돼"). 고객 1 : 활성 건물 1이 **UI 불변식**이 됐으므로
          여기는 「목록」이 아니라 그 한 동의 **정보를 채우는 자리**다. 소방계획서_49 §10.

          🔄 **[+ 건물 등록]은 2026-09-15 사용자 요청으로 되살렸다**(cf139d0에서 없앴던 것).
            §10-4가 예고한 그 복원이다 — 「다동이 실제로 오면 이 버튼을 복원하는 것이 정답」.
            갑지 「다수동일때」 시트(2·3·4동 블록)와 별지 9호 「동별」 쪽은 실재하는데 **그 칸을
            채울 2번째 동을 넣는 문이 화면에 없다**는 것이 복원 사유다.
          🚨 **조건으로 가리지 말 것.** 원래 이 버튼엔 `editing !== 'new'`가 붙어 있었고, 당시엔
            등록 폼이 늘 열려 있어 그 조건이 버튼을 **영원히 숨겼다** — 그게 「규현빌라」 2중 등록
            사고의 배경이다. 그래서 복원판은 `canManage`만 보고 **항상 그린다**.
            대신 등록 폼이 이미 열려 있을 때는 `disabled`로 **보이되 눌리지 않게** 한다 —
            감추면 결함이 재발하고, 그냥 두면 입력 중인 새 동이 빈 폼으로 초기화된다.
            (「조건에 가려 숨는 것」과 「비활성으로 보이는 것」은 다르다. 전자는 결함이다.)
          ⚠ 버튼이 없어도 첫 동은 만들 수 있었다 — 그 경로는 **그대로 살아 있다**:
            `initialBuildingPanelTarget`이 건물 0개 + 등록 권한이면 `'new'` 폼을 자동으로 열고
            (`lib/building-panel-open.ts`), 커밋 `0039484` 이후 고객을 만들면 1동이 **반드시**
            생긴다(§10-2 ①). 버튼은 **2번째 동부터**가 본래 쓸모다.
          📏 유지되는 것: 제목은 「건물정보」 그대로(§10-2 ③), 1동이면 표를 감추는 규칙도 그대로.
            되돌린 것은 §10-2 **② 하나뿐**이다 — 셋을 한꺼번에 되짚지 말 것. */}
      {/* ② 건물·시설 탭의 그룹 상자(2026-09-23 「기본정보처럼」). ⚠ 제목은 「건물정보」 그대로(§10-2 ③, 2026-09-11 사용자 확정 —
          test-49 [H1]이 문다). 머리줄의 개수·[건물 등록]은 상자 머리로 옮겼다(위 주석의 불변식 그대로). */}
      <GroupBox n={2} title="건물정보" testId="building-group" right={<>
        <span className="text-form-sm text-ink-meta">{buildings.length}개</span>
        {canManage && (
          <button onClick={openNew} disabled={editing === 'new'}
            title={editing === 'new' ? '등록 폼이 이미 열려 있습니다' : '건물(동)을 하나 더 등록합니다'}
            className="inline-flex items-center gap-1 h-form-7 px-2.5 rounded-lg border border-brand-line text-form-sm text-brand hover:bg-brand-tint transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
            <Plus className="size-3" />
            건물 등록
          </button>
        )}
      </>}>
      {(activeCount > 1 || !shouldHideBuildingTable({ buildings, editing })) && (
      <div className="px-5 py-4 space-y-3">
      {/* 다동 안내 — 서식이 담는 동 수를 넘으면 **세어서 알린다**(조용히 자르면 인쇄물은 멀쩡해 보인다).
          🚨 종전 주석은 근거를 「별지 9호 작성요령 10의 **동별로 나누어 작성**」이라고 적었다. **틀렸다.**
            법제처 원문(`erp_goal/_form/별지9호_법제처API_20260701.hwp`) 실측: 「나누어」 0회,
            「작성요령」 0회(절 이름은 **작성방법**). 그리고 조건이 「한 대상물의 여러 동」이 아니라
            **「둘 이상의 대상물을 같은 기간 내에 점검하여 함께 보고하는 경우」**다(작성방법 ※·10).
          ⭐ 서식에서 「동」은 두 뜻이다 — ① **「건물동수 N 개동」 한 칸**(한 대상물이 여러 동일 때,
            `building_count` 필드) ② **동별 건축물정보 표 반복**(여러 대상물을 한 서식에 함께 보고할 때).
            ②는 의무가 아니라 선택이고(작성방법 12는 「설비별로 작성할 수 있다」고 명시), 대상물을
            별개 고객으로 두고 각각 보고하면 해당되지 않는다. 이 배너는 ② 축이다.
          근거 전문은 소방계획서_49 §10-7. */}
      {activeCount > 1 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-form-sm text-amber-800">
          활성 건물 {activeCount}동 — <b>대표동</b>의 값이 별지 9호 2쪽·소방계획서 1.1에 인쇄되고,
          나머지 동은 별지 9호 「동별」 쪽과 갑지 <b>다수동일때</b> 시트에 실립니다.
          {activeCount > FORM9_MAX_BUILDINGS && (
            <> <b className="text-amber-900">서식이 담는 {FORM9_MAX_BUILDINGS}동을 넘어 {activeCount - FORM9_MAX_BUILDINGS}개 동은 인쇄되지 않습니다</b> — 서식을 추가하여 작성하세요.</>
          )}
        </div>
      )}
      {/* 1동뿐이고 **그 동의 상세가 이미 펼쳐져 있으면** 목록 표를 그리지 않는다 (2026-09-11 사용자 확정:
          "두번 보일 필요는 없어"). 자동 펼침을 넣자 같은 건물명이 목록 행과 폼에 **위아래로 두 번** 나왔다
          — 행 1개와 그 행의 상세는 같은 한 건이라, 표는 「고를 것이 있을 때」만 쓸모가 있다.
          ⚠ 머리줄(「건물정보 · N개」)은 남긴다 — 개수가 거기서만 보이고, **[+ 건물 등록]이 거기
            있다**(2026-09-15 복원). 표째 감추면 2번째 동을 추가하는 문까지 사라진다.
            🚨 이 논거는 09-11~09-15 사이 잠시 무효였다(버튼이 없던 기간). 그때는 「개수 표시」만이
              남기는 이유였다 — 이유가 두 번 바뀐 자리이니, 다음에 또 바뀌면 여기에 적을 것.
              적어 두지 않으면 다음 사람이 「표를 감추는 김에 머리줄도」로 읽는다.
          ⚠ 규칙 본문은 `lib/building-panel-open`의 `shouldHideBuildingTable`에 있다 — 여기 JSX에
            묻어 두면 아무도 단언하지 못한다(그게 이 결함이 처음 새어 나온 경로였다). */}
      {shouldHideBuildingTable({ buildings, editing }) ? null
        : buildings.length === 0 && editing !== 'new' ? (
        <p className="text-form-base text-ink-sub py-6 text-center">등록된 건물이 없습니다</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-form-base">
            <thead>
              <tr className="border-b border-brand-line-soft">
                {/* 마지막 빈 칸은 [보기·수정] 버튼 자리 — 표 폭 계산을 표에 맡긴다 */}
                {['건물명', '주소', '용도', '연면적', '층수', '준공', '상태', ''].map(h => (
                  <th key={h} className="text-left text-form-sm font-medium text-ink-sub pb-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buildings.map(b => (
                <tr key={b.id}
                  onClick={() => editing === b.id ? close() : openEdit(b)}
                  className={`border-b border-paper last:border-0 cursor-pointer transition-colors ${editing === b.id ? 'bg-brand-tint' : 'hover:bg-paper'}`}>
                  <td className="py-3 pr-4 font-medium text-ink">
                    {b.building_name}
                    {/* 대표동 표시 — 종전엔 '등록이 가장 빠른 활성 동'이 암묵 규칙이라, 어느 동의
                        값이 별지 9호·소방계획서에 실리는지 화면 어디에도 없었다(2026-09-08). */}
                    {b.id === primaryId && (
                      <span className="ml-1.5 align-middle text-form-2xs font-medium px-1.5 py-0.5 rounded-full bg-brand-tint text-brand"
                        title="이 동의 값이 별지 9호 2쪽·소방계획서 1.1에 인쇄됩니다">대표동</span>
                    )}
                    {canManage && activeCount > 1 && b.is_active && b.id !== primaryId && (
                      <button
                        onClick={e => { e.stopPropagation(); makePrimary(b) }}
                        className="ml-1.5 align-middle text-form-2xs text-ink-meta underline hover:text-brand"
                        title="이 동을 문서에 인쇄되는 대표동으로 지정합니다">대표로</button>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-form-sm text-ink-sub max-w-[140px] truncate">{b.address ?? '-'}</td>
                  <td className="py-3 pr-4">
                    {b.purpose ? (
                      <span className="text-form-sm font-medium px-2 py-0.5 rounded-full bg-brand-tint text-brand">{b.purpose}</span>
                    ) : (
                      <span className="text-form-sm text-ink-meta">-</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-form-sm text-ink-sub">{b.total_area != null ? `${b.total_area.toLocaleString()}㎡` : '-'}</td>
                  <td className="py-3 pr-4 text-form-sm text-ink-sub">
                    {b.floors_above != null ? `지상 ${b.floors_above}층${b.floors_below ? ` / 지하 ${b.floors_below}층` : ''}` : '-'}
                  </td>
                  <td className="py-3 pr-4 text-form-sm text-ink-sub">{b.year_built ?? '-'}</td>
                  <td className="py-3 pr-4">
                    <span className={`text-form-sm font-medium px-2 py-0.5 rounded-full ${b.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {b.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  {/* 행 전체가 클릭 가능하지만 **그렇게 보이지 않았다** — 커서만 바뀔 뿐 문이 없었다.
                      건축허가일·주차장이 이 폼 안에만 있으므로, 이 버튼이 사실상 **조회 버튼**이다.
                      ⚠ 행 onClick과 같은 동작이라 `stopPropagation` 없이는 두 번 토글돼 즉시 닫힌다. */}
                  <td className="py-3 text-right">
                    <button
                      onClick={e => { e.stopPropagation(); if (editing === b.id) close(); else openEdit(b) }}
                      data-testid="building-open"
                      title="건축허가일·주차장 등 상세 정보를 봅니다"
                      className="inline-flex items-center gap-1 h-form-7 px-2 rounded-lg border border-brand-line text-form-sm text-brand hover:bg-brand-tint transition-colors whitespace-nowrap">
                      {editing === b.id ? '닫기' : '보기·수정'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
      )}

      {/* 인라인 등록·수정 — ② 건물·시설 그룹 상자 안의 소그룹 줄들(2026-09-23 「기본정보처럼」 사용자 요청).
          기본정보 탭과 **같은 부품·같은 격자**라 세로줄이 두 탭에서 같은 자리에 선다. */}
      {editing && (
        <>
          <div className="flex items-center justify-between px-5 py-2.5 bg-brand-tint">
            <p className="text-form-sm font-bold text-brand">{editing === 'new' ? '건물 등록' : '건물 수정'}</p>
            <button onClick={close} className="text-ink-faint hover:text-ink-sub" title="닫기"><X className="size-4" /></button>
          </div>

          {/* empty:hidden — 새 동 안내가 없으면(수정·첫 동) 빈 띠를 남기지 않는다 */}
          <div className="px-5 py-3 empty:hidden">
            {/* 등록 시점 안내 (2026-09-11 사용자 지시) — **등록을 결정하는 그 순간에** 어디에 실리는지 알린다.
                🚨🚨 이 문구는 **반드시 배포되는 코드(origin/main)에 대고** 적을 것. 한 번 dev 서버
                  (=공유 작업트리)에 대고 판정해서 세 줄이 거짓인 채 푸시됐다(`7617b25` → `a2d5cc8`로 정정).
                  그 트리에는 타 세션의 **미커밋 다동 작업**이 얹혀 있었고 원격엔 하나도 없었다.
                📏 이 커밋에서 다동 배선이 실제로 들어왔으므로 문구를 **되돌려** 적는다 —
                  `otherBuildings`(별지 9호 동별)·`mb{i}` 실값 앵커(갑지 다수동일때)·`primaryBuilding`.
                  **동작과 그 동작을 설명하는 문구는 한 커밋에서 함께 움직인다.**
                ⚠ 여전히 대표동만 읽는 자리가 있다: 소방계획서 1.1(`primaryBuilding(buildings)`) ·
                  별지 9호 2쪽(`bldRows[0]`) · 3쪽 설비(`.eq('building_id', b.id)`) · 갑지 개요·정보 시트.
                  이 비대칭이 화면에 없으면 사용자는 "입력했는데 문서에 없다"를 겪는다.
                ⚠ 활성 동수는 화면의 `activeCount`와 **같은 값**을 쓴다 — 배너와 안내가 다른 수를 말하면
                  둘 중 하나는 반드시 거짓이다.
                ⚠ 마지막 줄은 규현빌라 실사고(기존 동을 고치려다 새 동을 만든 것) 재발 방지다. */}
            {editing === 'new' && buildings.length > 0 && (
              <div data-testid="building-new-notice"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-form-xs text-amber-800 space-y-1">
                <p><b>{activeCount + 1}번째 동</b>을 등록합니다 — 문서마다 실리는 자리가 다릅니다.</p>
                <p>· <b>실립니다</b>: 별지 9호 <b>동별</b> 쪽 · 갑지 <b>다수동일때</b> 시트 ·
                  소방계획서 <b>1.4 시설현황</b>(설비는 전 동 합산)</p>
                <p>· <b>안 실립니다</b>: 소방계획서 본문 1.1 · 별지 9호 2쪽·3쪽 · 갑지 개요·정보 시트 —
                  이 자리는 <b>대표동</b> 값만 인쇄합니다(목록에서 [대표로]로 바꿀 수 있습니다).</p>
                {activeCount + 1 > FORM9_MAX_BUILDINGS && (
                  <p className="font-semibold text-amber-900">
                    ⚠ 서식이 담는 {FORM9_MAX_BUILDINGS}동을 넘습니다 — 이 동은 인쇄되지 않습니다. 서식을 추가하여 작성하세요.
                  </p>
                )}
                <p className="text-amber-700">
                  ⚠ 기존 동을 고치려던 것이라면 <b>취소</b>하고 목록에서 [보기·수정]을 누르세요 —
                  여기서 저장하면 <b>새 동이 생기고</b>, 되돌리는 길은 완전 삭제가 아니라 비활성 처리뿐입니다.
                </p>
              </div>
            )}
          </div>

          <SubRow label="건물">
            <Cell span={2} label={<>건물명<span className="text-red-500 ml-0.5">*</span></>}>
              <input value={form.building_name} onChange={e => setField('building_name', e.target.value)} disabled={!canManage}
                className={`${inputCls} ${keyInputCls}`} />
            </Cell>
            <Cell label="용도" htmlFor="bf-purpose">
              {/* 049 building_purposes 제안 — select가 아닌 콤보: 대장이 목록에 없는 용도를 넣는 경우가
                  있어 강제하면 값이 잘린다. datalist→ComboInput 교체(2026-08-19) — 누르기 전엔 목록이 안 보였다 */}
              <ComboInput id="bf-purpose" value={form.purpose} onChange={v => setField('purpose', v)} disabled={!canManage}
                options={purposes} ariaLabel="건물 용도"
                placeholder={purposes.length > 0 ? '선택/직접 입력' : '예: 근린생활시설'} className={`${inputCls} !h-12`} />
            </Cell>
            <Cell label="준공연도">
              <input type="number" value={form.year_built} onChange={e => setField('year_built', e.target.value)} disabled={!canManage}
                className={`${inputCls} !h-12`} />
            </Cell>
            <Cell label="연면적(㎡)" htmlFor="bf-total-area">
              <input id="bf-total-area" type="number" value={form.total_area} onChange={e => setField('total_area', e.target.value)} disabled={!canManage} className={inputCls} />
            </Cell>
            <Cell label="지상(층)" htmlFor="bf-floors-above">
              <input id="bf-floors-above" type="number" value={form.floors_above} onChange={e => setField('floors_above', e.target.value)} disabled={!canManage} className={inputCls} />
            </Cell>
            <Cell label="지하(층)">
              <input type="number" value={form.floors_below} onChange={e => setField('floors_below', e.target.value)} disabled={!canManage} className={inputCls} />
            </Cell>
            <Cell label="상태">
              {editing !== 'new' && canManage ? (
                <label className="flex items-center gap-1.5 h-form-8 text-form-sm text-ink-sub">
                  <input type="checkbox" checked={form.is_active} onChange={e => setField('is_active', e.target.checked)} className="accent-brand" />
                  활성
                </label>
              ) : <p className="h-form-8 flex items-center text-form-sm text-ink-meta">{editing === 'new' ? '새 동' : form.is_active ? '활성' : '비활성'}</p>}
            </Cell>
          </SubRow>

          <SubRow label="주소">
            <Cell label="우편번호">
              <input value={form.zipcode} readOnly tabIndex={-1} className={`${inputCls} bg-paper`} />
            </Cell>
            <Cell span={2} label="주소">
              <input value={form.address} readOnly tabIndex={-1} placeholder="주소 검색 또는 고객 주소 상속" className={`${inputCls} bg-paper`} />
            </Cell>
            <Cell label={<span className="invisible">검색</span>}>
              {canManage && (
                <button onClick={handleAddressSearch}
                  className="w-full inline-flex items-center justify-center gap-1 h-form-8 px-3 rounded-lg bg-brand-tint text-brand text-form-sm font-medium border border-brand-line">
                  <Search className="size-3.5" /> 주소 검색
                </button>
              )}
            </Cell>
            {editing === 'new' && customerAddress && (
              <Cell span={4}>
                <label className="flex items-center gap-1.5 text-form-xs text-ink-sub">
                  <input type="checkbox" checked={sameAsCustomer} onChange={e => toggleSameAsCustomer(e.target.checked)} className="accent-brand" />
                  고객 주소와 동일 ({customerAddress})
                </label>
              </Cell>
            )}
          </SubRow>

          {/* ★ 기준일 — 별지 9호 2쪽 「건축물 정보」의 두 날짜. 기본정보 탭의 기준일 줄과 **같은 모양**(보라 바탕·큰 칸).
              ⚠ 사용승인일은 여기서 **고칠 수 없다**(고객 기본정보가 원천 — 점검 기산점 축) → 읽기 전용 + 갈 곳 안내.
              ⚠ a9Label·data-a9-blank는 그대로 — 「비었을 때만 빨강」 계약(test-a9)이 이 표식을 문다. */}
          <SubRow label="기준일" accent testId="building-keydates">
            <Cell>
              <div data-a9-blank={a9Blank(useApprovalDate) ? '1' : '0'} className="space-y-1.5">
                <label className={a9Label(a9Blank(useApprovalDate))}>사용승인일</label>
                <input value={useApprovalDate ?? ''} readOnly placeholder="고객 정보에서 입력"
                  title="사용승인일은 고객 기본 정보의 값입니다 — 점검 기산점 축이라 고객 정보에서 수정합니다"
                  className={`${inputCls} ${keyInputCls} bg-paper`} />
              </div>
            </Cell>
            <Cell>
              <div data-a9-blank={a9Blank(form.permit_date) ? '1' : '0'} className="space-y-1.5">
                <label className={a9Label(a9Blank(form.permit_date))}>건축허가일<span className="text-red-500 ml-0.5">*</span></label>
                <DateInput id="bf-permit-date" value={form.permit_date} onChange={e => setField('permit_date', e.target.value)} disabled={!canManage}
                  className={`${inputCls} ${keyInputCls}`} />
              </div>
            </Cell>
            <Cell span={2} label="건축물대장">
              <p className="text-form-xs text-ink-sub leading-relaxed">
                주소 검색 시 건축물대장에서 <b className="text-ink">빈 칸만</b> 자동 채움 — 대장에 없으면 직접 입력.
                사용승인일은 <b className="text-ink">기본정보 탭</b>에서 고칩니다(점검 기산점).
              </p>
              {ledgerNote && <p className="text-form-xs text-brand">{ledgerNote}</p>}
            </Cell>
          </SubRow>

          {/* 별지 9호 2쪽 "건축물 정보" 항목 (소방계획서_9 B안) — 대장이 값을 주지 않는 건물도 서식을 채울 수 있게 수기 입력 */}
          <SubRow label="규모 (별지 9호)">
            {/* 건축면적 — 표시만 필수(빨간 *), 저장은 막지 않는다(2026-09-08 사용자 확정): 대장 표제부에
                archArea가 없는 건물이 실재해(실호출 11/14) 차단하면 그 건물은 영영 저장이 안 된다 */}
            <Cell>
              <div data-a9-blank={a9Blank(form.building_area) ? '1' : '0'} className="space-y-1.5">
                <label className={a9Label(a9Blank(form.building_area))}>건축면적(㎡)<span className="text-red-500 ml-0.5">*</span></label>
                <input id="bf-building-area" type="number" value={form.building_area} onChange={e => setField('building_area', e.target.value)} disabled={!canManage} className={inputCls} />
              </div>
            </Cell>
            <Cell>
              <div data-a9-blank={a9Blank(form.height) ? '1' : '0'} className="space-y-1.5">
                <label className={a9Label(a9Blank(form.height))}>높이(m)</label>
                <input id="bf-height" type="number" value={form.height} onChange={e => setField('height', e.target.value)} disabled={!canManage} className={inputCls} />
              </div>
            </Cell>
            <Cell label="세대수" htmlFor="bf-households">
              <input id="bf-households" type="number" value={form.households} onChange={e => setField('households', e.target.value)} disabled={!canManage} className={inputCls} />
            </Cell>
            <Cell label="동수" htmlFor="bf-building-count">
              <input id="bf-building-count" type="number" value={form.building_count} onChange={e => setField('building_count', e.target.value)} disabled={!canManage} className={inputCls} />
            </Cell>
          </SubRow>

          {/* 구조 — 자유 입력 허용(목록 밖 값은 서식에서 '기타' 체크로 인쇄) */}
          <SubRow label="구조">
            <Cell label="건축물구조" htmlFor="bf-structure">
              <ComboInput id="bf-structure" value={form.main_structure} onChange={v => setField('main_structure', v)} disabled={!canManage}
                options={STRUCTURE_OPTIONS} ariaLabel="건축물구조" placeholder="선택/직접 입력" className={inputCls} />
            </Cell>
            <Cell label="지붕구조" htmlFor="bf-roof">
              <ComboInput id="bf-roof" value={form.roof_structure} onChange={v => setField('roof_structure', v)} disabled={!canManage}
                options={ROOF_OPTIONS} ariaLabel="지붕구조" placeholder="선택/직접 입력" className={inputCls} />
            </Cell>
            <Cell label="경사로(개소)" htmlFor="bf-ramp">
              <input id="bf-ramp" type="number" value={form.ramp_count} onChange={e => setField('ramp_count', e.target.value)} disabled={!canManage} className={inputCls} />
            </Cell>
          </SubRow>

          {/* 시설현황 — 서식 1.1 12~16행(승강기·주차장·계단)을 **그 배치 그대로** 한 덩어리로(4열 전폭).
              규칙은 여기 없다 — 판정은 `lib/facility-status`, 주차장 해석은 `doc-templates/report9`. */}
          <SubRow label="시설 현황">
            <Cell span={4}>
              <FacilityStatusGrid
                idPrefix="bf"
                disabled={!canManage}
                value={{
                  elevators: {
                    passenger: form.elevator_count,
                    emergency: form.emergency_elevator_count,
                    evac: form.evac_elevator_count,
                  },
                  stairs: {
                    special: form.stair_special_count, direct: form.stair_direct_count,
                    escape: form.stair_escape_count, outdoor: form.stair_outdoor_count,
                  },
                  parkingSummary: form.parking_summary,
                }}
                onElevator={(k, v) => setField(ELEVATOR_FORM_FIELD[k], v)}
                onStair={(k, v) => setField(STAIR_FORM_FIELD[k], v)}
                onParking={v => setField('parking_summary', v)}
              />
            </Cell>
          </SubRow>

          <SubRow label="메모">
            <Cell span={4} label="비고">
              <input value={form.notes} onChange={e => setField('notes', e.target.value)} disabled={!canManage} className={inputCls} />
            </Cell>
          </SubRow>

          {/* 저장 줄 — 기본정보 탭과 같은 모양·같은 자리(상자 아래, 스크롤해도 붙어 있다) */}
          {canManage && (
            <div data-testid="building-save-bar"
              className="sticky bottom-0 z-10 flex items-center gap-3 px-5 py-3 bg-paper/95 backdrop-blur border-t border-line">
              {editing !== 'new' && form.is_active && (() => {
                const cur = buildings.find(b => b.id === editing)
                return cur ? (
                  <button onClick={() => deactivate(cur)} disabled={isPending}
                    className="h-form-9 px-3 rounded-lg border border-red-200 text-form-sm text-red-500 hover:bg-red-50 shrink-0">비활성화</button>
                ) : null
              })()}
              <span className="text-form-xs truncate min-w-0 flex-1">
                {error ? <span className="text-red-500">{error}</span>
                  : saved ? <span className="text-green-700" data-testid="building-saved-note">저장되었습니다.</span>
                  : null}
              </span>
              <button onClick={close} className="h-form-9 px-4 rounded-lg border border-line text-form-sm text-ink-sub hover:bg-paper shrink-0">취소</button>
              <button onClick={save} disabled={isPending}
                className="h-form-9 px-6 rounded-lg bg-brand hover:bg-brand-strong text-white text-form-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0">
                {isPending && <Loader2 className="size-3 animate-spin" />} 저장
              </button>
            </div>
          )}
          {!canManage && error && <p className="px-5 py-3 text-form-xs text-red-500">{error}</p>}
        </>
      )}
      </GroupBox>

      {/* 주소 중복 안내 — 다른 고객의 고객·건물과 주소가 겹칠 때만 */}
      {dupInfo && (
        <AddressDuplicateDialog
          customer={dupInfo.customer}
          building={dupInfo.building}
          address={form.address.trim()}
          onClose={() => setDupInfo(null)}
          onContinue={() => {
            dupAckRef.current = form.address.trim()
            setDupInfo(null)
            if (pendingSaveRef.current) { pendingSaveRef.current = false; doSave() }
          }}
          continueLabel="계속 저장"
        />
      )}

      {/* 같은 이름 건물 확인 (2026-09-09) — 같은 고객 안에서 이름이 겹칠 때. **차단이 아니다**:
          한 고객이 여러 동을 가지는 것은 정상이라 「그래도 등록」으로 넘어갈 수 있고, 대신
          이름을 갈라 적도록 권한다(A동·B동). 종전엔 이 확인이 없어 같은 이름이 조용히 쌓였다. */}
      {sameNameDup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="bg-surface rounded-xl border border-brand-line shadow-xl w-full max-w-sm p-5" data-testid="building-samename-dialog">
            <h3 className="text-form-base-title font-semibold text-ink mb-2">같은 이름의 건물이 이미 있습니다</h3>
            <p className="text-form-sm text-ink-sub mb-1">
              이 고객에 <b className="text-ink">{sameNameDup.building_name}</b>
              {sameNameDup.is_active === false && <span className="text-ink-meta">(비활성)</span>}
              {' '}건물이 이미 등록돼 있습니다.
            </p>
            <p className="text-form-sm text-ink-meta mb-4">
              같은 건물을 <b>수정</b>하려면 목록에서 그 건물을 눌러 주세요.
              동이 여러 개라면 <b>「{sameNameDup.building_name} A동」</b>처럼 이름을 갈라 적으면 문서에서 구별됩니다.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setSameNameDup(null)}
                className="h-form-8 px-3 rounded-lg border border-line text-form-sm text-ink-sub hover:bg-brand-tint">취소</button>
              <button
                onClick={() => { const b = sameNameDup; setSameNameDup(null); openEdit(b) }}
                className="h-form-8 px-3 rounded-lg border border-brand-line text-form-sm text-brand hover:bg-brand-tint">기존 건물 수정</button>
              <button
                onClick={() => {
                  sameNameAckRef.current = normalizeBuildingName(form.building_name)
                  setSameNameDup(null)
                  save()
                }}
                className="h-form-8 px-3 rounded-lg bg-brand text-white text-form-sm hover:opacity-90">그래도 등록</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
