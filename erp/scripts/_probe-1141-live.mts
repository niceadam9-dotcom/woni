/** 1.14.1 promoPlan — 실서버 왕복 실측 (2026-09-18, 64회차 증분 실화면 검증)
 *
 *  UI(1.14 카드 월 격자)로 실제로 누르고 저장 → DB 폴링 → 엑셀 수신 → 1.14.1 상자 확인 →
 *  **원상복구**(실고객 오염 금지 — 검증 중 오염된 2명을 되돌린 전례).
 *
 *  실행: npx tsx scripts/_probe-1141-live.mts   (localhost:3000 — 워크트리 프로덕션 서버)
 */
import JSZip from 'jszip'
import { launch, login, raw, mkUser, delUser } from './_e2e-helpers.mjs'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import { PROMO_SHEET, PROMO_ROWS, PROMO_MONTH_COLS } from '../src/lib/fire-plan-anchors.ts'

const BASE = 'http://localhost:3000'
const EMAIL = 'e2e-promo-1141@test.local'
let ctx: Awaited<ReturnType<typeof launch>> | null = null
let userId: string | null = null
let customerId = ''
let hadPlanBefore: unknown

const sectionsOf = async () => {
  const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  return (data?.sections ?? {}) as Record<string, unknown>
}

try {
  const { data: cust } = await raw.from('customers').select('id, customer_name').eq('is_active', true).limit(1).single()
  if (!cust) throw new Error('스테이징에 고객이 없다')
  customerId = cust.id as string
  console.log(`대상 고객: ${cust.customer_name} (${customerId})`)
  hadPlanBefore = (await sectionsOf()).promoPlan
  console.log(`사전 promoPlan: ${JSON.stringify(hadPlanBefore) ?? '(없음)'}`)

  userId = await mkUser({ email: EMAIL, name: '홍보계획E2E', employeeId: 'E2E-P1141' })
  ctx = await launch()
  const page = ctx.page
  await login(page, EMAIL)

  // ── ① 1.12 절 화면에서 월 격자를 실제로 누른다 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.12`)
  const grid = page.locator('text=1.14.1 연간 계획').locator('..')
  await grid.waitFor({ timeout: 20000 })
  const posterRow = page.locator('div').filter({ hasText: /^포스터, 표어 전시/ }).last()
  await posterRow.locator('button', { hasText: /^3$/ }).click()
  await posterRow.locator('button', { hasText: /^7$/ }).click()
  await page.locator('button', { hasText: '서식 1.12~1.15 저장' }).click()

  // ── ② DB 폴링 — 모양(토스트)이 아니라 뜻(저장된 값)을 기다린다 ──
  let saved: number[] | undefined
  for (let i = 0; i < 20; i++) {
    const s = await sectionsOf()
    saved = (s.promoPlan as Record<string, number[]> | undefined)?.poster
    if (saved?.length === 2) break
    await new Promise(r => setTimeout(r, 500))
  }
  console.log(`DB promoPlan.poster = ${JSON.stringify(saved)}`)
  /* 🚨 `process.exit` 금지 — finally(원상복구)를 건너뛰어 **실고객을 오염시킨다**.
   *   2026-09-18 `_probe-today-live`가 정확히 그래서 감상골의 세 축을 남겼다. throw를 쓴다. */
  if (JSON.stringify(saved) !== '[3,7]') throw new Error(`저장이 DB에 닿지 않았다: ${JSON.stringify(saved)}`)

  // ── ③ 엑셀 수신 — 받은 파일에서 1.14.1 상자를 되읽는다 ──
  const res = await page.request.get(`${BASE}/customers/${customerId}/fire-plan/xlsx`)
  console.log(`xlsx HTTP ${res.status()}`)
  if (!res.ok()) throw new Error(`xlsx ${res.status()}: ${(await res.text()).slice(0, 200)}`)
  const g = await readSheetGrid(await JSZip.loadAsync(new Uint8Array(await res.body())), PROMO_SHEET)
  const at = (r: string) => g.cells.find(x => x.ref === r)?.text ?? ''
  const poster = PROMO_ROWS.find(r => r.key === 'poster')!
  const on3 = at(`${PROMO_MONTH_COLS[2]}${poster.row}`)
  const on7 = at(`${PROMO_MONTH_COLS[6]}${poster.row}`)
  const off1 = at(`${PROMO_MONTH_COLS[0]}${poster.row}`)
  const video = PROMO_ROWS.find(r => r.key === 'video')!
  const offRow = PROMO_MONTH_COLS.every(c => !at(`${c}${video.row}`).includes('■'))
  console.log(`포스터 3월=${on3} 7월=${on7} 1월=${off1} · 미입력 행 전부 ☐=${offRow}`)
  const ok = on3.includes('■') && on7.includes('■') && !off1.includes('■') && offRow
  console.log(`\n${ok ? '✅ 화면 입력 → 저장 → 엑셀까지 한 줄로 통했다' : '🚨 왕복이 끊겼다'}`)
  process.exitCode = ok ? 0 : 1
} finally {
  // ── ④ 원상복구 — 실고객을 오염시키지 않는다 ──
  if (customerId) {
    const s = await sectionsOf()
    if (hadPlanBefore === undefined) delete s.promoPlan
    else s.promoPlan = hadPlanBefore
    await raw.from('fire_plan_forms').update({ sections: s }).eq('customer_id', customerId)
    const after = (await sectionsOf()).promoPlan
    console.log(`원상복구: promoPlan = ${JSON.stringify(after) ?? '(없음)'}`)
  }
  if (userId) await delUser(userId)
  await ctx?.browser.close()
}
