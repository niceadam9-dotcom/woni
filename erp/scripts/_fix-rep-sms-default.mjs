// 대표 기본 수신 백필 (2026-08-19 사용자 확정)
//
// 왜 필요한가: '해제하면 안 보낸다'를 켜려면(pickContacts의 false 분기) 기존 고객이
// **명시적 체크 상태**여야 한다. 지금은 전원 NULL(미결정)이라 폴백 1명으로 대표에게 가는데,
// 그 상태에서 해제 의미만 바꾸면 아무 변화가 없다(여전히 NULL이라 폴백).
// 대표를 true로 못 박아 두면 화면의 체크가 실제 상태와 일치하고, 끄면 정말로 꺼진다.
//
// 안전: 대표 1명 true = 종전 폴백과 결과가 같다(문자량 불변). 이미 수신 지정이 있는 고객은
//       건드리지 않는다. 실측(2026-08-19): 회귀 위험 0곳.
//
// 실행: node scripts/_fix-rep-sms-default.mjs          (미리보기)
//       node scripts/_fix-rep-sms-default.mjs --apply
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

const APPLY = process.argv.includes('--apply')

// 대상 DB — 인자로 env 파일을 주면 그쪽(운영 등), 없으면 기본 .env.local(스테이징).
//   node scripts/_fix-rep-sms-default.mjs .env.local.prod-backup          (운영 미리보기)
//   node scripts/_fix-rep-sms-default.mjs .env.local.prod-backup --apply  (운영 적용)
const envArg = process.argv.slice(2).find(a => a.startsWith('.env'))
let url = SUPABASE_URL, key = SERVICE_ROLE_KEY
if (envArg) {
  const env = Object.fromEntries(
    readFileSync(new URL(`../${envArg}`, import.meta.url), 'utf8').split(/\r?\n/)
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  )
  url = env.NEXT_PUBLIC_SUPABASE_URL; key = env.SUPABASE_SERVICE_ROLE_KEY
}
console.log(`대상: ${envArg ?? '.env.local'} (${url?.slice(8, 28)}…) · ${APPLY ? '**적용**' : '미리보기'}`)

const admin = createClient(url, key, { auth: { persistSession: false } })

const { data, error } = await admin
  .from('customer_contacts')
  .select('id, customer_id, role, name, phone, sms_recipient')
if (error) { console.error('조회 실패:', error.message); process.exit(1) }

const byCust = new Map()
for (const r of data ?? []) {
  const a = byCust.get(r.customer_id) ?? []
  a.push(r); byCust.set(r.customer_id, a)
}

const targets = []
let skipDecided = 0, skipNoRep = 0
for (const [, cs] of byCust) {
  // 이미 누군가 켜져 있거나 명시적으로 꺼 둔 고객 = 사람이 결정한 상태다. 건드리지 않는다.
  if (cs.some(c => c.sms_recipient === true || c.sms_recipient === false)) { skipDecided++; continue }
  const rep = cs.find(c => c.role === '대표')
  if (!rep) { skipNoRep++; continue }
  targets.push(rep)
}

console.log(`고객 ${byCust.size}곳 · 대표 체크 대상 ${targets.length}곳`)
console.log(`  건너뜀: 이미 결정됨 ${skipDecided}곳 · 대표 없음 ${skipNoRep}곳`)

if (!APPLY) {
  for (const t of targets.slice(0, 5)) console.log(`  PLAN ${t.name ?? '(이름없음)'} ${t.phone ?? '(번호없음)'}`)
  if (targets.length > 5) console.log(`  … 외 ${targets.length - 5}곳`)
  console.log('\n미리보기입니다 — 반영하려면 --apply')
} else {
  let ok = 0
  for (const t of targets) {
    const { error: e } = await admin.from('customer_contacts')
      .update({ sms_recipient: true }).eq('id', t.id)
    if (e) console.error(`  실패 ${t.name}: ${e.message}`)
    else ok++
  }
  // 반영 후 다시 읽어 확인한다 — update 응답만 믿지 않는다
  const { data: after } = await admin.from('customer_contacts').select('customer_id, role, sms_recipient')
  const m = new Map()
  for (const r of after ?? []) { const a = m.get(r.customer_id) ?? []; a.push(r); m.set(r.customer_id, a) }
  let undecided = 0
  for (const [, cs] of m) if (!cs.some(c => c.sms_recipient === true || c.sms_recipient === false)) undecided++
  console.log(`\n반영 ${ok}/${targets.length}곳 · 검증: 아직 미결정인 고객 ${undecided}곳(대표 없는 곳만 남아야 정상)`)
  process.exitCode = ok === targets.length ? 0 : 1
}
