/** 드로어 다크 모드(xl) + 모바일 바텀시트 실측 (소방계획서_38 S2-4 · 육안 대체, dev :3000 필요)
 *  실행: node scripts/_probe-38-dark-mobile.mjs [inspectionId]
 *
 *  _probe-38-drawer-scale.mjs가 못 본 두 축:
 *   ① 다크 xl — sticky 헤더 배경이 **불투명**해야 한다. 반투명이면 스크롤할 때 아래 항목 글자가
 *      헤더를 뚫고 비친다. 라이트에서는 눈에 안 띄고 다크에서 도드라진다.
 *   ② 모바일 — inset-4(사방 16px)가 max-sm:에서 바텀시트로 **뒤집혀야** 한다. Tailwind v4의
 *      단축 vs longhand 우선순위에 기대는 구조라, 클래스 순서를 잘못 쓰면 조용히 데스크톱
 *      모양으로 고착된다(가장자리 탭이 백드롭에 먹힌다).
 *
 *  ⚠ 색 판정에 정규식을 쓰지 않는다. Tailwind v4는 팔레트를 lab()/oklab()으로 내보내며,
 *    소방계획서_36 F-9에서 rgb() 정규식이 파싱에 실패해 배경을 흰색으로 오인하고 **멀쩡한
 *    배지를 1:1 FAIL로 오보**했다. 여기서는 브라우저가 직접 칠한 픽셀을 읽고, fillStyle
 *    대입이 무시됐는지를 **서로 다른 두 sentinel**로 먼저 검증한다.
 */
