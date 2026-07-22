// V-1 음성 점검표 입력 E2E — 전사 → AI 구조화 → 확정 → responses 반영 (실 Claude API 1회 호출)
// 실행: npx tsx scripts/test-voice-sheet.mts <inspectionId>
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const inspectionId = process.argv[2]
if (!inspectionId) { console.log('사용법: npx tsx scripts/test-voice-sheet.mts <inspectionId>'); process.exit(1) }

const EMAIL = 'voice-sheet-e2e@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '음성E2E', employeeId: 'E2E-VOICE' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000) // AI 호출 대기
  await login(page, EMAIL)

  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('text=음성 점검표 입력 (V-1)')
  check('섹션 렌더', true)

  await page.fill('textarea[placeholder*="발화 규칙"]', '소화기 전부 양호')
  await page.click('button:has-text("AI 구조화")')
  await page.waitForSelector('button:has-text("확정 저장")', { timeout: 120000 })
  check('AI 구조화 — 제안 목록 표시', true)
  const proposals = await page.locator('input[type="checkbox"]').count()
  check('제안 항목 존재(소화기 시트 일괄 O)', proposals > 0, `${proposals}건`)

  await page.click('button:has-text("확정 저장")')
  await page.waitForSelector('text=점검표에 반영됐습니다')
  check('확정 저장 완료', true)

  // DB 반영 — 테스트 유저가 upsert한 응답 (전부 O)
  const { data: saved } = await raw.from('inspection_sheet_responses')
    .select('item_code, result').eq('inspection_id', inspectionId).eq('updated_by', userId)
  const rows = (saved ?? []) as Array<{ item_code: string; result: string }>
  check('DB responses 반영 (전부 O)', rows.length > 0 && rows.every(r => r.result === 'O'), `${rows.length}건`)

  // 전사 원문 로그
  const { data: logs } = await raw.from('activity_logs')
    .select('id, metadata').eq('action', 'voice_sheet_import').eq('entity_id', inspectionId).eq('actor_id', userId)
  const log = (logs ?? [])[0] as { id: string; metadata: { transcript?: string } } | undefined
  check('전사 원문 로그 기록', (log?.metadata?.transcript ?? '').includes('소화기 전부 양호'))

  // 정리 — 테스트 유저 생성분만 삭제
  await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspectionId).eq('updated_by', userId)
  if (log) await raw.from('activity_logs').delete().eq('id', log.id)
  console.log('  (테스트 응답·로그 정리 완료)')
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary()
