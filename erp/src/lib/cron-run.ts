import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

/** 크론 라우트 공용 래퍼 (통합 실행계획 A3 관측, 2026-10-02)
 *
 *  종전엔 라우트 11개가 각자 CRON_SECRET을 대조하고, 실패는 VPS 로그 파일(`MAILTO=""`)에만 남았다.
 *  이 래퍼가 (1) 인증을 한 곳에서 하고 (2) 발화마다 cron_runs(168)에 한 행을 쓰며 (3) 예외·실패 응답을
 *  Sentry로 보내고 (4) 끝날 때 다른 크론들의 신선도(마지막 성공이 주기의 2배를 넘었는가)를 점검한다.
 *
 *  🚨 라우트의 응답은 그대로 통과한다 — 본문·상태 모두 종전과 같다(E2E가 res.ok·started 등을 고정한다).
 *     기록·점검은 전부 best-effort다: cron_runs가 아직 없거나(168 미적용) DB가 잠깐 막혀도 라우트는 돈다.
 *  🚨 Sentry는 SENTRY_DSN이 없으면 초기화되지 않고(src/instrumentation.ts) capture는 조용히 무시된다. */

export const CRON_JOBS = [
  'auto-start-inspections', 'defect-action-notify', 'generate-monthly-bills', 'generate-yearly-plans',
  'inspection-deadline-notify', 'insurance-expiry-notify', 'law-revision-check', 'manager-edu-notify',
  'purge-activity-logs', 'sync-holidays', 'weekly-doc-briefing',
] as const
export type CronJob = typeof CRON_JOBS[number]

/** 기대 주기(deploy/cron/sjfire-erp.cron 정본) × 2 — 마지막 성공이 이보다 오래면 「신선도 경고」.
 *  매일 00:xx → 26h(발화 지연 여유) / 매주 월 → 8일 / 매월 1일 → 32일. */
export const CRON_MAX_AGE_HOURS: Record<CronJob, number> = {
  'inspection-deadline-notify': 26, 'insurance-expiry-notify': 26, 'auto-start-inspections': 26,
  'defect-action-notify': 26, 'manager-edu-notify': 26,
  'law-revision-check': 8 * 24, 'weekly-doc-briefing': 8 * 24,
  'sync-holidays': 32 * 24, 'generate-yearly-plans': 32 * 24, 'generate-monthly-bills': 32 * 24, 'purge-activity-logs': 32 * 24,
}

const RESULT_MAX_CHARS = 8000
const RETENTION_DAYS = 180

type Admin = SupabaseClient
type RunRow = { id: string } | null

