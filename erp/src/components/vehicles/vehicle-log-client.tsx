'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Check, X } from 'lucide-react'
import { createVehicleLogAction } from '@/app/(dashboard)/vehicles/actions'
import { DateInput } from '@/components/ui/date-input'
import { todayKst } from '@/lib/kst-date'

const inputCls = 'w-full h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition'

type Vehicle = { id: string; vehicle_number: string; vehicle_name: string }
type VehicleLog = {
  id: string; vehicle_id: string; log_date: string
  departure_location: string | null; destination: string | null; purpose: string | null
  start_mileage: number | null; end_mileage: number | null; distance: number | null
  fuel_cost: number | null; toll_cost: number | null; notes: string | null
  driver: { name: string } | null; vehicle: { vehicle_number: string; vehicle_name: string } | null
  departure_time: string | null; arrival_time: string | null; created_at: string
}

export function VehicleLogClient({
  logs, vehicles,
}: {
  logs: Record<string, unknown>[]
  vehicles: Vehicle[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')

  const [form, setForm] = useState({
    vehicle_id: vehicles[0]?.id ?? '',
    log_date: todayKst(),
    departure_time: '', arrival_time: '',
    departure_location: '', destination: '', purpose: '',
    start_mileage: '', end_mileage: '',
    fuel_cost: '', toll_cost: '', notes: '',
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const rows = (logs as VehicleLog[]).filter(l => !vehicleFilter || l.vehicle_id === vehicleFilter)

  function handleCreate() {
    setError('')
    if (!form.vehicle_id) { setError('차량을 선택해주세요.'); return }
    startTransition(async () => {
      const result = await createVehicleLogAction({
        vehicle_id: form.vehicle_id,
        log_date: form.log_date,
        departure_time: form.departure_time || undefined,
        arrival_time: form.arrival_time || undefined,
        departure_location: form.departure_location || undefined,
        destination: form.destination || undefined,
        purpose: form.purpose || undefined,
        start_mileage: form.start_mileage ? parseFloat(form.start_mileage) : undefined,
        end_mileage: form.end_mileage ? parseFloat(form.end_mileage) : undefined,
        fuel_cost: form.fuel_cost ? parseFloat(form.fuel_cost) : undefined,
        toll_cost: form.toll_cost ? parseFloat(form.toll_cost) : undefined,
        notes: form.notes || undefined,
      })
      if (result.error) { setError(result.error); return }
      setShowNew(false)
      setForm(p => ({ ...p, departure_time: '', arrival_time: '', departure_location: '', destination: '', purpose: '', start_mileage: '', end_mileage: '', fuel_cost: '', toll_cost: '', notes: '' }))
      router.refresh()
    })
  }

  const totalDistance = rows.reduce((sum, l) => sum + (l.distance ?? 0), 0)
  const totalFuel = rows.reduce((sum, l) => sum + (l.fuel_cost ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}
          className="h-9 rounded-lg border border-line px-2 text-xs text-ink-sub outline-none bg-surface">
          <option value="">전체 차량</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_number} {v.vehicle_name}</option>)}
        </select>
        <div className="flex items-center gap-4 ml-auto text-xs text-ink-sub">
          <span>총 운행거리: <strong className="text-ink">{totalDistance.toLocaleString()} km</strong></span>
          <span>총 유류비: <strong className="text-ink">{totalFuel.toLocaleString()} 원</strong></span>
        </div>
      </div>

      {showNew ? (
        <div className="bg-paper border border-brand-line rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <select value={form.vehicle_id} onChange={set('vehicle_id')} className={inputCls}>
              <option value="">차량 선택 *</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_number} {v.vehicle_name}</option>)}
            </select>
            <DateInput value={form.log_date} onChange={set('log_date')} className={inputCls} />
            <input value={form.purpose} onChange={set('purpose')} placeholder="운행 목적" className={inputCls} />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <input value={form.departure_location} onChange={set('departure_location')} placeholder="출발지" className={inputCls} />
            <input value={form.destination} onChange={set('destination')} placeholder="도착지" className={inputCls} />
            <input type="time" value={form.departure_time} onChange={set('departure_time')} className={inputCls} />
            <input type="time" value={form.arrival_time} onChange={set('arrival_time')} className={inputCls} />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-ink-sub">출발 계기 (km)</label>
              <input type="number" value={form.start_mileage} onChange={set('start_mileage')} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-ink-sub">도착 계기 (km)</label>
              <input type="number" value={form.end_mileage} onChange={set('end_mileage')} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-ink-sub">유류비 (원)</label>
              <input type="number" value={form.fuel_cost} onChange={set('fuel_cost')} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-ink-sub">통행료 (원)</label>
              <input type="number" value={form.toll_cost} onChange={set('toll_cost')} className={inputCls} />
            </div>
          </div>
          <input value={form.notes} onChange={set('notes')} placeholder="비고" className={inputCls} />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowNew(false); setError('') }}
              className="h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors flex items-center gap-1">
              <X className="size-3" />취소
            </button>
            <button onClick={handleCreate} disabled={isPending}
              className="h-8 px-4 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-strong transition-colors disabled:opacity-50 flex items-center gap-1">
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}저장
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowNew(true)}
          className="w-full h-10 rounded-xl border-2 border-dashed border-brand-line text-sm text-ink-faint hover:border-brand hover:text-brand transition-colors flex items-center justify-center gap-1.5">
          <Plus className="size-4" />운행일지 작성
        </button>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line">
              {['날짜', '차량', '운행목적', '출발지 → 도착지', '거리(km)', '유류비', '운전자', '비고'].map(h => (
                <th key={h} className="py-2.5 px-3 text-left font-medium text-ink-sub">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-ink-sub">운행일지가 없습니다</td></tr>
            ) : rows.map(l => (
              <tr key={l.id} className="border-b border-line hover:bg-paper">
                <td className="py-3 px-3 font-medium text-ink">{l.log_date}</td>
                <td className="py-3 px-3 text-ink-sub">{l.vehicle?.vehicle_number ?? '-'}</td>
                <td className="py-3 px-3 text-ink">{l.purpose ?? '-'}</td>
                <td className="py-3 px-3 text-ink-sub">
                  {l.departure_location || l.destination
                    ? `${l.departure_location ?? '-'} → ${l.destination ?? '-'}`
                    : '-'}
                </td>
                <td className="py-3 px-3 text-right text-ink">{l.distance != null ? l.distance.toLocaleString() : '-'}</td>
                <td className="py-3 px-3 text-right text-ink">{l.fuel_cost != null ? l.fuel_cost.toLocaleString() : '-'}</td>
                <td className="py-3 px-3 text-ink-sub">{l.driver?.name ?? '-'}</td>
                <td className="py-3 px-3 text-ink-faint">{l.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
