// 「달력과 점검업무가 반드시 일치해야 합니다」 — 마감일 축 일치 불변식 (2026-09-21 사용자 지시)
//
// 왜 생겼나: 두 화면이 **서로 다른 산식**을 쓰고 있었다.
//   달력   `inspection_steps.due_date` (확정일 기준 영업일 — computeStepDates)
//   작업대 `lib/annex-due` 우선 (④=점검 **종료일**+15영업일 / ⑥=보수완료일+10영업일), ⑤=이행기간 종료일
// 기산점이 아예 달라 같은 회차를 다른 날짜로 말했다(실측 스테이징: ④ 33건 중 5건, ⑥ 2건 중 2건,
// 최대 23일 차이). **한쪽은 D-day만, 한쪽은 날짜만** 보여준 탓에 비교가 불가능해 아무도 몰랐다.
// 어느 쪽이 맞는지는 운영 하늘촌 2026-1이 갈랐다(6단계 전부 computeStepDates와 일치).
//
// 이 검사가 지키는 것 — 화면 문구가 아니라 **두 화면이 읽는 값**이 같은가:
//   A 작업대가 쓰는 마감(page.tsx dueByStep)이 달력이 쓰는 칸과 같은 원천인가 — 소스 축
//   B 실제 화면에서 같은 회차의 같은 단계가 **같은 날짜**를 말하는가 — 행위 축
//   C 보이는 단계 집합도 같은가(불량 0건이면 양쪽 다 ④까지)
//
// ⚠ 소스 단언(A)만으로는 부족하다 — 모양은 맞고 값만 안 흐르는 결함을 이 저장소에서 네 번 겪었다.
//   그래서 B가 **받은 화면**을 읽는다.
//
// 실행: npx tsx scripts/test-due-axis-parity.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { readFileSync } from 'node:fs'
import { visibleStepNums, isSelfInspection, hasSheetDefect } from '../src/lib/inspection-step-status'

const EMAIL = 'due-parity@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
/** 주석을 걷어낸 코드만 — 설명하는 글에 단언이 걸리는 함정을 피한다(CRLF 포함) */
const codeOnly = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).filter(l => !l.trimStart().startsWith('//')).join('\n')

