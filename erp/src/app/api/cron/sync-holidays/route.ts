import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncHolidaysForYear, type SyncResult } from '@/lib/holiday-sync'

// 스케줄 **정본은 deploy/cron/sjfire-erp.cron**(VPS /etc/cron.d) — 매월 1일 00:10.
//   2026-08-18 사용자 확정으로 종전 연 2회(1/1·12/1)에서 상향했다(소방계획서_25 R-2):
//   임시공휴일은 1~3주 전에 지정되는데 연 2회로는 그 사이 지정분을 다음 발화까지 놓치고,
//   공휴일 하나가 틀리면 6단계 마감일이 통째로 밀리면서 화면 어디에도 안 드러난다.
//   호출당 3년치를 갱신하고 멱등이라 월 1회 비용은 작다.
// vercel.json에도 같은 스케줄이 있다 — 이 배포는 VPS라 그쪽은 예비다. **셋을 함께 고칠 것**
//   (2026-09-08 실측: 셋 중 둘이 연 2회로 남아 화면이 사용자에게 거짓 주기를 안내하고 있었다).
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

  // 수동 year 파라미터가 있으면 해당 연도만, 없으면 **올해·내년·내후년** 3년.
  //
  // 왜 내후년까지인가: 점검 6단계 마감일은 시작일에서 약 2개월 뒤까지 뻗는다. 연말 점검은
  // 다음 해 공휴일이 있어야 마감일이 맞는데(예: 2027-12-20 점검 → ③④⑤⑥이 2028년),
  // 올해+내년만 받으면 12월 점검마다 그 다음 해가 비어 마감일이 앞당겨진다.
  // 특일 정보 API는 내후년치를 이미 제공하므로 미리 받아 두는 데 비용이 없다.
  const paramYear = req.nextUrl.searchParams.get('year')
  let yearsToSync: number[]
  if (paramYear) {
    const y = parseInt(paramYear, 10)
    if (isNaN(y) || y < 2020 || y > 2030) {
      return NextResponse.json({ error: '유효하지 않은 연도입니다.' }, { status: 400 })
    }
    yearsToSync = [y]
  } else {
    yearsToSync = [currentYear, currentYear + 1, currentYear + 2]
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
