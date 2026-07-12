'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createVehicleAction, updateVehicleAction } from '@/app/(dashboard)/vehicles/actions'
import { DateInput } from '@/components/ui/date-input'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

const FUEL_TYPES = [
  { value: 'gasoline', label: '휘발유' },
  { value: 'diesel', label: '경유' },
  { value: 'lpg', label: 'LPG' },
  { value: 'electric', label: '전기' },
  { value: 'hybrid', label: '하이브리드' },
]

const VEHICLE_TYPES = ['승용차', '승합차', '화물차', '특수차', '이륜차']

type Vehicle = {
  id: string; vehicle_number: string; vehicle_name: string; vehicle_type: string | null
  maker: string | null; model_year: number | null; color: string | null
  fuel_type: string | null; insurance_expiry: string | null; inspection_expiry: string | null
  notes: string | null; is_active: boolean
}

export function VehicleFormClient({ vehicle }: { vehicle?: Vehicle }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [isActive, setIsActive] = useState(vehicle?.is_active ?? true)

  const [form, setForm] = useState({
    vehicle_number: vehicle?.vehicle_number ?? '',
    vehicle_name: vehicle?.vehicle_name ?? '',
    vehicle_type: vehicle?.vehicle_type ?? '',
    maker: vehicle?.maker ?? '',
    model_year: vehicle?.model_year?.toString() ?? '',
    color: vehicle?.color ?? '',
    fuel_type: vehicle?.fuel_type ?? '',
    insurance_expiry: vehicle?.insurance_expiry ?? '',
    inspection_expiry: vehicle?.inspection_expiry ?? '',
    notes: vehicle?.notes ?? '',
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  function handleSubmit() {
    setError('')
    if (!form.vehicle_number.trim()) { setError('차량번호를 입력해주세요.'); return }
    if (!form.vehicle_name.trim()) { setError('차량명을 입력해주세요.'); return }

    const input = {
      vehicle_number: form.vehicle_number.trim(),
      vehicle_name: form.vehicle_name.trim(),
      vehicle_type: form.vehicle_type || undefined,
      maker: form.maker || undefined,
      model_year: form.model_year ? parseInt(form.model_year) : undefined,
      color: form.color || undefined,
      fuel_type: form.fuel_type || undefined,
      insurance_expiry: form.insurance_expiry || undefined,
      inspection_expiry: form.inspection_expiry || undefined,
      notes: form.notes || undefined,
    }

    startTransition(async () => {
      if (vehicle) {
        const result = await updateVehicleAction(vehicle.id, { ...input, is_active: isActive })
        if (result.error) { setError(result.error); return }
        router.push(`/vehicles/${vehicle.id}`)
      } else {
        const result = await createVehicleAction(input)
        if (result.error) { setError(result.error); return }
        router.push('/vehicles')
      }
    })
  }

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-5 max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#514b81]">차량번호<span className="text-red-500 ml-0.5">*</span></label>
          <input value={form.vehicle_number} onChange={set('vehicle_number')} placeholder="예: 12가 3456" className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#514b81]">차량명<span className="text-red-500 ml-0.5">*</span></label>
          <input value={form.vehicle_name} onChange={set('vehicle_name')} placeholder="예: 소나타" className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#514b81]">차종</label>
          <select value={form.vehicle_type} onChange={set('vehicle_type')} className={inputCls}>
            <option value="">선택</option>
            {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#514b81]">연료</label>
          <select value={form.fuel_type} onChange={set('fuel_type')} className={inputCls}>
            <option value="">선택</option>
            {FUEL_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#514b81]">제조사</label>
          <input value={form.maker} onChange={set('maker')} placeholder="현대, 기아 등" className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#514b81]">연식</label>
          <input type="number" value={form.model_year} onChange={set('model_year')} placeholder="2023" className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#514b81]">색상</label>
          <input value={form.color} onChange={set('color')} placeholder="흰색" className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#514b81]">보험 만료일</label>
          <DateInput value={form.insurance_expiry} onChange={set('insurance_expiry')} className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#514b81]">자동차 검사 만료일</label>
          <DateInput value={form.inspection_expiry} onChange={set('inspection_expiry')} className={inputCls} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#514b81]">메모</label>
        <textarea value={form.notes} onChange={set('notes')} rows={3}
          className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition resize-none" />
      </div>
      {vehicle && (
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-[#514b81]">사용 여부</span>
          <button type="button" onClick={() => setIsActive(p => !p)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isActive ? 'bg-[#7b68ee]' : 'bg-[#c8c4d0]'}`}>
            <span className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-xs text-[#514b81]">{isActive ? '활성' : '비활성'}</span>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => router.back()}
          className="h-10 px-4 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors">
          취소
        </button>
        <button type="button" onClick={handleSubmit} disabled={isPending}
          className="h-10 px-6 rounded-lg bg-[#7b68ee] text-white text-sm font-medium hover:bg-[#6a57dd] transition-colors disabled:opacity-50 flex items-center gap-2">
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {vehicle ? '수정 완료' : '차량 등록'}
        </button>
      </div>
    </div>
  )
}
