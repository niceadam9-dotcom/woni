// 점검달력 「마지막 주가 화면 밖」 실측 (2026-09-23) — 달력 위 띠들이 세로를 얼마나 먹는가
import { BASE, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
const S = Date.now().toString(36); const EMAIL = `fold-${S}@test.local`
let uid = '', b = null
try {
  uid = await mkUser({ email: EMAIL, name: '접힘측정', employeeId: `E2E-FOLD-${S}` })
  const l = await launch(); b = l.browser; const { page } = l; page.setDefaultTimeout(120000)
  await login(page, EMAIL)
  for (const [w, h] of [[1920, 937], [1536, 730], [1366, 625]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(`${BASE}/inspections/calendar`)
    await page.waitForSelector('.rbc-month-view')
    await page.waitForTimeout(1500)
    const r = await page.evaluate(() => {
      const main = document.querySelector('main')
      const mv = document.querySelector('.rbc-month-view').getBoundingClientRect()
      const rows = [...document.querySelectorAll('.rbc-month-row')].map(e => { const x = e.getBoundingClientRect(); return [Math.round(x.top), Math.round(x.bottom)] })
      // 달력 위에 쌓인 덩이들 — main의 직계 자손부터 월 격자 조상까지
      const blocks = []
      let el = document.querySelector('.rbc-month-view')
      while (el && el !== main) {
        let sib = el.previousElementSibling
        while (sib) { const x = sib.getBoundingClientRect(); if (x.height > 0) blocks.push(`${(sib.getAttribute('data-testid') || sib.className || sib.tagName).toString().slice(0, 50)}=${Math.round(x.height)}`); sib = sib.previousElementSibling }
        el = el.parentElement
      }
      const labels = [...document.querySelectorAll('.rbc-date-cell')].map(e => e.textContent.trim())
      return { vh: innerHeight, mvTop: Math.round(mv.top), mvBottom: Math.round(mv.bottom), rows, blocks, lastLabel: labels.at(-1), scroll: main.scrollHeight - main.clientHeight, fs: getComputedStyle(document.documentElement).getPropertyValue('--fs-scale') }
    })
    const hidden = r.rows.filter(([t, bt]) => bt > r.vh).length
    const chip = await page.$('[data-testid="cal-orphan-chip"]'); const nav = await page.$('[data-testid="cal-nav"]')
    console.log(`  퇴사 칩 ${!!chip} · 탐색 줄 ${!!nav}`)
    console.log(`\n${w}x${h}  vh=${r.vh} fs=${r.fs.trim()}  격자 ${r.mvTop}→${r.mvBottom}  주 ${r.rows.length}개 중 화면 밖(아래 끝이 넘침) ${hidden}  페이지 스크롤 ${r.scroll}px`)
    console.log('  주별 위·아래', JSON.stringify(r.rows))
    console.log('  위 덩이', r.blocks.join(' | '))
    await page.screenshot({ path: `scripts/_shots/fold-${w}.png` })
    // 6주짜리 달(2026-08: 토요일 시작) — 이전 달로 한 번
    await page.click('[data-testid="cal-nav"] button[title="이전"]')
    await page.waitForTimeout(1200)
    const r6 = await page.evaluate(() => { const rows=[...document.querySelectorAll('.rbc-month-row')].map(e=>Math.round(e.getBoundingClientRect().bottom)); return { n: rows.length, last: rows.at(-1), vh: innerHeight, scroll: document.querySelector('main').scrollHeight - document.querySelector('main').clientHeight, label: document.querySelector('[data-testid="cal-nav"]')?.textContent } })
    console.log(`  이전 달: 주 ${r6.n}개 · 마지막 주 아래끝 ${r6.last} / vh ${r6.vh} · 스크롤 ${r6.scroll}px · ${(r6.label||'').replace(/s+/g,' ').slice(0,60)}`)
    await page.screenshot({ path: `scripts/_shots/fold-${w}-6wk.png` })
  }
} finally { await b?.close(); if (uid) await delUser(uid) }
