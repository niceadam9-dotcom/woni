/** ④ 「별지 9·10호 생성·제출」 칸 — 2026-09-11 사용자 3건 지적의 실측 프로브.
 *
 *  ① [엑셀로 받기]가 [제출 패키지] **옆**에 있는가 (생성물 목록 머리가 아니라)
 *  ② 총 이행기간이 드롭다운이 아니라 **라디오**인가 — 두 법정 갈래가 펼치지 않고 보이는가
 *  ③ 「조회가 너무 느리다」 — 서버 액션 **재조회 폭풍**이 멎었는가
 *
 *  ③의 판정은 개수가 아니라 **증가분**이다: 칸이 다 뜬 뒤(=로드 끝) 부모를 다시 그리게 만드는
 *  행위(제출일 타이핑·칩 전환)를 하고, 그때 getAnnex* 액션이 **더 나가는지**를 센다.
 *  종전에는 `only={[...]}`가 렌더마다 새 배열이라 로드 effect가 매번 재발화했다.
 *
 *  ⚠ 서버 액션은 전부 같은 URL로 POST된다(Next RSC 규약) — 어느 액션인지는 요청 본문의
 *    액션 id로 갈리므로 본문에 함께 실리는 인자(점검 id·annexNo)를 보고 센다.
 */
import { chromium } from 'playwright'
import { raw, BASE, check, summary, mkUser, delUser, PW } from './_e2e-helpers.mjs'

const EMAIL = 'wb4perf-probe@erp-test.com'

/* 🚨 **불량이 있는** 자체점검 회차여야 한다 — 소방계획서_48 이후 불량 0이면 ④⑤⑥이 아예
   그려지지 않아 `?step=4`가 조용히 ①로 떨어진다(첫 실행에서 실제로 그렇게 헛돌았다).
   표본이 없으면 초록으로 끝내지 말고 **소리를 내고 죽는다**(공허 통과 금지). */
const { data: defRows } = await raw.from('inspection_defects').select('inspection_id').limit(1000)
const withDefects = [...new Set((defRows ?? []).map(r => r.inspection_id))]
const { data: insp } = await raw.from('inspections')
  .select('id, customer_id, plan_type').in('id', withDefects).like('plan_type', 'special%')
  .order('created_at', { ascending: false }).limit(1).maybeSingle()
if (!insp) { console.error('❌ 불량이 있는 자체점검 회차가 없어 ④가 렌더되지 않는다 — 공허 통과시키지 않는다'); process.exit(1) }
console.log(`  [표본] inspection ${insp.id} (${insp.plan_type})`)

