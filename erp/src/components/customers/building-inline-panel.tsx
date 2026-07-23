'use client'

import { useState, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Building2, Plus, Search, Loader2, X } from 'lucide-react'
import { createBuildingAction, updateBuildingAction, deleteBuildingAction } from '@/app/(dashboard)/buildings/actions'
import { fetchBuildingLedgerAction } from '@/app/(dashboard)/customers/actions'
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
}

const EMPTY: FormState = {
  building_name: '', zipcode: '', address: '', address_jibun: '', bcode: '',
  purpose: '', total_area: '', floors_above: '', floors_below: '', year_built: '', notes: '', is_active: true,
}

const inputCls = 'h-8 w-full rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee]'
const labelCls = 'text-[11px] font-medium text-[#514b81]'

export function BuildingListPanel({ customerId, customerName, customerAddress, buildings, canManage, initialOpenId, initialNew }: {
  customerId: string
  customerName: string
  customerAddress: string | null
  buildings: BuildingPanelRow[]
  canManage: boolean
  initialOpenId?: string
  initialNew?: boolean
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
      setForm(prev => {
        const p = base ?? prev
        return {
          ...prev,
          purpose: p.purpose || (L.purpose ?? ''),
          total_area: p.total_area || (L.total_area != null ? String(L.total_area) : ''),
          floors_above: p.floors_above || (L.floors_above != null ? String(L.floors_above) : ''),
          floors_below: p.floors_below || (L.floors_below != null ? String(L.floors_below) : ''),
          year_built: p.year_built || (L.use_approval_date ? L.use_approval_date.slice(0, 4) : ''),
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
      }
      const res = editing === 'new'
        ? await createBuildingAction({ customer_id: customerId, ...common })
        : await updateBuildingAction({ id: editing!, is_active: form.is_active, ...common })
      if (res.error) { setError(res.error); return }
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
    <div id="buildings-panel" className="scroll-mt-4 bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">건물 목록</h2>
        <span className="text-xs text-[#b0acd6] ml-auto">{buildings.length}개</span>
        {canManage && editing !== 'new' && (
          <button onClick={openNew}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors">
            <Plus className="size-3" />
            건물 등록
          </button>
        )}
      </div>

      {buildings.length === 0 && editing !== 'new' ? (
        <p className="text-sm text-[#514b81] py-6 text-center">등록된 건물이 없습니다</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e0ddf5]">
                {['건물명', '주소', '용도', '연면적', '층수', '준공', '상태'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buildings.map(b => (
                <tr key={b.id}
                  onClick={() => editing === b.id ? close() : openEdit(b)}
                  className={`border-b border-[#f8f9fa] last:border-0 cursor-pointer transition-colors ${editing === b.id ? 'bg-[#f5f4ff]' : 'hover:bg-[#fafafa]'}`}>
                  <td className="py-3 pr-4 font-medium text-[#090c1d]">{b.building_name}</td>
                  <td className="py-3 pr-4 text-xs text-[#514b81] max-w-[140px] truncate">{b.address ?? '-'}</td>
                  <td className="py-3 pr-4">
                    {b.purpose ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">{b.purpose}</span>
                    ) : (
                      <span className="text-xs text-[#b0acd6]">-</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[#514b81]">{b.total_area != null ? `${b.total_area.toLocaleString()}㎡` : '-'}</td>
                  <td className="py-3 pr-4 text-xs text-[#514b81]">
                    {b.floors_above != null ? `지상 ${b.floors_above}층${b.floors_below ? ` / 지하 ${b.floors_below}층` : ''}` : '-'}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[#514b81]">{b.year_built ?? '-'}</td>
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
        <div className="mt-4 rounded-xl border border-[#d0ccf5] bg-[#fafaff] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[#7b68ee]">{editing === 'new' ? '건물 등록' : '건물 수정'}</p>
            <button onClick={close} className="text-[#b0acd6] hover:text-[#514b81]"><X className="size-4" /></button>
          </div>

          <div className="flex flex-wrap gap-2 items-end">
            <div className="w-52"><label className={labelCls}>건물명 *</label>
              <input value={form.building_name} onChange={e => setField('building_name', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="flex-1 min-w-64"><label className={labelCls}>주소</label>
              <input value={form.address} readOnly placeholder="주소 검색 또는 고객 주소 상속" className={`${inputCls} bg-[#f8f9fa]`} /></div>
            <div className="w-24"><label className={labelCls}>우편번호</label>
              <input value={form.zipcode} readOnly className={`${inputCls} bg-[#f8f9fa]`} /></div>
            {canManage && (
              <button onClick={handleAddressSearch}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#f5f4ff] hover:bg-[#ebe9ff] text-[#7b68ee] text-xs font-medium border border-[#d0ccf5]">
                <Search className="size-3.5" /> 주소 검색
              </button>
            )}
          </div>
          {editing === 'new' && customerAddress && (
            <label className="flex items-center gap-1.5 text-[11px] text-[#514b81]">
              <input type="checkbox" checked={sameAsCustomer} onChange={e => toggleSameAsCustomer(e.target.checked)} className="accent-[#7b68ee]" />
              고객 주소와 동일 ({customerAddress})
            </label>
          )}

          <div className="flex flex-wrap gap-2 items-end">
            <div className="w-36"><label className={labelCls}>용도</label>
              <input value={form.purpose} onChange={e => setField('purpose', e.target.value)} disabled={!canManage} placeholder="예: 근린생활시설" className={inputCls} /></div>
            <div className="w-28"><label className={labelCls}>연면적(㎡)</label>
              <input type="number" value={form.total_area} onChange={e => setField('total_area', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="w-24"><label className={labelCls}>지상(층)</label>
              <input type="number" value={form.floors_above} onChange={e => setField('floors_above', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="w-24"><label className={labelCls}>지하(층)</label>
              <input type="number" value={form.floors_below} onChange={e => setField('floors_below', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="w-24"><label className={labelCls}>준공연도</label>
              <input type="number" value={form.year_built} onChange={e => setField('year_built', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            <div className="flex-1 min-w-40"><label className={labelCls}>비고</label>
              <input value={form.notes} onChange={e => setField('notes', e.target.value)} disabled={!canManage} className={inputCls} /></div>
            {editing !== 'new' && canManage && (
              <label className="flex items-center gap-1.5 text-[11px] text-[#514b81] h-8">
                <input type="checkbox" checked={form.is_active} onChange={e => setField('is_active', e.target.checked)} className="accent-[#7b68ee]" />
                활성
              </label>
            )}
          </div>

          {ledgerNote && <p className="text-[11px] text-[#7b68ee]">{ledgerNote}</p>}
          {error && <p className="text-[11px] text-red-500">{error}</p>}

          {canManage && (
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={isPending}
                className="h-8 px-5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
                {isPending && <Loader2 className="size-3 animate-spin" />} 저장
              </button>
              <button onClick={close} className="h-8 px-4 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa]">취소</button>
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
    </div>
  )
}
