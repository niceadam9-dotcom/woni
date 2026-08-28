import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCompanyProfile } from '@/lib/company-profile'
import { can } from '@/lib/permissions'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { ThemeSync } from '@/components/layout/theme-sync'
import { readProfileTheme } from '@/lib/theme'
import type { UserRole } from '@/types'

// 사이드바 뱃지: 미완료 6단계 중 지연/D-Day(빨강), D-1~3(주황) 건수 (Victory10 §6)
async function getStepBadgeCounts(profileId: string, role: string) {
  const admin = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const d3 = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]

  function base() {
    // 삭제(비활성) 고객의 잔존 단계 제외(소방계획서_30 S2-1) — FK 힌트(customer_id)는 PGRST201 방지
    let q = admin
      .from('inspection_steps')
      .select('id, inspections!inner(assigned_employee_id, status, customers:customer_id!inner(is_active))', { count: 'exact', head: true })
      .eq('status', 'pending')
      .neq('inspections.status', 'completed')
      .eq('inspections.customers.is_active', true)
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

  // 문자 발송 뱃지(소방계획서_24 S9-5)는 **여기서 계산하지 않는다.**
  // 실측 497ms(중앙값)인데 이 레이아웃은 모든 화면이 지나므로, 넣으면 화면 전환마다
  // 0.5초가 붙는다. 뱃지는 "할 일이 있다"는 보조 신호일 뿐이라 첫 페인트를 막을 이유가 없다.
  // → Sidebar가 마운트 후 클라이언트에서 가져온다(scripts/_probe-sms-badge-cost.mts가 상한을 고정).
  // theme은 PROFILE_COLS(30초 캐시) 밖 — 관용 조회를 기존 병렬 묶음에 태워 왕복 추가 0
  const [{ redCount, orangeCount }, company, dbTheme] = await Promise.all([
    getStepBadgeCounts(profile.id, profile.role),
    getCompanyProfile(),
    readProfileTheme(profile.id),
  ])

  return (
    /* 인쇄: 사이드바·헤더는 print:hidden으로 빠지지만, 그것만으로는 부족하다 —
       h-screen + overflow 컨테이너 안의 내용은 **첫 화면 분량만 인쇄**되고 나머지가 잘린다.
       인쇄에서는 높이·스크롤 제약을 풀어 본문이 그대로 흐르게 한다(세금계산서·자격증명서 등 공용). */
    /* ⚠ print:bg-white는 리터럴이어야 한다 — 토큰(surface)이면 다크 모드에서 어두운 배경이 인쇄된다 */
    <div className="flex h-screen overflow-hidden bg-paper print:block print:h-auto print:overflow-visible print:bg-white">
      <ThemeSync dbTheme={dbTheme} />
      <Sidebar
        role={profile.role}
        redCount={redCount}
        orangeCount={orangeCount}
        canSeeSms={can(profile.role as UserRole, 'inspection_sms_send')}
        companyName={company?.company_name}
        logoUrl={company?.logo_url}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden print:block print:overflow-visible">
        <Header profile={profile} />
        <main className="flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">
          {children}
        </main>
      </div>
    </div>
  )
}
