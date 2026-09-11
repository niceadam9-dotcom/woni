'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Building2, Plus, Search, Loader2, X } from 'lucide-react'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { ComboInput } from '@/components/ui/combo-input'
import { createBuildingAction, updateBuildingAction, deleteBuildingAction } from '@/app/(dashboard)/buildings/actions'
import { fetchBuildingLedgerAction, checkAddressAction, type AddressDuplicateCustomer, type AddressDuplicateBuilding } from '@/app/(dashboard)/customers/actions'
import { AddressDuplicateDialog } from '@/components/customers/address-duplicate-dialog'
import { autoApplyLedgerEmptyAction } from '@/app/(dashboard)/customers/fire-plan-info-actions'
import { parseParkingSummary } from '@/lib/doc-templates/report9'
import { findSameNameBuilding, normalizeBuildingName } from '@/lib/building-dup'
import { initialBuildingPanelTarget, shouldHideBuildingTable } from '@/lib/building-panel-open'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
import { useCustomerTabs } from '@/components/customers/customer-tabs'

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
  stairs_count: number | null
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
  stairs_count: string
  ramp_count: string
  evac_elevator_count: string
}

const EMPTY: FormState = {
  building_name: '', zipcode: '', address: '', address_jibun: '', bcode: '',
  purpose: '', total_area: '', floors_above: '', floors_below: '', year_built: '', notes: '', is_active: true,
  permit_date: '', building_area: '', building_count: '', parking_summary: '',
  height: '', households: '', elevator_count: '', emergency_elevator_count: '',
  main_structure: '', roof_structure: '', stairs_count: '', ramp_count: '', evac_elevator_count: '',
}

/** 구조·지붕 제안 목록 — 소방계획서 1.1 패널(fire-plan-info-panel)과 같은 어휘. 서식 체크 판정은
 *  report9-assemble 키워드(콘크리트/철골/조적/목 · 슬래브|슬라브/기와/슬레이트, 그 외 = 기타)라
 *  목록 밖 자유 입력도 '기타' 체크로 안전하게 인쇄된다 */
const STRUCTURE_OPTIONS = ['철근콘크리트구조', '철골구조', '조적조', '목구조', '샌드위치판넬']
const ROOF_OPTIONS = ['슬래브', '기와', '슬레이트', '판넬', '징크']

/** 주차장 토글 칩 — 요약 텍스트의 단어 포함 여부가 곧 별지 9호 체크(parseParkingSummary 단일 원천, 사본 금지) */
const PARKING_CHIPS: Array<{ flag: keyof ReturnType<typeof parseParkingSummary>; word: string; label: string }> = [
  { flag: 'pkIn', word: '옥내', label: '옥내' },
  { flag: 'pkInUg', word: '지하', label: '옥내·지하' },
  { flag: 'pkInGround', word: '지상', label: '옥내·지상' },
  { flag: 'pkInPiloti', word: '필로티', label: '옥내·필로티' },
  { flag: 'pkMech', word: '기계식', label: '기계식' },
  { flag: 'pkRoof', word: '옥상', label: '옥상' },
  { flag: 'pkOut', word: '옥외', label: '옥외' },
]

/** 주차장 대수 4분류 — 건축물대장 조회(fetchBuildingLedgerAction)가 합성하는 어휘와 동일.
 *  숫자칸은 요약 텍스트를 읽고 쓰는 지름길일 뿐(텍스트가 원천) — 별도 저장 컬럼 없음 */
const PARKING_COUNT_FIELDS = ['옥내 자주식', '옥내 기계식', '옥외 자주식', '옥외 기계식'] as const
const parkingCountRe = (label: string) => new RegExp(label.replace(' ', '\\s*') + '\\s*(\\d+)\\s*대')

