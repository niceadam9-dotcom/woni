// 세금계산서 발행 — 인쇄/PDF 저장 시 전자세금계산서 양식만 남는지 검증
// 실행: npx tsx scripts/_probe-tax-invoice-print.mts   (dev 3000 필요)
// 인쇄 미디어를 에뮬레이트해 실제 인쇄 결과와 같은 상태에서 판정한다(창을 띄우지 않는다).
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'taxinv-print@sjfire.test'
let userId = ''

const run = async () => {
  const { data: bills } = await raw.from('bills').select('id, customer_id').limit(1)
  const bill = (bills ?? [])[0] as { id: string } | undefined
  if (!bill) throw new Error('청구(bills) 데이터가 없습니다.')
  console.log(`대상 청구 ${bill.id}`)

  userId = await mkUser({ email: EMAIL, name: '세금인쇄', employeeId: 'TXP-001', role: 'admin' })
  const { browser, page } = await launch()
  try {
    await login(page, EMAIL)
    await page.goto(`${BASE}/tax-invoices/issue?billId=${bill.id}`)
    await page.waitForLoadState('networkidle')

    const form = page.locator('#tax-invoice-form')
    const sidebar = page.locator('aside').first()
    const header = page.locator('header').first()
    const issuePane = page.getByRole('heading', { name: '발행 처리' })
    const printBtn = page.getByRole('button', { name: /인쇄 \/ PDF 저장/ })

    // ── 화면(screen)에서는 전부 보인다 ──
    check('화면 — 세금계산서 양식 표시', await form.isVisible(), '')
    check('화면 — 사이드바 표시', await sidebar.isVisible(), '')
    check('화면 — 헤더 표시', await header.isVisible(), '')
    check('화면 — 발행 처리 폼 표시', await issuePane.isVisible(), '')
    check('화면 — [인쇄 / PDF 저장] 버튼 표시', await printBtn.isVisible(), '')

    // ── 인쇄(print)에서는 양식만 남아야 한다 ──
    await page.emulateMedia({ media: 'print' })
    check('인쇄 — 세금계산서 양식 남음', await form.isVisible(), '')
    check('인쇄 — 사이드바 제외', !(await sidebar.isVisible()), '사이드바가 인쇄에 포함됨')
    check('인쇄 — 헤더 제외', !(await header.isVisible()), '헤더가 인쇄에 포함됨')
    check('인쇄 — 발행 처리 폼 제외', !(await issuePane.isVisible()), '발행 처리 폼이 인쇄에 포함됨')
    check('인쇄 — 버튼 줄 제외', !(await printBtn.isVisible()), '버튼이 인쇄에 포함됨')

    // 제목이 실제 전자세금계산서인지
    const title = await form.locator('h1').first().innerText()
    check('인쇄 대상이 전자세금계산서', title.replace(/\s/g, '').includes('전자세금계산서'), title)

    // 스크롤 컨테이너 때문에 뒷장이 잘리지 않는가 — 인쇄에서 본문 높이가 뷰포트를 넘어도 살아야 한다
    const cut = await page.evaluate(() => {
      const main = document.querySelector('main')
      if (!main) return { ok: false, why: 'main 없음' }
      const cs = getComputedStyle(main)
      return { ok: cs.overflowY === 'visible', why: `main overflow-y=${cs.overflowY}` }
    })
    check('인쇄 — 본문 스크롤 제약 해제(뒷장 잘림 방지)', cut.ok, cut.why)

    const rootCut = await page.evaluate(() => {
      const root = document.querySelector('main')?.closest('div.flex, div.print\\:block')?.parentElement
      const cs = root ? getComputedStyle(root) : null
      return { ok: !cs || cs.overflow === 'visible' || cs.overflowY === 'visible', why: `root overflow=${cs?.overflow ?? '-'}` }
    })
    check('인쇄 — 최상위 컨테이너 스크롤 제약 해제', rootCut.ok, rootCut.why)

    await page.emulateMedia({ media: 'screen' })
  } finally {
    await browser.close()
    await delUser(userId)
  }
  summary()
}

run().catch(e => { console.error(e); process.exit(1) })
