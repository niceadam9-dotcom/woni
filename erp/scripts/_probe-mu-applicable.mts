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
  'src/components/customers/plan-form110.tsx',     // 1.10.3 입력 토글 자체
])
const srcRoot = path.join(import.meta.dirname, '..', 'src')
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name)
  return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : []
})
const offenders: string[] = []
for (const file of walk(srcRoot)) {
  const rel = path.relative(path.join(import.meta.dirname, '..'), file).replace(/\\/g, '/')
  if (ALLOWED.has(rel)) continue
  const body = readFileSync(file, 'utf8')
  body.split(/\r?\n/).forEach((ln, i) => {
    if (/\.applicable\b/.test(ln) && !/^\s*(\*|\/\/)/.test(ln)) offenders.push(`${rel}:${i + 1}`)
  })
}
check('판정 원천·입력 UI 밖에서 .applicable 직접 접근 없음', offenders.length === 0, offenders.join(', '))

console.log(`\n=== 결과 — ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
