import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Route } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { VehicleLogClient } from '@/components/vehicles/vehicle-log-client'

export default async function VehicleLogPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const [{ data: logs }, { data: vehicles }] = await Promise.all([
    admin
      .from('vehicle_logs')
      .select(`*, driver:driver_id (name), vehicle:vehicle_id (vehicle_number, vehicle_name)`)
      .order('log_date', { ascending: false }),
    admin
      .from('vehicles')
      .select('id, vehicle_number, vehicle_name')
      .eq('is_active', true)
      .order('vehicle_number'),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Route className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">차량운행일지</h1>
            <p className="text-sm text-[#514b81] mt-0.5">차량 운행 내역을 기록하고 관리합니다</p>
          </div>
        </div>
        <Link href="/vehicles" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
          차량 목록
        </Link>
      </div>

      <VehicleLogClient
        logs={(logs ?? []) as Record<string, unknown>[]}
        vehicles={(vehicles ?? []) as { id: string; vehicle_number: string; vehicle_name: string }[]}
      />
    </div>
  )
}
