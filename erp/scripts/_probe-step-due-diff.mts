/** 공휴일 교정이 점검 6단계 마감일에 미치는 영향 (소방계획서_25 S-7) — **읽기 전용**.
 *  실행: npx tsx scripts/_probe-step-due-diff.mts [--prod]
 *
 *  왜 필요한가: 마감일은 영업일로 계산되고 영업일은 holidays가 결정한다. 공휴일이 늘면
 *  마감일이 **뒤로 밀려 법정 제출기한을 넘길 수 있고**, 줄면 앞당겨진다.
 *  교정 전에 어느 점검이 어느 방향으로 움직이는지 눈으로 보고 진행 여부를 정한다(Q-7).
 *
 *  판정은 `previewInspectionSteps`(순수 함수)를 **공휴일 집합만 바꿔 두 번** 호출해 비교한다 —
 *  화면·트리거와 같은 산식을 쓰므로 별도 재구현이 없다.
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { previewInspectionSteps } from '../src/lib/step-dates'
import { resolveHolidays } from '../src/lib/holidays'

const useProd = process.argv.includes('--prod')
config({ path: useProd ? '.env.local.prod-backup' : '.env.local', quiet: true })
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})
console.log(`대상 DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL} (${useProd ? '운영' : '스테이징'})\n`)

const STEP_LABEL = ['①점검일', '②배치확인서', '③관계인 보고', '④소방서 제출', '⑤보수 완료', '⑥이행완료']

// ── 1) 현행 DB 공휴일 (before)
const { data: cur } = await admin.from('holidays').select('date, name').order('date')
const curRows = (cur ?? []) as Array<{ date: string; name: string }>
const before = new Set(curRows.map(r => r.date))

// ── 2) 교정 후 공휴일 (after) — 현행에 든 연도 전부 + manual 보존분
const years = [...new Set(curRows.map(r => Number(r.date.slice(0, 4))))].sort()
const { data: manualRows } = await admin.from('holidays').select('date').eq('source', 'manual')
const manualDates = ((manualRows ?? []) as Array<{ date: string }>).map(r => r.date)

const after = new Set<string>(manualDates)
for (const y of years) {
  const { holidays, source, note } = await resolveHolidays(y)
  if (note) console.log(`  ⚠ ${y}: ${note}`)
  console.log(`  ${y}년 ${holidays.length}건 (${source})`)
  for (const h of holidays) after.add(h.date)
}

const added = [...after].filter(d => !before.has(d)).sort()
const removed = [...before].filter(d => !after.has(d)).sort()
console.log(`\n공휴일 변화: 추가 ${added.length}건 ${added.join(' ')} / 제거 ${removed.length}건 ${removed.join(' ')}`)
if (added.length === 0 && removed.length === 0) { console.log('\n변화 없음 — 마감일 영향도 없습니다.'); process.exit(0) }

// ── 3) 자체점검 표본으로 6단계 마감일 재계산 비교
const { data: insps } = await admin.from('inspections')
  .select('id, customer_id, inspection_start_date, inspection_end_date, plan_type, year, sequence_num, customers:customer_id(customer_name)')
  .or('plan_type.is.null,plan_type.like.special%')
  .not('inspection_start_date', 'is', null)
  .order('inspection_start_date', { ascending: false })
type Insp = {
  id: string; inspection_start_date: string; inspection_end_date: string | null
  year: number; sequence_num: number; customers: { customer_name: string } | null
}
const list = (insps ?? []) as unknown as Insp[]
console.log(`자체점검 ${list.length}건 대조\n`)

let later = 0, earlier = 0, same = 0
const rowsLater: string[] = []
const rowsEarlier: string[] = []

for (const i of list) {
  // 기준일 규칙(feedback_plan_anchor_date): 사용승인일 폴백은 제거됐다 — 점검 시작일이 기준
  const args = { startDate: i.inspection_start_date, endDate: i.inspection_end_date, useApprovalDate: null }
  const b = previewInspectionSteps({ ...args, holidays: before })
  const a = previewInspectionSteps({ ...args, holidays: after })
  const diffs = b.map((s, idx) => ({ step: idx, from: s.due_date, to: a[idx].due_date }))
    .filter(d => d.from !== d.to)
  if (diffs.length === 0) { same++; continue }

  const who = `${i.customers?.customer_name ?? '?'} ${i.year}년 ${i.sequence_num}차 (점검 ${i.inspection_start_date})`
  const detail = diffs.map(d => `${STEP_LABEL[d.step]} ${d.from}→${d.to}`).join(' · ')
  if (diffs.some(d => d.to > d.from)) { later++; rowsLater.push(`  ${who}\n      ${detail}`) }
  else { earlier++; rowsEarlier.push(`  ${who}\n      ${detail}`) }
}

console.log(`=== 뒤로 밀리는 건 ${later}건 — ⚠ 법정 기한 초과 가능, 개별 검토 필요 ===`)
rowsLater.forEach(r => console.log(r))
console.log(`\n=== 앞당겨지는 건 ${earlier}건 — 과다 공휴일 제거분(안전 방향) ===`)
rowsEarlier.forEach(r => console.log(r))
console.log(`\n변화 없음 ${same}건`)

// ── 4) 저장된 due_date와 재계산값의 차이 — Q-7(소급 재계산) 판단 자료
const { data: steps } = await admin.from('inspection_steps')
  .select('inspection_id, step_num, due_date, status')
const stepRows = (steps ?? []) as Array<{ inspection_id: string; step_num: number; due_date: string | null; status: string }>
const byInsp = new Map<string, typeof stepRows>()
for (const s of stepRows) {
  if (!byInsp.has(s.inspection_id)) byInsp.set(s.inspection_id, [])
  byInsp.get(s.inspection_id)!.push(s)
}
let storedDiff = 0, storedDiffCompleted = 0
for (const i of list) {
  const mine = byInsp.get(i.id) ?? []
  if (mine.length === 0) continue
  const a = previewInspectionSteps({
    startDate: i.inspection_start_date, endDate: i.inspection_end_date, useApprovalDate: null, holidays: after,
  })
  for (const s of mine) {
    const want = a[s.step_num - 1]?.due_date
    if (want && s.due_date && want !== s.due_date) {
      storedDiff++
      if (s.status === 'completed') storedDiffCompleted++
    }
  }
}
console.log(`\n=== 저장된 inspection_steps.due_date vs 재계산 ===`)
console.log(`  불일치 ${storedDiff}건 (그 중 이미 완료된 단계 ${storedDiffCompleted}건)`)
console.log('  ※ 저장값은 확정일 기준으로도 갱신되므로 이 차이가 곧 공휴일 탓은 아니다 — 소급 재계산(Q-7) 판단 참고용')
