import { redirect } from 'next/navigation'
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InspectionCalendarClient } from '@/components/inspections/inspection-calendar-client'
import type { UserRole } from '@/types'
import { todayKst } from '@/lib/kst-date'
import { isYm, ymOf, windowAround } from '@/lib/calendar-window'
import {
  loadCalendarWindow, earliestOverdueDue, countOrphanAssignments, listCalendarCustomerOptions,
} from '@/lib/calendar-data'

export default async function InspectionCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; cust?: string; insp?: string; day?: string; sms?: string; m?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const initialFilter = (['all', 'today', 'week', 'overdue'].includes(params.filter ?? '')
    ? params.filter
    : 'all') as 'all' | 'today' | 'week' | 'overdue'
  // 고객명 검색어 — 필터링은 클라이언트가 한다. 여기선 복원만.
  const initialCustomerQuery = (params.cust ?? '').slice(0, 100)
  // 단계 사이드 패널 복원 (2026-09-21 사용자 요청) — 점검표 입력에서 [←]로 돌아오면
  // **떠나기 직전 그 패널이 다시 열려 있어야** 한다. 종전엔 패널이 로컬 state뿐이라
  // 돌아오면 달력만 남고 사용자가 단계를 처음부터 다시 찾아 들어가야 했다.
  // 형식 검증만 여기서(uuid 꼴이 아니면 무시) — 실재 여부는 클라이언트가 목록에서 찾는다.
  const initialInspectionId = /^[0-9a-f-]{36}$/i.test(params.insp ?? '') ? params.insp! : ''
  // 데이 패널(우측 사이드바) 복원 — URL ?day= (2026-09-22 사용자 요청). 고객 등록이 모달에서
  // `/customers/new` **페이지**로 바뀌면서 이 패널도 화면을 떠났다 돌아오는 자리가 됐다:
  // 「입력 다 하고 다시 사이드바 화면으로 복귀 — 만약 사이드바에서 왔다면」.
  // 형식 검증만 여기서(YYYY-MM-DD가 아니면 무시) — 그 날짜에 일정이 없으면 빈 패널이 열린다(그게 옳다).
  const initialDayPanelDate = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? '') ? params.day! : ''

  const admin = createAdminClient()

  /* 🎯 2026-10-01 조회 창 축소 — 종전엔 전년~익년 **3년치**(계획 5,360행·HTML 415KB)를 매 진입마다
     실었다. 이제 **기준 달 ±1개월**만 싣고, 달을 넘기면 클라이언트가 달 단위로 보충한다
     (`loadCalendarRangeAction`). 기준 달의 우선순위:
       ① `?day=`  — 데이 패널 복원. 그 날짜가 창 밖이면 패널이 빈 채 열린다(종전 주석의 「그게 옳다」와 반대)
       ② `?m=`    — 보고 있던 달(클라이언트가 달 이동마다 replaceState로 기록)
       ③ `?insp=` — 패널 복원 대상 점검의 시작 달(그 점검이 창 밖이면 패널이 조용히 안 열린다)
       ④ 기한초과 진입 — 가장 오래된 미완료 마감의 달(종전엔 클라이언트가 3년치에서 골랐다)
       ⑤ 오늘(KST) */
  const overdueDate = initialFilter === 'overdue' ? await earliestOverdueDue(admin) : null
  let anchorYm: string
  if (initialDayPanelDate) anchorYm = ymOf(initialDayPanelDate)
  else if (isYm(params.m)) anchorYm = params.m
  else if (initialInspectionId) {
    const { data } = await admin.from('inspections').select('inspection_start_date').eq('id', initialInspectionId).maybeSingle()
    const d = (data as { inspection_start_date: string } | null)?.inspection_start_date
    anchorYm = d ? ymOf(d) : overdueDate ? ymOf(overdueDate) : ymOf(todayKst())
  }
  else if (overdueDate) anchorYm = ymOf(overdueDate)
  else anchorYm = ymOf(todayKst())
  const range = windowAround(anchorYm)

  // 넷이 서로 독립 — 함께 던진다(원격 왕복 ~200ms씩이라 직렬이면 그대로 더해진다)
  const [{ inspections, planItems, employees, placementLoad }, customerOptions, orphanCount, holidays] = await Promise.all([
    loadCalendarWindow(admin, range),
    // 검색 후보는 **활성 고객 전부** — 실린 일정에서만 뽑으면 창 밖 고객이 검색되지 않는다
    listCalendarCustomerOptions(admin),
    // 퇴사 담당 칩은 전 기간을 센다(행 0건 count) — 실린 창에서만 세면 창 밖 건이 조용히 빠진다
    countOrphanAssignments(admin),
    loadHolidays(admin, anchorYm),
  ])

  return (
    <InspectionCalendarClient
      inspections={inspections}
      planItems={planItems}
      initialRange={range}
      initialMonth={anchorYm}
      initialOverdueDate={overdueDate}
      customerOptions={customerOptions}
      orphanCount={orphanCount}
      employees={employees}
      currentUserId={profile.id}
      currentUserRole={profile.role as UserRole}
      initialFilter={initialFilter}
      initialCustomerQuery={initialCustomerQuery}
      initialInspectionId={initialInspectionId}
      initialDayPanelDate={initialDayPanelDate}
      holidays={holidays}
      placementLoad={placementLoad}
      canMovePlan={can(profile.role as UserRole, 'inspection_plan_manage')}
      canSendSms={can(profile.role as UserRole, 'inspection_sms_send')}
      // 문자 패널을 연 채 시작 — 대시보드 위젯·사이드바 뱃지가 `?sms=1`로 보낸다
      initialSmsPanelOpen={params.sms === '1'}
      // 달력에서 고객을 등록할 수 있는가 — 버튼 **자체를** 가린다(안 그러면 눌러 봐야 서버가 던진다).
      // 권한 축은 등록 액션과 같은 `customer_manage`.
      canCreateCustomer={can(profile.role as UserRole, 'customer_manage')}
    />
  )
}

/** 주말·공휴일 표시용 — 기준 연도 ±1년(행 수십 개라 창으로 자르지 않는다. 달을 넘겨도 그대로 쓴다) */
async function loadHolidays(admin: ReturnType<typeof createAdminClient>, anchorYm: string) {
  const y = Number(anchorYm.slice(0, 4))
  const { data } = await admin
    .from('holidays')
    .select('date, name')
    .gte('date', `${y - 1}-01-01`)
    .lte('date', `${y + 1}-12-31`)
  return (data ?? []) as Array<{ date: string; name: string }>
}
