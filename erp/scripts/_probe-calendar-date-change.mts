/** 점검일자 고치기 — **실화면** 확인 (2026-09-22)
 *  실행: npx tsx scripts/_probe-calendar-date-change.mts   (로컬 dev :3000 + 스테이징 DB)
 *
 *  검사(test-inspection-date-change)는 판정식과 배선을 묻는다. 여기서는 **실제로 그려지고
 *  저장되는가**를 본다.
 *
 *  🚨 **실데이터를 부수지 않는다.** 이 프로브는 실제 회차의 날짜를 옮기므로, 옮긴 뒤
 *     **같은 경로로 원래 날짜로 되돌린다**(finally에서도 한 번 더). 되돌림까지가 검사다 —
 *     2026-09-21에 고아 E2E가 실데이터 ⭐를 소프트 삭제한 전례가 있다([[risk_e2e_wrecks_real_data]]).
 *     `resolveStepDates`가 결정적이므로 같은 날짜로 되돌리면 단계 마감일도 원래 값으로 돌아온다.
 *
 *  🚨 달력을 **클릭해서 들어가지 않는다** — 칩은 그 달 표본에 의존해 흔들린다. `?insp=` 딥링크로 연다.
 *  🚨 표본은 **활성 고객**의 것이어야 한다(달력이 비활성 고객 건을 싣지 않는다).
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { createClient } from '@supabase/supabase-js'

const EMAIL = `cal-dc-${Date.now().toString(36)}@test.local`
const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const g = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
const db = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

type Sample = { id: string; name: string; start: string }

/** 활성 고객의 자체점검을 허용/막힘으로 갈라 하나씩 고른다 */
async function samples(): Promise<{ allowed?: Sample; blocked?: Sample }> {
  const y = new Date().getFullYear()
  const { data: insps } = await db.from('inspections')
    .select('id, customer_id, plan_type, inspection_start_date').gte('year', y - 1).lte('year', y + 1)
  const self = (insps ?? []).filter(i => !i.plan_type || String(i.plan_type).startsWith('special'))
  const { data: steps } = await db.from('inspection_steps').select('inspection_id, step_num, status')
  const by = new Map<string, Array<{ n: number; s: string }>>()
  for (const s of steps ?? []) {
    const k = s.inspection_id as string
    if (!by.has(k)) by.set(k, [])
    by.get(k)!.push({ n: s.step_num as number, s: String(s.status) })
  }
  const { data: custs } = await db.from('customers').select('id, is_active, customer_name')
  const cm = new Map((custs ?? []).map(c => [c.id as string, c as { is_active: boolean | null; customer_name: string }]))
  const out: { allowed?: Sample; blocked?: Sample } = {}
  for (const i of self) {
    const c = cm.get(i.customer_id as string)
    if (!c || c.is_active === false) continue
    const st = by.get(i.id as string) ?? []
    const key = st.some(x => x.n >= 2 && x.s === 'completed') ? 'blocked' : 'allowed'
    if (!out[key]) out[key] = { id: i.id as string, name: c.customer_name, start: String(i.inspection_start_date) }
    if (out.allowed && out.blocked) break
  }
  return out
}

const stepRows = async (id: string) => {
  const { data } = await db.from('inspection_steps').select('step_num, due_date').eq('inspection_id', id).order('step_num')
  return (data ?? []) as Array<{ step_num: number; due_date: string | null }>
}
const stepDates = async (id: string) => (await stepRows(id)).map(s => `${s.step_num}:${s.due_date}`).join(',')

/** 🚨 원상복구는 **재계산에 기대지 않고 원래 값을 되쓴다.**
 *  첫 판은 같은 날짜로 되돌리면 마감일도 돌아올 줄 알았는데, 저장된 마감일이 산식값과
 *  **다를 수 있다**(실측: 자체점검 32건 중 4건). 그 경우 되돌림이 원래 값을 산식값으로 덮는다 —
 *  검사가 실데이터를 조용히 고치는 것이다([[risk_e2e_wrecks_real_data]]). */
const restoreSteps = async (id: string, rows: Array<{ step_num: number; due_date: string | null }>) => {
  for (const r of rows) {
    await db.from('inspection_steps').update({ due_date: r.due_date })
      .eq('inspection_id', id).eq('step_num', r.step_num)
  }
}
const startOf = async (id: string) => {
  const { data } = await db.from('inspections').select('inspection_start_date').eq('id', id).maybeSingle()
  return String((data as { inspection_start_date: string } | null)?.inspection_start_date ?? '')
}

let userId = '', browser: { close: () => Promise<void> } | null = null
let restore: { id: string; date: string } | null = null

