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
        <nav className="flex items-center gap-1.5 text-xs text-ink-sub mb-4">
          <Link href="/vehicles" className="hover:text-brand">차량 관리</Link>
          <ChevronRight className="size-3" />
          <span className="text-ink font-medium">차량 등록</span>
        </nav>
        <div className="flex items-center gap-3">
          <Car className="size-6 text-brand" />
          <h1 className="text-xl font-bold text-ink">차량 등록</h1>
        </div>
      </div>
      <VehicleFormClient />
    </div>
  )
}
