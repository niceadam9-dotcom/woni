// manager-edu-notify insert 경로 주입 프로브 (2026-09-05) — 158 CHECK가 실제로 insert를
// 통과시키는지, D-30 규칙이 맞물리는지를 프로브 고객으로 실측하고 흔적을 즉시 지운다.
// (쿼리 경로만 보면 '발송 0'이 공허 통과가 된다 — 가드/경로 판정은 주입으로만.)
// 실행: node scripts/_probe-manager-edu-inject.mjs
import { readFileSync } from 'fs'
import { raw, check, summary, mkCustomer, cleanupCustomer } from './_e2e-helpers.mjs'

const env = readFileSync('.env.local', 'utf8')
const secret = env.match(/^CRON_SECRET=(.+)$/m)?.[1]?.trim()
if (!secret) { console.log('CRON_SECRET 없음'); process.exit(2) }

let customerId = ''
try {
  // 교육이수일 = 오늘(KST) + 30일 - 2년 → 기한(+2년)이 정확히 D-30
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setUTCDate(d.getUTCDate() + 30)
  d.setUTCFullYear(d.getUTCFullYear() - 2)
  const eduDate = d.toISOString().split('T')[0]

  const { data: anyProfile } = await raw.from('profiles').select('id').eq('is_system', false).limit(1).single()
  customerId = await mkCustomer({ customer_name: '실무교육크론프로브', address: '경기 양평군 테스트로 3', created_by: anyProfile.id })
  await raw.from('customers').update({ manager_edu_date: eduDate }).eq('id', customerId)

  const r = await fetch('http://localhost:3000/api/cron/manager-edu-notify', {
    headers: { Authorization: `Bearer ${secret}` },
  })
  const body = await r.json()
  check('크론 200 ok', r.status === 200 && body.ok === true, JSON.stringify(body))
  check('발송 1건 이상', (body.sent ?? 0) >= 1, `sent=${body.sent}`)

  const { data: rows, error } = await raw.from('notifications')
    .select('id, type, title').eq('reference_id', customerId).eq('type', 'manager_edu_due')
  check('158 CHECK 통과 — manager_edu_due 행 실재', !error && (rows ?? []).length >= 1,
    error ? error.message : `rows=${(rows ?? []).length}`)
  check('제목에 D-30', (rows ?? []).some(n => n.title.includes('[D-30]')), JSON.stringify((rows ?? [])[0] ?? {}))

  // 같은 날 재호출 중복 방지도 이 김에 — 다시 불러도 이 고객으론 추가 발송 없음
  const r2 = await fetch('http://localhost:3000/api/cron/manager-edu-notify', {
    headers: { Authorization: `Bearer ${secret}` },
  })
  const body2 = await r2.json()
  const { data: rows2 } = await raw.from('notifications')
    .select('id').eq('reference_id', customerId).eq('type', 'manager_edu_due')
  check('재호출 시 중복 발송 없음', (rows2 ?? []).length === (rows ?? []).length,
    `1차=${(rows ?? []).length} 2차=${(rows2 ?? []).length} sent2=${body2.sent}`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  // 흔적 정리 — 프로브 알림 전량 삭제 후 고객 삭제
  if (customerId) {
    await raw.from('notifications').delete().eq('reference_id', customerId)
    await cleanupCustomer(customerId)
  }
}

summary()
