import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Building2, ChevronRight } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BuildingNewClient } from '@/components/buildings/building-new-client'

export default async function BuildingNewPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>
}) {
  await requirePermission('building_manage')

  const params = await searchParams
  const admin = createAdminClient()

  // region 컬럼 존재 여부 확인 (018_region 마이그레이션 적용 여부)
  const { error: regionColErr } = await admin.from('customers').select('region_si').limit(1)
  const hasRegionCols = !regionColErr

  const selectCols = hasRegionCols
    ? 'id, customer_name, customer_code, address, region_si, region_myeon'
    : 'id, customer_name, customer_code, address'

  const [{ data: customersRaw }, { data: purposesRaw }] = await Promise.all([
    admin
      .from('customers')
      .select(selectCols)
      .eq('is_active', true)
      .order('customer_name'),
    admin.from('building_purposes').select('name').order('sort_order').order('name'),
  ])
  const purposes = ((purposesRaw ?? []) as Array<{ name: string }>).map(p => p.name)

  type CustomerRow = {
    id: string
    customer_name: string
    customer_code: string
    address: string | null
    region_si?: string | null
    region_myeon?: string | null
  }

  const customers = (customersRaw ?? []) as unknown as CustomerRow[]

  return (
    <div className="space-y-6">
      {/* 브레드크럼 */}
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/buildings" className="hover:text-[#7b68ee] flex items-center gap-1">
          <Building2 className="size-3.5" />
          건물 관리
        </Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium">건물 등록</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">건물 등록</h1>
        <p className="text-sm text-[#514b81] mt-0.5">소방점검 대상 건물 정보를 등록합니다</p>
      </div>

      <BuildingNewClient
        customers={customers}
        defaultCustomerId={params.customer_id}
        {...(purposes.length > 0 ? { purposes } : {})}
      />
    </div>
  )
}
