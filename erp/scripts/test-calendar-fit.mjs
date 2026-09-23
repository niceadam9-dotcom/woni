// 점검달력 「한눈에」 — 마지막 주가 화면 안에 들어오는가 (2026-09-23 사용자: 「28일 조회가 안 된다」)
// 실행: node scripts/test-calendar-fit.mjs   (dev 서버 localhost:3000 필요)
//
// 🎯 종전 결함: 달력 높이가 `calc(100vh - 190px)` 고정식이었는데 실제 시작점은 259px(1920×937)이라
//   마지막 주가 22px 잘리고 페이지가 80px 스크롤됐다(1366×625에서는 5주 중 3주가 화면 밖).
//   이제 달력이 **남은 높이를 채운다**. 이 검사는 그 결과를 **잰다** — 모양(클래스)이 아니라 픽셀로.
// 🚨 급소: 5주 달만 재면 6주 달(2026-08)의 마지막 주가 넘쳐도 초록이다 → 두 달을 다 잰다.
//   탐색 줄을 rbc 밖으로 꺼냈으므로 이동 규칙(월·주·목록 걸음)도 여기서 묻는다.
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const S = Date.now().toString(36); const EMAIL = `fit-${S}@test.local`
let uid = '', b = null
const navText = page => page.textContent('[data-testid="cal-nav"]').then(t => (t ?? '').replace(/\s+/g, ' '))
const measure = page => page.evaluate(() => {
  const main = document.querySelector('main')
  const rows = [...document.querySelectorAll('.rbc-month-row')].map(e => Math.round(e.getBoundingClientRect().bottom))
  return { n: rows.length, last: rows.at(-1) ?? 0, vh: innerHeight, scroll: main.scrollHeight - main.clientHeight }
})
try {
  uid = await mkUser({ email: EMAIL, name: '한눈검사', employeeId: `E2E-FIT-${S}` })
  const l = await launch(); b = l.browser; const { page } = l; page.setDefaultTimeout(120000)
  await login(page, EMAIL)

  for (const [w, h] of [[1920, 937], [1536, 730], [1366, 625]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(`${BASE}/inspections/calendar`)
    await page.waitForSelector('.rbc-month-view')
    await page.waitForFunction(() => document.querySelectorAll('.rbc-month-row').length >= 4)
    const m5 = await measure(page)
    check(`${w}×${h} 이번 달(${m5.n}주) 마지막 주가 화면 안`, m5.last <= m5.vh, `${m5.last} > ${m5.vh}`)
    check(`${w}×${h} 페이지 스크롤 없음`, m5.scroll <= 1, `${m5.scroll}px`)
    // 6주 달을 찾아간다(최대 12달) — 2026-08이 6주다
    let m6 = null
    for (let i = 0; i < 12 && !m6; i++) {
      await page.click('[data-testid="cal-nav"] button[title="이전"]')
      await page.waitForTimeout(400)
      const m = await measure(page)
      if (m.n === 6) m6 = m
    }
    check(`${w}×${h} 6주 달을 찾았다`, !!m6)
    if (m6) {
      check(`★ ${w}×${h} 6주 달도 마지막 주가 화면 안`, m6.last <= m6.vh, `${m6.last} > ${m6.vh}`)
      check(`${w}×${h} 6주 달 스크롤 없음`, m6.scroll <= 1, `${m6.scroll}px`)
    }
  }

  // ── 탐색 — rbc 툴바를 끄고 직접 그리므로 걸음을 직접 확인한다 ──
  await page.setViewportSize({ width: 1920, height: 937 })
  await page.goto(`${BASE}/inspections/calendar`)
  await page.waitForSelector('[data-testid="cal-nav"]')
  const now = new Date(Date.now() + 9 * 3600_000)
  const ym = (y, m) => `${y}년 ${m}월`
  const y0 = now.getUTCFullYear(), mo0 = now.getUTCMonth() + 1
  check('처음엔 이번 달', (await navText(page)).includes(ym(y0, mo0)), await navText(page))
  await page.click('[data-testid="cal-nav"] button[title="다음"]')
  const nY = mo0 === 12 ? y0 + 1 : y0, nM = mo0 === 12 ? 1 : mo0 + 1
  check('★ 다음 = 한 달 뒤', (await navText(page)).includes(ym(nY, nM)), await navText(page))
  await page.click('[data-testid="cal-nav"] button:has-text("오늘")')
  check('★ 오늘 = 이번 달로', (await navText(page)).includes(ym(y0, mo0)), await navText(page))
  await page.click('[data-testid="cal-nav"] button:has-text("주")')
  const wk1 = await navText(page)
  check('주 보기 = 「M월 d일 – M월 d일」', /\d+월 \d+일 – \d+월 \d+일/.test(wk1), wk1)
  await page.click('[data-testid="cal-nav"] button[title="다음"]')
  check('★ 주 보기 다음 = 라벨이 바뀐다(7일 걸음)', (await navText(page)) !== wk1, await navText(page))
  const wkGrid = await page.$('.grid.grid-cols-7')
  const wb = wkGrid && await wkGrid.boundingBox()
  check('★ 주 보기 카드도 화면 안', !!wb && wb.y + wb.height <= 937, JSON.stringify(wb))
  await page.click('[data-testid="cal-nav"] button:has-text("목록")')
  check('목록 보기로 전환', !!(await page.waitForSelector('.rbc-agenda-view', { timeout: 30000 }).catch(() => null)))
  check('★ rbc 자체 툴바는 안 그린다(탐색 줄이 두 벌이 아니다)', !(await page.$('.rbc-toolbar')))

  // ── 퇴사 담당: 띠 → 칩 ──
  await page.click('[data-testid="cal-nav"] button:has-text("월")')
  const chip = await page.$('[data-testid="cal-orphan-chip"]')
  if (chip) {
    check('퇴사 칩이 재배정 창구(고객 관리)로 간다', (await chip.getAttribute('href')) === '/customers')
    check('칩 title에 전문이 남는다', /담당자 재배정이 필요합니다/.test((await chip.getAttribute('title')) ?? ''))
  } else console.log('  (퇴사 담당 일정이 0건이라 칩 단언 생략)')
  check('★ 퇴사 띠가 사라졌다', !(await page.$('text=달력에는 계속 표시되며')))
} catch (e) {
  check('예외 없이 끝났다', false, e instanceof Error ? e.stack : String(e))
} finally {
  await b?.close(); if (uid) await delUser(uid)
  summary()
}
