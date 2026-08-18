import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncHolidaysForYear, type SyncResult } from '@/lib/holiday-sync'

// Vercel Cron에서 매년 1월 1일(0 0 1 1 *) + 12월 1일(0 0 1 12 *)에 자동 호출
// 수동 테스트: GET /api/cron/sync-holidays?year=2026
// Authorization: Bearer {CRON_SECRET} 헤더 필수
//
// 반영 규칙은 lib/holiday-sync.ts 하나가 갖는다(관리 화면 동기화 버튼과 동일 코드).
export async function GET(req: NextRequest) {
  // CRON_SECRET 미설정 시 통과시키던 종전 조건(`cronSecret && …`)은 무인증 구멍이었다 —
  // 설정돼 있지 않으면 아예 거부한다 (소방계획서_24 P-9와 같은 지적)
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  // 컨테이너 TZ가 UTC라 1/1 00:10 KST 발화 시 전년도로 잡힘 — +9h 시프트 후 UTC 게터로 KST 연 추출
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const currentYear = kstNow.getUTCFullYear()

  // 수동 year 파라미터가 있으면 해당 연도만, 없으면 올해+내년 (12월 실행이면 내년 선행 로드)
  const paramYear = req.nextUrl.searchParams.get('year')
  let yearsToSync: number[]
  if (paramYear) {
    const y = parseInt(paramYear, 10)
    if (isNaN(y) || y < 2020 || y > 2030) {
      return NextResponse.json({ error: '유효하지 않은 연도입니다.' }, { status: 400 })
    }
    yearsToSync = [y]
  } else {
    yearsToSync = [currentYear, currentYear + 1]
  }

  const results: SyncResult[] = []
  for (const year of yearsToSync) {
    results.push(await syncHolidaysForYear(admin, year))
  }

  const hasError = results.some(r => r.error)
  return NextResponse.json({
    ok: !hasError,
    synced: results,
    totalCount: results.reduce((s, r) => s + r.upserted, 0),
    // 폴백이 일어났으면 감춰지지 않게 최상위로 끌어올린다
    ...(results.some(r => r.note) ? { notes: results.filter(r => r.note).map(r => `${r.year}: ${r.note}`) } : {}),
    timestamp: now.toISOString(),
  })
}
