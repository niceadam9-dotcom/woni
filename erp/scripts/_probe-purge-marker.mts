// 소방계획서_18 X-4 — 로그 보존 크론이 '종이 보관 마커'만 남기고 나머지는 만료시키는지 실제 호출로 확인
// 실행: npm run dev 후 npx tsx scripts/_probe-purge-marker.mts   (스테이징 DB, CRON_SECRET 필요)
//
// 왜 필요한가: 마커(activity_logs)는 이후 모든 화면의 '종이 보관됨' 판정 근거다. 24개월 보존 크론이
// 이걸 지우면 정리된 과거 회차가 어느 날 갑자기 '배치확인서 누락'으로 되살아난다.
// 반대로 제외를 너무 넓게 걸면 판정에 쓰지도 않는 거대 감사 로그까지 영구 보존돼 보존정책을 어긴다.
// 그래서 확인할 것은 두 방향이다 — 마커는 남고, 같은 action의 고객 감사 로그는 만료 대상에 들어간다.
//
// dry_run은 삭제는 안 하지만 아카이브 JSON은 올린다 — 그 JSON에 어떤 행이 담겼는지로 판정하고 뒷정리한다.
//
// 라우트 핸들러를 HTTP 대신 **직접 호출**한다: dev 서버를 거치지 않아도 같은 코드 경로이고,
// 서버 기동 상태에 의존하지 않아 회귀 스위트에서 안정적으로 돌릴 수 있다.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { NextRequest } from 'next/server'
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer } from './_e2e-helpers.mjs'

const { GET: purgeGET } = await import('../src/app/api/cron/purge-activity-logs/route.ts')

const ACTION = 'fire_plan_archive_cleanup'
const ARCHIVE_BUCKET = 'log-archives'
const OLD_AT = '2020-06-15T00:00:00+09:00'   // 보존 기간을 확실히 넘긴 시각

let userId = ''
let customerId = ''
let inspectionId = ''
const logIds: string[] = []
let uploadedArchives: string[] = []

try {
  userId = await mkUser({ email: 'purge-marker-probe@erp-test.com', name: '보존프로브', employeeId: 'PB-PURGE' })
  customerId = await mkCustomer({ customer_name: '보존정책프로브고객', created_by: userId })
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: '2025-05-01', status: 'completed', created_by: userId, assigned_employee_id: userId,
  }).select('id').single()
  if (iErr) throw new Error(`회차 시드 실패: ${iErr.message}`)
  inspectionId = insp!.id

  // 같은 action·같은 시각의 두 행 — 하나는 회차 마커(판정 근거), 하나는 고객 감사 로그(기록)
  const { data: rows, error: lErr } = await raw.from('activity_logs').insert([
    { actor_id: userId, action: ACTION, entity_type: 'inspection', entity_id: inspectionId,
      metadata: { round: '2025년 1차', certs: 1, probe: true }, created_at: OLD_AT },
    { actor_id: userId, action: ACTION, entity_type: 'customer', entity_id: customerId,
      metadata: { deletedPaths: ['a', 'b'], probe: true }, created_at: OLD_AT },
  ]).select('id, entity_type')
  if (lErr) throw new Error(`로그 시드 실패: ${lErr.message}`)
  const markerId = rows!.find((r: { entity_type: string }) => r.entity_type === 'inspection')!.id
  const auditId = rows!.find((r: { entity_type: string }) => r.entity_type === 'customer')!.id
  logIds.push(markerId, auditId)

  // 시드 시각(2020-06)만 확실히 지나도록 보존 기간을 잡는다 — 최근 로그는 건드리지 않는다
  const retentionDays = Math.floor((Date.now() - new Date('2021-01-01T00:00:00Z').getTime()) / 86400000)
  const req = new NextRequest(
    `http://localhost/api/cron/purge-activity-logs?dry_run=1&retention_days=${retentionDays}`,
    { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } },
  )
  const res = await purgeGET(req)
  const body = await res.json() as { ok?: boolean; dry_run?: boolean; months?: string[]; archived?: number; error?: string }
  check('크론 호출 성공(dry_run)', res.status === 200 && body.ok === true, JSON.stringify(body).slice(0, 200))
  uploadedArchives = body.months ?? []

  // 아카이브 JSON = 이번에 만료 대상으로 잡힌 행들. 여기 들어갔다면 실제 실행 시 삭제된다는 뜻이다.
  const archivedIds = new Set<string>()
  for (const path of uploadedArchives) {
    const { data: blob } = await raw.storage.from(ARCHIVE_BUCKET).download(path)
    if (!blob) continue
    const parsed = JSON.parse(await blob.text()) as { rows: Array<{ id: string }> }
    for (const r of parsed.rows ?? []) archivedIds.add(r.id)
  }
  check('아카이브 대상이 실제로 수집됨', archivedIds.size > 0, `size=${archivedIds.size}`)

  check('X-4 — 종이 보관 마커는 만료 대상에서 제외', !archivedIds.has(markerId))
  check('X-4 — 같은 action이라도 고객 감사 로그는 정상 만료', archivedIds.has(auditId))

  // 마커가 DB에 그대로 남아 판정에 계속 쓰일 수 있는지 확인
  const { data: still } = await raw.from('activity_logs').select('id').eq('id', markerId).maybeSingle()
  check('X-4 — 마커 행 잔존', !!still)
} finally {
  const quiet = async (fn: () => Promise<unknown>) => { try { await fn() } catch { /* 무시 */ } }
  // dry_run이 올린 아카이브 파일 회수 — 실제 만료는 일어나지 않았다
  if (uploadedArchives.length > 0) await quiet(() => raw.storage.from(ARCHIVE_BUCKET).remove(uploadedArchives))
  if (logIds.length > 0) await quiet(() => raw.rpc('purge_activity_logs', { purge_ids: logIds }))
  if (inspectionId) await quiet(() => raw.from('inspections').delete().eq('id', inspectionId))
  if (customerId) await quiet(() => cleanupCustomer(customerId))
  if (userId) await quiet(() => delUser(userId))
}
summary()
