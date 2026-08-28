'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Building2, Plus, Search, Loader2, X } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { ComboInput } from '@/components/ui/combo-input'
import { createBuildingAction, updateBuildingAction, deleteBuildingAction } from '@/app/(dashboard)/buildings/actions'
import { fetchBuildingLedgerAction, checkAddressAction, type AddressDuplicateCustomer, type AddressDuplicateBuilding } from '@/app/(dashboard)/customers/actions'
import { AddressDuplicateDialog } from '@/components/customers/address-duplicate-dialog'
import { autoApplyLedgerEmptyAction } from '@/app/(dashboard)/customers/fire-plan-info-actions'
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
}

const EMPTY: FormState = {
  building_name: '', zipcode: '', address: '', address_jibun: '', bcode: '',
  purpose: '', total_area: '', floors_above: '', floors_below: '', year_built: '', notes: '', is_active: true,
  permit_date: '', building_area: '', building_count: '', parking_summary: '',
  height: '', households: '', elevator_count: '', emergency_elevator_count: '',
}

/** 누락 칩(소방계획서 빠른 입력) → 이 폼 입력칸 id — erp:focus-missing 이벤트로 열고 포커스 */
export const BUILDING_FIELD_IDS: Record<string, string> = {
  '건축허가일': 'bf-permit-date', '건축면적': 'bf-building-area', '건물동수': 'bf-building-count',
  '주차장': 'bf-parking', '높이': 'bf-height', '세대수': 'bf-households', '승강기': 'bf-elevator',
  '건물 용도': 'bf-purpose', '연면적': 'bf-total-area', '층수': 'bf-floors-above',
}

const inputCls = 'h-8 w-full rounded-lg border border-brand-line bg-surface px-2 text-xs outline-none focus:border-brand'
const labelCls = 'text-[11px] font-medium text-ink-sub'

