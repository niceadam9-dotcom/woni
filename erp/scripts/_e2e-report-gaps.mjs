// 보고서 준비도 실화면 (2026-09-23) — 탭 뱃지·탭 상단 목록·다음 빈 탭·달력 한 줄·달력 왕복
// 실행: node scripts/_e2e-report-gaps.mjs   (dev 서버 localhost:3000 필요 — 127.0.0.1은 HMR을 깬다)
import { BASE, raw, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const STAMP = Date.now().toString(36)
const EMAIL = `rg-${STAMP}@test.local`
const SHOT = process.env.SHOT_DIR || 'scripts/_shots'
let userId = '', browser = null
try {
  const y = new Date().getFullYear()
  const { data: cust } = await raw.from('customers').select('id, customer_name').eq('customer_name', '운주빌딩').maybeSingle()
  const { data: insps } = await raw.from('inspections').select('id, plan_type, year')
    .eq('customer_id', cust.id).eq('year', y)
  const insp = (insps ?? []).find(i => !i.plan_type || String(i.plan_type).startsWith('special'))
  check('표본: 운주빌딩 올해 자체점검 회차', !!insp, JSON.stringify(insps))

  userId = await mkUser({ email: EMAIL, name: '준비도검사', employeeId: `E2E-RG-${STAMP}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(90_000)
  await login(page, EMAIL)

  // ── ① 달력에서 온 것처럼 고객 기본정보 탭 ──
  const back = `/inspections/calendar?insp=${insp.id}&cust=${cust.id}`
  await page.goto(`${BASE}/customers/${cust.id}?tab=info&from=${encodeURIComponent(back)}`)
  // 모양이 아니라 **뜻**을 기다린다 — 비동기 조회가 끝나 목록이 붙는 순간
  await page.waitForSelector('[data-testid="report-gaps-strip-info"]', { timeout: 120_000 })
  const infoN = Number(await page.getAttribute('[data-testid="report-gaps-strip-info"]', 'data-gaps'))
  check('기본정보 탭 목록이 붙었다', infoN >= 0, String(infoN))
  const badges = {}
  for (const k of ['info', 'buildings', 'contacts', 'facilities', 'reports']) {
    const el = await page.$(`[data-testid="tab-gap-${k}"]`)
    badges[k] = el ? Number(await el.textContent()) : 0
  }
  console.log('  탭 뱃지', JSON.stringify(badges))
  check('★ 뱃지 수 = 목록 수 (같은 한 번의 조회)', badges.info === infoN, `${badges.info} vs ${infoN}`)
  check('★ 공통 탭에 뱃지(송달 동의·급수 → 1.1)', badges.facilities > 0)
  const backHref = await page.getAttribute('[data-testid="customer-back"]', 'href')
  check('★ ←가 달력 복귀 주소', backHref === back, backHref)
  await page.screenshot({ path: `${SHOT}/rg-info.png` })

  // ── ② 다음 빈 탭 → 탭 이동 후에도 from 보존 ──
  const nextBtn = await page.$('[data-testid="report-gaps-next"]')
  check('다음 빈 탭 버튼', !!nextBtn)
  if (nextBtn) {
    const label = await nextBtn.textContent()
    await nextBtn.click()
    await page.waitForFunction(() => new URLSearchParams(location.search).get('tab') !== 'info')
    const tab = new URL(page.url()).searchParams.get('tab')
    console.log(`  「${label?.trim()}」 → tab=${tab}`)
    check('★ 탭이 바뀌었다', tab && tab !== 'info', tab)
    check('★ 탭을 옮겨도 from이 남는다', new URL(page.url()).searchParams.get('from') === back, page.url())
    await page.waitForSelector(`[data-testid="report-gaps-strip-${tab}"]`, { timeout: 120_000 })
    await page.screenshot({ path: `${SHOT}/rg-next.png` })
  }

  // ── ③ 공통 탭 목록에 1.1 표식 ──
  await page.goto(`${BASE}/customers/${cust.id}?tab=facilities&from=${encodeURIComponent(back)}`)
  await page.waitForSelector('[data-testid="report-gaps-strip-facilities"]', { timeout: 120_000 })
  const facTxt = await page.textContent('[data-testid="report-gaps-strip-facilities"]')
  check('★ 공통 탭 목록에 송달 동의(1.1)', /1\.1\s*송달 동의/.test(facTxt ?? ''), facTxt)
  await page.screenshot({ path: `${SHOT}/rg-facilities.png` })

  // ── ④ from 없이 들어오면 ←는 목록 ──
  await page.goto(`${BASE}/customers/${cust.id}?tab=info`)
  check('from 없으면 ←는 고객 목록', (await page.getAttribute('[data-testid="customer-back"]', 'href')) === '/customers')
  await page.goto(`${BASE}/customers/${cust.id}?tab=info&from=${encodeURIComponent('//evil.example.com')}`)
  check('★ 외부 주소는 버린다', (await page.getAttribute('[data-testid="customer-back"]', 'href')) === '/customers')

  // ── ⑤ 달력 사이드바 한 줄 → 칩 → 탭 → ← → 같은 사이드바 ──
  await page.goto(`${BASE}${back}`)
  const line = await page.waitForSelector('[data-testid="daypanel-report-gaps"]', { timeout: 120_000 }).catch(() => null)
  check('★ 사이드바 한 줄이 떴다', !!line)
  if (line) {
    console.log('  한 줄:', (await line.textContent())?.trim())
    await page.screenshot({ path: `${SHOT}/rg-calendar.png` })
    // 2026-09-23 image-14: 칩 묶음 → 「빈칸 N」 + [입력하기](첫 빈 탭)
    const chip = await page.$('[data-testid="daypanel-report-input"]')
    if (chip) {
      const href = await chip.getAttribute('href')
      check('★ 칩이 달력 복귀 주소를 싣는다', /[?&]from=%2Finspections%2Fcalendar/.test(href ?? ''), href)
      await chip.click()
      await page.waitForURL(u => u.pathname.startsWith('/customers/'), { timeout: 120_000 })
      await page.waitForSelector('[data-testid="customer-back"]')
      await page.click('[data-testid="customer-back"]')
      await page.waitForURL(u => u.pathname === '/inspections/calendar', { timeout: 120_000 })
      const back2 = await page.waitForSelector('[data-testid="daypanel-report-gaps"]', { timeout: 120_000 }).catch(() => null)
      check('★ ←로 돌아오면 그 사이드바가 다시 열려 있다', !!back2 && new URL(page.url()).searchParams.get('insp') === insp.id, page.url())
    }
  }
} catch (e) {
  check('예외 없이 끝났다', false, e instanceof Error ? e.stack : String(e))
} finally {
  await browser?.close()
  if (userId) await delUser(userId)
  summary()
}
