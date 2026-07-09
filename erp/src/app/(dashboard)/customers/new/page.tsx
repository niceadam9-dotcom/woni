import { redirect } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CustomerNewClient } from '@/components/customers/customer-new-client'
import { getCompanyProfile } from '@/lib/company-profile'

export default async function CustomersNewPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const [{ data: employeesRaw }, company] = await Promise.all([
    admin
      .from('profiles')
      .select('id, name, position')
      .eq('is_active', true)
      .eq('is_system', false)
      .order('name'),
    getCompanyProfile(),
  ])

  const employees = (employeesRaw ?? []) as Array<{ id: string; name: string; position: string | null }>
  // 폼의 region_si는 시/군/구 단위(예: 양평군) — company_profile.default_region_myeon이 해당 값
  const defaultRegionSi = company?.default_region_myeon ?? ''

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserPlus className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">고객 등록</h1>
          <p className="text-sm text-[#514b81] mt-0.5">새 고객과 관계인 정보를 등록합니다</p>
        </div>
      </div>
      <CustomerNewClient employees={employees} defaultRegionSi={defaultRegionSi} />
    </div>
  )
}
