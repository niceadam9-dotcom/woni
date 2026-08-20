/** 별지 9호 3쪽 2절 / 4호 2쪽 — 다중이용업소 **비대상** 건의 점검결과란 ／ 인쇄 회귀 프로브.
 *
 *  배경(2026-08-20): 서림사 별지9호에서 2절 16칸이 통째로 공란이었다. 원인은 1절과 2절의 비대칭 —
 *  1절(rollUpForm3Results)은 '미설치 → N(／)'을 찍는데 2절은 무응답이면 키 자체를 안 만들었다.
 *  A안 확정 = 1.10.3 다중이용업소가 아니면(미입력 포함) 남은 칸 전부 'N'. `fillNonApplicableMu`.
 *
 *  ① 규칙 축 — fillNonApplicableMu 실호출 (비대상/대상/기존값 보존)
 *  ② 렌더 축 — muResultSection 실호출로 ／ 16개·체크박스 미체크 확인
 *  ③ 실DB 축 — 조립 파이프라인(직접응답 → STD-32 파생 → 비대상 채움) 재현 + 영향 범위 실측
 *  실행: npx tsx scripts/_probe-mu-nonapplicable.mts        (③은 .env.local = 스테이징)
 *  읽기 전용 — DB·파일 무변경. */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { MU_CODES, fillNonApplicableMu, deriveMuFromStd32 } from '../src/lib/mu-std32-map'
import r9mod from '../src/lib/doc-templates/report9.ts'

const { muResultSection } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
type R = Record<string, 'O' | 'X' | 'N'>
/** 2열 표의 결과 셀만 뽑는다(비고 행 포함 17칸). _probe-report9-marks.mjs와 같은 축.
 *  class는 'center'로 시작하되 표식이 더 붙는다('mk' = 오버라이드 편집 금지, lib/doc-overrides) */
