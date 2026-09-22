/** 달력 패널의 [소방계획서 엑셀] + 고지 칩 — **실화면** (2026-09-22)
 *  실행: npx tsx scripts/_probe-calendar-fireplan-notice.mts   (로컬 dev :3000 + 스테이징 DB)
 *
 *  실측 채움률이 **3.2%**(308명 중 10행)라 고지가 가장 많이 뜨는 자리다. 여기서 보는 것은
 *  ①버튼이 뜨고 ②엑셀이 실제로 오고 ③고지가 칩으로 그려지고 ④칩이 그 입력면으로 보내는가다.
 *
 *  읽기 전용 — 엑셀을 받고 화면을 오갈 뿐 아무것도 쓰지 않는다.
 *  🚨 표본은 **고지에 목적지가 붙는 조각이 있는** 회차여야 한다. 못 고르면 「판정 불가」로 표시한다.
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { createClient } from '@supabase/supabase-js'

const STAMP = Date.now().toString(36)
const EMAIL = `cal-fp-${STAMP}@test.local`
const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const g = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
const db = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '계획서칩프로브', employeeId: `E2E-FP-${STAMP}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(180_000)
  try { await login(page, EMAIL) } catch (e) {
    throw new Error(`로그인 실패 — URL=${page.url()} · ${String(e).slice(0, 120)}`)
  }

  // 활성 고객의 자체점검 하나 — 패널이 열려야 하므로 special_* 이어야 한다
  const y = new Date().getFullYear()
  const { data: insps } = await db.from('inspections')
    .select('id, customer_id, plan_type').gte('year', y - 1).lte('year', y + 1)
  const { data: custs } = await db.from('customers').select('id, is_active, customer_name')
  const cm = new Map((custs ?? []).map(c => [c.id as string, c as { is_active: boolean | null; customer_name: string }]))
  const t = (insps ?? [])
    .filter(i => !i.plan_type || String(i.plan_type).startsWith('special'))
    .find(i => cm.get(i.customer_id as string)?.is_active !== false)
  if (!t) { check('표본 — 활성 고객의 자체점검', false, '못 찾음(판정 불가)'); throw new Error('표본 없음') }
  check(`표본 — ${cm.get(t.customer_id as string)?.customer_name}`, true)

  await page.goto(`${BASE}/inspections/calendar?insp=${t.id}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="daypanel-fireplan"]').waitFor({ timeout: 180_000 })
  check('★ 패널에 [소방계획서 엑셀]이 있다 (게이트 없음)', true)

  const scope = page.locator('[data-testid="daypanel-fireplan"]')
  const dl = page.waitForEvent('download', { timeout: 240_000 }).catch(() => null)
  await scope.locator('button').first().click()
  const got = await dl
  if (got) {
    const path = await got.path()
    const head = path ? readFileSync(path).subarray(0, 2).toString('latin1') : ''
    check('★ 눌러서 실제로 파일이 온다 (xlsx = PK zip)', head === 'PK', `파일명=${got.suggestedFilename()} 머리=${head}`)
  } else {
    const msg = (await scope.innerText()).replace(/\s+/g, ' ').trim()
    check('★ 눌러서 실제로 파일이 온다 (xlsx = PK zip)', false, `다운로드 없음 — 화면: ${msg.slice(0, 120)}`)
  }

  await scope.locator('[data-testid="doc-notice-list"]').waitFor({ timeout: 120_000 })
  check('★ 고지가 목록으로 그려진다', true)
  const chips = await scope.locator('[data-testid="doc-notice-chip"]').count()
  check('★ 미입력 라벨에 칩이 붙는다 (채움률 3.2%라 대부분 뜬다)', chips > 0, `${chips}개`)

  if (chips > 0) {
    const chip = scope.locator('[data-testid="doc-notice-chip"]').first()
    const label = (await chip.innerText()).trim()
    const href = await chip.getAttribute('href')
    check('칩 주소에 복귀 경로(from=)가 실려 있다', !!href?.includes('from='), href ?? '(없음)')
    check('칩이 어디로 가는지 글씨로 말한다', label.length > 1, label)
    await chip.click()
    await page.waitForURL(u => u.pathname.startsWith('/customers/'), { timeout: 120_000 })
    check('★ 칩이 고객 상세의 그 칸으로 보낸다', true, page.url())
  }
} catch (e) {
  if (!String(e).includes('표본 없음')) check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