try {
  // ⚠ 로그인을 **먼저** 한다. 표본 조회(여러 번의 전량 질의)를 앞에 두면 로그인이 20초 창을
  //   넘겨 죽었다(2026-09-22 실측 — 최소 재현으로 로그인 자체는 멀쩡함을 확인했다).
  //   브라우저 일을 먼저 끝내고 DB 조회를 뒤로 민다.
  userId = await mkUser({ email: EMAIL, name: '날짜변경프로브', employeeId: `E2E-DC-${Date.now().toString(36)}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(60000)
  try {
    await login(page, EMAIL)
  } catch (e) {
    // 로그인 실패는 계측기 쪽 사고가 잦다 — 어디서 멈췄는지 화면을 남긴다
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ')
    throw new Error(`로그인 실패 — URL=${page.url()} · 화면="${body}" · 원인=${String(e).slice(0, 120)}`)
  }
  const s = await samples()

  // ── 1) 막힘 표본 — 버튼이 없고 **사유가 보인다** ──
  if (!s.blocked) check('표본 — 2단계 이상 완료 건', false, '표본 없음(판정 불가)')
  else {
    await page.goto(`${BASE}/inspections/calendar?insp=${s.blocked.id}`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="daypanel-anchor-date"]').waitFor({ timeout: 60000 })
    const edit = await page.locator('[data-testid="anchor-date-edit"]').count()
    const blocked = await page.locator('[data-testid="anchor-date-blocked"]').count()
    const reason = blocked ? (await page.locator('[data-testid="anchor-date-blocked"]').innerText()).trim() : ''
    check(`막힘(${s.blocked.name}) — [고치기] 없음`, edit === 0, `버튼 ${edit}개`)
    check(`막힘(${s.blocked.name}) — 사유가 보인다`, blocked === 1 && reason.includes('단계'), reason || '(사유 없음)')
    check('막힘 사유가 **왜** 막는지 말한다', reason.includes('서류'), reason)
  }

  // ── 2) 허용 표본 — 버튼이 있고, 미리보기가 뜨고, 실제로 저장된다 ──
  if (!s.allowed) check('표본 — 1단계까지만 완료된 건', false, '표본 없음(판정 불가)')
  else {
    const { id, name, start } = s.allowed
    const beforeRows = await stepRows(id)          // 되돌릴 때 **그대로 되쓸** 원본
    const beforeSteps = beforeRows.map(r => `${r.step_num}:${r.due_date}`).join(',')
    await page.goto(`${BASE}/inspections/calendar?insp=${id}`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="daypanel-anchor-date"]').waitFor({ timeout: 60000 })
    check(`허용(${name}) — [고치기] 있음`, (await page.locator('[data-testid="anchor-date-edit"]').count()) === 1)

    await page.locator('[data-testid="anchor-date-edit"]').click()
    await page.locator('[data-testid="anchor-date-modal"]').waitFor({ timeout: 30000 })
    check('모달이 열린다', true)

    // 하루 뒤로 옮겨 본다 — 되돌릴 것이므로 restore를 **먼저** 세운다
    const d = new Date(`${start}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)
    const moved = d.toISOString().slice(0, 10)
    restore = { id, date: start }

    await page.locator('[data-testid="anchor-date-input"]').fill(moved)
    await page.locator('[data-testid="anchor-date-preview"]').waitFor({ timeout: 60000 })
    const rows = await page.locator('[data-testid="anchor-date-preview"] tbody tr').count()
    check('★ 재계산 미리보기가 단계별로 뜬다', rows >= 4, `${rows}행`)

    await page.locator('[data-testid="anchor-date-save"]').click()
    await page.locator('[data-testid="anchor-date-modal"]').waitFor({ state: 'detached', timeout: 60000 })

    check('★ 점검일자가 실제로 바뀐다', (await startOf(id)) === moved, `DB=${await startOf(id)} 기대=${moved}`)
    const afterSteps = await stepDates(id)
    check('★ 1~6단계 마감일이 함께 재계산된다', afterSteps !== beforeSteps, `before=${beforeSteps}`)

    // ── 되돌리기 — 같은 화면 경로로 원상복구하고 **원래 값과 같은지** 확인 ──
    await page.goto(`${BASE}/inspections/calendar?insp=${id}`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="anchor-date-edit"]').waitFor({ timeout: 60000 })
    await page.locator('[data-testid="anchor-date-edit"]').click()
    await page.locator('[data-testid="anchor-date-input"]').fill(start)
    await page.locator('[data-testid="anchor-date-preview"]').waitFor({ timeout: 60000 })
    await page.locator('[data-testid="anchor-date-save"]').click()
    await page.locator('[data-testid="anchor-date-modal"]').waitFor({ state: 'detached', timeout: 60000 })

    check('★ 되돌리면 점검일자가 원래대로', (await startOf(id)) === start, `DB=${await startOf(id)} 기대=${start}`)

    /* 마감일은 **원래 값을 되쓴다.** 같은 날짜로 되돌려도 산식값이 원래 저장값과 다를 수 있어
       (실측 32건 중 4건) 재계산에 기대면 실데이터를 조용히 고친다. 되쓴 뒤 일치를 확인한다. */
    await restoreSteps(id, beforeRows)
    check('★ 단계 마감일이 원래 값으로 복구됐다 (프로브가 실데이터를 남기지 않는다)',
      (await stepDates(id)) === beforeSteps, `now=${await stepDates(id)} / before=${beforeSteps}`)
    restore = null   // 정상 복구됨
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  // 도중에 죽었으면 DB로 직접 되돌린다 — 실데이터를 옮겨 둔 채 끝내지 않는다
  if (restore) {
    const { error } = await db.from('inspections')
      .update({ inspection_start_date: restore.date }).eq('id', restore.id)
    console.error(`⚠ 프로브가 중단돼 날짜를 직접 복구했습니다(${restore.id} → ${restore.date})`
      + `${error ? ` — 복구 실패: ${error.message} · 수동 확인 필요` : ''}`
      + ' · 단계 마감일은 [점검일자 고치기]로 한 번 더 저장해 재계산하세요')
  }
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
