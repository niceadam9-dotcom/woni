/** 점검표 드로어 전체화면 + 배율 연동 실측 (소방계획서_38, dev :3000 필요)
 *  실행: node scripts/_probe-38-drawer-scale.mjs [inspectionId]
 *
 *  이 프로브가 닫는 축은 **다른 어떤 검사도 안 보는 축**이다:
 *   - test-font-scale S-1은 CSS 텍스트에서 '같은 변수를 읽는가'만 본다(정적).
 *     실제로 렌더된 헤더 높이와 소제목 offset이 같은지는 브라우저에서만 알 수 있다.
 *   - test-sheet-mother-drawer는 배율 md 한 점에서만 돈다 — lg/xl에서 겹치는지 모른다.
 *
 *  ⚠ '열린다'≠'안 겹친다'. 두 sticky가 겹쳐도 페이지는 멀쩡히 뜨고 테스트도 초록이다.
 *    가려지는 것은 항목 첫 행뿐이라 화면을 열어 봐야만 보인다 — 그래서 수치로 단언한다.
 */
import { chromium } from 'playwright'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? (pass++, console.log(`  ✅ ${n}${d ? ` — ${d}` : ''}`)) : (fail++, console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`)) }
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol

const EMAIL = 'drawer-scale-probe@erp-test.com'
const PW = 'E2eTest1!'
const VIEW = { width: 1500, height: 950 }   // _e2e-helpers.mjs:102와 동일
const SCALES = [['md', 1], ['lg', 1.15], ['xl', 1.3]]

let userId = null, browser = null

try {
  let inspId = process.argv[2]
  if (!inspId) {
    const { data: sp } = await s.from('inspections').select('id').like('plan_type', 'special%').limit(1)
    const { data } = await s.from('inspections').select('id, plan_type').is('plan_type', null).limit(1)
    inspId = (sp ?? [])[0]?.id ?? (data ?? [])[0]?.id
  }
  if (!inspId) throw new Error('자체점검 건을 찾지 못했습니다 — 인자로 inspectionId를 주세요')
  console.log(`대상 점검: ${inspId.slice(0, 8)}\n`)

  const { data: created, error } = await s.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  if (created?.user) {
    userId = created.user.id
    await s.from('profiles').upsert({
      id: userId, email: EMAIL, name: '배율프로브', employee_id: 'E2E-D38',
      role: 'admin', is_active: true, is_system: false,
    })
  } else {
    const { data: p } = await s.from('profiles').select('id').eq('email', EMAIL).maybeSingle()
    userId = p?.id
  }

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: VIEW })
  page.setDefaultTimeout(45000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

  await page.goto(`${BASE}/inspections/${inspId}`)
  await page.waitForSelector('[data-testid="sheet-group-board"]')
  await page.waitForLoadState('networkidle')

  // ── 소제목(run)이 있는 머더를 고른다 — 없으면 top-sheet-hdr 축을 아예 못 본다 ──
  const cards = page.locator('[data-group-key]')
  const n = await cards.count()
  let opened = null
  for (let i = 0; i < n; i++) {
    await cards.nth(i).click()
    await page.waitForSelector('[data-testid="sheet-drawer"] [data-outline-group]', { timeout: 30000 })
    if (await page.locator('[data-testid="sheet-drawer"] [data-subgroup]').count() > 0) {
      opened = await cards.nth(i).getAttribute('data-group-key'); break
    }
    await page.click('[data-testid="sheet-drawer-close"]')
    await page.waitForSelector('[data-testid="sheet-drawer"]', { state: 'detached' })
  }
  check('★ 소제목(run)이 있는 시트를 열었다 — top-sheet-hdr 축이 실제로 걸린다', !!opened, opened ?? '전 머더에 소제목 없음')
  if (!opened) throw new Error('소제목 있는 시트 없음 — 이 프로브는 그 축을 재려고 존재한다')
  console.log(`선택: ${opened}\n`)

  // ── 패널 기하: inset-4 = 사방 16px ─────────────────────────────────────────
  const panel = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="sheet-drawer"]').getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }
  })
  check('★ 전체화면 패널 — 사방 16px 여백(inset-4), 최대폭 상한 없음',
    panel.x === 16 && panel.y === 16 && panel.w === VIEW.width - 32 && panel.h === VIEW.height - 32,
    `${panel.w}×${panel.h} @(${panel.x},${panel.y}) / 기대 ${VIEW.width - 32}×${VIEW.height - 32} @(16,16)`)
  check('구판 920px 상한이 남아 있지 않다', panel.w > 920, `${panel.w}px`)

  // ── 배율 3점에서 기하·글자 실측 ────────────────────────────────────────────
  for (const [fs, k] of SCALES) {
    console.log(`\n── 배율 ${fs} (×${k}) ──`)
    await page.evaluate(v => document.documentElement.setAttribute('data-fs', v), fs)
    await page.waitForTimeout(350)

    const m = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="sheet-drawer"]')
      const hdr = d.querySelector('[data-outline-group] > .sticky')
      const sub = d.querySelector('[data-subgroup]')
      const btn = d.querySelector('[aria-label$=" O"]')
      const name = btn?.closest('.border-b')?.querySelector('span:nth-child(2)')
      const box = d.querySelector('.overflow-y-auto')
      const cs = el => el ? getComputedStyle(el) : null
      const scrollerEls = [...d.querySelectorAll('*')]
        .filter(el => el.scrollHeight - el.clientHeight > 2 && /auto|scroll/.test(getComputedStyle(el).overflowY))
      const scrollers = scrollerEls.length
      // ⚠ 개수만 세면 두 가지를 못 잡는다(2026-08-30 2차 독립 판정 지적 ②).
      //   ① 종전 `scrollers <= 2`는 목차 몫으로 한 칸을 열어 뒀는데 실측상 목차가 스크롤러가 된 적이
      //      없어 그 여유분이 그대로 **사각지대**였다 — 항목 박스 아닌 것이 하나 더 스크롤돼도 초록이다.
      //   ② 더 나쁘게, 아무것도 스크롤되지 않으면(scrollers=0) 단언이 **공허하게** 통과한다.
      //      S4-4가 지키려는 것은 '스크롤러가 적다'가 아니라 '**항목 박스가** 스크롤러다'이다.
      //   그래서 개수 대신 **정체**를 본다.
      const scrollerTags = scrollerEls.map(el =>
        el === box ? 'box'
          : el.closest('nav') ? 'toc'
            : `OTHER:${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 40)}`)
      return {
        hdrH: hdr ? hdr.getBoundingClientRect().height : null,
        subTop: sub ? parseFloat(cs(sub).top) : null,
        subRectTop: sub ? sub.getBoundingClientRect().top : null,
        hdrRectBottom: hdr ? hdr.getBoundingClientRect().bottom : null,
        btnW: btn ? btn.getBoundingClientRect().width : null,
        btnH: btn ? btn.getBoundingClientRect().height : null,
        nameFs: name ? parseFloat(cs(name).fontSize) : null,
        boxOverflowX: box ? box.scrollWidth - box.clientWidth : null,
        scrollers,
        scrollerTags,
        pageOver: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      }
    })

    // (a) sticky 2층 — 헤더 높이와 소제목 offset이 **같아야** 한다
    check(`[${fs}] ★ sticky 겹침 없음 — 소제목 top(${m.subTop}) = 중분류 높이(${m.hdrH})`,
      m.hdrH != null && m.subTop != null && near(m.hdrH, m.subTop), `Δ=${m.hdrH != null && m.subTop != null ? (m.subTop - m.hdrH).toFixed(2) : '?'}px`)
    check(`[${fs}] 중분류 헤더가 배율을 따른다 (26×${k} = ${(26 * k).toFixed(1)}px)`,
      near(m.hdrH, 26 * k, 1), `실측 ${m.hdrH?.toFixed(1)}px`)

    // (g) 탭 타깃 — 40px 하한 + 배율 연동
    check(`[${fs}] ○/✕ 탭 타깃 = 40×${k} = ${(40 * k).toFixed(0)}px (40px 하한 보장)`,
      near(m.btnW, 40 * k, 1) && near(m.btnH, 40 * k, 1) && m.btnW >= 39.5,
      `${m.btnW?.toFixed(1)}×${m.btnH?.toFixed(1)}`)

    // 문항명 — 이 차수의 핵심 칸 (구 12px 고정 → 14×배율)
    check(`[${fs}] 항목 문항명 = 14×${k} = ${(14 * k).toFixed(1)}px (구 12px 고정)`,
      near(m.nameFs, 14 * k, 0.3), `실측 ${m.nameFs}px`)

    // (c) 스크롤바 — 항목 박스(+lg 목차)만, 페이지는 0
    //     개수가 아니라 **정체**로 본다(위 scrollerTags 주석 참조).
    const tags = m.scrollerTags || []
    const detail = `${m.scrollers}개 [${tags.join(', ') || '없음'}]`
    check(`[${fs}] ★ 항목 박스가 실제 스크롤러다 (공허 통과 차단)`, tags.includes('box'), detail)
    check(`[${fs}] ★ 예상 밖 스크롤러 0 — 항목 박스와 목차 외에는 스크롤되지 않는다`,
      tags.filter(t => t.startsWith('OTHER:')).length === 0, detail)
    check(`[${fs}] 페이지 세로 스크롤 0`, m.pageOver <= 2, `초과 ${m.pageOver}px`)

    // (b) 가로 넘침 없음
    check(`[${fs}] 항목 박스 가로 넘침 0`, m.boxOverflowX != null && m.boxOverflowX <= 1, `${m.boxOverflowX}px`)
  }

  await page.evaluate(() => document.documentElement.setAttribute('data-fs', 'md'))
} catch (e) {
  check('예외 없음', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close().catch(() => {})
  // ⚠ PostgREST 빌더는 thenable이지만 .catch()가 없다 — await 후 try/catch로 감싸야 한다.
  //   .catch()를 붙이면 정리 단계가 통째로 터져 **본 검사가 전부 초록인데 exit=1**이 된다.
  if (userId) {
    try { await s.from('profiles').delete().eq('id', userId) } catch { /* 이미 없음 */ }
    try { await s.auth.admin.deleteUser(userId) } catch { /* 이미 없음 */ }
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
  process.exit(fail === 0 ? 0 : 1)
}
