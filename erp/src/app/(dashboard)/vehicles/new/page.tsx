import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Car, ChevronRight } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { VehicleFormClient } from '@/components/vehicles/vehicle-form-client'

export default async function VehicleNewPage() {
  await requireRole(['manager', 'admin'])

  return (
    <div className="space-y-6">
      <div>
        <nav className="flex items-center gap-1.5 text-xs text-[#514b81] mb-4">
          <Link href="/vehicles" className="hover:text-[#7b68ee]">차량 관리</Link>
          <ChevronRight className="size-3" />
          <span className="text-[#090c1d] font-medium">차량 등록</span>
        </nav>
        <div className="flex items-center gap-3">
          <Car className="size-6 text-[#7b68ee]" />
          <h1 className="text-xl font-bold text-[#090c1d]">차량 등록</h1>
        </div>
      </div>
      <VehicleFormClient />
    </div>
  )
}
