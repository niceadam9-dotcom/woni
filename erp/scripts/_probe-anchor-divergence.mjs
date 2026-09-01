// 0단계 계측 — 기산점을 사용승인일로 되돌릴 때의 영향 범위. **읽기 전용(SELECT만).**
// 실행: node scripts/_probe-anchor-divergence.mjs [envFile]   (기본 .env.local = 스테이징)
//
// 왜: 기산점이 바뀌면 (월)이 다른 고객의 연간 일정이 **통째로 다른 달로 이동**한다.
//     규모를 모르고 켜면 기존 데이터 대부분이 흔들린다(날짜 가드에 '오늘'을 넣어 전건이 막혔던 축과 같다).
//
// 분기: 불일치 <10% → A안(사용승인일 최우선) / >30% → B안(plan_anchor_manual 백필로 기존 일정 동결)
//
// ⚠ 판정 술어는 전부 ASCII·숫자 축이다 — 한글 리터럴을 질의에 넣으면 에러 없이 0건이 될 수 있다.
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
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error(`${envFile}에서 URL/SERVICE_ROLE_KEY를 찾지 못했습니다.`); process.exit(1) }
console.log(`대상 DB: ${SUPABASE_URL} (${envFile})\n`)

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// 1000행 상한을 피해 전량을 range로 긁는다 (요청당 조용히 잘린다 — risk_supabase_1000row_cap)
async function fetchAll(cols) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('customers').select(cols).range(from, from + 999)
    if (error) { console.error('조회 실패:', error.message); process.exit(1) }
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

const rows = await fetchAll('id, customer_code, customer_name, use_approval_date, plan_anchor_date, is_active, inspection_type, inspection_sub_type')
const total = rows.length
const active = rows.filter(r => r.is_active !== false)

const pct = (n, d) => d === 0 ? '—' : `${(n / d * 100).toFixed(1)}%`
const mo = s => (s ? Number(String(s).slice(5, 7)) : null)
const day = s => (s ? Number(String(s).slice(8, 10)) : null)

console.log(`고객 총 ${total}건 (활성 ${active.length} · 비활성 ${total - active.length})`)
if (total === 0) { console.log('\n⚠ 고객 0건 — 이 DB로는 영향 범위를 판정할 수 없다.'); process.exit(0) }

// ── ① 사용승인일 공백 (경고 배지 대상 규모)
const noApproval = active.filter(r => !r.use_approval_date)
console.log(`\n① 사용승인일 공백: ${noApproval.length}/${active.length} (${pct(noApproval.length, active.length)})`)
for (const r of noApproval.slice(0, 15)) console.log(`   - ${r.customer_code} ${r.customer_name}`)
if (noApproval.length > 15) console.log(`   … 외 ${noApproval.length - 15}건`)

// ── ② 점검계획일 공백 (현행 기산점 — 필수값이라 0이어야 한다)
const noAnchor = active.filter(r => !r.plan_anchor_date)
console.log(`\n② 점검계획일 공백: ${noAnchor.length}/${active.length} (${pct(noAnchor.length, active.length)}) — 필수값이라 0이 정상`)
for (const r of noAnchor.slice(0, 15)) console.log(`   - ${r.customer_code} ${r.customer_name}`)

// ── ③ 분기 근거: 둘 다 있는데 **월**이 다른 고객
const both = active.filter(r => r.use_approval_date && r.plan_anchor_date)
const divergentMo = both.filter(r => mo(r.use_approval_date) !== mo(r.plan_anchor_date))
const divergentDay = both.filter(r => mo(r.use_approval_date) === mo(r.plan_anchor_date) && day(r.use_approval_date) !== day(r.plan_anchor_date))
console.log(`\n③ 둘 다 입력된 고객: ${both.length}건`)
console.log(`   🔴 (월) 불일치: ${divergentMo.length}/${both.length} (${pct(divergentMo.length, both.length)}) ← 일정이 다른 달로 이동한다`)
console.log(`   🟡 (월) 같고 (일)만 다름: ${divergentDay.length}건 ← 같은 달 안에서 날짜만 움직인다`)
for (const r of divergentMo.slice(0, 20)) {
  console.log(`   - ${r.customer_code} ${r.customer_name}: 사용승인 ${r.use_approval_date}(${mo(r.use_approval_date)}월) ≠ 계획일 ${r.plan_anchor_date}(${mo(r.plan_anchor_date)}월)`)
}
if (divergentMo.length > 20) console.log(`   … 외 ${divergentMo.length - 20}건`)

// ── ④ 종합 대상만 따로 (2차 +6개월까지 함께 움직이므로 파급이 2배)
const comp = divergentMo.filter(r => r.inspection_sub_type === '종합')  // '종합'
console.log(`\n④ 불일치 고객 중 종합 대상: ${comp.length}건 — 1차·2차 두 자리가 함께 이동한다`)

// ── 판정
const ratio = both.length === 0 ? 0 : divergentMo.length / both.length
console.log('\n──── 분기 판정 ────')
if (both.length === 0) console.log('둘 다 입력된 고객이 0건 — 판정 불가. 다른 DB로 재측정할 것.')
else if (ratio < 0.10) console.log(`불일치 ${pct(divergentMo.length, both.length)} < 10% → **A안**(사용승인일 최우선 + plan_anchor 폴백). 소수는 배지로 개별 처리.`)
else if (ratio > 0.30) console.log(`불일치 ${pct(divergentMo.length, both.length)} > 30% → **B안**(plan_anchor_manual 백필로 기존 일정 동결, 신규만 법정 축).`)
else console.log(`불일치 ${pct(divergentMo.length, both.length)} — 10~30% 회색지대. 위 목록을 보고 사용자와 결정할 것.`)
