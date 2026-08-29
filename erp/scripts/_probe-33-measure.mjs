// 소방계획서_33 S6-1 — 백필 대상 행 수 실측 (읽기 전용).
// 실행: node scripts/_probe-33-measure.mjs [envFile]
// 한글 술어를 SQL/PostgREST로 넘기면 조용히 0건이 되므로(feedback_no_powershell_text_edit),
// 필터는 ASCII 축(sequence_num·plan_type LIKE 'special%')으로만 걸고 한글 비교는 JS에서 한다.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const envFile = process.argv[2] || '.env.local'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const env = Object.fromEntries(
  readFileSync(join(root, envFile), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })
console.log(`대상 DB: ${env.NEXT_PUBLIC_SUPABASE_URL} (${envFile})\n`)

const JONGHAP = String.fromCodePoint(0xC885, 0xD569)   // 종합
const JAKDONG = String.fromCodePoint(0xC791, 0xB3D9)   // 작동
const ILBAN   = String.fromCodePoint(0xC77C, 0xBC18, 0xAD00, 0xB9AC)  // 일반관리
const SOBANG  = String.fromCodePoint(0xC18C, 0xBC29, 0xC548, 0xC804, 0xAD00, 0xB9AC) // 소방안전관리
const label = v => v === null || v === undefined ? 'null'
  : v === JONGHAP ? 'JONGHAP' : v === JAKDONG ? 'JAKDONG'
  : v === ILBAN ? 'ILBAN' : v === SOBANG ? 'SOBANG' : JSON.stringify(v)

function tally(rows, keyFn) {
  const m = new Map()
  for (const r of rows) { const k = keyFn(r); m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

// ── 고객 축 ──
const { data: custs, error: ce } = await admin.from('customers')
  .select('id, inspection_type, inspection_category, inspection_sub_type')
if (ce) { console.error('customers 조회 실패:', ce.message); process.exit(1) }
console.log(`[customers] 총 ${custs.length}건`)
for (const [k, n] of tally(custs, c => `type=${label(c.inspection_type)} cat=${label(c.inspection_category)} sub=${label(c.inspection_sub_type)}`))
  console.log(`   ${k} : ${n}`)
const isComp = c => c.inspection_sub_type === JONGHAP || (c.inspection_sub_type == null && c.inspection_type === JONGHAP)
const compIds = new Set(custs.filter(isComp).map(c => c.id))
console.log(`   -> 종합 대상 고객(새 트리거 술어): ${compIds.size}건\n`)

// ── plan_items 축 ──
const { data: pi, error: pe } = await admin.from('inspection_plan_items')
  .select('id, customer_id, sequence_num, plan_type, inspection_type, inspection_category, inspection_sub_type')
  .eq('sequence_num', 2)
if (pe) { console.error('plan_items 조회 실패:', pe.message); process.exit(1) }
console.log(`[inspection_plan_items] sequence_num=2 총 ${pi.length}건`)
for (const [k, n] of tally(pi, r => `plan_type=${JSON.stringify(r.plan_type)} type=${label(r.inspection_type)} cat=${label(r.inspection_category)} sub=${label(r.inspection_sub_type)}`))
  console.log(`   ${k} : ${n}`)
const piSpecial = pi.filter(r => (r.plan_type ?? '').startsWith('special'))
const piTarget = piSpecial.filter(r => r.inspection_category !== ILBAN)
console.log(`   -> special_* 한정: ${piSpecial.length}건 / 그중 일반관리 제외(백필 대상): ${piTarget.length}건`)
console.log(`   -> 그중 고객이 종합 대상이 아닌 행(가드 위반 선재): ${piTarget.filter(r => !compIds.has(r.customer_id)).length}건\n`)

// ── inspections 축 ──
// inspections에는 inspection_category·inspection_sub_type 컬럼이 없다(실측) — 관리유형은 고객 축으로만 판정한다.
const custById = new Map(custs.map(c => [c.id, c]))
const { data: ins, error: ie } = await admin.from('inspections')
  .select('id, customer_id, sequence_num, plan_type, inspection_type, status')
  .eq('sequence_num', 2)
if (ie) { console.error('inspections 조회 실패:', ie.message); process.exit(1) }
console.log(`[inspections] sequence_num=2 총 ${ins.length}건`)
for (const [k, n] of tally(ins, r => `plan_type=${JSON.stringify(r.plan_type)} type=${label(r.inspection_type)} custCat=${label(custById.get(r.customer_id)?.inspection_category)}`))
  console.log(`   ${k} : ${n}`)
const insSpecial = ins.filter(r => (r.plan_type ?? '').startsWith('special'))
const insTarget = insSpecial.filter(r => custById.get(r.customer_id)?.inspection_category !== ILBAN)
console.log(`   -> special_* 한정: ${insSpecial.length}건 / 그중 일반관리 제외(백필 대상): ${insTarget.length}건`)
console.log(`   -> plan_type이 null인 seq2(레거시): ${ins.filter(r => r.plan_type == null).length}건\n`)

// ── seq2 점검표 응답 (소급 피해 축) ──
if (insTarget.length > 0) {
  const ids = insTarget.map(r => r.id)
  const { data: resp, error: re } = await admin.from('inspection_sheet_responses')
    .select('id, inspection_id').in('inspection_id', ids)
  if (re) console.log(`[sheet_responses] 조회 실패: ${re.message}`)
  else {
    console.log(`[inspection_sheet_responses] 백필 대상 seq2 점검 ${ids.length}건에 달린 응답: ${resp.length}건`)
    if (resp.length > 0) {
      const byIns = tally(resp, r => r.inspection_id)
      for (const [k, n] of byIns.slice(0, 10)) console.log(`   insp=${k} : ${n}건`)
      console.log('   ⚠ 응답이 있으면 점검표 범위 축소(종합 -> 작동)로 소급 항목이 사라질 수 있다.')
    }
  }
} else {
  console.log('[inspection_sheet_responses] 백필 대상 seq2 점검 0건 — 소급 피해 없음')
}
console.log()

// ── SMS 템플릿 {점검종류} 사용 여부 (S6-3) ──
{
  // 실측: message_templates 컬럼은 key/subject/body (id·name·content 아님 — 메일 서식)
  const TOKEN = String.fromCodePoint(0xC810, 0xAC80, 0xC885, 0xB958)  // 점검종류
  const { data: tpl, error: te } = await admin.from('message_templates').select('key, subject, body')
  if (te) console.log(`[message_templates] 조회 실패: ${te.message}`)
  else {
    const hit = (tpl ?? []).filter(t => `${t.subject ?? ''}${t.body ?? ''}`.includes(TOKEN))
    console.log(`[message_templates] 총 ${(tpl ?? []).length}건 / {점검종류} 사용: ${hit.length}건`)
    for (const t of hit) console.log(`   - key=${t.key}`)
  }
  const { data: st, error: se } = await admin.from('settings').select('key, value')
  if (se) console.log(`[settings] 조회 실패: ${se.message}`)
  else {
    const hit = (st ?? []).filter(s => JSON.stringify(s.value ?? '').includes(TOKEN))
    console.log(`[settings] 총 ${(st ?? []).length}건 / {점검종류} 사용: ${hit.length}건`)
    for (const s of hit) console.log(`   - key=${s.key} :: ${JSON.stringify(s.value).slice(0, 200)}`)
  }
}
