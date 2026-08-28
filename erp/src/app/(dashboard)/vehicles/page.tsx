import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Car, Plus } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function VehiclesPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const { data: vehicles } = await admin
    .from('vehicles')
    .select('*')
    .order('created_at', { ascending: false })

  const canManage = profile.role === 'manager' || profile.role === 'admin'

  const FUEL_LABELS: Record<string, string> = {
    gasoline: '휘발유', diesel: '경유', lpg: 'LPG', electric: '전기', hybrid: '하이브리드',
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Car className="size-6 text-brand" />
          <div>
            <h1 className="text-xl font-bold text-ink">차량 관리</h1>
            <p className="text-sm text-ink-sub mt-0.5">보유 차량 정보를 관리합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/vehicles/log" className="h-9 px-3 rounded-lg border border-line text-sm text-ink-sub hover:bg-paper transition-colors flex items-center">
            운행일지
          </Link>
          {canManage && (
            <Link href="/vehicles/new" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">
              <Plus className="size-4" />차량 등록
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(!vehicles || vehicles.length === 0) ? (
          <div className="col-span-full py-16 text-center text-sm text-ink-sub bg-surface rounded-xl border border-line">
            등록된 차량이 없습니다
          </div>
        ) : (vehicles as Record<string, unknown>[]).map(v => {
          const insuranceExpiry = v.insurance_expiry as string | null
          const inspectionExpiry = v.inspection_expiry as string | null
          const insuranceWarning = insuranceExpiry && insuranceExpiry < today
          const inspectionWarning = inspectionExpiry && inspectionExpiry < today

          return (
            <Link key={v.id as string} href={`/vehicles/${v.id}`}
              className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5 hover:border-brand/40 transition-colors block">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-ink">{v.vehicle_number as string}</span>
                    {!(v.is_active as boolean) && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">비활성</span>
                    )}
                  </div>
                  <p className="text-sm text-ink-sub mt-0.5">{v.vehicle_name as string}</p>
                </div>
                <Car className="size-5 text-ink-faint shrink-0 mt-0.5" />
              </div>
              <div className="mt-3 space-y-1">
                {!!v.vehicle_type && <p className="text-xs text-ink-faint">종류: {v.vehicle_type as string}</p>}
                {!!v.maker && <p className="text-xs text-ink-faint">제조사: {v.maker as string}{v.model_year ? ` (${v.model_year})` : ''}</p>}
                {!!v.fuel_type && <p className="text-xs text-ink-faint">연료: {FUEL_LABELS[v.fuel_type as string] ?? v.fuel_type as string}</p>}
              </div>
              <div className="mt-3 pt-3 border-t border-line space-y-1">
                {insuranceExpiry && (
                  <p className={`text-xs ${insuranceWarning ? 'text-red-500 font-medium' : 'text-ink-faint'}`}>
                    보험만료: {insuranceExpiry}{insuranceWarning ? ' ⚠' : ''}
                  </p>
                )}
                {inspectionExpiry && (
                  <p className={`text-xs ${inspectionWarning ? 'text-red-500 font-medium' : 'text-ink-faint'}`}>
                    검사만료: {inspectionExpiry}{inspectionWarning ? ' ⚠' : ''}
                  </p>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
