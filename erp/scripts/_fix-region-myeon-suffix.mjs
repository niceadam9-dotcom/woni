// 읍/면 표기 정규화 — 같은 지역이 '용문' / '용문면' 두 표기로 갈라져 지역 필터가 샌다
// 실행: node scripts/_fix-region-myeon-suffix.mjs           — 미리보기(기본, 쓰기 없음)
//       node scripts/_fix-region-myeon-suffix.mjs --apply   — 실제 적용
//       node scripts/_fix-region-myeon-suffix.mjs --apply .env.local.prod-backup   — 운영 대상
//
// 왜 고쳐야 하나 (2026-08-19 실측, 스테이징 활성 313곳):
//   용문 46 ↔ 용문면 2 · 양서 22 ↔ 양서면 1 · 강상 12 ↔ 강상면 3 · 지평 10 ↔ 지평면 9 · 서종 8 ↔ 서종면 1
// 라벨이 지저분한 정도가 아니다 — 지역 필터에서 '용문면'을 고르면 46곳이 안 나오고 2곳만 나온다.
// 지역 순회를 준비하는 담당자가 44곳을 통째로 놓친다(Q-11이 만들어진 목적이 바로 그 동선이다).
// 같은 3단 축을 쓰는 /customers/regional-assign도 같은 영향을 받는다.
//
// 방향: **다수파 표기로 통일**한다. 소수파를 고치는 쪽이 변경 건수가 훨씬 적어
// (16곳 vs 90곳+) 되돌릴 일이 생겨도 피해가 작다. 행정구역 정식 명칭(면)으로 맞추는 안은
// 사용자가 보기로 한 표기와 달라질 수 있어 택하지 않았다.
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const envFile = args.find(a => a.startsWith('.env')) ?? '.env.local'

const env = Object.fromEntries(
  readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })

console.log(`대상: ${envFile} (${env.NEXT_PUBLIC_SUPABASE_URL?.slice(8, 28)}…)`)
console.log(APPLY ? '모드: **실제 적용**\n' : '모드: 미리보기 (쓰기 없음)\n')

// 활성/비활성 전부 본다 — 비활성 고객도 나중에 되살아나면 같은 문제를 일으킨다
const { data, error } = await db.from('customers')
  .select('id, customer_name, region_si, region_myeon, is_active')
if (error) { console.error(error.message); process.exit(1) }
const rows = data ?? []

// 표기별 건수 → 접미사만 다른 짝을 찾는다
const count = new Map()
for (const r of rows) {
  const v = (r.region_myeon ?? '').trim()
  if (v) count.set(v, (count.get(v) ?? 0) + 1)
}

/** '용문면' → '용문' 처럼, 접미사를 뗀 짝이 더 많으면 그쪽으로 맞춘다 */
const rename = new Map()   // from → to
for (const [v, n] of count) {
  const m = /^(.+?)(읍|면|동)$/.exec(v)
  if (!m) continue
  const bare = m[1]
  const bareN = count.get(bare) ?? 0
  if (bareN > n) rename.set(v, bare)          // 다수파(접미사 없음)로 통일
}

if (rename.size === 0) {
  console.log('✅ 접미사만 다른 중복 표기가 없습니다 — 고칠 것이 없습니다.')
  process.exit(0)
}

console.log('— 통일 계획 (소수파 → 다수파)')
let total = 0
for (const [from, to] of rename) {
  const n = count.get(from)
  total += n
  console.log(`  ${from}(${n}곳) → ${to}(${count.get(to)}곳)`)
}
console.log(`\n  바뀌는 고객: ${total}곳`)

// 실제 대상 행을 나열한다 — 몇 곳인지가 아니라 **어느 고객인지** 보고 판단할 수 있게
const targets = rows.filter(r => rename.has((r.region_myeon ?? '').trim()))
console.log('\n— 대상 고객')
for (const t of targets) {
  const from = t.region_myeon.trim()
  console.log(`  ${t.is_active ? ' ' : '·'} ${t.customer_name}  [${t.region_si ?? '?'}] ${from} → ${rename.get(from)}`)
}
console.log('  (앞의 · 는 비활성 고객)')

if (!APPLY) {
  console.log('\n미리보기입니다. 적용하려면 --apply 를 붙여 다시 실행하세요.')
  process.exit(0)
}

console.log('\n— 적용')
let done = 0
for (const [from, to] of rename) {
  const { error: e, count: n } = await db.from('customers')
    .update({ region_myeon: to }, { count: 'exact' })
    .eq('region_myeon', from)
  if (e) { console.error(`  ❌ ${from} → ${to}: ${e.message}`); continue }
  done += n ?? 0
  console.log(`  ✅ ${from} → ${to}: ${n}곳`)
}

// 적용 후 재확인 — "몇 건 고쳤다"가 아니라 "이제 갈라진 게 없다"를 확인한다
const { data: after } = await db.from('customers').select('region_myeon')
const c2 = new Map()
for (const r of after ?? []) {
  const v = (r.region_myeon ?? '').trim()
  if (v) c2.set(v, (c2.get(v) ?? 0) + 1)
}
const left = [...c2.keys()].filter(v => {
  const m = /^(.+?)(읍|면|동)$/.exec(v)
  return m && c2.has(m[1])
})
console.log(`\n총 ${done}곳 변경`)
console.log(left.length === 0
  ? '✅ 접미사만 다른 중복 표기 0 — 지역 필터가 더 이상 갈라지지 않습니다.'
  : `⚠ 남은 중복: ${left.join(', ')}`)
