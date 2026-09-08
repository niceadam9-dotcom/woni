/** 소방계획서_41 실측(읽기 전용) — 실제 회차로 assembleReport9를 돌려 조립 축을 검증한다.
 *  ① 전 defectRow에 userEntered 불리언이 새겨진다
 *  ② applicableGroups ⊆ DEFECT_GROUPS·기타 제외·안전시설등=다중이용업 축과 일치
 *  ③ fold 4상태 분포 눈검사용 출력(그룹별 kind)
 *  실행: npx tsx --conditions=react-server scripts/_probe-41-live.mts */
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { assembleReport9 } = await import('../src/lib/report9-assemble.ts')
const { DEFECT_GROUPS, foldDefectGroups } = await import('../src/lib/doc-templates/report9.ts')

let pass = 0, fail = 0, withLedger = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`)
  ok ? pass++ : fail++
}

// 자체점검 회차 표본 — 불량 유무가 섞이도록 최근 것부터
const { data } = await admin.from('inspections')
  .select('id, customer_id, inspection_type, status')
  .in('status', ['in_progress', 'completed'])
  .order('created_at', { ascending: false }).limit(8)
const rows = (data ?? []) as Array<{ id: string; customer_id: string; inspection_type: string | null; status: string }>
if (!rows.length) { console.log('표본 회차 0건 — 판정 불가(환경 축)'); process.exit(2) }

for (const r of rows) {
  let d
  try { ({ data: d } = await assembleReport9(admin as never, r.customer_id, r.id)) }
  catch (e) { console.log(`\n${r.id.slice(0, 8)} 조립 실패(축 밖): ${e instanceof Error ? e.message : String(e)}`); continue }
  console.log(`\n${r.id.slice(0, 8)} type=${r.inspection_type} defects=${d.defectRows.length}`)
  check('userEntered 전 행 명시', d.defectRows.every(x => typeof x.userEntered === 'boolean'))
  const ag = d.applicableGroups
  // 2026-09-08: 대장이 비면 **미공급이 정답**이다(모르는 것을 「해당없음」으로 단정하지 않는다).
  check('대장 공란이면 미공급·아니면 공급', d.facilityChecks.length === 0 ? ag === undefined : Array.isArray(ag),
    `facilityChecks=${d.facilityChecks.length} ag=${ag ? ag.length : 'undefined'}`)
  if (!ag) continue
  check('DEFECT_GROUPS 부분집합', ag.every(g => (DEFECT_GROUPS as readonly string[]).includes(g)))
  check('기타는 항상 미해당(Q-1)', !ag.includes('기타'))
  // ⚠ 종전엔 조립기와 **같은 식**(multiUseCounts 키 존재)으로 재계산해 비교하는 항진 검사였다 —
  //   8쪽이 2쪽과 갈라진 실결함을 구조적으로 못 잡았다. 2쪽이 인쇄하는 값(multiUseNone)과 대조한다.
  check('안전시설등 = 2쪽 다중이용업 축', ag.includes('안전시설등') === !d.multiUseNone,
    `ag=${ag.includes('안전시설등')} 2쪽해당=${!d.multiUseNone} counts=${Object.keys(d.multiUseCounts).length}`)
  withLedger++
  const folds = foldDefectGroups(d.defectRows, ag)
  console.log('  fold: ' + DEFECT_GROUPS.map(g => `${g}=${folds.get(g)!.kind}`).join(' '))
}

// ⚠ 정체(正體) 판정 — 표본이 전부 대장 공란이면 위 단언들은 **한 번도 안 돌고** 초록이 된다.
//   개수만 세면 그 공허를 못 본다(소방계획서_38 교훈). 양성 경로 표본 0건은 실패로 알린다.
check(`양성 경로 표본(대장 있는 회차) ≥ 1 — ${withLedger}/${rows.length}`, withLedger > 0,
  withLedger === 0 ? '전 표본이 대장 공란 — fold 발동 경로는 이 실행에서 검증되지 않았다(환경 축)' : '')

console.log(`\n결과: ${pass}/${pass + fail}${fail ? ` FAIL ${fail}` : ''}`)
process.exit(fail ? 1 : 0)
