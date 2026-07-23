// 9-9d E2E — 관계인 보고 이메일 실발송 (gmail.send, 수신 = 공용계정 자기 자신)
// 실행: npx tsx scripts/test-owner-send.mts   (로컬 dev + 스테이징 DB + gmail.send 토큰)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'owner-send-e2e@erp-test.com'
const SAFE_RECIPIENT = 'sjfirekorea@gmail.com' // 발신 계정 자신에게 — 외부 발송 없음
let userId = ''
let custId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '발송E2E', employeeId: 'E2E-SND' })
  custId = await mkCustomer({
    customer_name: '발송E2E고객', created_by: userId,
    email_delivery_consent: true, report_email: SAFE_RECIPIENT,
  })
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: '2026-07-20', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = insp!.id
  // 발송 대상 별지 9호 생성물(더미 PDF)
  const { error: upErr } = await raw.storage.from('fire-plans')
    .upload(`${custId}/inspections/${inspId}/report9_1700000000000.pdf`, Buffer.from('%PDF-1.4 e2e report9'), { contentType: 'application/pdf' })
  if (upErr) throw new Error(`더미 업로드 실패: ${upErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/inspections/${inspId}`)
  await page.waitForSelector('text=③ 관계인 보고')
  check('타임라인 ③ 표시', true)
  const sendBtn = page.locator('button:has-text("생성물 이메일 발송")')
  check('발송 버튼 활성(동의+이메일 보유)', !(await sendBtn.isDisabled()))
  await sendBtn.click()
  await page.waitForSelector('text=관계인 보고 발송됨', { timeout: 30000 })
  check('발송 성공 메시지', true)

  const { data: deliveries } = await raw.from('report_deliveries')
    .select('recipient_email, message_id, subject, file_name').eq('inspection_id', inspId)
  const d = (deliveries ?? [])[0] as { recipient_email: string; message_id: string | null; subject: string; file_name: string } | undefined
  check('발송 이력 기록', !!d, JSON.stringify(deliveries))
  check('수신자 = 송달 이메일', d?.recipient_email === SAFE_RECIPIENT)
  check('Gmail message_id 증빙', !!d?.message_id, d?.message_id ?? '')
  check('첨부 파일명 기록', (d?.file_name ?? '').includes('자체점검결과보고서'))

  // 재진입 — ③ 완료 표시(발송됨)
  await page.goto(`${BASE}/inspections/${inspId}`)
  await page.waitForSelector(`text=발송됨 → ${SAFE_RECIPIENT}`)
  check('③ 발송 이력 표시(재발송 버튼 전환)', await page.isVisible('button:has-text("재발송")'))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('report_deliveries').delete().eq('inspection_id', inspId)
    await raw.from('inspection_reports').delete().eq('inspection_id', inspId)
    const { data: files } = await raw.storage.from('fire-plans').list(`${custId}/inspections/${inspId}`)
    const paths = ((files ?? []) as Array<{ name: string }>).map(o => `${custId}/inspections/${inspId}/${o.name}`)
    if (paths.length) await raw.storage.from('fire-plans').remove(paths)
  }
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
summary()
