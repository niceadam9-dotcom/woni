import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Car, ChevronRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { VehicleFormClient } from '@/components/vehicles/vehicle-form-client'

const FUEL_LABELS: Record<string, string> = {
  gasoline: '휘발유', diesel: '경유', lpg: 'LPG', electric: '전기', hybrid: '하이브리드',
}

export default async function VehicleDetailPage({ params }: { params: { id: string } }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const { data: vehicle } = await admin
    .from('vehicles')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!vehicle) notFound()

  const v = vehicle as Record<string, unknown>
  const canManage = profile.role === 'manager' || profile.role === 'admin'

  if (canManage) {
    return (
      <div className="space-y-6">
        <div>
          <nav className="flex items-center gap-1.5 text-xs text-[#514b81] mb-4">
            <Link href="/vehicles" className="hover:text-[#7b68ee]">차량 관리</Link>
            <ChevronRight className="size-3" />
            <span className="text-[#090c1d] font-medium">{v.vehicle_number as string}</span>
          </nav>
          <div className="flex items-center gap-3">
            <Car className="size-6 text-[#7b68ee]" />
            <h1 className="text-xl font-bold text-[#090c1d]">차량 상세</h1>
          </div>
        </div>
        <VehicleFormClient vehicle={v as Parameters<typeof VehicleFormClient>[0]['vehicle']} />
      </div>
    )
  }

  // 읽기 전용 뷰
  return (
    <div className="space-y-6">
      <div>
        <nav className="flex items-center gap-1.5 text-xs text-[#514b81] mb-4">
          <Link href="/vehicles" className="hover:text-[#7b68ee]">차량 관리</Link>
          <ChevronRight className="size-3" />
          <span className="text-[#090c1d] font-medium">{v.vehicle_number as string}</span>
        </nav>
        <div className="flex items-center gap-3">
          <Car className="size-6 text-[#7b68ee]" />
          <h1 className="text-xl font-bold text-[#090c1d]">{v.vehicle_number as string}</h1>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-[#c8c4d0] p-6 max-w-2xl">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
          {[
            ['차량번호', v.vehicle_number], ['차량명', v.vehicle_name],
            ['차종', v.vehicle_type], ['연료', v.fuel_type ? FUEL_LABELS[v.fuel_type as string] : null],
            ['제조사', v.maker], ['연식', v.model_year],
            ['색상', v.color], ['보험만료', v.insurance_expiry],
            ['검사만료', v.inspection_expiry], ['상태', (v.is_active as boolean) ? '활성' : '비활성'],
          ].map(([k, val]) => val ? (
            <div key={k as string}>
              <dt className="text-xs text-[#b0acd6]">{k as string}</dt>
              <dd className="text-sm font-medium text-[#090c1d] mt-0.5">{String(val)}</dd>
            </div>
          ) : null)}
        </dl>
        {v.notes ? (
          <div className="mt-4 pt-4 border-t border-[#c8c4d0]">
            <p className="text-xs text-[#b0acd6]">메모</p>
            <p className="text-sm text-[#090c1d] mt-1 whitespace-pre-wrap">{v.notes as string}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
