/** 실 DB 왕복 — 별지 11호 완료 축이 실데이터에서 무엇을 만드나 (소방계획서_43 S5-5).
 *
 *  D-2 확증이 목적이다: 엑셀 `완료보고서!I20`에 찍히던 값이 **계획 종료일**이었는지,
 *  그리고 수리 후 **실제 완료일**(action_completed_at)로 바뀌는지를 같은 점검 건에서 나란히 본다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-43-live-done.mts */
import './_env.mjs'   // ⚠ 없으면 supabaseUrl 부재로 던진다 — env 누락을 '데이터 0건'으로 오독한 전례가 있다
import { createAdminClient } from '../src/lib/supabase/admin'
import { assembleReport9, actionPlanPeriod, annexDoneRows } from '../src/lib/report9-assemble'
import { doneCells } from '../src/lib/doc-templates/report9'
import { isoToSerial } from '../src/lib/xlsx-inject'

const admin = createAdminClient()

// 완료 처리된 불량이 있는 점검을 찾는다
const { data: defects, error } = await admin.from('inspection_defects')
  .select('inspection_id, defect_name, action_taken, action_completed_at, action_start, action_end')
  .not('action_completed_at', 'is', null)
  .order('action_completed_at', { ascending: false })
  .limit(200)
if (error) { console.error('조회 실패:', error.message); process.exit(1) }

const rows = defects ?? []
console.log(`완료 처리된 불량 ${rows.length}건 (상한 200)\n`)
if (!rows.length) {
  console.log('⚠ 완료 건이 0이라 ①② 경로를 실데이터로 재현할 수 없다 — 운영/스테이징 데이터 축 문제이지 코드 축이 아니다.')
  console.log('  (2026-08-24 업무데이터 전량 삭제 이력 참조)')
  process.exit(0)
}

const byInsp = new Map<string, typeof rows>()
for (const r of rows) {
  if (!byInsp.has(r.inspection_id)) byInsp.set(r.inspection_id, [] as never)
  byInsp.get(r.inspection_id)!.push(r)
}
console.log(`점검 ${byInsp.size}건에 걸쳐 있다\n`)

let checked = 0
for (const [inspId, ds] of [...byInsp].slice(0, 5)) {
  // ⚠ error를 함께 본다 — data만 꺼내면 임베드 모호성·없는 컬럼이 **조용한 0행**이 된다
  const { data: insp, error: iErr } = await admin.from('inspections')
    .select('id, customer_id').eq('id', inspId).maybeSingle()
  if (iErr) { console.log(`   ⚠ 점검 조회 실패: ${iErr.message}`); continue }
  if (!insp) { console.log(`   ⚠ 점검 행이 없다(고아 불량 ${ds.length}건) — inspection_id=${inspId}`); continue }
  const { data: custRow } = await admin.from('customers').select('name').eq('id', insp.customer_id).maybeSingle()
  const custName = custRow?.name ?? '?'
  console.log(`── ${custName} (${inspId.slice(0, 8)}) — 완료 ${ds.length}건 ──`)

  // 종전 엑셀이 I20에 찍던 값 = 계획 종료일(개요!G10 = actionPlanPeriod().endISO)
  const { data: allDef } = await admin.from('inspection_defects')
    .select('defect_code, defect_name, action_plan, action_start, action_end, action_taken, action_completed_at')
    .eq('inspection_id', inspId)
  const ap = actionPlanPeriod((allDef ?? []) as never)
  const planEnd = ap?.endISO ?? null

  const d9 = await assembleReport9(admin, insp.customer_id, inspId).then(r => r.data).catch(() => null)
  const fold = d9?.done ?? annexDoneRows((allDef ?? []) as never, { hasAnyDefect: true, applicable: true })
  const cells = doneCells(fold)

  console.log(`   계획 종료일(종전 I20) = ${planEnd ?? '(없음)'} ${planEnd ? `[시리얼 ${isoToSerial(planEnd)}]` : ''}`)
  console.log(`   완료 축 kind = ${fold.kind} · 전건 ${fold.rows.length} · 엑셀 ${cells.cells.length}행 (넘침 ${cells.overflow})`)
  cells.cells.forEach((c, i) => {
    const serial = c.doneISO ? isoToSerial(c.doneISO) : null
    console.log(`   B${19 + i} "${c.content.slice(0, 34)}"  I${19 + i} ${c.doneISO || '(공란)'}${serial ? ` [${serial}]` : ''}`)
  })
  // ★ D-2 확증 — 실제 완료일이 계획 종료일과 다른가
  const diff = fold.rows.filter(r => r.doneISO && r.doneISO !== planEnd)
  console.log(`   ★ 실제 완료일 ≠ 계획 종료일: ${diff.length}/${fold.rows.length}건`
    + (diff.length ? ` → 종전 엑셀은 ${diff.length}건에 틀린 날짜를 찍고 있었다` : ' (이 건은 우연히 같다)'))
  console.log('')
  checked++
}
console.log(`점검 ${checked}건 확인 완료`)
