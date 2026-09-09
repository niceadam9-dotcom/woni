import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCompanyProfile } from '@/lib/company-profile'
import { can } from '@/lib/permissions'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { ThemeSync } from '@/components/layout/theme-sync'
import { FontScaleSync } from '@/components/layout/font-scale-sync'
import { readProfileTheme } from '@/lib/theme'
import { readProfileFontScale } from '@/lib/font-scale'
import type { UserRole } from '@/types'
import { todayKst } from '@/lib/kst-date'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { activeStepsByInspection, isStepNa, NA_CANDIDATE_STEP_NUMS } from '@/lib/active-steps'

/** 사이드바 뱃지: 미완료 6단계 중 지연/D-Day(빨강), D-1~3(주황) 건수 (Victory10 §6)
 *
 *  🎯 소방계획서_45 §S11(Q-6 유예분): 종전에는 `activeStepNums` 필터가 **아예 없어**, 점검표 모두
 *  합격이라 화면에서 '해당없음'으로 흐려진 ⑤⑥이 영원히 `pending`으로 남아 그 회차가 사이드바에서
 *  **영구 빨강**이었다. 사용자가 할 수 있는 일이 없는데 뱃지는 계속 재촉하는 상태 —
 *  「빨강을 없애려면 해당없음인 단계를 완료 처리해야 한다」는 거짓 압력이 D34-2 방향이다.
 *
 *  ⚠ 이 조회는 `count:'exact', head:true`라 **행을 안 받는다**(모든 화면이 지나는 레이아웃이라
 *  성능이 값이다 — 종전 주석 참조). 그래서 전 단계를 행으로 받아 거르지 않고,
 *  **'해당없음이 될 수 있는 단계'만**(⑤⑥ — activeStepNums는 ①~④를 두 분기의 공통 접두로 갖는다)
 *  행으로 받아 빼야 할 건수를 센다. 자체점검 1건당 최대 2행이라 비용이 유계다. */
async function getStepBadgeCounts(profileId: string, role: string) {
  const admin = createAdminClient()
  // F-14 잔여 축 — 둘 다 KST로 **함께** 옮긴다. 한쪽만 바꾸면 '오늘'과 'D+3'의 기준이
  // 갈라져 뱃지가 하루치 어긋난다(비교 상대인 due_date는 DATE=달력 날짜라 KST가 맞다).
  const today = todayKst()
  const d3 = todayKst(Date.now() + 3 * 86400000)

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

  /** ⑤⑥ 후보 행만 받아온다 — 같은 필터·같은 창(窓)이라야 뺀 수가 센 수와 짝이 맞는다 */
  function naCandidates() {
    let q = admin
      .from('inspection_steps')
      .select('id, inspection_id, step_num, inspections!inner(assigned_employee_id, status, customers:customer_id!inner(is_active))')
      .eq('status', 'pending')
      .neq('inspections.status', 'completed')
      .eq('inspections.customers.is_active', true)
      .in('step_num', [...NA_CANDIDATE_STEP_NUMS])
    if (role === 'employee') q = q.eq('inspections.assigned_employee_id', profileId)
    return q
  }

  const [redRes, orangeRes, redNaRes, orangeNaRes] = await Promise.all([
    base().lte('due_date', today),
    base().gt('due_date', today).lte('due_date', d3),
    fetchAllRows<{ inspection_id: string; step_num: number }>((from, to) =>
      naCandidates().lte('due_date', today).order('id').range(from, to)),
    fetchAllRows<{ inspection_id: string; step_num: number }>((from, to) =>
      naCandidates().gt('due_date', today).lte('due_date', d3).order('id').range(from, to)),
  ])

  // ⚠ R-7(4차 판정): 못 받은 후보는 **빼지 않는다** = 빨강이 유지된다(안전한 쪽). 다만 그 사실이
  // 조용하면 「고쳤는데 왜 아직 빨갛나」를 아무도 설명할 수 없으므로 표면화한다.
  if (redNaRes.error || redNaRes.truncated || orangeNaRes.error || orangeNaRes.truncated) {
    console.error('[sidebar-badge] 해당없음 후보 조회 불완전 — 뱃지가 실제보다 높게 남습니다', redNaRes.error, orangeNaRes.error)
  }
  const naRows = [...redNaRes.rows, ...orangeNaRes.rows]
  const active = await activeStepsByInspection(
    admin, [...new Set(naRows.map(r => r.inspection_id))], 'sidebar-badge')
  const naCount = (rows: typeof naRows) =>
    rows.filter(r => isStepNa(active, r.inspection_id, r.step_num)).length

  // ⚠ 뺄셈은 **0에서 멈춘다**. 두 조회 사이에 단계가 완료되면 뺀 수가 센 수를 넘을 수 있는데,
  // 음수 뱃지는 화면이 깨진 것으로 보인다(빼는 쪽이 더 나중이라 실무상 드물지만 유계로 둔다).
  return {
    redCount: Math.max(0, (redRes.count ?? 0) - naCount(redNaRes.rows)),
    orangeCount: Math.max(0, (orangeRes.count ?? 0) - naCount(orangeNaRes.rows)),
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  // 문자 발송 뱃지(소방계획서_24 S9-5)는 **여기서 계산하지 않는다.**
  // 실측 497ms(중앙값)인데 이 레이아웃은 모든 화면이 지나므로, 넣으면 화면 전환마다
  // 0.5초가 붙는다. 뱃지는 "할 일이 있다"는 보조 신호일 뿐이라 첫 페인트를 막을 이유가 없다.
  // → Sidebar가 마운트 후 클라이언트에서 가져온다(scripts/_probe-sms-badge-cost.mts가 상한을 고정).
  // theme·form_font_scale은 PROFILE_COLS(30초 캐시) 밖 — 관용 조회를 기존 병렬 묶음에
  // 태워 **왕복 추가 0**. 컬럼이 없으면 둘 다 null이라 화면은 기본값으로 그려진다.
  const [{ redCount, orangeCount }, company, dbTheme, dbFontScale] = await Promise.all([
    getStepBadgeCounts(profile.id, profile.role),
    getCompanyProfile(),
    readProfileTheme(profile.id),
    readProfileFontScale(profile.id),
  ])

  return (
    /* 인쇄: 사이드바·헤더는 print:hidden으로 빠지지만, 그것만으로는 부족하다 —
       h-screen + overflow 컨테이너 안의 내용은 **첫 화면 분량만 인쇄**되고 나머지가 잘린다.
       인쇄에서는 높이·스크롤 제약을 풀어 본문이 그대로 흐르게 한다(세금계산서·자격증명서 등 공용). */
    /* ⚠ print:bg-white는 리터럴이어야 한다 — 토큰(surface)이면 다크 모드에서 어두운 배경이 인쇄된다 */
    <div className="flex h-screen overflow-hidden bg-paper print:block print:h-auto print:overflow-visible print:bg-white">
      <ThemeSync dbTheme={dbTheme} />
      <FontScaleSync dbScale={dbFontScale} />
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
