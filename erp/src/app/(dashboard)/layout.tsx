import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCompanyProfile } from '@/lib/company-profile'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'

// 사이드바 뱃지: 미완료 6단계 중 지연/D-Day(빨강), D-1~3(주황) 건수 (Victory10 §6)
async function getStepBadgeCounts(profileId: string, role: string) {
  const admin = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const d3 = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]

  function base() {
    let q = admin
      .from('inspection_steps')
      .select('id, inspections!inner(assigned_employee_id, status)', { count: 'exact', head: true })
      .eq('status', 'pending')
      .neq('inspections.status', 'completed')
    if (role === 'employee') q = q.eq('inspections.assigned_employee_id', profileId)
    return q
  }

  const [redRes, orangeRes] = await Promise.all([
    base().lte('due_date', today),
    base().gt('due_date', today).lte('due_date', d3),
  ])
  return { redCount: redRes.count ?? 0, orangeCount: orangeRes.count ?? 0 }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const [{ redCount, orangeCount }, company] = await Promise.all([
    getStepBadgeCounts(profile.id, profile.role),
    getCompanyProfile(),
  ])

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8f9fa]">
      <Sidebar
        role={profile.role}
        redCount={redCount}
        orangeCount={orangeCount}
        companyName={company?.company_name}
        logoUrl={company?.logo_url}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header profile={profile} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
