import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateYearlyPlanItems, loadHolidaySet } from '@/lib/inspection-plan-generator'
import type { InspectionType } from '@/types'

// 활성 고객(소방안전관리·일반관리)의 연간 점검계획을 매년 반복 생성 — 비활성/삭제 전까지 계속
// 롤링 생성(2026-08-22): 호출 시점과 무관하게 항상 올해+내년을 생성한다. 종전 12/1(내년)·1/1(올해)
// 이원 체계는 1~11월 내내 내년분이 비어 "기준일부터 1년치" 후반부가 조회되지 않았다.
// 크론: 매월 1일 호출(deploy/cron/sjfire-erp.cron) — 멱등이라 반복 실행 안전
// 수동 테스트: GET /api/cron/generate-yearly-plans?year=2027 (해당 연도만 단독 생성)
// Authorization: Bearer {CRON_SECRET} 헤더 필수
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  // CRON_SECRET이 없으면 검사를 통째로 건너뛰던 종전 조건(`cronSecret && …`)은 무인증 구멍이었다 —
  // 값이 빠지는 순간 이 엔드포인트가 누구에게나 열린다. 미설정이면 아예 거부한다(sync-holidays와 동일 규약).
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  // 컨테이너 TZ가 UTC라 연말·연초 발화 시 날짜가 밀림 — +9h 시프트 후 UTC 게터로 KST 연 추출
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const currentYear = kstNow.getUTCFullYear()

  const paramYear = req.nextUrl.searchParams.get('year')
  let targetYears: number[]
  if (paramYear) {
    const y = parseInt(paramYear, 10)
    if (isNaN(y) || y < 2020 || y > 2100) {
      return NextResponse.json({ error: '유효하지 않은 연도입니다.' }, { status: 400 })
    }
    targetYears = [y]
  } else {
    // 롤링: 올해 보정 + 내년 선행 생성 — 어느 달에 돌아도 향후 12개월 이상이 항상 존재
    targetYears = [currentYear, currentYear + 1]
  }

  // 계획 생성자 — 시스템 계정 우선, 없으면 활성 관리자
  let createdBy: string | null = null
  const { data: sysProfile } = await admin
    .from('profiles').select('id').eq('is_system', true).limit(1)
  if (sysProfile?.length) {
    createdBy = (sysProfile[0] as { id: string }).id
  } else {
    const { data: adminProfile } = await admin
      .from('profiles').select('id').eq('role', 'admin').eq('is_active', true).limit(1)
    if (adminProfile?.length) createdBy = (adminProfile[0] as { id: string }).id
  }
  if (!createdBy) {
    return NextResponse.json({ error: '계획 생성자 프로필을 찾을 수 없습니다.' }, { status: 500 })
  }

  // 활성 고객 전 유형 — 일반관리도 자체점검(special_*) 자동 생성 대상 (소방계획서_6 W-8)
  // 기준일은 생성기가 결정(점검계획일 → 최초 점검시작일) — 모두 없으면 0건
  const { data: customers, error: custErr } = await admin
    .from('customers')
    .select('id, customer_name, inspection_type, inspection_category, inspection_sub_type, plan_anchor_date, assigned_employee_id')
    .eq('is_active', true)
    .in('inspection_type', ['종합', '작동', '일반관리'])

  if (custErr) {
    return NextResponse.json({ error: custErr.message }, { status: 500 })
  }

  type CustRow = {
    id: string; customer_name: string; inspection_type: InspectionType
    inspection_category: string | null; inspection_sub_type: string | null
    plan_anchor_date: string | null; assigned_employee_id: string | null
  }
  const custList = (customers ?? []) as unknown as CustRow[]

  const results: Array<{ year: number; customers: number; created: number; errors: string[] }> = []
  for (const year of targetYears) {
    const hdSet = await loadHolidaySet(admin, year)
    let created = 0
    const errors: string[] = []
    for (const c of custList) {
      try {
        created += await generateYearlyPlanItems(admin, c, year, createdBy, hdSet)
      } catch (err) {
        errors.push(`${c.customer_name}: ${String(err)}`)
      }
    }
    results.push({ year, customers: custList.length, created, errors })
  }

  const hasError = results.some(r => r.errors.length > 0)
  return NextResponse.json({
    ok: !hasError,
    results,
    timestamp: now.toISOString(),
  })
}