/** 세그먼트 제거 뒤 구분자(`, ` · ` · `) 잔해 정리 — 칩 토글·대수칸이 공용 */
function tidyParkingText(s: string): string {
  return s
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*,\s*/g, ', ').replace(/(?:, )+/g, ', ')
    .replace(/\s*·\s*/g, ' · ').replace(/(?: · )+/g, ' · ')
    .replace(/,\s*·\s*/g, ', ').replace(/·\s*,\s*/g, ', ')
    .replace(/^[\s,·]+|[\s,·]+$/g, '')
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
      stairs_count: b.stairs_count != null ? String(b.stairs_count) : '',
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
    setLedgerNote(''); setError(''); syncUrl(b.id)
    // 건축허가일이 필수가 되면서(2026-09-05) 기존 건물 대다수가 공란 — 대장에서 빈 칸만 자동 보충해
    // 저장 차단에 걸리기 전에 채워준다(등록 폼 openNew와 같은 동작, 수기 값은 덮지 않음)
    if (canManage && !f.permit_date && b.bcode && b.address_jibun) fetchLedger(b.bcode, b.address_jibun, f)
  }
  function openNew() {
    const f = newForm()
    setForm(f); setEditing('new'); setSameAsCustomer(!!customerAddress)
    openBcodeRef.current = f.bcode
    setLedgerNote(''); setError(''); syncUrl('new')
    if (f.bcode && f.address_jibun) fetchLedger(f.bcode, f.address_jibun, f)
  }
  /* 닫기 = **완전히 접는다**(2026-09-09). 종전엔 여기서 다시 '건물 등록' 폼을 열었는데,
   * 수정을 마치고 닫은 자리에 빈 등록 폼이 나타나 **다음 입력이 새 건물이 되는** 통로였다. */
  function close() {
    setForm(newForm()); setEditing(null); setSameAsCustomer(false)
    openBcodeRef.current = ''
    setLedgerNote(''); setError('')
    tabs?.setTabDirty('buildings', false)
    syncUrl(null)
  }

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    tabs?.setTabDirty('buildings', true)
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

  // 주차장 칩 토글 — 요약 텍스트에 단어를 넣고 빼는 것뿐(단어 포함 = 서식 체크, parseParkingSummary 축).
  // 대수 등 상세("자주식 12대")는 텍스트에 그대로 남는다.
  function toggleParkingWord(word: string) {
    const cur = form.parking_summary
    if (cur.includes(word)) {
      setField('parking_summary', tidyParkingText(cur.split(word).join('')))
    } else {
      // '지상'은 옥내 문맥에서만 옥내·지상으로 인정(parseParkingSummary) — 옥내가 없으면 함께 넣는다
      const add = word === '지상' && !cur.includes('옥내') ? '옥내 지상' : word
      setField('parking_summary', cur ? `${cur}, ${add}` : add)
    }
  }

  // 주차장 대수칸 — 텍스트에서 「옥내 자주식 12대」 세그먼트를 읽고(표시) 고쳐 쓴다(입력).
  // 숫자를 지우면 세그먼트째 제거. 분류가 텍스트에 없으면 뒤에 덧붙인다(대장 합성과 같은 형식).
  function parkingCountOf(label: string): string {
    const m = form.parking_summary.match(parkingCountRe(label))
    return m ? m[1] : ''
  }
  function setParkingCount(label: string, raw: string) {
    const cur = form.parking_summary
    const re = parkingCountRe(label)
    const n = raw.replace(/\D/g, '')
    if (re.test(cur)) {
      setField('parking_summary', n ? cur.replace(re, `${label} ${n}대`) : tidyParkingText(cur.replace(re, '')))
    } else if (n) {
      setField('parking_summary', cur ? `${cur}, ${label} ${n}대` : `${label} ${n}대`)
    }
  }

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
        stairs_count: int(form.stairs_count),
        ramp_count: int(form.ramp_count),
        evac_elevator_count: int(form.evac_elevator_count),
      }
      const res = editing === 'new'
        ? await createBuildingAction({ customer_id: customerId, ...common })
        : await updateBuildingAction({ id: editing!, is_active: form.is_active, ...common })
      if (res.error) { setError(res.error); return }
      // 주소(bcode) 확정 시 소방계획서용 대장 확장 필드 반영 — 소방계획서 탭 버튼 클릭 불필요.
      // '전 필드'(대장이 정답, 2026-08-06 사용자 확정)는 **이 편집에서 주소가 새로 확정된 경우에만** —
      // 같은 주소 재저장까지 'all'로 돌리면 방금 저장한 수기 구조·주차장 값이 대장 값으로 되돌아간다(2026-09-05).
      if (form.bcode) {
        const mode = form.bcode !== openBcodeRef.current ? 'all' as const : 'empty' as const
        try { await autoApplyLedgerEmptyAction(customerId, { mode }) } catch { /* best-effort */ }
      }
      close()
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
    <div id="buildings-panel" className="scroll-mt-4 bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="size-4 text-brand" />
        <h2 className="text-form-base-title font-semibold text-ink">건물 목록</h2>
        <span className="text-form-sm text-ink-meta ml-auto">{buildings.length}개</span>
        {canManage && editing !== 'new' && (
          <button onClick={openNew}
            className="inline-flex items-center gap-1 h-form-7 px-2.5 rounded-lg border border-brand-line text-form-sm text-brand hover:bg-brand-tint transition-colors">
            <Plus className="size-3" />
            건물 등록
          </button>
        )}
      </div>

      {/* 1동뿐이고 **그 동의 상세가 이미 펼쳐져 있으면** 목록 표를 그리지 않는다 (2026-09-11 사용자 확정:
          "두번 보일 필요는 없어"). 자동 펼침을 넣자 같은 건물명이 목록 행과 폼에 **위아래로 두 번** 나왔다
          — 행 1개와 그 행의 상세는 같은 한 건이라, 표는 「고를 것이 있을 때」만 쓸모가 있다.
          ⚠ 머리줄(「건물 목록 · N개 · [+ 건물 등록]」)은 **남긴다** — 거기에 2번째 동을 추가하는 문이 있다.
            표까지 통째로 감추면 그 버튼이 함께 사라져, 이번에 고친 그 결함(문이 조건에 가려 숨는 것)이
            모양만 바꿔 되살아난다.
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
                  <td className="py-3 pr-4 font-medium text-ink">{b.building_name}</td>
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

      {/* 인라인 등록·수정 패널 */}
      {editing && (
        <div className="mt-4 rounded-xl border border-brand-line bg-brand-tint p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-form-sm font-bold text-brand">{editing === 'new' ? '건물 등록' : '건물 수정'}</p>
            <button onClick={close} className="text-ink-faint hover:text-ink-sub"><X className="size-4" /></button>
          </div>

          {/* 등록 시점 안내 (2026-09-11 사용자 지시) — **등록을 결정하는 그 순간에** 어디에 실리는지 알린다.
              🚨🚨 이 문구는 **반드시 배포되는 코드(origin/main)에 대고** 적을 것. 처음 판정을 dev 서버
                (=공유 작업트리)에 대고 해서 세 줄이 거짓인 채 푸시됐다(`7617b25`). 그 트리에는 타 세션의
                **미커밋 다동 작업**이 얹혀 있었고, 원격에는 그게 하나도 없었다.
              📏 origin/main 실측(정정 근거):
                · 갑지 「다수동일때」 시트 — 앵커가 `mbStructureBlank`·`mbRoofBlank`… 뿐이라
                  값이 아니라 **빈 서식으로 상시 덮는다**(`xlsx-anchors`·`xlsx-workbook` 주석 명시).
                · 별지 9호 「동별」 쪽 — `otherBuildings`/`bldRest`가 **아예 없다**(grep 0건).
                · 별지 9호 3쪽 설비 — `.eq('building_id', b.id)`라 **대표동만**.
                · 소방계획서 1.1 — `const b = buildings[0]`이라 대표동만.
                · 유일한 예외가 소방계획서 **1.4 시설현황** — `.in('building_id', …)`로 전 동 합산.
              ⚠ 그러므로 지금은 "거의 안 실린다"가 참이다. 다동 배선이 원격에 올라오면
                **그 커밋에서 이 문구도 함께** 고칠 것(동작과 그 동작을 설명하는 문구는 한 커밋에서 움직인다).
              ⚠ 활성 동수는 `buildings`에서 **직접 센다** — 표가 그리는 것과 같은 배열을 같은 방식으로.
              ⚠ 마지막 줄은 규현빌라 실사고(기존 동을 고치려다 새 동을 만든 것) 재발 방지다. */}
          {editing === 'new' && buildings.length > 0 && (
            <div data-testid="building-new-notice"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-form-xs text-amber-800 space-y-1">
              <p><b>{buildings.filter(b => b.is_active).length + 1}번째 동</b>을 등록합니다 —
                <b className="text-amber-900"> 지금은 이 동이 문서에 거의 인쇄되지 않습니다.</b></p>
              <p>· <b>안 실립니다</b>: 소방계획서 본문 1.1 · 별지 9호 2쪽·3쪽 · 갑지 개요·정보 시트 —
                이 자리는 <b>대표동</b>(가장 먼저 등록된 활성 동) 값만 인쇄합니다.
                갑지 <b>다수동일때</b> 시트도 아직 <b>빈 서식</b>으로 인쇄됩니다.</p>
              <p>· <b>실립니다</b>: 소방계획서 <b>1.4 시설현황</b>(설비는 전 동 합산) — 여기뿐입니다.</p>
              <p>· 동을 나누어 인쇄해야 한다면 <b>고객을 따로 등록</b>하는 것이 현재 실무입니다.</p>
              <p className="text-amber-700">
                ⚠ 기존 동을 고치려던 것이라면 <b>취소</b>하고 목록에서 [보기·수정]을 누르세요 —
                여기서 저장하면 <b>새 동이 생기고</b>, 되돌리는 길은 완전 삭제가 아니라 비활성 처리뿐입니다.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-end">
            <div className="w-52"><label className={labelCls}>건물명<span className="text-red-500 ml-0.5">*</span></label>
              <input value={form.building_name} onChange={e => setField('building_name', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="flex-1 min-w-64"><label className={labelCls}>주소</label>
              <input value={form.address} readOnly placeholder="주소 검색 또는 고객 주소 상속" className={`${inputCls} bg-paper`} /></div>
            <div className="w-24"><label className={labelCls}>우편번호</label>
              <input value={form.zipcode} readOnly className={`${inputCls} bg-paper`} /></div>
            {canManage && (
              <button onClick={handleAddressSearch}
                className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg bg-brand-tint hover:bg-brand-tint text-brand text-form-sm font-medium border border-brand-line">
                <Search className="size-3.5" /> 주소 검색
              </button>
            )}
          </div>
          {editing === 'new' && customerAddress && (
            <label className="flex items-center gap-1.5 text-form-xs text-ink-sub">
              <input type="checkbox" checked={sameAsCustomer} onChange={e => toggleSameAsCustomer(e.target.checked)} className="accent-brand" />
              고객 주소와 동일 ({customerAddress})
            </label>
          )}

          <div className="flex flex-wrap gap-2 items-end">
            <div className="w-36"><label className={labelCls}>용도</label>
              {/* 049 building_purposes 제안 — select가 아닌 콤보: 대장이 목록에 없는 용도를 넣는 경우가
                  있어 강제하면 값이 잘린다. datalist→ComboInput 교체(2026-08-19) — 누르기 전엔 목록이 안 보였다 */}
              <ComboInput id="bf-purpose" value={form.purpose} onChange={v => setField('purpose', v)} disabled={!canManage}
                options={purposes} ariaLabel="건물 용도"
                placeholder={purposes.length > 0 ? '선택/직접 입력' : '예: 근린생활시설'} className={inputCls} /></div>
            <div className="w-28"><label className={labelCls}>연면적(㎡)</label>
              <input id="bf-total-area" type="number" value={form.total_area} onChange={e => setField('total_area', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="w-24"><label className={labelCls}>지상(층)</label>
              <input id="bf-floors-above" type="number" value={form.floors_above} onChange={e => setField('floors_above', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="w-24"><label className={labelCls}>지하(층)</label>
              <input type="number" value={form.floors_below} onChange={e => setField('floors_below', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="w-24"><label className={labelCls}>준공연도</label>
              <input type="number" value={form.year_built} onChange={e => setField('year_built', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="flex-1 min-w-40"><label className={labelCls}>비고</label>
              <input value={form.notes} onChange={e => setField('notes', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            {editing !== 'new' && canManage && (
              <label className="flex items-center gap-1.5 text-form-xs text-ink-sub h-form-8">
                <input type="checkbox" checked={form.is_active} onChange={e => setField('is_active', e.target.checked)} className="accent-brand" />
                활성
              </label>
            )}
          </div>

          {/* 별지 9호 2쪽 "건축물 정보" 항목 (소방계획서_9 B안) — 대장이 값을 주지 않는 건물도 서식을 채울 수 있게 수기 입력 */}
          <div className="rounded-lg border border-brand-line-soft bg-surface p-3 space-y-2">
            <p className="text-form-xs font-semibold text-ink-sub">
              별지 9호 2쪽 건축물 정보
              <span className="ml-1 font-normal text-ink-meta">— 주소 검색 시 건축물대장에서 빈 칸만 자동 채움, 대장에 없으면 직접 입력</span>
            </p>
            {/* ① 허가·승인·면적·규모 — 연면적·층수는 위 기본 정보 행에서 입력 */}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="w-32"><label className={labelCls}>건축허가일<span className="text-red-500 ml-0.5">*</span></label>
                <DateInput id="bf-permit-date" value={form.permit_date} onChange={e => setField('permit_date', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-32"><label className={labelCls}>사용승인일</label>
                <input value={useApprovalDate ?? ''} readOnly placeholder="고객 정보에서 입력"
                  title="사용승인일은 고객 기본 정보의 값입니다 — 점검 기산점 축이라 고객 정보에서 수정합니다"
                  className={`${inputCls} bg-paper`} /></div>
              {/* 건축면적 — 표시만 필수(빨간 *), 저장은 막지 않는다(2026-09-08 사용자 확정): 대장 표제부에
                  archArea가 없는 건물이 실재해(실호출 11/14) 차단하면 그 건물은 영영 저장이 안 된다 */}
              <div className="w-28"><label className={labelCls}>건축면적(㎡)<span className="text-red-500 ml-0.5">*</span></label>
                <input id="bf-building-area" type="number" value={form.building_area} onChange={e => setField('building_area', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-20"><label className={labelCls}>높이(m)</label>
                <input id="bf-height" type="number" value={form.height} onChange={e => setField('height', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-24"><label className={labelCls}>세대수</label>
                <input id="bf-households" type="number" value={form.households} onChange={e => setField('households', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-20"><label className={labelCls}>동수</label>
                <input id="bf-building-count" type="number" value={form.building_count} onChange={e => setField('building_count', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            </div>
            {/* ② 구조 — 자유 입력 허용(목록 밖 값은 서식에서 '기타' 체크로 인쇄) */}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="w-40"><label className={labelCls}>건축물구조</label>
                <ComboInput id="bf-structure" value={form.main_structure} onChange={v => setField('main_structure', v)} disabled={!canManage}
                  options={STRUCTURE_OPTIONS} ariaLabel="건축물구조" placeholder="선택/직접 입력" className={inputCls} /></div>
              <div className="w-36"><label className={labelCls}>지붕구조</label>
                <ComboInput id="bf-roof" value={form.roof_structure} onChange={v => setField('roof_structure', v)} disabled={!canManage}
                  options={ROOF_OPTIONS} ariaLabel="지붕구조" placeholder="선택/직접 입력" className={inputCls} /></div>
              <div className="w-24"><label className={labelCls}>경사로(개소)</label>
                <input id="bf-ramp" type="number" value={form.ramp_count} onChange={e => setField('ramp_count', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            </div>
            {/* ③ 계단·승강기 — 특별피난계단 개소는 세부제원 3-8(전실 제연)이 유일 원천(A9-3)이라 여기 없음 */}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="w-32"><label className={labelCls}>직통·피난계단(개소)</label>
                <input id="bf-stairs" type="number" value={form.stairs_count} onChange={e => setField('stairs_count', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-28"><label className={labelCls}>승용승강기(대)</label>
                <input id="bf-elevator" type="number" value={form.elevator_count} onChange={e => setField('elevator_count', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-28"><label className={labelCls}>비상용승강기(대)</label>
                <input type="number" value={form.emergency_elevator_count} onChange={e => setField('emergency_elevator_count', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-28"><label className={labelCls}>피난용승강기(대)</label>
                <input type="number" value={form.evac_elevator_count} onChange={e => setField('evac_elevator_count', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <p className="text-form-xs text-ink-meta pb-1.5">특별피난계단 개소는 세부제원 3-8(전실 제연)에서 자동 반영</p>
            </div>
            {/* ④ 주차장 — 텍스트가 원천, 칩은 단어를 넣고 빼는 지름길 + 서식 체크 미리보기 */}
            <div>
              <label className={labelCls}>주차장</label>
              <input id="bf-parking" value={form.parking_summary} onChange={e => setField('parking_summary', e.target.value)} disabled={!canManage}
                placeholder="예: 옥내 자주식 12대, 옥외 자주식 6대" className={inputCls} />
              {/* 대수 숫자칸 — 한글 타이핑 없이 숫자만 치면 위 텍스트가 자동 합성된다 */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                {PARKING_COUNT_FIELDS.map(label => (
                  <span key={label} className="inline-flex items-center gap-1 text-form-xs text-ink-sub">
                    {label}
                    <input type="number" min={0} inputMode="numeric" disabled={!canManage} aria-label={`${label} 대수`}
                      value={parkingCountOf(label)} onChange={e => setParkingCount(label, e.target.value)}
                      className="h-6 w-14 rounded border border-brand-line bg-surface px-1.5 text-form-xs text-right outline-none focus:border-brand" />
                    대
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                {(() => { const pk = parseParkingSummary(form.parking_summary); return PARKING_CHIPS.map(c => (
                  <button key={c.word} type="button" disabled={!canManage} onClick={() => toggleParkingWord(c.word)}
                    title={pk[c.flag] ? `'${c.word}' 단어를 텍스트에서 제거` : `'${c.word}' 단어를 텍스트에 추가`}
                    className={`h-6 px-2 rounded-full border text-form-xs transition-colors ${pk[c.flag]
                      ? 'bg-brand text-white border-brand'
                      : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`}>
                    {pk[c.flag] ? '✓ ' : ''}{c.label}
                  </button>
                )) })()}
                <span className="text-form-xs text-ink-meta ml-1">색칠된 칩 = 별지 9호에 √로 인쇄 (단어 포함 기준)</span>
              </div>
            </div>
          </div>

          {ledgerNote && <p className="text-form-xs text-brand">{ledgerNote}</p>}
          {error && <p className="text-form-xs text-red-500">{error}</p>}

          {canManage && (
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={isPending}
                className="h-form-8 px-5 rounded-lg bg-brand hover:bg-brand-strong text-white text-form-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
                {isPending && <Loader2 className="size-3 animate-spin" />} 저장
              </button>
              <button onClick={close} className="h-form-8 px-4 rounded-lg border border-line text-form-sm text-ink-sub hover:bg-paper">취소</button>
              {editing !== 'new' && form.is_active && (() => {
                const cur = buildings.find(b => b.id === editing)
                return cur ? (
                  <button onClick={() => deactivate(cur)} disabled={isPending}
                    className="h-form-8 px-3 rounded-lg border border-red-200 text-form-sm text-red-500 hover:bg-red-50 ml-auto">비활성화</button>
                ) : null
              })()}
            </div>
          )}
        </div>
      )}

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
