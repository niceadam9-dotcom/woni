/** 점검달력 사이드 패널의 [보고서 엑셀] — **뜨는 조건**을 고정한다 (2026-09-21 사용자 요청)
 *  실행: npx tsx scripts/test-calendar-workbook-button.mts   (스테이징 DB · 브라우저 불필요)
 *
 *  🚨 이 검사의 급소는 「버튼이 있는가」가 **아니다**. 있는 것만 물으면 가장 위험한 실패를
 *     통째로 놓친다 — **정기(monthly) 건에도 붙는 것**이다.
 *
 *     화면 badge는 `inspection_type`인데, 1단계짜리 정기 230건이 그 badge를 「작동」(174)·
 *     「종합」(56)으로 달고 있다(2026-09-21 실측). 그 칩으로도 이 패널이 열리므로, badge를 축으로
 *     쓰면 결과보고서가 **없는** 230건에 버튼이 붙어 빈 문서를 받게 된다.
 *     결과보고서(별지 9/10/11호 + 갑지)가 실제로 있는 축은 **`plan_type`**이다.
 *
 *  🚨 `steps.length === 6`으로도 가를 수 없다. 패널의 steps는 **표시 축으로 걸러진 것**이라
 *     불량 0이면 ⑤⑥이 빠져 4개다(사용자가 신고한 image-4가 정확히 그 경우 — badge「일반」·4단계).
 *
 *  그래서 두 축을 함께 묻는다:
 *    ① 판정식이 **실데이터와 일치**하는가 — 전건에 대해 `isSelfInspection(plan_type)`가
 *       「단계 행이 2개 이상인가」(=자체점검)와 같은 답을 내는가. 단계 행 수는 판정식이 보지 않는
 *       **독립 관측치**라 항진명제가 아니다. 축을 badge로 갈아끼우면 여기서 230건이 어긋난다.
 *    ② 배선 — 서버가 그 판정으로 `hasResultReport`를 싣고, 클라이언트가 **그 값으로만** 가리는가.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { isSelfInspection } from '../src/lib/inspection-step-status.ts'
import { codeOnly } from './_code-only.mts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
const db = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

console.log('— ① 판정식이 실데이터와 일치하는가 (단계 행 수는 판정식이 안 보는 독립 관측치)')
const { data: insps, error } = await db.from('inspections').select('id, inspection_type, plan_type')
if (error) throw new Error(`점검 조회 실패: ${error.message}`)
const { data: stepRows, error: e2 } = await db.from('inspection_steps').select('inspection_id')
if (e2) throw new Error(`단계 조회 실패: ${e2.message}`)

const stepCount = new Map<string, number>()
for (const s of stepRows ?? []) {
  const k = s.inspection_id as string
  stepCount.set(k, (stepCount.get(k) ?? 0) + 1)
}

ok('표본 — 점검이 있다', (insps?.length ?? 0) > 0, `${insps?.length ?? 0}건`)

type Row = { id: string; inspection_type: string | null; plan_type: string | null }
const rows = (insps ?? []) as Row[]
const mismatches: string[] = []
let selfN = 0, planOnlyN = 0
for (const i of rows) {
  const steps = stepCount.get(i.id) ?? 0
  const expected = steps >= 2          // 자체점검 = 6단계(표시 전 원본 행)
  const got = isSelfInspection(i.plan_type)
  if (expected) selfN++; else planOnlyN++
  if (expected !== got) mismatches.push(`${i.inspection_type}/${i.plan_type} 단계${steps} → 판정 ${got}`)
}
ok(`★ 전건 일치 — 판정 = (단계 행 ≥2) [자체점검 ${selfN}건 · 1단계 ${planOnlyN}건]`,
  mismatches.length === 0, `어긋남 ${mismatches.length}건: ${mismatches.slice(0, 5).join(' | ')}`)

// 두 부류가 **둘 다 표본에 있어야** 위 단언이 뜻을 갖는다(한쪽만 있으면 공허하다)
ok('전제 — 자체점검 표본이 있다', selfN > 0, `${selfN}건`)
ok('전제 — 1단계(정기·일반) 표본이 있다', planOnlyN > 0, `${planOnlyN}건`)

console.log('\n— ★ badge를 축으로 쓰면 무너진다는 것을 표본으로 못박는다')
{
  // badge(inspection_type)가 「작동」·「종합」인데 결과보고서가 **없는** 건 — 이게 이 검사의 존재 이유다
  const badgeTrap = rows.filter(i =>
    (i.inspection_type === '작동' || i.inspection_type === '종합') && !isSelfInspection(i.plan_type))
  ok('★ badge「작동·종합」이면서 결과보고서 없는 건이 실재한다 (badge 축 금지의 근거)',
    badgeTrap.length > 0, `${badgeTrap.length}건`)
  ok('★ 그 건들에는 판정이 전부 false', badgeTrap.every(i => !isSelfInspection(i.plan_type)))
  // 반대로 badge가 「일반」인데 결과보고서가 **있는** 건(사용자 신고 image-4) — 숨기면 안 되는 쪽
  const generalWithReport = rows.filter(i => i.inspection_type === '일반관리' && isSelfInspection(i.plan_type))
  ok('★ badge「일반」이면서 결과보고서가 있는 건도 실재한다 (일반을 통째로 빼면 안 되는 근거)',
    generalWithReport.length > 0, `${generalWithReport.length}건`)
}

console.log('\n— ② 배선 — 서버가 그 판정으로 싣고, 클라이언트가 그 값으로만 가린다')
const page = codeOnly(readFileSync(new URL('../src/app/(dashboard)/inspections/calendar/page.tsx', import.meta.url), 'utf8'))
const client = codeOnly(readFileSync(new URL('../src/components/inspections/inspection-calendar-client.tsx', import.meta.url), 'utf8'))

ok('서버가 isSelfInspection을 들여온다', /import\s*\{[^}]*isSelfInspection/.test(page))
ok('★ hasResultReport를 **plan_type**으로 계산한다', /hasResultReport:\s*isSelfInspection\(\s*insp\.plan_type\s*\)/.test(page),
  page.match(/hasResultReport:[^\n]*/)?.[0] ?? '(없음)')
