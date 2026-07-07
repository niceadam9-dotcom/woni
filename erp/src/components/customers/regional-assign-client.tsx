'use client'

import { useState, useTransition, useMemo } from 'react'
import { Loader2, UserCheck, MapPin, CheckSquare, Square, Users } from 'lucide-react'
import { bulkAssignEmployeeAction } from '@/app/(dashboard)/customers/actions'

type Customer = {
  id: string
  customer_code: string
  customer_name: string
  address: string | null
  region_si: string | null
  region_myeon: string | null
  region_ri: string | null
  assigned_employee_id: string | null
}

type Employee = { id: string; name: string; position: string | null }

type Props = {
  customers: Customer[]
  employees: Employee[]
}

const inputCls = 'h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

export function RegionalAssignClient({ customers, employees }: Props) {
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [selectedSi, setSelectedSi] = useState(
    customers.some(c => c.region_si === '양평군') ? '양평군' : ''
  )
  const [selectedMyeon, setSelectedMyeon] = useState('')
  const [selectedRi, setSelectedRi] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  // 시/군/구 목록 (distinct)
  const siOptions = useMemo(() => [
    ...new Set(customers.map(c => c.region_si).filter((v): v is string => v !== null)),
  ].sort(), [customers])

  // 읍/면/동 목록 (선택한 시 기준)
  const myeonOptions = useMemo(() => {
    if (!selectedSi) return []
    return [
      ...new Set(
        customers
          .filter(c => c.region_si === selectedSi)
          .map(c => c.region_myeon)
          .filter((v): v is string => v !== null),
      ),
    ].sort()
  }, [customers, selectedSi])

  // 리/동 목록 (선택한 읍/면/동 기준)
  const riOptions = useMemo(() => {
    if (!selectedSi || !selectedMyeon) return []
    return [
      ...new Set(
        customers
          .filter(c => c.region_si === selectedSi && c.region_myeon === selectedMyeon)
          .map(c => c.region_ri)
          .filter((v): v is string => v !== null),
      ),
    ].sort()
  }, [customers, selectedSi, selectedMyeon])

  // 필터된 고객 목록
  const filtered = useMemo(() => {
    return customers.filter(c => {
      if (!selectedSi) return false
      if (c.region_si !== selectedSi) return false
      if (selectedMyeon && c.region_myeon !== selectedMyeon) return false
      if (selectedRi && c.region_ri !== selectedRi) return false
      return true
    })
  }, [customers, selectedSi, selectedMyeon, selectedRi])

  function handleSiChange(val: string) {
    setSelectedSi(val)
    setSelectedMyeon('')
    setSelectedRi('')
    setCheckedIds(new Set())
    setMessage(null)
  }

  function handleMyeonChange(val: string) {
    setSelectedMyeon(val)
    setSelectedRi('')
    setCheckedIds(new Set())
    setMessage(null)
  }

  function handleRiChange(val: string) {
    setSelectedRi(val)
    setCheckedIds(new Set())
    setMessage(null)
  }

  function toggleAll() {
    if (checkedIds.size === filtered.length) {
      setCheckedIds(new Set())
    } else {
      setCheckedIds(new Set(filtered.map(c => c.id)))
    }
  }

  function toggleOne(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleAssign() {
    if (!selectedEmployee) { setMessage({ type: 'error', text: '배정할 직원을 선택해주세요.' }); return }
    if (checkedIds.size === 0) { setMessage({ type: 'error', text: '배정할 고객을 선택해주세요.' }); return }
    setMessage(null)
    startTransition(async () => {
      const result = await bulkAssignEmployeeAction([...checkedIds], selectedEmployee)
      if (result.error) {
        setMessage({ type: 'error', text: result.error })
      } else {
        setMessage({ type: 'success', text: `${result.updatedCount}개 고객에 담당자를 배정했습니다.` })
        setCheckedIds(new Set())
      }
    })
  }

  const empMap = new Map(employees.map(e => [e.id, e.name]))
  const allChecked = filtered.length > 0 && checkedIds.size === filtered.length

  return (
    <div className="space-y-6">
      {/* 지역 선택 + 직원 선택 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">지역 선택</h2>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          {/* 시/군/구 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#514b81]">시/군/구 *</label>
            <select value={selectedSi} onChange={e => handleSiChange(e.target.value)} className={inputCls}>
              <option value="">선택</option>
              {siOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* 읍/면/동 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#514b81]">읍/면/동</label>
            <select
              value={selectedMyeon}
              onChange={e => handleMyeonChange(e.target.value)}
              disabled={!selectedSi || myeonOptions.length === 0}
              className={inputCls + ' disabled:opacity-40 disabled:cursor-not-allowed'}
            >
              <option value="">전체</option>
              {myeonOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* 리/동 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#514b81]">리/동</label>
            <select
              value={selectedRi}
              onChange={e => handleRiChange(e.target.value)}
              disabled={!selectedMyeon || riOptions.length === 0}
              className={inputCls + ' disabled:opacity-40 disabled:cursor-not-allowed'}
            >
              <option value="">전체</option>
              {riOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="w-px h-8 bg-[#c8c4d0] self-end mb-0.5" />

          {/* 배정 직원 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#514b81]">배정 직원 *</label>
            <div className="flex items-center gap-2">
              <UserCheck className="size-4 text-[#7b68ee]" />
              <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)} className={inputCls + ' min-w-[160px]'}>
                <option value="">직원 선택</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.name}{e.position ? ` (${e.position})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleAssign}
            disabled={isPending || checkedIds.size === 0 || !selectedEmployee}
            className="h-9 px-5 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />}
            {checkedIds.size > 0 ? `${checkedIds.size}건 배정` : '배정하기'}
          </button>
        </div>

        {message && (
          <p className={`text-sm rounded-lg px-4 py-2.5 ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {message.text}
          </p>
        )}
      </div>

      {/* 고객 목록 */}
      {!selectedSi ? (
        <div className="bg-white rounded-xl border border-[#c8c4d0] py-16 text-center text-sm text-[#514b81]">
          <MapPin className="size-8 mx-auto mb-3 text-[#b0acd6]" />
          시/군/구를 선택하면 해당 지역 고객 목록이 표시됩니다
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#c8c4d0] py-16 text-center text-sm text-[#514b81]">
          선택한 지역에 등록된 고객이 없습니다
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#c8c4d0] bg-[#f8f9fa]">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-[#7b68ee]" />
              <span className="text-sm font-semibold text-[#090c1d]">
                해당 지역 고객 {filtered.length}건
              </span>
              {checkedIds.size > 0 && (
                <span className="text-xs text-[#7b68ee] font-medium bg-[#f5f4ff] px-2 py-0.5 rounded-full">
                  {checkedIds.size}건 선택됨
                </span>
              )}
            </div>
            <button
              onClick={toggleAll}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-medium transition-colors ${
                allChecked
                  ? 'border-[#7b68ee] bg-[#f5f4ff] text-[#7b68ee] hover:bg-[#ebe9ff]'
                  : 'border-[#c8c4d0] bg-white text-[#514b81] hover:border-[#7b68ee] hover:text-[#7b68ee]'
              }`}
            >
              {allChecked
                ? <><CheckSquare className="size-3.5" />전체취소</>
                : <><Square className="size-3.5" />전체선택</>}
            </button>
          </div>

          <div className="divide-y divide-[#c8c4d0]">
            {filtered.map(c => {
              const checked = checkedIds.has(c.id)
              const currentEmp = c.assigned_employee_id ? empMap.get(c.assigned_employee_id) : null
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${checked ? 'bg-[#f5f4ff]' : 'hover:bg-[#f8f9fa]'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(c.id)}
                    className="size-4 rounded border-[#d0ccf5] text-[#7b68ee] focus:ring-[#7b68ee]/20 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#090c1d] truncate">{c.customer_name}</span>
                      <span className="text-xs text-[#b0acd6] font-mono shrink-0">{c.customer_code}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {c.address && (
                        <span className="text-xs text-[#b0acd6] truncate max-w-[200px]">{c.address}</span>
                      )}
                      <span className="text-xs">
                        {currentEmp ? (
                          <span className="text-[#514b81]">현 담당: <strong>{currentEmp}</strong></span>
                        ) : (
                          <span className="text-red-500 font-medium">미배정</span>
                        )}
                      </span>
                    </div>
                  </div>
                  {checked && selectedEmployee && (
                    <span className="text-xs text-[#7b68ee] font-medium shrink-0">
                      → {empMap.get(selectedEmployee) ?? ''}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
