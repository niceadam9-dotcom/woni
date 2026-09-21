/** 달력 사이드 패널 [보고서 엑셀] — **실화면** 확인 (2026-09-21)
 *  실행: npx tsx scripts/_probe-calendar-workbook-button.mts   (로컬 dev :3000 + 스테이징 DB)
 *
 *  검사(test-calendar-workbook-button)는 판정식과 배선을 묻는다. 여기서는 **실제로 그려지는가**를
 *  눈으로 대신 확인한다. 둘 다 필요하다 — 배선이 맞아도 렌더 조건이 엉뚱하면 화면엔 안 뜬다.
 *
 *  🚨 달력을 **클릭해서 들어가지 않는다.** 칩이 그 달 표본에 의존해 흔들리는 탓에 과거 두 번
 *     거짓 빨강을 냈다([[project_due_axis_unify]]). 패널 복원 딥링크 `?insp=`로 **바로** 연다.
 *
 *  표본은 DB에서 직접 고른다 — plan_type별로 하나씩. 특히 `monthly` 표본은 badge가 「작동」이라
 *  **이 결함의 함정을 그대로 재현**한다(화면 글씨만 보면 자체점검처럼 보인다).
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { createClient } from '@supabase/supabase-js'

const EMAIL = `cal-wb-${Date.now().toString(36)}@test.local`
const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const g = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
const db = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

const y = new Date().getFullYear()

/** 🚨 표본은 **활성 고객**의 것이어야 한다. 달력은 비활성 고객의 점검을 일부러 싣지 않는데
 *  (`is_active !== false` 필터, 2026-08-28), 첫 판이 그걸 모르고 `.limit(1)`로 집어 비활성 고객
 *  「지평7」을 골랐다 — 패널이 아예 안 열려 **제품이 멀쩡한데 빨강**이 났다. 계측기부터 의심한다. */
async function sample(planType: string, generalOnly = false) {
  let q = db.from('inspections').select('id, customer_id, inspection_type, plan_type')
    .eq('plan_type', planType).gte('year', y - 1).lte('year', y + 1)
  if (generalOnly) q = q.eq('inspection_type', '일반관리')
  const { data } = await q.limit(50)
  const rows = (data ?? []) as Array<{ id: string; customer_id: string; inspection_type: string; plan_type: string }>
  if (rows.length === 0) return null
  const { data: custs } = await db.from('customers').select('id, is_active')
    .in('id', [...new Set(rows.map(r => r.customer_id))])
  const active = new Set((custs ?? []).filter(c => c.is_active !== false).map(c => c.id as string))
  return rows.find(r => active.has(r.customer_id)) ?? null
}

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '달력엑셀프로브', employeeId: `E2E-CWB-${Date.now().toString(36)}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)

  const cases = [
    { label: '자체점검 작동(special_작동)', row: await sample('special_작동'), want: true },
    { label: '자체점검 종합(special_종합)', row: await sample('special_종합'), want: true },
    { label: 'badge「일반」인 자체점검(일반관리/special_작동 — image-4)', row: await sample('special_작동', true), want: true },
    { label: '정기(monthly) — badge는 「작동」이지만 결과보고서 없음', row: await sample('monthly'), want: false },
    { label: '일반 계획(event) — 1단계', row: await sample('event'), want: false },
  ]

  for (const c of cases) {
    if (!c.row) { check(`표본 — ${c.label}`, false, '표본을 못 찾았다(판정 불가)'); continue }
    await page.goto(`${BASE}/inspections/calendar?insp=${c.row.id}`, { waitUntil: 'domcontentloaded' })
    // 패널이 열릴 때까지 — 고객명 줄이 아니라 **하단 이동 링크**를 기다린다(모든 패널에 늘 있다)
    await page.locator('[data-testid="daypanel-detail-link"]').waitFor({ timeout: 60000 })
    const has = await page.locator('[data-testid="daypanel-workbook"]').count()
    const btn = await page.locator('[data-testid="daypanel-workbook"] button').count()
    check(`${c.label} → [보고서 엑셀] ${c.want ? '뜬다' : '안 뜬다'}`,
      (has > 0) === c.want && (!c.want || btn > 0),
      `badge=${c.row.inspection_type} plan=${c.row.plan_type} 영역=${has} 버튼=${btn}`)
  }

  // 글씨가 한 벌인지 — WORKBOOK_LABEL을 따르는가(여기 또 적지 않았는지)
  const first = cases.find(c => c.want && c.row)
  if (first?.row) {
    await page.goto(`${BASE}/inspections/calendar?insp=${first.row.id}`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="daypanel-workbook"]').waitFor({ timeout: 60000 })
    const label = (await page.locator('[data-testid="daypanel-workbook"] button').first().innerText()).trim()
    check('버튼 글씨 = 「보고서 엑셀」 (WORKBOOK_LABEL 한 벌)', label.includes('보고서 엑셀'), label)

    // ★ **있는 것과 받는 것은 다르다** — 실제로 눌러서 파일이 오는지 본다.
    //   패널은 fixed·z-50이라 버튼이 무언가에 덮여 클릭이 안 닿을 수 있고, 그건 구조 단언으로는
    //   안 보인다. 받은 바이트의 머리가 `PK`(zip)인지까지 확인한다 — 200이어도 빈 몸통일 수 있다.
    const dl = page.waitForEvent('download', { timeout: 180_000 }).catch(() => null)
    await page.locator('[data-testid="daypanel-workbook"] button').first().click()
    const got = await dl
    if (got) {
      const path = await got.path()
      const head = path ? readFileSync(path).subarray(0, 2).toString('latin1') : ''
      check('★ 눌러서 실제로 파일이 온다 (xlsx = PK zip)', head === 'PK',
        `파일명=${got.suggestedFilename()} 머리=${head}`)
    } else {
      // 라우트가 사유를 띄웠다면 그 문구를 그대로 보고한다 — 조용한 실패로 넘기지 않는다
      const msg = (await page.locator('[data-testid="daypanel-workbook"]').innerText()).replace(/\s+/g, ' ').trim()
      check('★ 눌러서 실제로 파일이 온다 (xlsx = PK zip)', false, `다운로드 없음 — 화면 문구: ${msg}`)
    }
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
