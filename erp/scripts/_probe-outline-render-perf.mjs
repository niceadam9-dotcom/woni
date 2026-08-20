// S7-18 (R-8) — 90항목 outline 리렌더 비용 실측 (먼저 측정, 최적화는 결과 보고)
// 시나리오: special_종합(전 항목 범위) STD-03(90항목) 드로어에서 ○ 클릭 → 클래스 커밋까지 ms.
// MutationObserver 인페이지 계측 — 클릭당 전 행 리렌더가 포함된 인터랙션 지연.
// ⚠ dev 서버 측정 = 상한치(프로덕션은 더 빠름). 판정 임계: p95 100ms.
// 실행: node scripts/_probe-outline-render-perf.mjs   (dev :3000 + 스테이징 DB)
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'outline-perf-e2e@erp-test.com'
let userId = '', custId = '', inspId = ''
let browser = null

try {
  userId = await mkUser({ email: EMAIL, name: '성능측정E2E', employeeId: 'E2E-PERF' })
  custId = await mkCustomer({ customer_name: '성능측정E2E고객', created_by: userId })
  const { data: insp, error } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '종합', plan_type: 'special_종합', sequence_num: 1,
    inspection_start_date: '2026-08-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(error.message)
  inspId = insp.id

  // STD-03(스프링클러 90항목 — 저장소 최대) 항목 코드 확보
  const { data: sheet } = await raw.from('inspection_sheets')
    .select('id, sheet_name').eq('version', 'v2025').eq('sheet_code', 'STD-03').single()
  const { data: items } = await raw.from('inspection_sheet_items')
    .select('item_code').eq('sheet_id', sheet.id).order('order_num')
  const codes = [...new Set((items ?? []).map(i => i.item_code))]
  check('셋업: STD-03 항목 ≥ 85', codes.length >= 85, `${codes.length}개`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspId}`)
  await page.waitForSelector('[data-testid="sheet-group-board"]')
  await page.click(`[data-board-sheet="${sheet.id}"]`)
  await page.waitForSelector(`[data-testid="sheet-drawer"] [aria-label="${codes[0]} O"]`)
  const rows = await page.locator('[data-testid="sheet-drawer"] [aria-label$=" O"]').count()
  check('드로어 행 수 = 전 항목(종합 범위)', rows === codes.length, `rows=${rows} codes=${codes.length}`)

  // 워밍업 2클릭(제외) 후 본측정: 시트 전반에 고르게 20클릭
  const stride = Math.floor(codes.length / 22)
  const targets = Array.from({ length: 22 }, (_, i) => codes[i * stride]).filter(Boolean)
  const times = await page.evaluate(async (sel) => {
    const out = []
    for (const code of sel) {
      const btn = document.querySelector(`[data-testid="sheet-drawer"] [aria-label="${code} O"]`)
      if (!btn) { out.push(-1); continue }
      const t0 = performance.now()
      const done = new Promise(res => {
        const mo = new MutationObserver(() => {
          if (btn.className.includes('bg-green-500')) { mo.disconnect(); res(performance.now() - t0) }
        })
        mo.observe(btn, { attributes: true, attributeFilter: ['class'] })
        setTimeout(() => { mo.disconnect(); res(-2) }, 5000)
      })
      btn.click()
      out.push(await done)
      await new Promise(r => setTimeout(r, 60))   // 프레임 안정화 — 배칭 중첩 방지
    }
    return out
  }, targets)

  const valid = times.filter(t => t >= 0)
  const warm = valid.slice(2)   // 앞 2클릭 워밍업 제외
  warm.sort((a, b) => a - b)
  const mean = warm.reduce((a, b) => a + b, 0) / warm.length
  const p50 = warm[Math.floor(warm.length * 0.5)]
  const p95 = warm[Math.floor(warm.length * 0.95)]
  const max = warm[warm.length - 1]
  console.log(`  [실측] 클릭→커밋(ms) n=${warm.length} — mean ${mean.toFixed(1)} · p50 ${p50.toFixed(1)} · p95 ${p95.toFixed(1)} · max ${max.toFixed(1)}`)
  console.log(`  [원자료] ${times.map(t => t.toFixed(0)).join(', ')}`)
  check('측정 유효(실패 클릭 0)', valid.length === times.length, `${valid.length}/${times.length}`)
  check('p95 < 100ms (인지 임계 — dev 상한치 기준)', p95 < 100, `p95=${p95.toFixed(1)}ms`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
summary()
