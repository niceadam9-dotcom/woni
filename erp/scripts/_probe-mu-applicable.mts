/** 다중이용업소 '해당 여부' 3개 인쇄 지점 일치 회귀 프로브. 읽기 전용(DB·파일 무변경).
 *
 *  요구(2026-08-20 사용자 확정): "어느 쪽이든 먼저 입력되면 3곳이 모두 동일해야 하고,
 *  한쪽이 수정되면 다른 쪽도 수정되어야 한다." → 판정을 lib/multi-use 한 곳으로 모으고,
 *  **인쇄 결과로** 세 지점이 같은지 확인한다(호출부가 몰래 갈라지면 여기서 깨진다).
 *
 *   A 별지 9호 2쪽 다중이용업소현황 '해당없음' 체크   — renderReport9 HTML
 *   B 별지 9호 3쪽 2절 / 4호 2쪽 MU 16칸 전부 ／      — muResultSection HTML
 *   C 소방계획서 서식 1.10 '해당없음' 체크            — buildFirePlanHtml HTML(실데이터 기반)
 *
 *  네 가지 입력 형태를 전부 넣는다: 섹션 부재 / 토글 미선택 / false / true.
 *  실행: npx tsx --conditions=react-server scripts/_probe-mu-applicable.mts */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
async function load<T>(p: string): Promise<T> {
  const m = await import(p) as Record<string, unknown>
  return (m.default ?? m) as T
}
const mu = await load<typeof import('../src/lib/multi-use.ts')>('../src/lib/multi-use.ts')
const map = await load<typeof import('../src/lib/mu-std32-map.ts')>('../src/lib/mu-std32-map.ts')
const r9 = await load<typeof import('../src/lib/doc-templates/report9.ts')>('../src/lib/doc-templates/report9.ts')

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** 1.10.3이 가질 수 있는 형태 전부 — '비대상으로 볼 것인가'의 기대값과 함께 */
const SHAPES: Array<{ label: string; mu: { applicable?: boolean } | null | undefined; none: boolean }> = [
  { label: '섹션 부재(1.10.3 미저장)', mu: undefined, none: true },
  { label: 'null', mu: null, none: true },
  { label: '토글 미선택(applicable 부재)', mu: {}, none: true },
  { label: 'applicable=false', mu: { applicable: false }, none: true },
  // applicable=true는 '해당' 분기의 상세 행까지 렌더된다 — 칸이 비어도 죽지 않아야 하므로
  // 일부러 **최소 형태**(applicable만)로 둔다. 여기서 터지면 그게 결함이다(users 미보유 과거 행).
  { label: 'applicable=true(최소 형태)', mu: { applicable: true }, none: false },
]

// ── 0. 판정 함수 ────────────────────────────────────────────────────────────
console.log('=== 0. lib/multi-use 판정')
for (const s of SHAPES) {
  check(`${s.label} → 해당없음 ${s.none}`, mu.isMultiUseNone(s.mu) === s.none)
  check(`${s.label} → 여집합 성립`, mu.isMultiUseApplicable(s.mu) === !mu.isMultiUseNone(s.mu))
}

// ── A. 별지 9호 2쪽 ─────────────────────────────────────────────────────────
// 2쪽 다중이용업소현황 마지막 줄이 '[√]해당없음'인지. 조립부(report9-actions)가 넘기는 값과
// 같은 식을 여기서 다시 쓰지 않도록, multiUseNone은 반드시 isMultiUseNone으로 만든다.
const BASE9 = {
  ckOp: false, ckInitial: false, ckCompEtc: false, customerName: '', purpose: '', address: '',
  inspPeriod: '', inspDays: '', companyName: '', companyPhone: '', consent: null, reportEmail: '',
  main: null, assistants: [], reportDate: '', submitTo: '', repRole: '', ownerName: '', ownerPhone: '',
  managerGrade: '', mgrName: '', mgrPhone: '', mgrEduDate: '', hasFirePlan: false,
  prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false, insuranceJoined: null,
  insCompany: '', insPeriod: '', insPerson: '', insProperty: '', multiUseCounts: {},
  permitDate: '', useApprovalDate: '', totalArea: '', buildingArea: '', households: '',
  floorsAbove: '', floorsBelow: '', heightM: '', buildingCount: '',
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  elvR: '', elvE: '', elvV: '', pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
  rampCount: '', stairsCount: '', facilityChecks: [], resultMarks: {}, muResults: {}, defectRows: [],
}
console.log('\n=== A. 별지 9호 2쪽 다중이용업소현황')
const noneChecked9 = (section: { applicable?: boolean } | null | undefined) => {
  const html = r9.renderReport9({ ...BASE9, multiUseNone: mu.isMultiUseNone(section) } as never)
  return /\[√\]해당없음/.test(html)
}
for (const s of SHAPES) check(`${s.label} → [√]해당없음 = ${s.none}`, noneChecked9(s.mu) === s.none)

