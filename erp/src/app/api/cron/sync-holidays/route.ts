import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKoreanHolidays } from '@/lib/holidays'

// Vercel Cron에서 매년 1월 1일(0 0 1 1 *) + 12월 1일(0 0 1 12 *)에 자동 호출
// 수동 테스트: GET /api/cron/sync-holidays?year=2026
// Authorization: Bearer {CRON_SECRET} 헤더 필수
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1 // 1-indexed

  // 수동 year 파라미터가 있으면 해당 연도만, 없으면 자동 결정
  const paramYear = req.nextUrl.searchParams.get('year')

  let yearsToSync: number[]
  if (paramYear) {
    const y = parseInt(paramYear, 10)
    if (isNaN(y) || y < 2020 || y > 2030) {
      return NextResponse.json({ error: '유효하지 않은 연도입니다.' }, { status: 400 })
    }
    yearsToSync = [y]
  } else if (currentMonth === 12) {
    // 12월 1일 실행: 내년 데이터 선행 로드
    yearsToSync = [currentYear, currentYear + 1]
  } else {
    // 1월 1일 실행: 올해 + 내년 동기화
    yearsToSync = [currentYear, currentYear + 1]
  }

  const results: Array<{ year: number; count: number; error?: string }> = []

  for (const year of yearsToSync) {
    try {
      const holidays = await getKoreanHolidays(year)

      if (holidays.length === 0) {
        results.push({ year, count: 0, error: '공휴일 데이터 없음' })
        continue
      }

      const rows = holidays.map(h => ({
        date: h.date,
        name: h.name,
        is_national: true,
      }))

      const { error } = await admin
        .from('holidays')
        .upsert(rows as unknown as Record<string, unknown>[], { onConflict: 'date' })

      if (error) {
        results.push({ year, count: 0, error: error.message })
      } else {
        results.push({ year, count: rows.length })
      }
    } catch (err) {
      results.push({ year, count: 0, error: String(err) })
    }
  }

  const totalCount = results.reduce((s, r) => s + r.count, 0)
  const hasError = results.some(r => r.error)

  return NextResponse.json({
    ok: !hasError,
    synced: results,
    totalCount,
    timestamp: now.toISOString(),
  })
}
