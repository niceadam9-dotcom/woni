/** 달력 데이 패널 [보고서 엑셀] — 고지가 **안** 뜨고 다운로드는 되는가 — 실화면 (2026-09-23)
 *  실행: TEST_BASE_URL=http://localhost:3107 npx tsx scripts/_probe-calendar-notice-roundtrip.mts
 *        (로컬 dev + 스테이징 DB)
 *
 *  🚨 2026-09-23 **계약 교대.** 첫 판(09-22)은 「고지 → 칩 → 입력면 → 복귀 배너」 한 바퀴를 걸었다.
 *    사용자 지시로 달력은 보고서 고지를 **그리지 않는다**(31/31 상시라 400px 사이드바를 덮었다) —
 *    그 바퀴가 통째로 사라졌으므로 이 프로브는 반대 방향을 걷는다:
 *      ① 버튼을 누르면 **엑셀은 받아진다** (고지를 걷다 버튼까지 죽이지 않았다)
 *      ② 고지 목록·칩·「엑셀 고지:」 자기 토스트가 **하나도 안 뜬다**
 *         (`owns = !onNotice && !onError` — onError만 넘겨도 버튼이 대신 그리지 않는다)
 *      ③ 복귀 배너도 없다
 *  ⚠ **공허 통과 방지**: 「안 뜬다」는 고지가 원래 없는 회차에서도 초록이다. 그래서 표본은
 *    서버가 그 회차에 **실제로 고지를 보내는**(`x-workbook-missing` 비어 있지 않은) 건으로 고르고,
 *    화면에서 받은 응답 헤더로도 한 번 더 확인한다.
 *  ⚠ **다 끝난 뒤 센다**: 고지는 다운로드 뒤 상태로 켜진다. 버튼이 busy를 풀 때(=`finally`)까지
 *    기다려야 「아직 안 켜졌을 뿐」을 「안 뜬다」로 오독하지 않는다.
 *
 *  읽기 전용 — 엑셀을 받을 뿐 아무것도 쓰지 않는다.
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { createClient } from '@supabase/supabase-js'

const STAMP = Date.now().toString(36)
const EMAIL = `cal-wb-${STAMP}@test.local`
const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const g = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
const db = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '달력엑셀프로브', employeeId: `E2E-WB-${STAMP}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(120_000)
  try { await login(page, EMAIL) } catch (e) {
    throw new Error(`로그인 실패 — URL=${page.url()} · ${String(e).slice(0, 120)}`)
  }

  // 표본 — 활성 고객의 자체점검 중 서버가 **고지를 보내는** 회차
  const y = new Date().getFullYear()
  const { data: insps } = await db.from('inspections')
    .select('id, customer_id, plan_type').gte('year', y - 1).lte('year', y + 1)
  const { data: custs } = await db.from('customers').select('id, is_active, customer_name')
  const cm = new Map((custs ?? []).map(c => [c.id as string, c as { is_active: boolean | null; customer_name: string }]))
  const cands = (insps ?? [])
    .filter(i => !i.plan_type || String(i.plan_type).startsWith('special'))
    .filter(i => cm.get(i.customer_id as string)?.is_active !== false)

  let target: { id: string; name: string; raw: string } | null = null
  for (const c of cands.slice(0, 20)) {
    const res = await page.request.get(`${BASE}/inspections/${c.id}/workbook`, { timeout: 180_000 })
    const raw = decodeURIComponent(res.headers()['x-workbook-missing'] ?? '')
    if (res.ok() && raw) { target = { id: c.id as string, name: cm.get(c.customer_id as string)?.customer_name ?? '—', raw }; break }
  }
  if (!target) { check('표본 — 고지를 보내는 회차', false, '못 찾음(판정 불가)'); throw new Error('표본 없음') }
  check(`표본 — ${target.name} (서버 고지: ${target.raw.slice(0, 50)}…)`, true)

  await page.goto(`${BASE}/inspections/calendar?insp=${target.id}`, { waitUntil: 'domcontentloaded' })
  const row = page.locator('[data-testid="daypanel-workbook"]')
  await row.waitFor()
  check('보고서 엑셀 줄이 패널에 있다 (버튼 자체를 없애지 않았다)', true)

  const respP = page.waitForResponse(r => r.url().includes(`/inspections/${target!.id}/workbook`), { timeout: 180_000 })
  const dlP = page.waitForEvent('download', { timeout: 180_000 }).catch(() => null)
  const btn = row.locator('[data-testid="workbook-xlsx"]')
  await btn.click()
  const resp = await respP
  const dl = await dlP
  check('★ ① 엑셀이 받아진다', !!dl && resp.ok(), `status=${resp.status()} · 파일=${dl?.suggestedFilename() ?? '(없음)'}`)
  check('★ 이번 응답에도 서버 고지가 **실려 왔다** (아래 「안 뜬다」가 공허하지 않다)',
    !!(resp.headers()['x-workbook-missing'] ?? ''))

  // 버튼이 busy를 풀 때까지 — 고지 상태는 그 전에 이미 켜졌을 것이다
  await page.waitForFunction(
    () => !(document.querySelector('[data-testid="daypanel-workbook"] [data-testid="workbook-xlsx"]') as HTMLButtonElement | null)?.disabled,
    undefined, { timeout: 60_000 })
  await page.waitForTimeout(500)

  const panelText = await row.innerText()
  check('★ ② 고지 목록이 안 뜬다', (await row.locator('[data-testid="doc-notice-list"]').count()) === 0)
  check('★ ② 칩이 안 뜬다', (await page.locator('[data-testid="doc-notice-chip"]').count()) === 0)
  check('★ ② 「채우면 다음 발행에 반영됩니다」가 없다', !(await page.locator('body').innerText()).includes('채우면 다음 발행에 반영됩니다'))
  check('★ ② 버튼 자기 고지(「엑셀 고지:」)도 없다 — owns가 꺼졌다', !panelText.includes('엑셀 고지'), panelText.slice(0, 120))
  check('③ 복귀 배너가 없다', (await page.locator('[data-testid="daypanel-workbook-resume"]').count()) === 0)
  check('오류도 없다 (받았으니)', !/실패|오류/.test(panelText), panelText.slice(0, 120))
} catch (e) {
  if (!String(e).includes('표본 없음')) check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