export function BuildingListPanel({ customerId, customerName, customerAddress, buildings, canManage, initialOpenId, initialNew, purposes = [] }: {
  customerId: string
  customerName: string
  customerAddress: string | null
  buildings: BuildingPanelRow[]
  canManage: boolean
  initialOpenId?: string
  initialNew?: boolean
  /** 049 building_purposes — 관리자 > 건물 용도 관리 목록. datalist 제안(대장 자동값·신규 용도도 허용) */
  purposes?: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const openPostcode = useDaumPostcode()
  const tabs = useCustomerTabs()
  // 주소 상속용: bcode가 저장된 첫 활성 건물 (§5-A-2)
  const inheritSrc = buildings.find(b => b.is_active && b.bcode) ?? null

  const [editing, setEditing] = useState<string | null>(
    initialNew ? 'new' : (initialOpenId && buildings.some(b => b.id === initialOpenId) ? initialOpenId : null))
  const [form, setForm] = useState<FormState>(() =>
    initialOpenId ? toForm(buildings.find(b => b.id === initialOpenId)) : newForm())
  const [sameAsCustomer, setSameAsCustomer] = useState(initialNew && !!customerAddress)
  const [ledgerNote, setLedgerNote] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  // 주소 중복 안내 팝업 — 다른 고객의 고객/건물과 주소가 겹칠 때만 (같은 고객의 다른 동은 정상)
  const [dupInfo, setDupInfo] = useState<{ customer?: AddressDuplicateCustomer; building?: AddressDuplicateBuilding } | null>(null)
  const dupAckRef = useRef('')            // '계속 등록'으로 확인 완료된 주소
  const pendingSaveRef = useRef(false)    // 저장 시점 중복 확인 후 이어서 저장할지

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
      if (!editingRef.current) {
        const target = buildings.find(b => b.is_active) ?? buildings[0]
        if (!target) return
        setForm(toForm(target)); setEditing(target.id); setSameAsCustomer(false)
        setLedgerNote(''); setError(''); syncUrl(target.id)
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
    setForm(toForm(b)); setEditing(b.id); setSameAsCustomer(false)
    setLedgerNote(''); setError(''); syncUrl(b.id)
  }
  function openNew() {
    const f = newForm()
    setForm(f); setEditing('new'); setSameAsCustomer(!!customerAddress)
    setLedgerNote(''); setError(''); syncUrl('new')
    if (f.bcode && f.address_jibun) fetchLedger(f.bcode, f.address_jibun, f)
  }
  function close() {
    setEditing(null); setLedgerNote(''); setError('')
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

  function save() {
    if (!form.building_name.trim()) { setError('건물명을 입력해주세요.'); return }
    setError('')
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
      }
      const res = editing === 'new'
        ? await createBuildingAction({ customer_id: customerId, ...common })
        : await updateBuildingAction({ id: editing!, is_active: form.is_active, ...common })
      if (res.error) { setError(res.error); return }
      // 주소(bcode) 확정 시 소방계획서용 대장 확장 필드를 '전 필드' 1회 반영 — 소방계획서 탭 버튼 클릭 불필요.
      // 주소가 새로 확정된 시점이라 이전 값은 다른 건물 데이터 → 대장이 정답 (2026-08-06 사용자 확정).
      // 탭 진입 자동은 mode 기본값('빈 칸만')이라 기존 고객의 수기 값은 보존된다.
      if (form.bcode) { try { await autoApplyLedgerEmptyAction(customerId, { mode: 'all' }) } catch { /* best-effort */ } }
      tabs?.setTabDirty('buildings', false)
      setEditing(null); syncUrl(null)
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
        <h2 className="text-sm font-semibold text-ink">건물 목록</h2>
        <span className="text-xs text-ink-faint ml-auto">{buildings.length}개</span>
        {canManage && editing !== 'new' && (
          <button onClick={openNew}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-brand-line text-xs text-brand hover:bg-brand-tint transition-colors">
            <Plus className="size-3" />
            건물 등록
          </button>
        )}
      </div>

      {buildings.length === 0 && editing !== 'new' ? (
        <p className="text-sm text-ink-sub py-6 text-center">등록된 건물이 없습니다</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line-soft">
                {['건물명', '주소', '용도', '연면적', '층수', '준공', '상태'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-ink-sub pb-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buildings.map(b => (
                <tr key={b.id}
                  onClick={() => editing === b.id ? close() : openEdit(b)}
                  className={`border-b border-paper last:border-0 cursor-pointer transition-colors ${editing === b.id ? 'bg-brand-tint' : 'hover:bg-paper'}`}>
                  <td className="py-3 pr-4 font-medium text-ink">{b.building_name}</td>
                  <td className="py-3 pr-4 text-xs text-ink-sub max-w-[140px] truncate">{b.address ?? '-'}</td>
                  <td className="py-3 pr-4">
                    {b.purpose ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-tint text-brand">{b.purpose}</span>
                    ) : (
                      <span className="text-xs text-ink-faint">-</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs text-ink-sub">{b.total_area != null ? `${b.total_area.toLocaleString()}㎡` : '-'}</td>
                  <td className="py-3 pr-4 text-xs text-ink-sub">
                    {b.floors_above != null ? `지상 ${b.floors_above}층${b.floors_below ? ` / 지하 ${b.floors_below}층` : ''}` : '-'}
                  </td>
                  <td className="py-3 pr-4 text-xs text-ink-sub">{b.year_built ?? '-'}</td>
                  <td className="py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${b.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {b.is_active ? '활성' : '비활성'}
                    </span>
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
            <p className="text-xs font-bold text-brand">{editing === 'new' ? '건물 등록' : '건물 수정'}</p>
            <button onClick={close} className="text-ink-faint hover:text-ink-sub"><X className="size-4" /></button>
          </div>

          <div className="flex flex-wrap gap-2 items-end">
            <div className="w-52"><label className={labelCls}>건물명 *</label>
              <input value={form.building_name} onChange={e => setField('building_name', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="flex-1 min-w-64"><label className={labelCls}>주소</label>
              <input value={form.address} readOnly placeholder="주소 검색 또는 고객 주소 상속" className={`${inputCls} bg-paper`} /></div>
            <div className="w-24"><label className={labelCls}>우편번호</label>
              <input value={form.zipcode} readOnly className={`${inputCls} bg-paper`} /></div>
            {canManage && (
              <button onClick={handleAddressSearch}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-brand-tint hover:bg-brand-tint text-brand text-xs font-medium border border-brand-line">
                <Search className="size-3.5" /> 주소 검색
              </button>
            )}
          </div>
          {editing === 'new' && customerAddress && (
            <label className="flex items-center gap-1.5 text-[11px] text-ink-sub">
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
              <label className="flex items-center gap-1.5 text-[11px] text-ink-sub h-8">
                <input type="checkbox" checked={form.is_active} onChange={e => setField('is_active', e.target.checked)} className="accent-brand" />
                활성
              </label>
            )}
          </div>

          {/* 별지 9호 2쪽 "건축물 정보" 항목 (소방계획서_9 B안) — 대장이 값을 주지 않는 건물도 서식을 채울 수 있게 수기 입력 */}
          <div className="rounded-lg border border-brand-line-soft bg-surface p-3 space-y-2">
            <p className="text-[11px] font-semibold text-ink-sub">
              별지 9호 2쪽 건축물 정보
              <span className="ml-1 font-normal text-ink-faint">— 주소 검색 시 건축물대장에서 빈 칸만 자동 채움, 대장에 없으면 직접 입력</span>
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="w-32"><label className={labelCls}>건축허가일</label>
                <DateInput id="bf-permit-date" value={form.permit_date} onChange={e => setField('permit_date', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-28"><label className={labelCls}>건축면적(㎡)</label>
                <input id="bf-building-area" type="number" value={form.building_area} onChange={e => setField('building_area', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-20"><label className={labelCls}>높이(m)</label>
                <input id="bf-height" type="number" value={form.height} onChange={e => setField('height', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-24"><label className={labelCls}>세대수</label>
                <input id="bf-households" type="number" value={form.households} onChange={e => setField('households', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-20"><label className={labelCls}>동수</label>
                <input id="bf-building-count" type="number" value={form.building_count} onChange={e => setField('building_count', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-24"><label className={labelCls}>승용승강기</label>
                <input id="bf-elevator" type="number" value={form.elevator_count} onChange={e => setField('elevator_count', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="w-24"><label className={labelCls}>비상용승강기</label>
                <input type="number" value={form.emergency_elevator_count} onChange={e => setField('emergency_elevator_count', e.target.value)} disabled={!canManage} className={inputCls} /></div>
              <div className="flex-1 min-w-48"><label className={labelCls}>주차장</label>
                <input id="bf-parking" value={form.parking_summary} onChange={e => setField('parking_summary', e.target.value)} disabled={!canManage}
                  placeholder="예: 옥내 자주식 12대, 옥외 자주식 6대" className={inputCls} /></div>
            </div>
          </div>

          {ledgerNote && <p className="text-[11px] text-brand">{ledgerNote}</p>}
          {error && <p className="text-[11px] text-red-500">{error}</p>}

          {canManage && (
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={isPending}
                className="h-8 px-5 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
                {isPending && <Loader2 className="size-3 animate-spin" />} 저장
              </button>
              <button onClick={close} className="h-8 px-4 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper">취소</button>
              {editing !== 'new' && form.is_active && (() => {
                const cur = buildings.find(b => b.id === editing)
                return cur ? (
                  <button onClick={() => deactivate(cur)} disabled={isPending}
                    className="h-8 px-3 rounded-lg border border-red-200 text-xs text-red-500 hover:bg-red-50 ml-auto">비활성화</button>
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
    </div>
  )
}
