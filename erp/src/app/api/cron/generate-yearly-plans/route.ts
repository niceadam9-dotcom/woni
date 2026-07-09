import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateYearlyPlanItems, loadHolidaySet } from '@/lib/inspection-plan-generator'
import type { InspectionType } from '@/types'

// 활성 고객(종합/작동)의 연간 점검계획을 매년 반복 생성 — 비활성/삭제 전까지 계속
// Vercel Cron: 매년 12월 1일(내년 계획 선행 생성) + 1월 1일(올해 보정) 호출
// 수동 테스트: GET /api/cron/generate-yearly-plans?year=2027
// Authorization: Bearer {CRON_SECRET} 헤더 필수
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  // 컨테이너 TZ가 UTC라 연말·연초 발화 시 날짜가 밀림 — +9h 시프트 후 UTC 게터로 KST 연·월 추출
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const currentYear  = kstNow.getUTCFullYear()
  const currentMonth = kstNow.getUTCMonth() + 1

  const paramYear = req.nextUrl.searchParams.get('year')
  let targetYears: number[]
  if (paramYear) {
    const y = parseInt(paramYear, 10)
    if (isNaN(y) || y < 2020 || y > 2100) {
      return NextResponse.json({ error: '유효하지 않은 연도입니다.' }, { status: 400 })
    }
    targetYears = [y]
  } else if (currentMonth === 12) {
    // 12월: 내년 계획 선행 생성 (+올해 보정)
    targetYears = [currentYear, currentYear + 1]
  } else {
    // 그 외(1월 1일 정기 실행 포함): 올해 보정 — 멱등이라 중복 실행 안전
    targetYears = [currentYear]
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

  // 활성 소방안전관리 고객 (일반관리는 수동 생성이므로 제외)
  // 기준일은 생성기가 결정(최초 점검시작일 우선 → 사용승인일) — 둘 다 없으면 0건
  const { data: customers, error: custErr } = await admin
    .from('customers')
    .select('id, customer_name, inspection_type, use_approval_date, assigned_employee_id')
    .eq('is_active', true)
    .in('inspection_type', ['종합', '작동'])

  if (custErr) {
    return NextResponse.json({ error: custErr.message }, { status: 500 })
  }

  type CustRow = {
    id: string; customer_name: string; inspection_type: InspectionType
    use_approval_date: string | null; assigned_employee_id: string | null
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
