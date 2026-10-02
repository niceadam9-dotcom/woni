import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCronStaleness, type CronStale } from '@/lib/cron-run'

/** /api/health — 업타임 감시용 (통합 실행계획 A3, 2026-10-02)
 *
 *  200 = DB 응답 + Gotenberg 응답. 어느 하나라도 죽으면 503 — 외부 감시(healthchecks.io·UptimeRobot류)가 그걸로 울린다.
 *  Gotenberg는 별지·소방계획서 PDF 전부가 거치는 컨테이너라 "앱은 떠 있는데 PDF만 안 나오는" 상태를 다운으로 친다.
 *  크론 신선도는 **정보**로만 싣는다(503 사유가 아니다) — 크론이 늦은 것과 서비스가 죽은 것은 다른 알림이다.
 *  인증 없음(proxy PUBLIC_PATHS) — 그래서 비밀·버전·내부 주소는 싣지 않는다. Caddy /api/* 레이트리밋(120/분) 안.
 */
export const dynamic = 'force-dynamic'

type Check = { ok: boolean; ms: number; reason?: string }

async function checkDb(): Promise<Check> {
  const t0 = Date.now()
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('profiles').select('id', { head: true, count: 'exact' }).limit(1)
    return error ? { ok: false, ms: Date.now() - t0, reason: 'db query failed' } : { ok: true, ms: Date.now() - t0 }
  } catch {
    return { ok: false, ms: Date.now() - t0, reason: 'db unreachable' }
  }
}

async function checkGotenberg(): Promise<Check> {
  const t0 = Date.now()
  const base = process.env.GOTENBERG_URL
  if (!base) return { ok: false, ms: 0, reason: 'GOTENBERG_URL unset' }
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000), cache: 'no-store' })
    return r.ok ? { ok: true, ms: Date.now() - t0 } : { ok: false, ms: Date.now() - t0, reason: `http ${r.status}` }
  } catch {
    return { ok: false, ms: Date.now() - t0, reason: 'unreachable' }
  }
}

export async function GET() {
  const [db, gotenberg] = await Promise.all([checkDb(), checkGotenberg()])
  let cronStale: CronStale[] = []
  if (db.ok) {
    try { cronStale = await getCronStaleness(createAdminClient()) } catch { /* 정보성 — 실패해도 health는 판정한다 */ }
  }
  const ok = db.ok && gotenberg.ok
  return NextResponse.json(
    { ok, db, gotenberg, cron: { stale: cronStale.map(s => ({ job: s.job, hoursSince: s.hoursSince, maxHours: s.maxHours })) }, at: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
