/** 소방계획서_44 검증 — 별지 9호 2쪽 3행 확정 자리 이관 (S5-1·S5-3·S5-4)
 *
 *  A. 해석 사슬(순수) — 자동 / 소방계획서 확정 / 레거시 폴백 / **다른 해 확정은 안 먹는다**
 *  B. 자동 판정 — annexStatus 자신이 「작성」 근거가 되면 안 된다(자기 자신을 근거로 삼는 함정)
 *  C. 실DB 조립 — Q-4 회귀: 아무도 안 골랐으면 「보관」 √가 인쇄되지 않는다(종전엔 작성=보관으로 찍혔다)
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-44-prev-year-duty.mts
 *  출력은 ASCII (PS 5.1 한글 뭉갬 회피)
 */
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}

const {
  judgePrevYearDutyAuto, resolvePrevYearDuty, annexStatusOtherYears, prevYearDutyLines,
} = await import('../src/lib/prev-year-duty.ts')
type Auto = Awaited<ReturnType<typeof judgePrevYearDutyAuto>>

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`)
  ok ? pass++ : fail++
}

// ── A. 해석 사슬 ─────────────────────────────────────────────────────────────
console.log('[A] resolve chain')
const AUTO: Auto = { year: 2025, hasPlan: true, opDone: true, compDone: false, eduDone: false, drillDone: false }

const a1 = resolvePrevYearDuty(AUTO, null, {})
check('A1 no confirmation -> auto as-is', a1.opDone && !a1.compDone && a1.hasPlan)
check('A1 negatives never asserted by auto', !a1.opNone && !a1.compNone && !a1.eduNone && !a1.planNone)

const a2 = resolvePrevYearDuty(AUTO, { prevYear: { '2025': { edu: '실시' } } }, {})
check('A2 plan confirm YES overrides auto(false)', a2.eduDone && !a2.eduNone)

const a3 = resolvePrevYearDuty(AUTO, { prevYear: { '2025': { op: '미실시' } } }, {})
check('A3 plan confirm NO beats auto(true)', !a3.opDone && a3.opNone)

// ⭐ 44의 핵심 — 값에 연도가 새겨져 있으므로 작년 확정이 올해 칸으로 새지 않는다(D-3 소멸)
const a4 = resolvePrevYearDuty(AUTO, { prevYear: { '2024': { op: '미실시', edu: '실시' } } }, {})
check('A4 other-year confirmation does NOT apply', a4.opDone && !a4.opNone && !a4.eduDone)
check('A4 other years are surfaced, not swallowed',
  annexStatusOtherYears({ prevYear: { '2024': { op: '미실시' } } }, 2025).join(',') === '2024')

const a5 = resolvePrevYearDuty(AUTO, null, { prevOpDone: '미실시' })
check('A5 legacy annex_inputs still read (Q-3 fallback)', !a5.opDone && a5.opNone)

const a6 = resolvePrevYearDuty(AUTO, { prevYear: { '2025': { op: '실시' } } }, { prevOpDone: '미실시' })
check('A6 plan wins over legacy', a6.opDone && !a6.opNone)

// Q-4 — 「보관」에는 원천이 없다. 아무도 안 골랐으면 양쪽 공란
check('A7 stored blank when nobody chose (was: followed hasFirePlan)', !a1.stored && !a1.unstored)
const a8 = resolvePrevYearDuty(AUTO, { plan: { stored: '보관' } }, {})
check('A8 stored YES only when chosen', a8.stored && !a8.unstored)
const a9 = resolvePrevYearDuty(AUTO, { plan: { written: '미작성', stored: '보관' } }, {})
check('A9 written=NO kills both stored cells', a9.planNone && !a9.hasPlan && !a9.stored && !a9.unstored)

// 화면 요약 3줄 — 확정을 그대로 비추는가(작성 패널 1단이 이 문자열을 그린다)
const lines = prevYearDutyLines(a3)
check('A10 summary lines mirror the resolved marks',
  lines.length === 3
  && /작동 ☐실시 ☑미실시/.test(lines[1].text)
  && /☑작성 ☐미작성 · ☐보관 ☐미보관/.test(lines[0].text),
  lines.map(l => `${l.label}:${l.text}`).join(' | '))

// ── B. 자동 판정 — annexStatus 자기참조 금지 ────────────────────────────────
console.log('[B] auto judge')
const stubAdmin = (rows: Array<{ inspection_type: string }>) => ({
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: rows }) }) }) }) }),
}) as unknown as Parameters<typeof judgePrevYearDutyAuto>[0]

const bOnlyStatus = await judgePrevYearDutyAuto(stubAdmin([]), {
  customerId: 'x', year: 2025, sections: { annexStatus: { plan: { written: '' } } },
})
check('B1 annexStatus alone is NOT evidence of a written plan', !bOnlyStatus.hasPlan)
const bWithForm = await judgePrevYearDutyAuto(stubAdmin([]), {
  customerId: 'x', year: 2025, sections: { annexStatus: {}, training: { records: [] } },
})
check('B2 any real section still counts as written', bWithForm.hasPlan)

const bTraining = await judgePrevYearDutyAuto(stubAdmin([]), {
  customerId: 'x', year: 2025,
  sections: { training: { records: [{ year: '2025', kind: '교육' }, { year: '2024', kind: '훈련' }] } },
})
check('B3 training judged per year & kind (1.11.4 source)', bTraining.eduDone && !bTraining.drillDone)

const bGeneral = await judgePrevYearDutyAuto(stubAdmin([{ inspection_type: '일반관리' }]), {
  customerId: 'x', year: 2025, sections: {}, inspectionSubType: '종합',
})
check('B4 general customer sub_type restores the axis', bGeneral.compDone && !bGeneral.opDone)

// ── C. 실DB 조립 (환경이 있을 때만) ─────────────────────────────────────────
console.log('[C] live assemble')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.log('  SKIP - env missing (this is an environment gap, not a pass)')
} else {
  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(url, key)
  const { assembleReport9 } = await import('../src/lib/report9-assemble.ts')
  const { renderReport9 } = await import('../src/lib/doc-templates/report9.ts')
  const { data } = await admin.from('inspections')
    .select('id, customer_id').in('status', ['in_progress', 'completed'])
    .order('created_at', { ascending: false }).limit(5)
  const rows = (data ?? []) as Array<{ id: string; customer_id: string }>
  if (!rows.length) {
    console.log('  SKIP - no sample inspection (environment gap)')
  } else {
    let checked = 0
    for (const { id, customer_id } of rows) {
      const res = await assembleReport9(admin as never, customer_id, id)
      const d = res.data as unknown as Record<string, unknown>
      if (!d || typeof d !== 'object' || !('hasFirePlan' in d)) continue
      checked++
      const html = renderReport9(d as never)
      const storedMark = /\[√\]보관/.test(html)
      // 확정이 없는 건에서 보관 √가 찍히면 Q-4 회귀다(종전 동작).
      check(`C ${id.slice(0, 8)} stored mark == resolved field`, storedMark === !!d.firePlanStored,
        `html=${storedMark} field=${!!d.firePlanStored}`)
      if (d.hasFirePlan && !d.firePlanStored) {
        check(`C ${id.slice(0, 8)} written but stored blank (Q-4)`, !storedMark)
      }
    }
    if (!checked) console.log('  SKIP - assemble returned no data for samples (environment gap)')
  }
}

console.log(`\nPASS ${pass} / FAIL ${fail}`)
process.exit(fail ? 1 : 0)