// ── B. 별지 9호 3쪽 2절 / 4호 2쪽 MU 16칸 ───────────────────────────────────
console.log('\n=== B. MU 16칸 (별지 9호 3쪽 2절 = 별지 4호 2쪽)')
const allSlashed = (section: { applicable?: boolean } | null | undefined) => {
  const res = map.fillNonApplicableMu({}, mu.isMultiUseApplicable(section))
  const html = r9.muResultSection({ muResults: res })
  // 결과 셀은 class="center"에 다른 클래스가 붙을 수 있다(2026-08-20 'mk' 추가) —
  // 클래스 문자열 전체 일치로 잡으면 무관한 스타일 변경에 프로브가 깨진다.
  return [...html.matchAll(/class="[^"]*\bcenter\b[^"]*"[^>]*>([^<]*)</g)]
    .filter(m => m[1].trim() === '/').length === 16
}
for (const s of SHAPES) check(`${s.label} → 16칸 전부 ／ = ${s.none}`, allSlashed(s.mu) === s.none)

// ── C. 소방계획서 서식 1.10 ─────────────────────────────────────────────────
// 순수 렌더라 실데이터를 한 번 조립한 뒤 forms.multiUse만 갈아끼워 네 형태를 모두 본다.
console.log('\n=== C. 소방계획서 서식 1.10')
let cRan = false
try {
  const adminMod = await load<typeof import('../src/lib/supabase/admin.ts')>('../src/lib/supabase/admin.ts')
  const gen = await load<typeof import('../src/lib/fire-plan-generate.ts')>('../src/lib/fire-plan-generate.ts')
  const tpl = await load<typeof import('../src/lib/fire-plan-template.ts')>('../src/lib/fire-plan-template.ts')
  const admin = adminMod.createAdminClient()
  const { data: forms } = await admin.from('fire_plan_forms').select('customer_id').limit(1)
  const target = ((forms ?? [])[0] as { customer_id: string } | undefined)?.customer_id
  if (!target) throw new Error('fire_plan_forms 없음')
  const asm = await gen.assembleFirePlan(admin, target, 2026) as { data: { forms: Record<string, unknown> } }
  for (const s of SHAPES) {
    const data = { ...asm.data, forms: { ...asm.data.forms, multiUse: s.mu ?? undefined } }
    const html = tpl.buildFirePlanHtml(data as never, [])
    // '해당 여부' 행만 잘라 그 안의 체크 상태를 본다 (☑/□ 표기는 ck() 규약)
    const row = /해당 여부<\/th><td[^>]*>([\s\S]*?)<\/td>/.exec(html)?.[1] ?? ''
    const noneOn = /■\s*해당없음|☑\s*해당없음|\[√\]\s*해당없음/.test(row)
    check(`${s.label} → 해당없음 체크 = ${s.none}`, noneOn === s.none, `행: ${row.replace(/\s+/g, ' ').trim()}`)
  }
  cRan = true
} catch (e) {
  console.log(`  ⚠ 건너뜀(DB 접근 실패?): ${(e as Error).message}`)
}
check('C축 실행됨(조용히 건너뛰지 않음)', cRan, 'DB 없이 통과하면 3곳 일치가 검증되지 않는다')

