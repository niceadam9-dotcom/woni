import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ClipboardList } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InspectionNewClient } from '@/components/inspections/inspection-new-client'
import type { UserRole } from '@/types'

export default async function InspectionNewPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if ((profile.role as UserRole) === 'employee') redirect('/inspections')

  const admin = createAdminClient()
  const currentYear = new Date().getFullYear()

  const [customersRes, contactsRes, employeesRes, holidaysRes] = await Promise.all([
    admin.from('customers').select('id, customer_name, customer_code, inspection_type').eq('is_active', true).order('customer_name'),
    admin.from('customer_contacts').select('id, customer_id, role, name, phone'),
    admin.from('profiles').select('id, name, position').eq('is_active', true).order('name'),
    admin.from('holidays').select('date').in('year', [currentYear, currentYear + 1]),
  ])

  type CustomerOption = { id: string; customer_name: string; customer_code: string; inspection_type: string }
  type ContactOption = { id: string; customer_id: string; role: string; name: string; phone: string | null }
  type EmployeeOption = { id: string; name: string; position: string | null }

  const customers = (customersRes.data ?? []) as CustomerOption[]
  const contacts = (contactsRes.data ?? []) as ContactOption[]
  const employees = (employeesRes.data ?? []) as EmployeeOption[]
  const holidayDates = ((holidaysRes.data ?? []) as Array<{ date: string }>).map(h => h.date)

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/inspections" className="text-[#514b81] hover:text-[#7b68ee] transition-colors">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex items-center gap-2">
          <ClipboardList className="size-5 text-[#7b68ee]" />
          <h1 className="text-xl font-bold text-[#090c1d]">점검 배정</h1>
        </div>
      </div>

      <InspectionNewClient
        customers={customers}
        contacts={contacts}
        employees={employees}
        holidayDates={holidayDates}
        currentUserId={profile.id}
      />
    </div>
  )
}