try {
  // ── A 소스 축 — 작업대가 달력과 **같은 칸**에서 읽는가 ──────────────────────
  {
    const page = codeOnly(src('src/app/(dashboard)/inspections/[id]/page.tsx'))
    check('A 작업대 마감은 inspection_steps에서 온다(dueByStep)',
      /dueByStep\s*=\s*new Map\(steps\.map/.test(page))
    for (const [n, key] of [[4, 'due9'], [6, 'due11']] as const) {
      check(`A ${key} = dueByStep.get(${n})`,
        new RegExp(`const ${key} = dueByStep\\.get\\(${n}\\)`).test(page))
    }
    check('A ⑤도 같은 칸', /repair:\s*\{\s*due:\s*dueByStep\.get\(5\)/.test(page))
    // 🚨 폴백이 곧 두 번째 축이다 — 되살아나면 두 화면이 다시 갈라진다
    check('🚨 A 법정 산식으로 **폴백하지 않는다**(폴백 = 두 번째 축)',
      !/due9\s*=.*report9DueISO/.test(page) && !/due11\s*=.*report11DueISO/.test(page))
    const wb = codeOnly(src('src/components/inspections/inspection-workbench.tsx'))
    check('A 스텝바 D-day도 같은 칸(legal 우선 제거)',
      /const due = st\?\.due_date \?\? null/.test(wb) && !/legal\?\.due \?\? st\?\.due_date/.test(wb))
  }

  // ── 표본 고르기 — 단계 행이 있고 활성인 자체점검 회차 ─────────────────────
  const iq = await raw.from('inspections')
    .select('id, customer_id, year, sequence_num, plan_type, status').eq('status', 'in_progress').limit(60)
  if (iq.error) throw new Error(iq.error.message)
  const insps = (iq.data ?? []) as Array<{ id: string; customer_id: string; year: number; sequence_num: number; plan_type: string | null; status: string }>
  const ids = insps.map(i => i.id)
  const sq = await raw.from('inspection_steps').select('inspection_id, step_num, due_date, status').in('inspection_id', ids)
  if (sq.error) throw new Error(sq.error.message)
  const byInsp = new Map<string, Map<number, { due: string | null; status: string }>>()
  for (const s of (sq.data ?? []) as Array<{ inspection_id: string; step_num: number; due_date: string | null; status: string }>) {
    if (!byInsp.has(s.inspection_id)) byInsp.set(s.inspection_id, new Map())
    byInsp.get(s.inspection_id)!.set(s.step_num, { due: s.due_date, status: s.status })
  }
  // 불량 축 — 보이는 단계 집합(C)을 계산하려면 필요하다
  const dq = await raw.from('inspection_defects').select('inspection_id').in('inspection_id', ids)
  const xq = await raw.from('inspection_sheet_responses').select('inspection_id').in('inspection_id', ids).eq('result', 'X')
  const cnt = (rows: Array<{ inspection_id: string }> | null) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) m.set(r.inspection_id, (m.get(r.inspection_id) ?? 0) + 1)
    return m
  }
  const defCnt = cnt(dq.data as Array<{ inspection_id: string }>), xCnt = cnt(xq.data as Array<{ inspection_id: string }>)

  // 미완료 단계가 있는 회차(= 마감이 화면에 뜨는 회차)를 고른다 — 완료면 '완료 날짜'가 대신 뜬다
  const target = insps.find(i => {
    const m = byInsp.get(i.id)
    return m && [...m.values()].some(v => v.status !== 'completed' && v.due)
  })
  check('표본 — 미완료 단계가 있는 진행 중 회차를 찾았다', !!target, `${insps.length}건 조회`)

  // ── C 보이는 단계 집합이 같은가 (전수) ───────────────────────────────────
  {
    let mismatch = 0
    const samples: string[] = []
    for (const i of insps) {
      const m = byInsp.get(i.id)
      if (!m) continue
      const needs = hasSheetDefect({ defectsTotal: defCnt.get(i.id) ?? 0, sheetX: xCnt.get(i.id) ?? 0, axisIncomplete: false })
      const visible = visibleStepNums(isSelfInspection(i.plan_type), needs)
      // 달력도 같은 축(lib/active-steps isStepVisible)을 쓴다 — 두 화면이 같은 함수를 부르는지 소스로 못박는다
      const dbRows = [...m.keys()].sort((a, b) => a - b)
      const notCovered = visible.filter(n => !dbRows.includes(n))
      if (notCovered.length) { mismatch++; if (samples.length < 4) samples.push(`${i.year}-${i.sequence_num}: 보여야 할 ${notCovered} 행 없음`) }
    }
    check('C 보여야 할 단계의 행이 전부 있다', mismatch === 0, samples.join(' · '))
    const cal = codeOnly(src('src/app/(dashboard)/inspections/calendar/page.tsx'))
    check('🚨 C 달력도 같은 표시 축을 쓴다(isStepVisible)', /isStepVisible\(/.test(cal))
  }

  if (target) {
    const l = await launch()
    browser = l.browser
    const page = l.page
    userId = await mkUser({ email: EMAIL, name: '마감축', employeeId: 'E2E-DUEAX' })
    await login(page, EMAIL)

    // ── B 행위 축 — 작업대 스텝바가 DB 마감과 **같은 날짜**를 말하는가 ──────
    await page.goto(`${BASE}/inspections/${target.id}`)
    await page.waitForSelector('[data-testid="workbench-stepbar"]', { timeout: 60000 })
    const bar = await page.locator('[data-testid="workbench-stepbar"]').innerText()
    const m = byInsp.get(target.id)!
    const KEY_OF: Record<number, string> = { 1: 'checklist', 2: 'cert', 3: 'ownerReport', 4: 'submit9', 5: 'repair', 6: 'submit11' }
    let shown = 0, wrong: string[] = []
    for (const [n, v] of m) {
      if (v.status === 'completed' || !v.due) continue
      const btn = page.locator(`[data-testid="workbench-stepbar"] button[data-step="${KEY_OF[n]}"]`)
      if (!(await btn.count())) continue      // 감춰진 단계(⑤⑥ 해당없음)는 대상이 아니다
      const t = (await btn.innerText()).replace(/\s+/g, ' ')
      shown++
      // A-1: 스텝바는 「마감 MM-DD · D-N」으로 말한다 — DB 마감의 월·일이 그대로 있어야 한다
      if (!t.includes(`마감 ${v.due.slice(5, 10)}`)) wrong.push(`${n}단계 DB=${v.due} 화면="${t}"`)
    }
    check('B 스텝바에 마감이 뜬 미완료 단계가 있다', shown > 0, `${shown}개`)
    check('★ B 작업대가 말하는 마감 = DB(달력이 읽는 칸) 마감',
      wrong.length === 0, wrong.join(' · ') || `${shown}개 대조`)
    check('★ A-1 스텝바가 **날짜와 D-day를 함께** 말한다(종전엔 D-day만)',
      /마감 \d{2}-\d{2} · (D-\d+|초과 \d+일)/.test(bar), bar.slice(0, 160))

    // ── B-1 달력 패널의 단계 링크가 6단계 전부 살아 있는가(소스 축) ─────────
    {
      const links = codeOnly(src('src/lib/inspection-step-links.ts'))
      for (const n of [2, 3, 4, 6]) {
        check(`B-1 ${n}단계 링크가 생겼다(종전 null)`, new RegExp(`case ${n}:`).test(links))
      }
      check('B-1 ②③④⑥은 작업대 그 칸으로(?step=N)', /\?step=\$\{n\}/.test(links) || /step=\$\{n\}/.test(links))
      check('B-1 ①은 전용 입력 화면 그대로', /\/sheet\?sheet=auto/.test(links))
      check('B-1 ⑤는 불량표 앵커 그대로', /\?step=5#defects/.test(links))
    }
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary()
