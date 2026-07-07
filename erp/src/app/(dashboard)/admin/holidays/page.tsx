import { redirect } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { HolidaysManager } from '@/components/admin/holidays-manager'
import type { Holiday } from '@/types'

export default async function HolidaysPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  const admin = createAdminClient()
  const currentYear = new Date().getFullYear()

  const { data } = await admin
    .from('holidays')
    .select('*')
    .gte('date', `${currentYear - 1}-01-01`)
    .lte('date', `${currentYear + 1}-12-31`)
    .order('date', { ascending: true })

  const holidays = (data ?? []) as Holiday[]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CalendarDays className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">공휴일 관리</h1>
          <p className="text-sm text-[#514b81] mt-0.5">
            국가공휴일 자동 동기화 및 회사 자체 휴무일을 관리합니다
          </p>
        </div>
      </div>

      <HolidaysManager initialHolidays={holidays} initialYear={currentYear} />
    </div>
  )
}
