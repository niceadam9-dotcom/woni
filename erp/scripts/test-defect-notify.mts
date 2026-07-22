// 9-7d E2E — 불량 이행기한 임박 알림 크론 (D-3·경과·멱등)
// 실행: npx tsx scripts/test-defect-notify.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer } from './_e2e-helpers.mjs'
import { readFileSync } from 'fs'

const EMAIL = 'defect-notify-e2e@erp-test.com'
let userId = ''
let custId = ''
let inspId = ''
const defectIds: string[] = []

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '기한알림E2E', employeeId: 'E2E-DFN' })
  custId = await mkCustomer({ customer_name: '기한알림E2E고객', created_by: userId })
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-30), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = insp!.id

  // D-3 미완료 2건 + 기한경과 1건 + 완료된 건(알림 제외 확인)
  const rows = [
    { defect_name: '소화기 압력 미달', action_end: kstShift(3) },
    { defect_name: '유도등 점등 불량', action_end: kstShift(3) },
    { defect_name: '경보기 오작동', action_end: kstShift(-1) },
    { defect_name: '완료된 불량', action_end: kstShift(3), action_completed_at: new Date().toISOString() },
  ]
  for (const r of rows) {
    const { data } = await raw.from('inspection_defects')
      .insert({ inspection_id: inspId, severity: '보통', ...r }).select('id').single()
    defectIds.push(data!.id)
  }

  const secret = (readFileSync('F:/AI/ERP/erp/.env.local', 'utf8').match(/^CRON_SECRET=(.+)$/m)?.[1] ?? '').trim()
  const fire = () => fetch(`${BASE}/api/cron/defect-action-notify`, {
    headers: { Authorization: `Bearer ${secret}` },
  }).then(r => r.json())

  const res = await fire()
  check('크론 응답 ok', res.ok === true, JSON.stringify(res))

  const { data: notis } = await raw.from('notifications')
    .select('recipient_id, type, title, message').eq('reference_id', inspId)
  const list = (notis ?? []) as Array<{ recipient_id: string; type: string; title: string; message: string }>
  const due = list.filter(n => n.type === 'defect_action_due')
  const overdue = list.filter(n => n.type === 'defect_action_overdue')
  check('D-3 알림 발송(담당 수신)', due.some(n => n.recipient_id === userId), JSON.stringify(due))
  check('D-3 제목에 불량 2건(완료건 제외)', due.some(n => n.title.includes('2건')), due[0]?.title)
  check('D-3 메시지에 불량명', due.some(n => n.message.includes('소화기 압력 미달')))
  check('기한경과 알림(과태료 문구)', overdue.some(n => n.message.includes('과태료')), JSON.stringify(overdue))

  // 멱등 — 같은 날 재발화 시 추가 발송 없음
  const before = list.length
  const res2 = await fire()
  check('재발화 ok', res2.ok === true)
  const { data: notis2 } = await raw.from('notifications').select('id').eq('reference_id', inspId)
  check('재발화 멱등(추가 발송 없음)', (notis2 ?? []).length === before, `${before} → ${(notis2 ?? []).length}`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (inspId) await raw.from('notifications').delete().eq('reference_id', inspId)
  for (const id of defectIds) await raw.from('inspection_defects').delete().eq('id', id)
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
summary()
