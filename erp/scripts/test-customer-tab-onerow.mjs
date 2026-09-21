// 고객 상세 탭 바가 두 줄로 접히는지 실측한다 (2026-09-21)
// 재는 것: ① 탭 9개의 자연 폭(줄바꿈 없이 필요한 폭) ② 지금 tablist가 쓰는 폭 ③ 실제 줄 수
// 뱃지 길이가 고객마다 달라(공통 4종 / 소방계획서 8/12 / 이력 09-18) 자연 폭이 흔들리므로
// 최근 갱신 고객 여럿을 돌아 **최댓값**으로 판정한다.
import { raw, mkUser, delUser, login, BASE, PW } from './_e2e-helpers.mjs'
import { chromium } from 'playwright'

const EMAIL = 'e2e-tabwidth@test.local'
const VIEWPORTS = [1280, 1440, 1920]

const { data: custs } = await raw.from('customers')
  .select('id, customer_name').eq('is_active', true)
  .order('updated_at', { ascending: false }).limit(5)

const uid = await mkUser({ email: EMAIL, name: '탭폭실측', employeeId: 'E2E-TABW', role: 'admin' })
const browser = await chromium.launch()
let worst = { natural: 0 }, rowsBad = 0
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } })
  page.setDefaultTimeout(120000)   // dev 첫 컴파일이 느리다(수정 직후 재컴파일)
  await login(page, EMAIL, PW)

  for (const c of custs) {
    await page.goto(`${BASE}/customers/${c.id}?tab=info`)
    await page.waitForSelector('[role=tablist] [role=tab]')
    for (const w of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: 950 })
      await page.waitForTimeout(200)
      const m = await page.evaluate(() => {
        const tl = document.querySelector('[role=tablist]')
        const tabs = [...tl.querySelectorAll('[role=tab]')]
        const gap = parseFloat(getComputedStyle(tl).columnGap) || 0
        // 자연 폭 = 줄바꿈이 없다고 가정한 필요 폭(뷰포트 독립)
        const natural = tabs.reduce((s, t) => s + t.getBoundingClientRect().width, 0) + gap * (tabs.length - 1)
        return {
          natural: Math.round(natural),
          tablist: Math.round(tl.clientWidth),
          rows: new Set(tabs.map(t => Math.round(t.offsetTop))).size,
          labels: tabs.map(t => t.textContent.trim()).join(' | '),
        }
      })
      if (m.natural > worst.natural) worst = { ...m, vw: w, cust: c.customer_name }
      if (m.rows > 1) rowsBad++
      console.log(`${c.customer_name.slice(0, 12).padEnd(12)} vw=${w}  줄수=${m.rows}  자연폭=${m.natural}  tablist폭=${m.tablist}  여유=${m.tablist - m.natural}`)
    }
  }
} finally {
  await browser.close()
  await delUser(uid)
}
console.log(`\n최대 자연폭 ${worst.natural}px (${worst.cust}, vw=${worst.vw}) — ${worst.labels}`)
console.log(rowsBad === 0 ? '✅ 전 표본·전 뷰포트 한 줄' : `❌ 두 줄인 경우 ${rowsBad}건`)
process.exit(rowsBad === 0 ? 0 : 1)
