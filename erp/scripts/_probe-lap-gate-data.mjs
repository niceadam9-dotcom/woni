/** 「①이 설비 확인으로 갈리는」 조건이 실데이터에서 **몇 건이나 서는가** (읽기 전용).
 *
 *  갈림 조건(lib/facility-verify-gate): 활성 건물 total>0 AND unverified>0
 *  → 건물이 **0동**이면 조건이 안 선다. 그러면 사용자 눈에는 기능이 통째로 없는 것과 같다.
 *
 *  실행:
 *    스테이징  node scripts/_probe-lap-gate-data.mjs
 *    운영      SB_URL=… SB_KEY=… node scripts/_probe-lap-gate-data.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

let url = process.env.SB_URL, key = process.env.SB_KEY
if (!url || !key) {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const pick = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(env)?.[1] ?? '').trim()
  url = pick('NEXT_PUBLIC_SUPABASE_URL')
  key = pick('SUPABASE_SERVICE_ROLE_KEY')
}
const db = createClient(url, key, { auth: { persistSession: false } })
console.log(`DB = ${url.replace(/^https:\/\//, '').slice(0, 12)}…`)

const page = async (t, sel, f) => {
  const out = []
  for (let i = 0; ; i += 1000) {
    let q = db.from(t).select(sel).order('id').range(i, i + 999)
    if (f) q = f(q)
    const { data, error } = await q
    if (error) { console.log(`  조회 실패 ${t}: ${error.message}`); break }
    out.push(...data); if (data.length < 1000) break
  }
  return out
}

// 진행 중 자체점검 회차 = 달력에서 ①을 누를 수 있는 모집단
const insps = await page('inspections', 'id, customer_id, status',
  q => q.eq('status', 'in_progress'))
const custIds = [...new Set(insps.map(i => i.customer_id))]
const blds = await page('buildings', 'id, customer_id, facilities_verified_at',
  q => q.eq('is_active', true))

const byCust = new Map()
for (const b of blds) {
  if (!byCust.has(b.customer_id)) byCust.set(b.customer_id, [])
  byCust.get(b.customer_id).push(b)
}

let noBld = 0, allVerified = 0, gateFires = 0
for (const c of custIds) {
  const arr = byCust.get(c) ?? []
  if (arr.length === 0) noBld++
  else if (arr.every(b => b.facilities_verified_at)) allVerified++
  else gateFires++
}
const pct = (n) => custIds.length ? `${(n / custIds.length * 100).toFixed(1)}%` : '—'
console.log(`\n진행 중 회차 ${insps.length}건 · 해당 고객 ${custIds.length}명`)
console.log(`  활성 건물 총 ${blds.length}동 (고객 ${byCust.size}명이 보유)`)
console.log(`\n① 링크 목적지 갈림:`)
console.log(`  🚩 설비 확인으로 감 (건물 有 + 미확인 有) = ${gateFires}명  ${pct(gateFires)}`)
console.log(`  ➜ 점검표로 직행 (건물 0동)              = ${noBld}명  ${pct(noBld)}  ← 조건이 못 선다`)
console.log(`  ➜ 점검표로 직행 (전 동 확인 완료)        = ${allVerified}명  ${pct(allVerified)}`)

const verified = blds.filter(b => b.facilities_verified_at).length
console.log(`\n참고 — 전체 활성 건물 ${blds.length}동 중 확인일 찍힌 동 = ${verified} (${blds.length ? (verified / blds.length * 100).toFixed(1) : '—'}%)`)
