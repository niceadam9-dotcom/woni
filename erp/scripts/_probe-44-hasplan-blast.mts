/** 소방계획서_44 D-5 — hasPlan 축소의 영향 범위 실측 (읽기 전용)
 *
 *  종전:  hasPlan = sections에서 annexStatus를 뺀 **키 개수** > 0
 *  신규:  hasPlan = 그 중 **내용이 있는** 키가 하나라도 있는가
 *
 *  가드를 켜기 전에 「작성 √ → 공란」으로 뒤집히는 고객이 몇인지 센다.
 *  (feedback_guard_blast_radius — 차단 정책은 영향 건수를 세고 켠다)
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-44-hasplan-blast.mts
 *  출력은 ASCII (PS 5.1 한글 뭉갬 회피)
 */
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}

/** 값에 사람이 넣은 내용이 있는가 — 빈 문자열·빈 배열·전부 빈 객체는 '없다' */
function hasContent(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (typeof v === 'number') return true
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.some(hasContent)
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(hasContent)
  return false
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.log('SKIP - env missing (environment gap, not a measurement)')
  process.exit(2)
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(url!, key!)

const { data, error } = await admin.from('fire_plan_forms').select('customer_id, sections')
if (error) { console.log(`ERROR ${error.message}`); process.exit(3) }
const rows = (data ?? []) as Array<{ customer_id: string; sections: Record<string, unknown> | null }>

let flips = 0, sameTrue = 0, sameFalse = 0
const flipRows: string[] = []
const keyStat = new Map<string, { total: number; empty: number }>()

for (const r of rows) {
  const s = (r.sections ?? {}) as Record<string, unknown>
  const keys = Object.keys(s).filter(k => k !== 'annexStatus')
  const before = keys.length > 0
  const after = keys.some(k => hasContent(s[k]))
  for (const k of keys) {
    const st = keyStat.get(k) ?? { total: 0, empty: 0 }
    st.total++
    if (!hasContent(s[k])) st.empty++
    keyStat.set(k, st)
  }
  if (before !== after) { flips++; flipRows.push(`${r.customer_id.slice(0, 8)} keys=[${keys.join(',')}]`) }
  else if (before) sameTrue++
  else sameFalse++
}

console.log(`[1] fire_plan_forms rows = ${rows.length}`)
console.log(`[2] hasPlan true->false FLIPS = ${flips}`)
console.log(`[3] unchanged true = ${sameTrue} / unchanged false = ${sameFalse}`)
for (const f of flipRows.slice(0, 20)) console.log(`    FLIP ${f}`)
console.log('[4] per-key: how often a stored section key is an empty shell')
for (const [k, st] of [...keyStat.entries()].sort((a, b) => b[1].empty - a[1].empty)) {
  console.log(`    ${k.padEnd(16)} total=${String(st.total).padStart(4)} empty=${String(st.empty).padStart(4)}`)
}

// 44의 실경로 재현: 1.10 저장이 항상 함께 보내는 4키만 있고 전부 빈 경우
const onlyForm110 = rows.filter(r => {
  const s = (r.sections ?? {}) as Record<string, unknown>
  const keys = Object.keys(s).filter(k => k !== 'annexStatus')
  return keys.length > 0 && keys.every(k => ['inspection', 'multiUse', 'fireHistory', 'dutyLog'].includes(k))
    && !keys.some(k => hasContent(s[k]))
})
console.log(`[5] rows whose only content is the empty 1.10 shell = ${onlyForm110.length}`)