const marksOf = (html: string) => [...html.matchAll(/class="center[^"]*"[^>]*>([^<]*)</g)].map(m => m[1].trim())

// ── ① 규칙 축 ──────────────────────────────────────────────
console.log('\n=== ① fillNonApplicableMu 규칙')
check('MU_CODES 16칸', MU_CODES.length === 16, String(MU_CODES.length))

for (const [label, v] of [['false(비대상)', false], ['null(미입력)', null], ['undefined(1.10.3 없음)', undefined]] as const) {
  const out = fillNonApplicableMu({}, v as boolean | null | undefined)
  check(`${label} → 16칸 전부 N`,
    MU_CODES.length === Object.keys(out).length && MU_CODES.every(k => out[k] === 'N'),
    JSON.stringify(out))
}

const yes = fillNonApplicableMu({}, true)
check('true(다중이용업소) + 무응답 → 무변경(공란 유지)', Object.keys(yes).length === 0, JSON.stringify(yes))

const partial = fillNonApplicableMu({ 'MU-001': 'X', 'MU-003': 'O' } as R, true)
check('true + 일부 응답 → 나머지 공란(입력 대기)',
  Object.keys(partial).length === 2 && partial['MU-001'] === 'X' && partial['MU-003'] === 'O',
  JSON.stringify(partial))

const keep = fillNonApplicableMu({ 'MU-001': 'X', 'MU-003': 'O' } as R, false)
check('비대상이어도 기존 O·X는 안 덮는다',
  keep['MU-001'] === 'X' && keep['MU-003'] === 'O' && keep['MU-002'] === 'N',
  JSON.stringify(keep))

// ── ② 렌더 축 ──────────────────────────────────────────────
console.log('\n=== ② muResultSection 렌더')
const htmlN = muResultSection({ muResults: fillNonApplicableMu({}, false) })
const mN = marksOf(htmlN)
check('비대상 → ／ 16칸 인쇄', mN.filter(s => s === '/').length === 16, `실제 ${JSON.stringify(mN)}`)
check('／ 칸의 설치 체크박스는 미체크([√] 없음)', !htmlN.includes('[√]'),
  '해당없음인데 설치 √가 찍히면 안 된다')

const htmlBlank = muResultSection({ muResults: fillNonApplicableMu({}, true) })
check('다중이용업소 무응답 → 종전대로 전 칸 공란(회귀 방지)',
  marksOf(htmlBlank).every(s => s === ''), JSON.stringify(marksOf(htmlBlank)))

const htmlMix = muResultSection({ muResults: fillNonApplicableMu({ 'MU-001': 'O', 'MU-012': 'X' } as R, false) })
const mMix = marksOf(htmlMix)
check('혼합 → ○ 1 · × 1 · ／ 14',
  mMix.filter(s => s === '○').length === 1 && mMix.filter(s => s === '×').length === 1
  && mMix.filter(s => s === '/').length === 14, JSON.stringify(mMix))
check('○·× 칸에는 설치 체크박스 [√]', (htmlMix.match(/\[√\]/g) ?? []).length === 2,
  String((htmlMix.match(/\[√\]/g) ?? []).length))

// ── ③ 실DB 축 ─────────────────────────────────────────────
console.log('\n=== ③ 실 DB 조립 재현 + 영향 범위')
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
console.log('  DB:', env.NEXT_PUBLIC_SUPABASE_URL)

/** report9-actions.ts:351-354·442-444 조립 순서 재현 */
const assembleMu = (rows: Array<{ item_code: string; result: string }>, applicable: boolean | null | undefined): R => {
  const out: R = {}
  for (const r of rows) {
    if (r.item_code.startsWith('MU-') && ['O', 'X', 'N'].includes(r.result)) out[r.item_code] = r.result as 'O' | 'X' | 'N'
  }
  const by = new Map(rows.map(r => [r.item_code, r.result]))
  for (const [mu, v] of Object.entries(deriveMuFromStd32(c => by.get(c)))) if (!out[mu]) out[mu] = v
  return fillNonApplicableMu(out, applicable)
}

const { data: insps } = await admin.from('inspections')
  .select('id, customer_id, year, status, plan_type').eq('status', 'completed')
const rowsI = (insps ?? []) as Array<{ id: string; customer_id: string; year: number; plan_type: string | null }>
const custIds = [...new Set(rowsI.map(i => i.customer_id))]
const { data: forms } = await admin.from('fire_plan_forms').select('customer_id, sections').in('customer_id', custIds)
const applicableOf = new Map<string, boolean | undefined>(
  ((forms ?? []) as Array<{ customer_id: string; sections: { multiUse?: { applicable?: boolean } } | null }>)
    .map(f => [f.customer_id, f.sections?.multiUse?.applicable]))
const { data: names } = await admin.from('customers').select('id, customer_name').in('id', custIds)
const nameOf = new Map(((names ?? []) as Array<{ id: string; customer_name: string }>).map(c => [c.id, c.customer_name]))

let changed = 0, isMu = 0, hadData = 0
for (const i of rowsI) {
  const { data: resp } = await admin.from('inspection_sheet_responses')
    .select('item_code, result').eq('inspection_id', i.id)
  const rows = (resp ?? []) as Array<{ item_code: string; result: string }>
  const app = applicableOf.get(i.customer_id)
  const before = assembleMu(rows, true)          // 종전 동작 = 채움 없음
  const after = assembleMu(rows, app)
  if (app) isMu++
  if (Object.keys(before).length) hadData++
  const delta = MU_CODES.filter(k => before[k] !== after[k])
  if (delta.length) {
    changed++
    console.log(`  · ${nameOf.get(i.customer_id)} ${i.year} — 공란 ${delta.length}칸 → ／`
      + (Object.keys(before).length ? ` (기존값 ${Object.keys(before).length}칸 보존)` : ''))
  }
  // 기존에 값이 있던 칸은 어떤 경우에도 안 바뀐다
  const clobbered = Object.keys(before).filter(k => before[k] !== after[k])
  if (clobbered.length) check(`${nameOf.get(i.customer_id)} 기존값 보존`, false, clobbered.join(','))
}
console.log(`  완료점검 ${rowsI.length}건 — 다중이용업소 ${isMu}건 · MU데이터 보유 ${hadData}건 · 이번 변경으로 ／ 채워짐 ${changed}건`)

const seorim = [...nameOf].find(([, n]) => n.includes('서림사'))
if (seorim) {
  const i = rowsI.find(r => r.customer_id === seorim[0])!
  const { data: resp } = await admin.from('inspection_sheet_responses').select('item_code, result').eq('inspection_id', i.id)
  const mu = assembleMu((resp ?? []) as Array<{ item_code: string; result: string }>, applicableOf.get(i.customer_id))
  const marks = marksOf(muResultSection({ muResults: mu }))
  check('서림사 실데이터 → 2절 16칸 전부 ／', marks.filter(s => s === '/').length === 16, JSON.stringify(marks))
} else check('서림사 완료점검 존재', false, '대상 건을 못 찾음')

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
