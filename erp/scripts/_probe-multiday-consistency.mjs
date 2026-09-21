/** 점검기간 — 종료일과 일수가 **어긋난 회차**가 몇 건인가 (읽기 전용).
 *
 *  두 칸은 서로를 모른다(UI에도 서버에도 연결이 없다). 그런데 `inspection_days`는
 *  **별지 9호에 그대로 인쇄된다**(report9-assemble.ts `inspDays`) — 어긋나면 법정 서류에
 *  「기간 9/21~9/23 · 일수 1일」 같은 모순이 찍힌다.
 *
 *  실행: node scripts/_probe-multiday-consistency.mjs      (스테이징)
 *        SB_URL=… SB_KEY=… node scripts/_probe-multiday-consistency.mjs   (운영)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

let url = process.env.SB_URL, key = process.env.SB_KEY
if (!url || !key) {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const pick = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(env)?.[1] ?? '').trim()
  url = pick('NEXT_PUBLIC_SUPABASE_URL'); key = pick('SUPABASE_SERVICE_ROLE_KEY')
}
const db = createClient(url, key, { auth: { persistSession: false } })
console.log(`DB = ${url.replace(/^https:\/\//, '').slice(0, 12)}…`)

const rows = []
for (let i = 0; ; i += 1000) {
  const { data, error } = await db.from('inspections')
    .select('id, inspection_start_date, inspection_end_date, inspection_days, status, year, sequence_num')
    .order('id').range(i, i + 999)
  if (error) { console.log('조회 실패:', error.message); break }
  rows.push(...data); if (data.length < 1000) break
}

/** 포함 계산 — 시작·종료 양끝을 센다(9/21~9/22 = 2일). 종료일 없으면 1일. */
const inclusive = (s, e) => {
  if (!s) return null
  if (!e) return 1
  const d = (Date.parse(`${e}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / 86400000
  return Number.isFinite(d) ? d + 1 : null
}

let ok = 0, bad = 0, noStart = 0
const samples = []
for (const r of rows) {
  const want = inclusive(r.inspection_start_date, r.inspection_end_date)
  if (want === null) { noStart++; continue }
  const got = r.inspection_days ?? 1
  if (want === got) ok++
  else { bad++; if (samples.length < 12) samples.push({ ...r, want, got }) }
}
console.log(`\n전체 회차 ${rows.length}건 (시작일 없음 ${noStart})`)
console.log(`  ✅ 일치      = ${ok}`)
console.log(`  🚩 어긋남    = ${bad}  (${rows.length ? (bad / rows.length * 100).toFixed(1) : '—'}%)`)
if (samples.length) {
  console.log('\n어긋난 예:')
  for (const s of samples) {
    console.log(`  ${s.inspection_start_date} ~ ${s.inspection_end_date ?? '(없음)'}`
      + `  기간상 ${s.want}일인데 저장된 일수 = ${s.got}  [${s.status} ${s.year}년 ${s.sequence_num}차]`)
  }
}
// 종료일이 실제로 쓰인 회차(다일)만 따로 — 여기가 서류에 모순이 찍히는 모집단이다
const multi = rows.filter(r => r.inspection_end_date && r.inspection_end_date !== r.inspection_start_date)
const multiBad = multi.filter(r => inclusive(r.inspection_start_date, r.inspection_end_date) !== (r.inspection_days ?? 1))
console.log(`\n다일 점검(종료일 ≠ 시작일) ${multi.length}건 중 어긋남 ${multiBad.length}건`)
console.log(`일수 범위 밖(>5 또는 <1) = ${rows.filter(r => (r.inspection_days ?? 1) < 1 || (r.inspection_days ?? 1) > 5).length}건`)
