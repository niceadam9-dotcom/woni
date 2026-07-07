import { redirect } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CustomerNewClient } from '@/components/customers/customer-new-client'

export default async function CustomersNewPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role === 'employee') redirect('/customers')

  const admin = createAdminClient()
  const { data: employeesRaw } = await admin
    .from('profiles')
    .select('id, name, position')
    .eq('is_active', true)
    .order('name')

  const employees = (employeesRaw ?? []) as Array<{ id: string; name: string; position: string | null }>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserPlus className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">고객 등록</h1>
          <p className="text-sm text-[#514b81] mt-0.5">새 고객과 관계인 정보를 등록합니다</p>
        </div>
      </div>
      <CustomerNewClient employees={employees} />
    </div>
  )
}