// ── D. 소스 가드 — 판정을 직접 읽는 곳이 새로 생기지 않게 ──────────────────
// A축은 renderReport9에 값을 넣어 보는 검사라 **조립부(report9-actions)는 못 덮는다**
// ('use server' 파일이라 스크립트에서 import 불가). 그 구멍을 소스 축으로 막는다:
// `.applicable`을 직접 읽어도 되는 곳은 판정 원천과 입력 UI 둘뿐이다.
console.log('\n=== D. 소스 가드 (.applicable 직접 접근)')
const ALLOWED = new Set([
  'src/lib/multi-use.ts',                          // 판정 원천
  // 1.10.3 입력 토글 자체 — 2026-09-09(43 S7) 서식 1.4 「기타」 아래로 이사했다.
  // 면제를 **옮긴 것이지 늘린 것이 아니다**: plan-form110은 더 이상 토글을 갖고 있지 않으므로
  // 그 항목을 남겨 두면 낡은 면제가 되어 그 파일의 새 위반을 조용히 통과시킨다.
  'src/components/customers/plan-multi-use-card.tsx',
])
const srcRoot = path.join(import.meta.dirname, '..', 'src')
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name)
  return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : []
})
// ⚠ 패턴을 **다중이용업 문맥으로 한정**한다(2026-09-08 정정).
//   종전엔 `.applicable`이 든 줄을 전부 잡았다. `applicable`은 흔한 낱말이라, 다른 축이 같은
//   이름을 쓰는 순간 오탐이 난다 — 실제로 별지 11호 완료 축이 `annexDoneRows(rows, ctx:
//   { hasAnyDefect, applicable })`를 도입하자(report9-assemble.ts:198·218) 이 가드가 빨개졌다.
//   그건 '해당하는 불량 구분이 있는가'(:818 applicableGroups.length > 0)라 다중이용업과 무관하다.
//   **울지 말아야 할 때 우는 가드는 무시당한다** — 그리고 이 프로브는 test-all에 등재조차
//   안 돼 있어서, 빨간 채로 아무도 모르고 지나가고 있었다(둘이 겹치면 가드가 없는 것과 같다).
//   그래서 다중이용업 문맥의 식별자에 붙은 `.applicable`만 잡는다.
const MU_APPLICABLE = /\b(mu|muSection|multiUse|multi_use|muInfo|muData)\w*\s*(\?\.|\.|\]\s*\.)\s*applicable\b/i
const MU_BRACKET = /\[\s*['"]multiUse['"]\s*\][\s\S]{0,40}?\.applicable\b/
const offenders: string[] = []
for (const file of walk(srcRoot)) {
  const rel = path.relative(path.join(import.meta.dirname, '..'), file).replace(/\\/g, '/')
  if (ALLOWED.has(rel)) continue
  const body = readFileSync(file, 'utf8')
  body.split(/\r?\n/).forEach((ln, i) => {
    if (/^\s*(\*|\/\/)/.test(ln)) return                       // 주석은 규약 설명이라 제외
    if (MU_APPLICABLE.test(ln) || MU_BRACKET.test(ln)) offenders.push(`${rel}:${i + 1}`)
  })
}
check('다중이용업 판정을 원천 밖에서 직접 읽는 곳 없음', offenders.length === 0, offenders.join(', '))

// 좁힌 만큼 **판별자가 살아 있는지**를 함께 단언한다 — 패턴을 좁히면 늘 통과하는 가드가 되기 쉽다.
// 진짜 위반 모양을 만들어 넣어 잡히는지 보고, 무관한 `.applicable`은 안 잡히는지도 본다.
const bait = [
  "  const on = muSection.applicable === true",
  "  const on2 = mu?.applicable",
  "  const on3 = (sections['multiUse'] as X).applicable",
]
const innocent = [
  "  return { kind: ctx.applicable ? 'ok' : 'na', rows: [] }",
  "  applicable: applicableGroups ? applicableGroups.length > 0 : true,",
]
const caught = bait.filter(l => MU_APPLICABLE.test(l) || MU_BRACKET.test(l)).length
const falsePos = innocent.filter(l => MU_APPLICABLE.test(l) || MU_BRACKET.test(l)).length
check(`D2 판별자 생존 — 위반 모양 ${bait.length}종을 전부 잡는다`, caught === bait.length, `잡은 것 ${caught}/${bait.length}`)
check('D3 무관한 .applicable은 잡지 않는다(오탐 재발 방지)', falsePos === 0, `오탐 ${falsePos}건`)

console.log(`\n=== 결과 — ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
