/** 고지 → 채우러 가기 → 돌아오기 — **한 바퀴 실화면** (2026-09-22)
 *  실행: npx tsx scripts/_probe-calendar-notice-roundtrip.mts   (로컬 dev :3000 + 스테이징 DB)
 *
 *  이 프로브 하나가 R1~R5의 이음매를 전부 문다:
 *    패널 → [보고서 엑셀] → 고지가 **두 덩이로** 그려짐 → 칩 클릭 → 그 입력면 도착
 *    → [←] → **달력 패널이 다시 열리고** → 「입력을 마치고 돌아오셨습니다」 배너
 *
 *  읽기 전용 — 엑셀을 받고 화면을 오갈 뿐 아무것도 쓰지 않는다.
 *  🚨 표본은 **고지에 채울 것이 있는** 자체점검이어야 한다. 못 고르면 「판정 불가」로 표시한다
 *     (빨강이 아니다) — 표본을 잘못 골라 제품이 멀쩡한데 빨개진 전례가 있다.
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { createClient } from '@supabase/supabase-js'
import { parseWorkbookNotice, splitNoticeParts } from '../src/lib/workbook-notice.ts'

const STAMP = Date.now().toString(36)
const EMAIL = `cal-rt-${STAMP}@test.local`
const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const g = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
const db = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '고지왕복프로브', employeeId: `E2E-RT-${STAMP}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(120_000)
  try { await login(page, EMAIL) } catch (e) {
    throw new Error(`로그인 실패 — URL=${page.url()} · ${String(e).slice(0, 120)}`)
  }

  // 활성 고객의 자체점검 중 **고지에 채울 것이 있는** 건을 고른다
  const y = new Date().getFullYear()
  const { data: insps } = await db.from('inspections')
    .select('id, customer_id, plan_type').gte('year', y - 1).lte('year', y + 1)
  const { data: custs } = await db.from('customers').select('id, is_active, customer_name')
  const cm = new Map((custs ?? []).map(c => [c.id as string, c as { is_active: boolean | null; customer_name: string }]))
  const cands = (insps ?? [])
    .filter(i => !i.plan_type || String(i.plan_type).startsWith('special'))
    .filter(i => cm.get(i.customer_id as string)?.is_active !== false)

  let target: { id: string; name: string } | null = null
  for (const c of cands) {
    const res = await page.request.get(`${BASE}/inspections/${c.id}/workbook`, { timeout: 180_000 })
    const raw = res.headers()['x-workbook-missing'] ?? ''
    if (!raw) continue
    const g2 = splitNoticeParts(parseWorkbookNotice(decodeURIComponent(raw)))
    // 「회차 축에 채울 것」과 「상한」이 **둘 다** 있어야 두 덩이 분리를 눈으로 확인할 수 있다
    if (g2.fixable.length > 0 && g2.caps.length > 0) {
      target = { id: c.id as string, name: cm.get(c.customer_id as string)?.customer_name ?? '—' }
      break
    }
  }
  if (!target) { check('표본 — 채울 것과 상한이 둘 다 있는 회차', false, '못 찾음(판정 불가)'); throw new Error('표본 없음')  }
  check(`표본 — ${target.name}`, true)

  // ── 1) 패널에서 엑셀을 받고 고지가 두 덩이로 그려지는가 ──
  await page.goto(`${BASE}/inspections/calendar?insp=${target.id}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="daypanel-workbook"]').waitFor({ timeout: 120_000 })
  const dl = page.waitForEvent('download', { timeout: 180_000 }).catch(() => null)
  await page.locator('[data-testid="daypanel-workbook"] button').first().click()
  await dl
  await page.locator('[data-testid="doc-notice-list"]').waitFor({ timeout: 120_000 })
  check('★ 고지가 목록으로 그려진다', true)

  const chips = await page.locator('[data-testid="doc-notice-chip"]').count()
  const caps = await page.locator('[data-testid="doc-notice-caps"]').count()
  check('★ 채울 수 있는 것에 칩이 붙는다', chips > 0, `${chips}개`)
  check('★ 채울 수 없는 것(상한)은 **따로** 그려진다', caps === 1, `${caps}개 덩이`)
  const capText = caps ? (await page.locator('[data-testid="doc-notice-caps"]').innerText()) : ''
  check('상한 덩이가 「채울 수 없습니다」라고 말한다', capText.includes('채울 수 없습니다'), capText.slice(0, 60))

  // ── 2) 칩을 눌러 그 입력면으로 가는가 ──
  const chip = page.locator('[data-testid="doc-notice-chip"]').first()
  const chipHref = await chip.getAttribute('href')
  check('칩 주소에 복귀 경로(from=)가 실려 있다', !!chipHref?.includes('from='), chipHref ?? '(없음)')
  await chip.click()
  await page.waitForURL(u => !u.pathname.includes('/inspections/calendar'), { timeout: 120_000 })
  check('★ 칩이 그 입력면으로 보낸다', true, page.url())

  // ── 3) 돌아오면 패널이 열리고 재발행 배너가 뜨는가 ──
  //     [←]가 있으면 그것으로, 없으면 칩에 실린 from= 주소로 되돌아간다(같은 경로다)
  const back = page.locator('[data-testid="sheet-entry-back"]')
  if (await back.count()) await back.first().click()
  else {
    // ⚠ `from=`은 **상대 경로**다 — 그대로 goto하면 Playwright가 invalid URL로 거부한다
    const rel = new URL(chipHref!, BASE).searchParams.get('from') ?? ''
    await page.goto(new URL(rel, BASE).toString(), { waitUntil: 'domcontentloaded' })
  }

  await page.locator('[data-testid="daypanel-workbook"]').waitFor({ timeout: 120_000 })
  check('★ 돌아오면 **그 회차 패널이 다시 열린다**', page.url().includes('/inspections/calendar'), page.url())
  /* ⚠ **effect가 돌기 전에 세면 안 된다.** 배너는 마운트 후 effect(쪽지 소비)에서 켜지므로
     `count()`를 즉시 부르면 0이 나온다 — 첫 판이 그렇게 거짓 빨강을 냈다(제품은 멀쩡했다).
     보일 때까지 기다린다. */
  const resumeOk = await page.locator('[data-testid="daypanel-workbook-resume"]')
    .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
  check('★ 「입력을 마치고 돌아오셨습니다」 배너가 뜬다 (쪽지가 소비됐다)', resumeOk,
    resumeOk ? '' : '30초 안에 안 떴다')
} catch (e) {
  if (!String(e).includes('표본 없음')) check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