let uid = null
const browser = await chromium.launch()
try {
  uid = await mkUser({ email: EMAIL, name: '작업대프로브', employeeId: 'WB4-PROBE' })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(20000)

  /** 서버 액션 POST 카운터 — annexNo가 실린 것만 센다(고유값 로드/저장 축) */
  let annexPosts = 0
  const seen = []
  page.on('request', r => {
    if (r.method() !== 'POST') return
    const body = r.postData() ?? ''
    if (!body.includes(insp.id)) return
    if (/report9|report10|report11/.test(body)) { annexPosts++; seen.push(body.slice(0, 120)) }
  })

  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

  // ── 서버 렌더 시간 ──
  const t0 = Date.now()
  await page.goto(`${BASE}/inspections/${insp.id}?step=4`, { waitUntil: 'commit' })
  await page.waitForSelector('[data-testid="workbench-stepbar"]', { timeout: 60000 })
  const serverMs = Date.now() - t0
  const panel = page.locator('[data-annex-fields="report10"]')
  await panel.locator('input[aria-label="제출일"]').waitFor({ timeout: 60000 })
  const readyMs = Date.now() - t0
  console.log(`  [실측] 스텝바 ${serverMs}ms · ④ 고유값 칸 ${readyMs}ms`)

  // ── ① 엑셀 버튼 자리 ──
  const pkgBtn = page.locator('button:has-text("제출 패키지")').first()
  const xlsBtn = page.locator('[data-testid="workbook-xlsx"]').first()
  await pkgBtn.waitFor()
  check('[엑셀로 받기]가 화면에 있다', (await xlsBtn.count()) >= 1)
  const sameRow = await page.evaluate(() => {
    const pkg = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('제출 패키지'))
    const xls = document.querySelector('[data-testid="workbook-xlsx"]')
    if (!pkg || !xls) return null
    return { sibling: pkg.parentElement === xls.parentElement, next: pkg.nextElementSibling === xls,
      inTakeRow: !!xls.closest('[data-testid="annex-take-row"]'),
      py: pkg.getBoundingClientRect().y, xy: xls.getBoundingClientRect().y,
      px: pkg.getBoundingClientRect().x, xx: xls.getBoundingClientRect().x }
  })
  console.log(`  [실측] 자리 ${JSON.stringify(sameRow)}`)
  check('[엑셀로 받기]가 [제출 패키지]의 **바로 다음 형제**다', !!sameRow?.sibling && !!sameRow?.next)
  // 🎯 지적의 핵심은 '형제'가 아니라 **눈에 옆**이다 — 칩 줄에 끼웠을 땐 형제인데도 다음 줄로 접혔다
  check('두 버튼이 같은 줄·엑셀이 오른쪽', !!sameRow && Math.abs(sameRow.py - sameRow.xy) < 6 && sameRow.px < sameRow.xx,
    JSON.stringify(sameRow))
  // 음성 대조 — 창구가 둘이 되지 않았는가(종전 자리인 생성물 목록 안에는 없어야 한다)
  check('④에 [엑셀로 받기]는 하나뿐', (await page.locator('[data-testid="workbook-xlsx"]').count()) === 1)
  check('생성물 목록 안에는 없다 — 받기 줄에 있다', !!sameRow?.inTakeRow
    && (await page.locator('[data-testid="annex-take-row"] [data-testid="workbook-xlsx"]').count()) === 1)

  // ── ② 라디오 ──
  const group = panel.locator('[data-testid="legal-period-select"]')
  check('총 이행기간 묶음이 하나 있다', (await group.count()) === 1)
  check('그 묶음은 select가 아니다', (await group.evaluate(el => el.tagName)) !== 'SELECT'
    && (await group.locator('select').count()) === 0)
  check('라디오 3갈래(직접 입력·10일·20일)',
    (await group.locator('input[type=radio]').count()) === 3
    && (await panel.locator('[data-testid="legal-period-opt-10"]').count()) === 1
    && (await panel.locator('[data-testid="legal-period-opt-20"]').count()) === 1
    && (await panel.locator('[data-testid="legal-period-opt-manual"]').count()) === 1)
  check('펼치지 않아도 두 법정 갈래 글자가 보인다',
    await panel.getByText('10일 수리·정비').isVisible() && await panel.getByText('20일 철거·교체').isVisible())
  const checkedCount = await group.locator('input[type=radio]:checked').count()
  check('항상 정확히 하나만 선택 상태', checkedCount === 1, `checked=${checkedCount}`)

  // ── ③ 재조회 폭풍 ──
  await page.waitForTimeout(2500)          // 마운트 직후 왕복이 끝나기를 기다린다
  const baseline = annexPosts
  console.log(`  [실측] 마운트까지 별지 서버액션 ${baseline}회`)

  // 부모를 여러 번 다시 그리게 한다 — 소방서 제출일 타이핑(setSubDate9)이 가장 잦은 경로다.
  // ⚠ DateInput의 보이는 칸은 `type=text`다(type=date는 달력 팝업 전용 히든 입력) — 첫 시도에서
  //   히든 쪽을 잡아 20초를 헛돌았다. 라벨 줄을 기준으로 잡는다.
  const subRow = page.locator('div:has(> span:text-is("소방서 제출일"))').first()
  const subDate = subRow.locator('input[placeholder="YYYY-MM-DD"]').first()
  await subDate.click()
  await subDate.press('Control+a')
  for (const ch of ['2', '0', '2', '6', '0', '9', '1', '1']) {
    await subDate.press(`Digit${ch}`)
    await page.waitForTimeout(150)
  }
  console.log(`  [실측] 타이핑 후 제출일 칸 = "${await subDate.inputValue()}"`)
  await page.waitForTimeout(2500)
  const afterTyping = annexPosts - baseline
  console.log(`  [실측] 타이핑 8회 중 추가 별지 서버액션 ${afterTyping}회`)
  check('제출일을 타이핑해도 고유값을 다시 조회하지 않는다', afterTyping === 0,
    `추가 ${afterTyping}회 — ${seen.slice(baseline).join(' | ').slice(0, 300)}`)

  // 칩 전환(setDocSel)도 부모 렌더다 — ④ report10 칸은 그대로여야 한다
  const before2 = annexPosts
  await page.locator('[data-doc-chip="report4"]').click().catch(() => {})
  await page.waitForTimeout(2000)
  const afterChip = annexPosts - before2
  console.log(`  [실측] 칩 전환 후 추가 별지 서버액션 ${afterChip}회`)
  check('칩을 바꿔도 ④ 10호 칸이 재조회되지 않는다', afterChip <= 1, `추가 ${afterChip}회`)

  await page.locator('[data-annex-fields="report10"]').screenshot({ path: 'scripts/_shot-wb4-annex10.png' }).catch(() => {})
  await page.screenshot({ path: 'scripts/_shot-wb4-full.png' })
  console.log('  [산출] scripts/_shot-wb4-annex10.png · _shot-wb4-full.png')
} finally {
  await browser.close()
  await delUser(uid)
}
summary()
