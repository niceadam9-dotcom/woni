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
          <Car className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">차량 관리</h1>
            <p className="text-sm text-[#514b81] mt-0.5">보유 차량 정보를 관리합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/vehicles/log" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
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
          <div className="col-span-full py-16 text-center text-sm text-[#514b81] bg-white rounded-xl border border-[#c8c4d0]">
            등록된 차량이 없습니다
          </div>
        ) : (vehicles as Record<string, unknown>[]).map(v => {
          const insuranceExpiry = v.insurance_expiry as string | null
          const inspectionExpiry = v.inspection_expiry as string | null
          const insuranceWarning = insuranceExpiry && insuranceExpiry < today
          const inspectionWarning = inspectionExpiry && inspectionExpiry < today

          return (
            <Link key={v.id as string} href={`/vehicles/${v.id}`}
              className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5 hover:border-[#7b68ee]/40 transition-colors block">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#090c1d]">{v.vehicle_number as string}</span>
                    {!(v.is_active as boolean) && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">비활성</span>
                    )}
                  </div>
                  <p className="text-sm text-[#514b81] mt-0.5">{v.vehicle_name as string}</p>
                </div>
                <Car className="size-5 text-[#b0acd6] shrink-0 mt-0.5" />
              </div>
              <div className="mt-3 space-y-1">
                {!!v.vehicle_type && <p className="text-xs text-[#b0acd6]">종류: {v.vehicle_type as string}</p>}
                {!!v.maker && <p className="text-xs text-[#b0acd6]">제조사: {v.maker as string}{v.model_year ? ` (${v.model_year})` : ''}</p>}
                {!!v.fuel_type && <p className="text-xs text-[#b0acd6]">연료: {FUEL_LABELS[v.fuel_type as string] ?? v.fuel_type as string}</p>}
              </div>
              <div className="mt-3 pt-3 border-t border-[#c8c4d0] space-y-1">
                {insuranceExpiry && (
                  <p className={`text-xs ${insuranceWarning ? 'text-red-500 font-medium' : 'text-[#b0acd6]'}`}>
                    보험만료: {insuranceExpiry}{insuranceWarning ? ' ⚠' : ''}
                  </p>
                )}
                {inspectionExpiry && (
                  <p className={`text-xs ${inspectionWarning ? 'text-red-500 font-medium' : 'text-[#b0acd6]'}`}>
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
