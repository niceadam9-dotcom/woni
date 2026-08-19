// 지역 표기 실측 — 화면의 '양평군 · 강하 · (리 없음)'에서 '강하'가 '강하면'이어야 하는지 확인
// 실행: node scripts/_probe-region-suffix.mjs
import { raw } from './_e2e-helpers.mjs'

const { data, error } = await raw.from('customers')
  .select('region_si, region_myeon, region_ri')
  .eq('is_active', true)
if (error) { console.error(error.message); process.exit(1) }

const rows = data ?? []
console.log(`활성 고객 ${rows.length}곳\n`)

// 읍/면 — 접미사가 붙었는가
const myeon = new Map()
for (const r of rows) {
  const v = (r.region_myeon ?? '').trim()
  if (!v) continue
  myeon.set(v, (myeon.get(v) ?? 0) + 1)
}
const SUFFIX = /(읍|면|동|리|가)$/
const bare = [...myeon.entries()].filter(([v]) => !SUFFIX.test(v)).sort((a, b) => b[1] - a[1])
const ok = [...myeon.entries()].filter(([v]) => SUFFIX.test(v)).sort((a, b) => b[1] - a[1])

console.log(`— 읍/면 값 ${myeon.size}종`)
console.log(`  접미사 있음: ${ok.length}종 (${ok.slice(0, 6).map(([v, n]) => `${v}×${n}`).join(', ')}${ok.length > 6 ? ' …' : ''})`)
console.log(`  ★ 접미사 없음: ${bare.length}종 — ${bare.map(([v, n]) => `${v}×${n}`).join(', ') || '(없음)'}`)

// '강하'처럼 접미사만 다른 짝이 실제로 있는가 = 같은 지역이 두 표기로 갈라졌는가
const pairs = bare.filter(([v]) => ['읍', '면', '동'].some(s => myeon.has(v + s)))
console.log(`  ★★ 같은 지역이 두 표기로 갈라진 경우: ${pairs.length ? pairs.map(([v, n]) => `${v}(${n}) ↔ ${['읍','면','동'].map(s=>v+s).filter(x=>myeon.has(x)).map(x=>`${x}(${myeon.get(x)})`).join('/')}`).join(', ') : '없음'}`)

// 리 — 빈 값이 얼마나 되나 ('(리 없음)' 묶음이 화면을 뒤덮는 이유)
const noRi = rows.filter(r => (r.region_myeon ?? '').trim() && !(r.region_ri ?? '').trim()).length
const withMyeon = rows.filter(r => (r.region_myeon ?? '').trim()).length
console.log(`\n— 리 표기`)
console.log(`  읍/면은 있고 리가 빈 고객: ${noRi} / ${withMyeon}곳 (${withMyeon ? Math.round(noRi / withMyeon * 100) : 0}%)`)
console.log(`  → 이 비율이 높으면 화면에 '(리 없음)'이 반복돼 소음이 된다`)

// 시/군도 같이
const si = new Map()
for (const r of rows) {
  const v = (r.region_si ?? '').trim()
  if (!v) continue
  si.set(v, (si.get(v) ?? 0) + 1)
}
console.log(`\n— 시/군 ${si.size}종: ${[...si.entries()].sort((a,b)=>b[1]-a[1]).map(([v,n])=>`${v}×${n}`).join(', ')}`)
const noSi = rows.filter(r => !(r.region_si ?? '').trim()).length
console.log(`  지역 미상(시/군 빈 값): ${noSi}곳`)