export async function withCronRun(
  job: CronJob, req: NextRequest, handler: () => Promise<NextResponse>,
  // 테스트 주입용(scripts/test-cron-run.mts) — 라우트는 넘기지 않는다
  deps: { admin?: () => Admin } = {},
): Promise<NextResponse> {
  // CRON_SECRET 미설정 시 통과시키던 종전 조건(`cronSecret && …`)은 무인증 구멍이었다 — 미설정이면 아예 거부
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = (deps.admin ?? createAdminClient)()
  const startedAt = new Date()
  const run = await startRun(admin, job, startedAt)

  try {
    const res = await handler()
    const { ok, body } = await summarize(res)
    await finishRun(admin, run, startedAt, {
      ok, status: res.status, result: body,
      error: ok ? null : (typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`),
    })
    if (!ok) {
      Sentry.captureMessage(`[cron] ${job} 실패 응답 ${res.status}`, { level: 'error', tags: { job }, extra: { body } })
      console.error(`[cron:${job}] 실패 응답`, res.status, body)
    }
    await afterRun(admin, job)
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await finishRun(admin, run, startedAt, { ok: false, status: 500, result: null, error: message })
    Sentry.captureException(err, { tags: { job } })
    console.error(`[cron:${job}] 예외`, err)
    return NextResponse.json({ ok: false, error: '크론 실행 실패' }, { status: 500 })
  }
}

async function startRun(admin: Admin, job: CronJob, startedAt: Date): Promise<RunRow> {
  try {
    const { data, error } = await admin.from('cron_runs')
      .insert({ job, started_at: startedAt.toISOString() })
      .select('id').single()
    if (error) { console.warn(`[cron:${job}] cron_runs 기록 불가(168 미적용?):`, error.message); return null }
    return data as { id: string }
  } catch (e) {
    console.warn(`[cron:${job}] cron_runs 기록 예외:`, e)
    return null
  }
}

async function finishRun(
  admin: Admin, run: RunRow, startedAt: Date,
  patch: { ok: boolean; status: number; result: Record<string, unknown> | null; error: string | null },
) {
  if (!run) return
  try {
    const finishedAt = new Date()
    await admin.from('cron_runs').update({
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      ok: patch.ok, status: patch.status, error: patch.error, result: patch.result,
    }).eq('id', run.id)
  } catch (e) {
    console.warn('[cron] cron_runs 마감 기록 예외:', e)
  }
}

/** 응답을 복제해 읽는다. ok = 2xx·3xx 이고 본문이 ok:false·error를 말하지 않을 때. */
async function summarize(res: NextResponse): Promise<{ ok: boolean; body: Record<string, unknown> | null }> {
  let body: Record<string, unknown> | null = null
  try {
    const text = await res.clone().text()
    if (text) {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') {
        body = text.length <= RESULT_MAX_CHARS ? parsed as Record<string, unknown> : { truncated: true, chars: text.length }
      }
    }
  } catch { /* JSON이 아닌 응답 — 상태 코드로만 판정 */ }
  const bodySaysFail = body !== null && (body.ok === false || typeof body.error === 'string')
  return { ok: res.status < 400 && !bodySaysFail, body }
}

/** 발화 뒤 부수 점검 — 신선도 경고 + 오래된 행 정리. 전부 best-effort. */
async function afterRun(admin: Admin, job: CronJob) {
  try {
    const stale = await getCronStaleness(admin)
    for (const s of stale) {
      if (s.job === job) continue // 지금 막 돈 자기 자신은 제외
      const msg = `[cron] 신선도 경고: ${s.job} 마지막 성공 ${s.hoursSince}시간 전 (기대 ≤ ${s.maxHours}h)`
      Sentry.captureMessage(msg, { level: 'warning', tags: { job: s.job, kind: 'stale' } })
      console.warn(msg)
    }
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString()
    await admin.from('cron_runs').delete().lt('started_at', cutoff)
  } catch (e) {
    console.warn('[cron] 신선도 점검 예외:', e)
  }
}

export type CronStale = { job: CronJob; lastOkAt: string; hoursSince: number; maxHours: number }

/** 마지막 성공이 기대 주기의 2배를 넘은 크론 목록. 기록이 한 번도 없는 job은 넣지 않는다
 *  (168 직후 월간 크론들이 한 달 내내 울리는 소음 방지 — 첫 성공 뒤부터 감시한다). */
export async function getCronStaleness(admin: Admin, now: Date = new Date()): Promise<CronStale[]> {
  const { data, error } = await admin.from('cron_runs')
    .select('job, started_at').eq('ok', true)
    .order('started_at', { ascending: false }).limit(400)
  if (error || !data) return []
  const lastOk = new Map<string, string>()
  for (const r of data as Array<{ job: string; started_at: string }>) {
    if (!lastOk.has(r.job)) lastOk.set(r.job, r.started_at)
  }
  const out: CronStale[] = []
  for (const job of CRON_JOBS) {
    const at = lastOk.get(job)
    if (!at) continue
    const hoursSince = Math.round((now.getTime() - new Date(at).getTime()) / 3600_000)
    const maxHours = CRON_MAX_AGE_HOURS[job]
    if (hoursSince > maxHours) out.push({ job, lastOkAt: at, hoursSince, maxHours })
  }
  return out
}