// 🚨 「어딘가의 select가 plan_type을 갖는가」로 물으면 안 된다 — 같은 파일의 **계획 항목 조회**가
//   이미 plan_type을 싣고 있어서, 정작 점검 조회에서 빼도 초록이 된다(변이 M3가 그렇게 뚫었다).
//   물어야 할 것은 「**점검** 조회가 싣는가」다. from('inspections')에 앵커를 건다.
{
  const m = page.match(/from\('inspections'\)[\s\S]{0,400}?\.select\('([^']*)'\)/)
  ok('★ **점검** 조회가 plan_type을 싣는다 (안 실으면 판정 입력이 늘 undefined→전건 true)',
    !!m && m[1].includes('plan_type'), m ? m[1] : '(점검 조회를 못 찾음)')
}
ok('음성 — hasResultReport를 inspection_type으로 계산하지 않는다',
  !/hasResultReport:[^\n]*inspection_type/.test(page))

ok('클라이언트가 WorkbookXlsxButton을 들여온다', /import\s*\{[^}]*WorkbookXlsxButton/.test(client))
ok('★ 패널이 hasResultReport로 가린다', /selectedInspection\.hasResultReport\s*&&/.test(client),
  client.match(/selectedInspection\.hasResultReport[^\n]*/)?.[0] ?? '(없음)')
ok('★ 버튼이 그 가림 **안쪽**에 있다 (가림과 버튼이 갈라지면 늘 뜬다)', () => {
  const m = client.match(/selectedInspection\.hasResultReport\s*&&[\s\S]{0,600}?WorkbookXlsxButton/)
  return m !== null
})
ok('음성 — 패널이 steps.length로 가리지 않는다 (표시 축이라 불량0이면 4다)',
  !/steps\.length\s*===?\s*6/.test(client))
// 🚨 부분 문자열로 물으면 안 된다 — `data-x="daypanel-workbook-removed"` 같은 것도 통과한다
//   (변이 M8이 그렇게 뚫었다). **속성째** 묻는다.
ok('표식 — 왕복 검사가 구조를 추측하지 않게 testid를 둔다',
  /data-testid=["']daypanel-workbook["']/.test(client))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
