// 달력 사이드바 「문서」 한 덩이 + 소방계획서 입력 왕복 (2026-09-23 사용자 요청, erp_goal/image-12)
// 실행: node scripts/test-calendar-docs-panel.mjs   (dev 서버 localhost:3000 필요)
//
// 사용자: 「엑셀 받기 삭제 · 소방계획서 엑셀과 입력을 쉽게 · 산만하게 분산하지 말고 정렬」
//        「소방계획서 입력 후 달력으로 복귀도 편리하고 쉽게」
// 🚨 급소: ① 이름 없는 [엑셀 받기]가 사라지고 **같은 기능이 이름을 달고** 남았는가(지운 게 아니다)
//         ② 보고서·소방계획서가 **같은 열**에 줄 맞춰 섰는가(왼쪽 x가 같다 — 모양이 아니라 픽셀)
//         ③ [소방계획서 입력] → 탭 → 「점검달력으로 돌아가기」 → **같은 사이드바**가 다시 열리는가
import { BASE, raw, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const S = Date.now().toString(36); const EMAIL = `docs-${S}@test.local`
let uid = '', b = null
try {
  const { data: cust } = await raw.from('customers').select('id').eq('customer_name', '운주빌딩').maybeSingle()
  const { data: insps } = await raw.from('inspections').select('id, plan_type').eq('customer_id', cust.id)
  const insp = (insps ?? []).find(i => String(i.plan_type ?? '').startsWith('special'))
  check('표본: 운주빌딩 자체점검 회차', !!insp)

  uid = await mkUser({ email: EMAIL, name: '문서칸검사', employeeId: `E2E-DOCS-${S}` })
  const l = await launch(); b = l.browser; const { page } = l; page.setDefaultTimeout(120000)
  await page.setViewportSize({ width: 1920, height: 937 })
  await login(page, EMAIL)

  const cal = `/inspections/calendar?insp=${insp.id}`
  await page.goto(`${BASE}${cal}`)
  const docs = await page.waitForSelector('[data-testid="daypanel-docs"]')
  const txt = (await docs.textContent()) ?? ''
  check('★ ① 이름 없는 「엑셀 받기」가 없다', !/엑셀 받기/.test(txt), txt.slice(0, 200))
  check('★ ① 같은 기능이 「소방계획서 엑셀」로 남았다', await page.isVisible('[data-testid="daypanel-fireplan"] >> text=소방계획서 엑셀'))
  check('보고서 엑셀도 그대로', await page.isVisible('[data-testid="daypanel-workbook"] >> text=보고서 엑셀'))
  check('소방계획서 입력 버튼', await page.isVisible('[data-testid="daypanel-fireplan-input"]'))

  // ② **같은 틀** — 2026-09-23 image-14 「동일한 패턴으로 — 왜 이리 산만해」. 모양이 아니라 픽셀로 잰다:
  //   두 칸의 엑셀 버튼이 같은 x·같은 폭, 입력 버튼이 같은 x, 칸마다 두 버튼이 한 줄, 제목이 한 줄.
  //   🚨 종전 판은 **기본 배율에서만** 쟀다 → 사용자 화면(큰 배율)에서 「소방계획 / 서」로 꺾인 걸 놓쳤다.
  //   그래서 배율 네 단계(기본·lg·xl·xxl) 전부에서 잰다.
  for (const fs of ['', 'lg', 'xl', 'xxl']) {
    // 🚨 배율은 **DB·쿠키로** 건다 — html[data-fs]를 직접 바꾸면 FontScaleSync가 정본(DB) 값으로 되돌려
    //   큰 배율 검사가 기본 배율을 네 번 재고 초록이 된다(2026-09-23 실제로 그랬다 — 캡처가 잡았다).
    await raw.from('profiles').update({ form_font_scale: fs || 'md' }).eq('id', uid)
    await page.context().addCookies([{ name: 'erp-fs', value: fs || 'md', url: BASE }])
    await page.goto(`${BASE}${cal}`)
    await page.waitForSelector('[data-testid="daypanel-docs"]')
    await page.waitForTimeout(300)
    check(`계측기: [${fs || '기본'}] 배율이 실제로 걸렸다`, (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs-scale').trim())) === ({ '': '1', lg: '1.15', xl: '1.3', xxl: '1.45' }[fs]))
    // 2026-09-23 image-15 — 제목줄을 없앤 **두 줄** 틀: 줄마다 [문서 엑셀][입력]. 글씨가 한 줄인지는 버튼 높이로 묻는다
    const g = await page.evaluate(() => ['daypanel-workbook', 'daypanel-fireplan'].map(id => {
      const row = document.querySelector(`[data-testid="${id}"]`)
      const [xlEl, inEl] = [...row.children]
      const [xl, inp] = [xlEl, inEl].map(e => e.getBoundingClientRect())
      return { xlX: Math.round(xl.left), xlW: Math.round(xl.width), inX: Math.round(inp.left),
        sameRow: Math.abs(xl.top - inp.top) <= 2, xlH: Math.round(xl.height), inH: Math.round(inp.height),
        oneLine: xlEl.scrollHeight <= xlEl.clientHeight + 1 && inEl.scrollHeight <= inEl.clientHeight + 1 }
    }))
    const docs = await page.evaluate(() => { const d = document.querySelector('[data-testid="daypanel-docs"]'); return d.scrollWidth - d.clientWidth })
    const tag = fs || '기본'
    check(`★ ② [${tag}] 버튼 글씨가 꺾이지 않는다`, g.every(c => c.oneLine), JSON.stringify(g))
    check(`★ ② [${tag}] 엑셀 버튼 두 개가 같은 x·같은 폭`, g[0].xlX === g[1].xlX && Math.abs(g[0].xlW - g[1].xlW) <= 1, JSON.stringify(g))
    check(`★ ② [${tag}] 입력 버튼 두 개가 같은 x`, Math.abs(g[0].inX - g[1].inX) <= 1, JSON.stringify(g))
    check(`★ ② [${tag}] 칸마다 두 버튼이 한 줄·한 높이`, g.every(c => c.sameRow && Math.abs(c.xlH - c.inH) <= 1), JSON.stringify(g))
    check(`② [${tag}] 가로 넘침 없음`, docs <= 1, `${docs}px`)
    await page.screenshot({ path: `scripts/_shots/docs-panel-${tag}.png`, clip: { x: 1520, y: 560, width: 400, height: 377 } })
  }
  await raw.from('profiles').update({ form_font_scale: 'md' }).eq('id', uid)
  await page.context().addCookies([{ name: 'erp-fs', value: 'md', url: BASE }])
  await page.goto(`${BASE}${cal}`)
  await page.waitForSelector('[data-testid="daypanel-docs"]')
  check('★ 빈칸 칩 묶음이 없다(수만 — 칸 이름은 탭이 말한다)', !(await page.$('[data-testid^="daypanel-report-gap-"]')))
  const rin = await page.getAttribute('[data-testid="daypanel-report-input"]', 'href')
  check('★ 보고서 [입력하기] = 고객 탭 + 달력 복귀 주소', /^\/customers\/[^?]+\?tab=(info|buildings|contacts|facilities|reports)[^]*from=%2Finspections%2Fcalendar/.test(rin ?? ''), rin)
  check('하단 링크 이름 = 회차 탭(목적지대로)', (await page.textContent('[data-testid="daypanel-plan-link"]'))?.includes('회차 탭'))
  await page.screenshot({ path: 'scripts/_shots/docs-panel.png', clip: { x: 1520, y: 0, width: 400, height: 937 } })

  // ③ 입력 → 복귀
  const href = await page.getAttribute('[data-testid="daypanel-fireplan-input"]', 'href')
  check('입력 링크 = 소방계획서 탭 + 달력 복귀 주소', /\?tab=plan&from=%2Finspections%2Fcalendar/.test(href ?? ''), href)
  await page.click('[data-testid="daypanel-fireplan-input"]')
  await page.waitForURL(u => u.pathname.startsWith('/customers/') && u.searchParams.get('tab') === 'plan')
  const ret = await page.waitForSelector('[data-testid="customer-return-calendar"]')
  check('★ ③ 소방계획서 탭에 「점검달력으로 돌아가기」', /점검달력으로 돌아가기/.test((await ret.textContent()) ?? ''))
  await page.screenshot({ path: 'scripts/_shots/docs-plan-tab.png', clip: { x: 224, y: 64, width: 1696, height: 200 } })
  // 탭을 옮겨도 버튼이 남는다
  await page.click('[role="tab"]:has-text("공통")')
  await page.waitForFunction(() => new URLSearchParams(location.search).get('tab') === 'facilities')
  check('★ 다른 탭으로 옮겨도 복귀 버튼이 남는다', await page.isVisible('[data-testid="customer-return-calendar"]'))
  await page.click('[data-testid="customer-return-calendar"]')
  await page.waitForURL(u => u.pathname === '/inspections/calendar')
  const back = await page.waitForSelector('[data-testid="daypanel-docs"]', { timeout: 60000 }).catch(() => null)
  check('★ ③ 돌아오면 같은 회차 사이드바가 열려 있다', !!back && new URL(page.url()).searchParams.get('insp') === insp.id, page.url())

  // 달력에서 오지 않았으면 버튼이 없다
  await page.goto(`${BASE}/customers/${cust.id}?tab=plan`)
  await page.waitForSelector('[data-testid="customer-back"]')
  check('달력에서 오지 않았으면 복귀 버튼 없음', !(await page.$('[data-testid="customer-return-calendar"]')))
} catch (e) {
  check('예외 없이 끝났다', false, e instanceof Error ? e.stack : String(e))
} finally {
  await b?.close(); if (uid) await delUser(uid)
  summary()
}