import { chromium } from 'playwright'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? (pass++, console.log(`  ✅ ${n}${d ? ` — ${d}` : ''}`)) : (fail++, console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`)) }

const EMAIL = 'drawer-dark-probe@erp-test.com'
const PW = 'E2eTest1!'
let userId = null, browser = null

/** 브라우저 안에서 실행 — 색이 불투명한지 픽셀로 판정한다(문자열 파싱 없음) */
const OPACITY_FN = `
function opacityOf(colorStr) {
  const c = document.createElement('canvas'); c.width = c.height = 1
  const ctx = c.getContext('2d', { willReadFrequently: true })
  // sentinel: fillStyle 대입이 실제로 먹었는지 먼저 본다. 파싱 실패 시 fillStyle은 **이전 값**을
  // 유지하므로, 서로 다른 두 색을 시도해 둘 다 그대로면 '판정 불가'다(조용한 오탐 차단).
  ctx.fillStyle = '#123456'; const s1 = ctx.fillStyle
  ctx.fillStyle = colorStr;  const s2 = ctx.fillStyle
  if (s1 === s2 && colorStr.replace(/\\s/g, '') !== '#123456') return { ok: false, reason: 'fillStyle 파싱 실패: ' + colorStr }
  const paint = bg => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = colorStr; ctx.fillRect(0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data)
  }
  const onBlack = paint('#000000'), onWhite = paint('#ffffff')
  const opaque = onBlack[0] === onWhite[0] && onBlack[1] === onWhite[1] && onBlack[2] === onWhite[2]
  return { ok: true, opaque, onBlack, onWhite, color: colorStr }
}`

async function openDrawer(page, inspId) {
  // ⚠ dev 서버는 로그인 후 첫 진입에서 라우트를 컴파일한다 — 재기동 직후엔 30초를 넘긴다.
  //   타임아웃을 넉넉히 주지 않으면 '앱 결함'이 아니라 '콜드 스타트'를 빨간불로 읽게 된다.
  await page.goto(`${BASE}/inspections/${inspId}`, { timeout: 120000 })
  await page.waitForSelector('[data-testid="sheet-group-board"]', { timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 120000 })
  const cards = page.locator('[data-group-key]')
  const n = await cards.count()
  for (let i = 0; i < n; i++) {
    await cards.nth(i).click()
    await page.waitForSelector('[data-testid="sheet-drawer"] [data-outline-group]', { timeout: 90000 })
    if (await page.locator('[data-testid="sheet-drawer"] [data-subgroup]').count() > 0) return true
    await page.click('[data-testid="sheet-drawer-close"]')
    await page.waitForSelector('[data-testid="sheet-drawer"]', { state: 'detached' })
  }
  return false
}

try {
  let inspId = process.argv[2]
  if (!inspId) {
    const { data: sp } = await s.from('inspections').select('id').like('plan_type', 'special%').limit(1)
    const { data } = await s.from('inspections').select('id, plan_type').is('plan_type', null).limit(1)
    inspId = (sp ?? [])[0]?.id ?? (data ?? [])[0]?.id
  }
  if (!inspId) throw new Error('자체점검 건을 찾지 못했습니다')
  console.log(`대상 점검: ${inspId.slice(0, 8)}\n`)

  const { data: created, error } = await s.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  if (created?.user) {
    userId = created.user.id
    await s.from('profiles').upsert({
      id: userId, email: EMAIL, name: '다크프로브', employee_id: 'E2E-D38D',
      role: 'admin', is_active: true, is_system: false,
    })
  } else {
    const { data: p } = await s.from('profiles').select('id').eq('email', EMAIL).maybeSingle()
    userId = p?.id
  }

  browser = await chromium.launch()

  // ══ ① 다크 모드 × xl 배율 ══════════════════════════════════════════════════
  console.log('── ① 다크 모드 × 배율 xl ──')
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
    page.setDefaultTimeout(45000)
    await page.goto(`${BASE}/login`)
    await page.fill('input[type=email]', EMAIL)
    await page.fill('input[type=password]', PW)
    await page.click('button[type=submit]')
    await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

    if (!await openDrawer(page, inspId)) throw new Error('소제목 있는 시트 없음')
    await page.evaluate(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.setAttribute('data-fs', 'xl')
    })
    await page.waitForTimeout(400)

    // ⚠ page.evaluate(string)은 **식**을 평가한다 — 함수 선언을 앞에 이어 붙이면 SyntaxError다.
    //   IIFE 본문 안에 넣어야 선언이 성립한다.
    const r = await page.evaluate(`(() => {
      ${OPACITY_FN}
      const d = document.querySelector('[data-testid="sheet-drawer"]')
      const hdr = d.querySelector('[data-outline-group] > .sticky')
      const sub = d.querySelector('[data-subgroup]')
      const cs = el => getComputedStyle(el)
      return {
        isDark: document.documentElement.classList.contains('dark'),
        fs: document.documentElement.getAttribute('data-fs'),
        hdrBg: opacityOf(cs(hdr).backgroundColor),
        subBg: opacityOf(cs(sub).backgroundColor),
        panelBg: opacityOf(cs(d).backgroundColor),
        hdrH: hdr.getBoundingClientRect().height,
        subTop: parseFloat(cs(sub).top),
        panelBorder: cs(d).borderTopColor,
        panelBorderW: cs(d).borderTopWidth,
      }
    })()`)

    check('다크 클래스 + xl 배율이 실제로 걸렸다', r.isDark && r.fs === 'xl', `dark=${r.isDark} data-fs=${r.fs}`)
    check('색 판정기가 유효하다 (fillStyle 파싱 성공 — 오탐 차단)',
      r.hdrBg.ok && r.subBg.ok && r.panelBg.ok,
      [r.hdrBg, r.subBg, r.panelBg].filter(x => !x.ok).map(x => x.reason).join(' / ') || 'ok')
    check('★ 중분류 sticky 헤더 배경이 불투명 (스크롤 시 항목이 비치지 않는다)',
      r.hdrBg.ok && r.hdrBg.opaque, r.hdrBg.color)
    check('★ 소제목 sticky 헤더 배경이 불투명', r.subBg.ok && r.subBg.opaque, r.subBg.color)
    check('패널 배경이 불투명 (백드롭이 비치지 않는다)', r.panelBg.ok && r.panelBg.opaque, r.panelBg.color)
    check('패널에 테두리가 실재 (백드롭과 경계가 선다)',
      parseFloat(r.panelBorderW) > 0, `${r.panelBorderW} ${r.panelBorder}`)
    check('다크·xl에서도 sticky 겹침 없음', Math.abs(r.hdrH - r.subTop) <= 0.6,
      `헤더 ${r.hdrH.toFixed(1)}px / 소제목 top ${r.subTop}px`)

    await page.screenshot({ path: '../erp_goal/_shot-38-dark-xl.png' })
    console.log('    📷 erp_goal/_shot-38-dark-xl.png')
    await page.close()
  }

  // ══ ② 모바일 바텀시트 (390×844) ═══════════════════════════════════════════
  console.log('\n── ② 모바일 390×844 (max-sm 바텀시트) ──')
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    page.setDefaultTimeout(45000)
    await page.goto(`${BASE}/login`)
    await page.fill('input[type=email]', EMAIL)
    await page.fill('input[type=password]', PW)
    await page.click('button[type=submit]')
    await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

    if (!await openDrawer(page, inspId)) throw new Error('모바일: 소제목 있는 시트 없음')
    await page.waitForTimeout(300)

    const m = await page.evaluate(`(() => {
      const d = document.querySelector('[data-testid="sheet-drawer"]')
      const r = d.getBoundingClientRect()
      const toc = document.querySelector('[data-testid="sheet-toc"]')
      const tr = toc ? toc.getBoundingClientRect() : null
      const btns = toc ? [...toc.querySelectorAll('[data-toc-group]')].map(b => b.getBoundingClientRect()) : []
      return {
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        bottom: Math.round(r.bottom), vh: window.innerHeight, vw: window.innerWidth,
        tocRow: btns.length >= 2 ? Math.abs(btns[0].top - btns[1].top) < 2 : null,
        tocH: tr ? Math.round(tr.height) : null,
        pageOver: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
        radiusTop: getComputedStyle(d).borderTopLeftRadius,
        radiusBottom: getComputedStyle(d).borderBottomLeftRadius,
      }
    })()`)

    check('★ 바텀시트다 — 풀폭·하단 고정 (inset-4 여백이 남아 있지 않다)',
      m.x === 0 && m.w === m.vw && m.bottom === m.vh,
      `x=${m.x} w=${m.w}/${m.vw} bottom=${m.bottom}/${m.vh}`)
    check('★ 높이 95dvh', Math.abs(m.h - m.vh * 0.95) <= 2, `${m.h}px / 기대 ${Math.round(m.vh * 0.95)}px`)
    check('위 모서리만 둥글다 (아래는 화면 끝에 붙는다)',
      parseFloat(m.radiusTop) > 0 && parseFloat(m.radiusBottom) === 0,
      `top=${m.radiusTop} bottom=${m.radiusBottom}`)
    check('★ 목차가 가로 스트립 (세로 목록이 아니다)', m.tocRow === true, `같은 행 여부=${m.tocRow} 높이=${m.tocH}px`)
    check('페이지 세로 스크롤 0', m.pageOver <= 2, `초과 ${m.pageOver}px`)

    await page.screenshot({ path: '../erp_goal/_shot-38-mobile.png' })
    console.log('    📷 erp_goal/_shot-38-mobile.png')
    await page.close()
  }
} catch (e) {
  check('예외 없음', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close().catch(() => {})
  // ⚠ PostgREST 빌더에 .catch()를 붙이면 정리 단계가 터져 본 검사가 전건 초록인데 exit=1이 된다
  if (userId) {
    try { await s.from('profiles').delete().eq('id', userId) } catch { /* 이미 없음 */ }
    try { await s.auth.admin.deleteUser(userId) } catch { /* 이미 없음 */ }
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
  process.exit(fail === 0 ? 0 : 1)
}
