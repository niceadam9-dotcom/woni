// 별지 9호 준비 섹션 UI 스모크 — 점검 상세 (P3 §9-6⑦)
// 실행: npx tsx scripts/test-report9-ui.mts <inspectionId>  (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const inspectionId = process.argv[2]
if (!inspectionId) { console.log('사용법: npx tsx scripts/test-report9-ui.mts <inspectionId>'); process.exit(1) }

const EMAIL = 'report9-ui-e2e@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '별지9E2E', employeeId: 'E2E-R9' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('text=실시결과 보고서 (별지 9호)')
  check('섹션 렌더', true)
  check('① 대상물 공통정보 행', await page.isVisible('text=① 대상물 공통정보'))
  check('② 점검 인력 행', await page.isVisible('text=② 점검 인력'))
  check('③ 점검표 응답 행', await page.isVisible('text=③ 점검표 응답'))
  check('④ 송달 동의 행', await page.isVisible('text=④ 송달 동의'))
  check('점검표 롤업 표기', await page.isVisible('text=3쪽 양호/불량 자동 롤업'))
  check('생성 버튼', await page.isVisible('button:has-text("보고서 생성")'))
  check('생성물 목록(report9_*.hwp)', await page.isVisible('text=report9_'))
  check('다운로드 버튼', await page.isVisible('button:has-text("받기")'))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary()
