// 회사 메일 쓰기 E2E — 작성·첨부·실발송(자기 수신)·발송 이력·보낸편지함 탭·답장 프리필
// 실행: npx tsx scripts/test-mail-compose.mts   (로컬 dev + 스테이징 DB + gmail.send 토큰)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const EMAIL = 'mail-compose-e2e@erp-test.com'
const SELF = 'sjfirekorea@gmail.com'
const STAMP = Date.now()
const SUBJECT = `[E2E] 메일쓰기 검증 ${STAMP}`
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const tmpFile = join(tmpdir(), 'e2e-mail-att.txt')

try {
  userId = await mkUser({ email: EMAIL, name: '메일E2E', employeeId: 'E2E-MAIL' })
  writeFileSync(tmpFile, 'e2e attachment content')

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // 목록 — 탭·쓰기 버튼
  await page.goto(`${BASE}/mail`)
  await page.waitForSelector('text=회사 메일')
  check('받은/보낸 탭', await page.isVisible('a:has-text("보낸편지함")'))
  check('[메일 쓰기] 버튼', await page.isVisible('a:has-text("메일 쓰기")'))

  // 작성 → 발송 (자기 수신 — 외부 발송 없음)
  await page.click('a:has-text("메일 쓰기")')
  await page.waitForSelector('text=받는 사람')
  await page.fill('input[placeholder="example@domain.com"]', SELF)
  await page.locator('label:has-text("제목") + input, div:has(> label:has-text("제목")) input').first().fill(SUBJECT)
  await page.locator('textarea').first().fill('E2E 본문입니다.')
  await page.locator('input[type="file"]').setInputFiles(tmpFile)
  check('첨부 표시', await page.isVisible('text=e2e-mail-att.txt'))
  await page.click('button:has-text("발송")')
  await page.waitForSelector('text=발송 완료', { timeout: 30000 })
  check('발송 성공', true)

  // 발송 이력 (거버넌스)
  const { data: logs } = await raw.from('mail_send_logs')
    .select('sender_id, recipients, subject, message_id, attachment_count').eq('subject', SUBJECT)
  const log = (logs ?? [])[0] as { sender_id: string; recipients: string; message_id: string | null; attachment_count: number } | undefined
  check('mail_send_logs 기록', !!log, JSON.stringify(logs))
  check('작성 직원 기록', log?.sender_id === userId)
  check('message_id 증빙', !!log?.message_id)
  check('첨부 수 기록', log?.attachment_count === 1)

  // 보낸편지함 탭에 노출 (발송 직후 자동 이동됨 — 제목 확인, 전파 지연 대비 재시도)
  let seen = false
  for (let i = 0; i < 6 && !seen; i++) {
    await page.goto(`${BASE}/mail?box=sent`)
    await page.waitForSelector('text=회사 메일')
    seen = await page.isVisible(`text=[E2E] 메일쓰기 검증 ${STAMP}`)
    if (!seen) await page.waitForTimeout(3000)
  }
  check('보낸편지함 탭에 표시', seen)

  // 답장 프리필 — 보낸 메일 상세 → [답장] → Re: 제목·수신자 프리필
  if (seen) {
    await page.click(`text=[E2E] 메일쓰기 검증 ${STAMP}`)
    await page.waitForSelector('a:has-text("답장")')
    check('상세 — 답장·전달 버튼', await page.isVisible('a:has-text("전달")'))
    await page.click('a:has-text("답장")')
    await page.waitForSelector('text=받는 사람')
    const subj = await page.locator('div:has(> label:has-text("제목")) input').first().inputValue()
    check('답장 제목 Re: 프리필', subj === `Re: ${SUBJECT}`, subj)
    const to = await page.locator('input[placeholder="example@domain.com"]').inputValue()
    check('답장 수신자 프리필', to.includes('sjfirekorea'), to)
    check('원본 인용 포함', (await page.locator('textarea').first().inputValue()).includes('원본 메일'))
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  try { unlinkSync(tmpFile) } catch { /* ignore */ }
  await raw.from('mail_send_logs').delete().eq('subject', SUBJECT)
  if (userId) await delUser(userId)
}
summary()
