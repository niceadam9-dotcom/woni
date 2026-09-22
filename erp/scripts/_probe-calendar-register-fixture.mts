/** 달력에서 **실제로 등록**하고 두 갈래를 확인 — 픽스처 (2026-09-22)
 *  실행: npx tsx scripts/_probe-calendar-register-fixture.mts   (로컬 dev :3000 + 스테이징 DB)
 *
 *  R1 프로브는 「폼이 뜨는가」까지만 봤다. 여기서는 **끝까지 눌러** 두 갈래를 가른다:
 *    · 과거 날짜 → 1차 점검 즉시 시작 → 달력 띠가 「1~4단계가 생겼습니다」 + [1단계 열기]
 *    · 미래 날짜 → 계획 항목만 → 띠가 「계획이 잡혔습니다」 + [계획 확인]
 *  그리고 화면 말이 **DB와 맞는지**(inspection_steps 행이 실제로 생겼나)까지 대조한다 —
 *  띠 문구만 보면 서버가 거짓말해도 초록이다.
 *
 *  🚨 **자기가 만든 것만 지운다.** 고객을 실제로 만들면 계획 항목·점검·단계가 줄줄이 생긴다.
 *     이름에 표식(E2E-REG-)을 넣고 그 표식으로만 지운다. 실데이터는 건드리지 않는다.
 *  🚨 되돌림 실패는 **조용히 넘기지 않는다** — 남은 것을 이름과 함께 찍는다.
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { createClient } from '@supabase/supabase-js'

const STAMP = Date.now().toString(36)
const EMAIL = `cal-reg-${STAMP}@test.local`
const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const g = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
const db = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

const iso = (offsetDays: number) =>
  new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10)

const made: string[] = []   // 만들어진 고객 id — finally에서 이것만 지운다

/** 이 프로브가 만든 고객을 자식까지 지운다 (FK 순서대로) */
async function purge(customerId: string) {
  const { data: insps } = await db.from('inspections').select('id').eq('customer_id', customerId)
  for (const i of insps ?? []) {
    await db.from('inspection_steps').delete().eq('inspection_id', i.id as string)
  }
  await db.from('inspections').delete().eq('customer_id', customerId)
  await db.from('inspection_plan_items').delete().eq('customer_id', customerId)
  await db.from('customer_contacts').delete().eq('customer_id', customerId)
  await db.from('buildings').delete().eq('customer_id', customerId)
  await db.from('activity_logs').delete().eq('entity_id', customerId)
  const { error } = await db.from('customers').delete().eq('id', customerId)
  return error?.message
}

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '달력등록픽스처', employeeId: `E2E-REG-${STAMP}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(60000)
  try { await login(page, EMAIL) } catch (e) {
    throw new Error(`로그인 실패 — URL=${page.url()} · ${String(e).slice(0, 120)}`)
  }

  /** 모달을 열어 필수 6칸을 채우고 등록한다 */
  async function register(label: string, anchor: string, name: string) {
    await page.goto(`${BASE}/inspections/calendar`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="calendar-new-customer"]').click()
    const modal = page.locator('[data-testid="calendar-new-customer-modal"]')
    await modal.getByText('고객명 (건물명)').first().waitFor({ timeout: 60000 })

    /* 날짜 칸은 **라벨로 짚는다.**
       ⚠ 「첫 번째 빈 날짜 칸」으로 고르면 안 된다 — 칸 순서가 점검일자·계약일·사용승인일이라
         빈 칸 첫째는 **계약일**이고, 그러면 사용승인일이 비어 [등록]이 영원히 잠긴다
         (첫 판이 정확히 그렇게 115번 헛돌았다). */
    const dateBy = (label: string) =>
      modal.locator(`div:has(> label:has-text("${label}"))`).locator('input[placeholder="YYYY-MM-DD"]').first()
    await dateBy('점검일자').fill(anchor)
    check(`${label}: 미래 안내가 ${anchor > iso(0) ? '뜬다' : '안 뜬다'}`,
      (await modal.locator('[data-testid="anchor-future-note"]').count() > 0) === (anchor > iso(0)),
      `anchor=${anchor} 오늘=${iso(0)}`)

    /* 주소 — 검색 팝업 대신 도로명주소 칸에 직접 넣는다(필수는 `address`다).
       ⚠ **등록마다 달라야 한다.** 같은 주소를 두 번 쓰면 두 번째에서 주소 중복 팝업이 떠
         제출이 막힌다(첫 판이 그래서 미래 갈래에서 90초 헛돌았다) — 그건 제품이 옳게 동작한 것이다. */
    await modal.locator('input[placeholder="주소 검색 후 동/호수 등 추가 입력"]').fill(`서울시 테스트구 ${STAMP}로 ${label}`)
    await modal.locator('input[placeholder="주소 검색 시 자동입력 또는 직접 입력"]').fill(name)
    await dateBy('사용승인일').fill('2020-01-01')
    await modal.locator('input[placeholder="대표 이름 *"]').fill('테스트대표')

    const submit = modal.locator('button[type="submit"]').last()
    await submit.waitFor({ timeout: 30000 })
    // 고객코드 자동생성이 끝나야 활성화된다 — 안 풀리면 **무엇이 비었는지** 버튼 글씨가 말해 준다
    const enabled = await page.waitForFunction(
      () => !(document.querySelector('[data-testid="calendar-new-customer-modal"] button[type="submit"]') as HTMLButtonElement | null)?.disabled,
      undefined, { timeout: 60000 },
    ).then(() => true).catch(() => false)
    if (!enabled) throw new Error(`[등록]이 안 풀렸다 — 버튼 글씨="${(await submit.innerText()).trim()}"`)
    await submit.click()
    await page.locator('[data-testid="calendar-created-banner"]').waitFor({ timeout: 90000 })

    const { data } = await db.from('customers').select('id').eq('customer_name', name).maybeSingle()
    const cid = (data as { id: string } | null)?.id
    if (cid) made.push(cid)
    return cid
  }

  // ── 갈래 A — 과거 날짜: 1~4단계가 생긴다 ──
  {
    const name = `E2E-REG-${STAMP}-과거`
    const cid = await register('과거', iso(-1), name)
    check('과거: 고객이 만들어졌다', !!cid, name)
    check('★ 과거: 띠가 「1~4단계가 생겼습니다」', (await page.locator('[data-testid="created-started"]').count()) === 1)
    check('★ 과거: [1단계 열기]가 있다', (await page.locator('[data-testid="created-open-step1"]').count()) === 1)
    if (cid) {
      const { data: insps } = await db.from('inspections').select('id').eq('customer_id', cid)
      check('★ 과거: DB에도 점검이 생겼다 (화면 말과 맞다)', (insps ?? []).length === 1, `${(insps ?? []).length}건`)
      const ids = (insps ?? []).map(i => i.id as string)
      const { data: steps } = ids.length
        ? await db.from('inspection_steps').select('id').in('inspection_id', ids) : { data: [] }
      check('★ 과거: 단계 6개가 깔렸다', (steps ?? []).length === 6, `${(steps ?? []).length}개`)
    }
    // [1단계 열기]가 **화면을 떠나지 않고** 패널을 여는지
    await page.locator('[data-testid="created-open-step1"]').click()
    await page.locator('[data-testid="daypanel-anchor-date"]').waitFor({ timeout: 30000 })
    check('★ 과거: [1단계 열기]가 달력을 떠나지 않고 회차 패널을 연다',
      page.url().includes('/inspections/calendar'), page.url())
  }

  // ── 갈래 B — 미래 날짜: 계획만 잡힌다 ──
  {
    const name = `E2E-REG-${STAMP}-미래`
    const cid = await register('미래', iso(45), name)
    check('미래: 고객이 만들어졌다', !!cid, name)
    check('★ 미래: 띠가 「계획이 잡혔습니다」', (await page.locator('[data-testid="created-planned"]').count()) === 1)
    check('★ 미래: [계획 확인]이 있다', (await page.locator('[data-testid="created-open-plan"]').count()) === 1)
    if (cid) {
      const { data: insps } = await db.from('inspections').select('id').eq('customer_id', cid)
      check('★ 미래: DB에 점검이 **없다** (화면 말과 맞다)', (insps ?? []).length === 0, `${(insps ?? []).length}건`)
      const { data: items } = await db.from('inspection_plan_items').select('id').eq('customer_id', cid)
      check('★ 미래: 계획 항목은 생겼다', (items ?? []).length > 0, `${(items ?? []).length}건`)
    }
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  for (const cid of made) {
    const err = await purge(cid)
    if (err) console.error(`⚠ 픽스처 정리 실패(${cid}): ${err} — 수동 확인 필요`)
  }
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
