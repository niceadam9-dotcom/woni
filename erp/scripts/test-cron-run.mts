// 크론 공용 래퍼 단위 테스트 (A3 2026-10-02) — src/lib/cron-run.ts
// 실행: npx tsx --conditions=react-server scripts/test-cron-run.mts   (test-all.mts 등재 · 서버·DB 불필요 — 가짜 admin 주입)
//
// 고정하는 것:
//  1) 인증 — CRON_SECRET 미설정·불일치는 401, 핸들러를 부르지 않는다
//  2) 응답 통과 — 핸들러의 상태·본문이 그대로 나간다(E2E가 res.ok·started 등을 읽는다)
//  3) 판정 — 2xx+본문 정상 = ok / 본문 ok:false·error = 실패 / 5xx = 실패 / 예외 = 500 + 실패 기록
//  4) best-effort — cron_runs 기록이 실패해도(168 미적용) 핸들러 응답은 그대로
//  5) 신선도 — 주기×2 초과만 경고, 기록 없는 job은 제외, 11개 job 목록과 정본 크론 파일이 일치
import { readFileSync } from 'fs'
import { NextRequest, NextResponse } from 'next/server'

let fails = 0
const ok = (cond: boolean, label: string, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${!cond && detail ? ` — ${detail}` : ''}`)
  if (!cond) fails++
}

// ── 가짜 Supabase admin: cron_runs insert/update/select/delete를 메모리에 ─────────────
type Row = Record<string, unknown>
function fakeAdmin(opts: { failInsert?: boolean; rows?: Row[] } = {}) {
  const rows: Row[] = opts.rows ?? []
  const api = {
    rows,
    from(table: string) {
      if (table !== 'cron_runs') throw new Error(`unexpected table ${table}`)
      return {
        insert(v: Row) {
          return { select: () => ({ single: async () => {
            if (opts.failInsert) return { data: null, error: { message: 'relation "cron_runs" does not exist' } }
            const r = { id: `r${rows.length + 1}`, ...v }; rows.push(r); return { data: { id: r.id }, error: null }
          } }) }
        },
        update(patch: Row) { return { eq: async (_k: string, id: string) => { const r = rows.find(x => x.id === id); if (r) Object.assign(r, patch); return { error: null } } } },
        delete() { return { lt: async () => ({ error: null }) } },
        select() {
          return { eq: (_k: string, v: unknown) => ({ order: () => ({ limit: async () => ({
            data: rows.filter(r => r.ok === v).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))), error: null,
          }) }) }) }
        },
      }
    },
  }
  return api
}

// 가짜 admin은 래퍼의 deps 인자로 주입한다(ESM export를 바꿔 끼우지 않는다)
let current = fakeAdmin()
const { withCronRun: wrapReal, getCronStaleness, CRON_JOBS, CRON_MAX_AGE_HOURS } = await import('../src/lib/cron-run')
const withCronRun: typeof wrapReal = (job, r, h) => wrapReal(job, r, h, { admin: () => current as never })

const req = (auth?: string) => new NextRequest('http://localhost/api/cron/x', { headers: auth ? { authorization: auth } : {} })
process.env.CRON_SECRET = 's3cret'

// 1) 인증
{
  let called = 0
  const h = async () => { called++; return NextResponse.json({ ok: true }) }
  const r1 = await withCronRun('sync-holidays', req(), h)
  const r2 = await withCronRun('sync-holidays', req('Bearer nope'), h)
  const saved = process.env.CRON_SECRET; delete process.env.CRON_SECRET
  const r3 = await withCronRun('sync-holidays', req('Bearer '), h)
  process.env.CRON_SECRET = saved
  ok(r1.status === 401 && r2.status === 401 && r3.status === 401, '인증: 헤더 없음·불일치·CRON_SECRET 미설정 → 401')
  ok(called === 0, '인증 실패 시 핸들러를 부르지 않는다', `called=${called}`)
  ok(current.rows.length === 0, '인증 실패는 cron_runs에 기록하지 않는다')
}

// 2)·3) 통과·판정
{
  current = fakeAdmin()
  const r = await withCronRun('auto-start-inspections', req('Bearer s3cret'), async () => NextResponse.json({ ok: true, started: 3 }))
  const body = await r.json()
  ok(r.status === 200 && body.ok === true && body.started === 3, '성공 응답이 그대로 통과(상태·본문)', JSON.stringify(body))
  const row = current.rows[0]
  ok(row?.ok === true && row?.status === 200 && typeof row?.duration_ms === 'number' && !!row?.finished_at, 'cron_runs: ok·status·duration·finished_at 기록', JSON.stringify(row))
  ok((row?.result as Row)?.started === 3, 'cron_runs.result에 응답 본문', JSON.stringify(row?.result))

  current = fakeAdmin()
  const r2 = await withCronRun('sync-holidays', req('Bearer s3cret'), async () => NextResponse.json({ ok: false, synced: [] }))
  ok(r2.status === 200 && current.rows[0]?.ok === false, '본문 ok:false → 응답은 그대로, 기록은 실패')

  current = fakeAdmin()
  await withCronRun('law-revision-check', req('Bearer s3cret'), async () => NextResponse.json({ error: 'LAW_OC 미설정' }, { status: 500 }))
  ok(current.rows[0]?.ok === false && current.rows[0]?.error === 'LAW_OC 미설정' && current.rows[0]?.status === 500, '5xx + error 문구 → 실패·문구 기록', JSON.stringify(current.rows[0]))

  current = fakeAdmin()
  const r4 = await withCronRun('weekly-doc-briefing', req('Bearer s3cret'), async () => { throw new Error('boom') })
  ok(r4.status === 500, '핸들러 예외 → 500')
  ok(current.rows[0]?.ok === false && current.rows[0]?.error === 'boom', '예외 → 실패·메시지 기록', JSON.stringify(current.rows[0]))
  const b4 = await r4.json()
  ok(!JSON.stringify(b4).includes('boom'), '예외 메시지를 응답 본문에 싣지 않는다', JSON.stringify(b4))
}

// 4) best-effort
{
  current = fakeAdmin({ failInsert: true })
  const r = await withCronRun('purge-activity-logs', req('Bearer s3cret'), async () => NextResponse.json({ ok: true, deleted: 0 }))
  const b = await r.json()
  ok(r.status === 200 && b.ok === true, 'cron_runs 기록 불가(168 미적용)여도 라우트 응답은 그대로')
}

// 5) 신선도
{
  const now = new Date('2026-10-10T00:00:00Z')
  const h = (n: number) => new Date(now.getTime() - n * 3600_000).toISOString()
  current = fakeAdmin({ rows: [
    { id: 'a', job: 'inspection-deadline-notify', started_at: h(30), ok: true },   // 매일 — 26h 초과 → 경고
    { id: 'b', job: 'insurance-expiry-notify', started_at: h(20), ok: true },      // 매일 — 정상
    { id: 'c', job: 'weekly-doc-briefing', started_at: h(24 * 9), ok: true },      // 매주 — 8일 초과 → 경고
    { id: 'd', job: 'sync-holidays', started_at: h(24 * 20), ok: true },           // 매월 — 정상
    { id: 'e', job: 'auto-start-inspections', started_at: h(2), ok: false },       // 실패만 있음 → 성공 기록 없음 → 제외
    { id: 'f', job: 'auto-start-inspections', started_at: h(40), ok: true },       // 그 전 성공은 40h → 경고
  ] })
  const stale = await getCronStaleness(current as never, now)
  const jobs = stale.map(s => s.job).sort()
  ok(JSON.stringify(jobs) === JSON.stringify(['auto-start-inspections', 'inspection-deadline-notify', 'weekly-doc-briefing']),
    '신선도: 주기×2 초과만(실패 행은 성공으로 치지 않음)', JSON.stringify(jobs))
  ok(!jobs.includes('generate-monthly-bills'), '기록이 한 번도 없는 job은 경고하지 않는다(168 직후 소음 방지)')
}

// 6) job 목록 = 라우트 디렉터리 = 정본 크론 파일
{
  const { readdirSync } = await import('fs')
  const dirs = readdirSync(new URL('../src/app/api/cron/', import.meta.url)).sort()
  ok(JSON.stringify([...CRON_JOBS].sort()) === JSON.stringify(dirs), 'CRON_JOBS = src/app/api/cron 디렉터리 11개', JSON.stringify(dirs))
  ok(CRON_JOBS.every(j => CRON_MAX_AGE_HOURS[j] > 0), '모든 job에 신선도 한도가 있다')
  const cron = readFileSync(new URL('../deploy/cron/sjfire-erp.cron', import.meta.url), 'utf8')
  const scheduled = [...cron.matchAll(/^[^#].*\/api\/cron\/([a-z-]+)/gm)].map(m => m[1]).sort()
  ok(JSON.stringify(scheduled) === JSON.stringify(dirs), '정본 크론 파일의 발화 대상 = 라우트 11개', JSON.stringify(scheduled))
  for (const job of dirs) {
    const src = readFileSync(new URL(`../src/app/api/cron/${job}/route.ts`, import.meta.url), 'utf8')
    ok(src.includes(`withCronRun('${job}', req,`) && !src.includes('process.env.CRON_SECRET'),
      `${job}: 래퍼 경유·라우트 자체 인증 없음`)
  }
}

console.log(fails === 0 ? '\n✅ 크론 래퍼 전건 통과' : `\n❌ 실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
