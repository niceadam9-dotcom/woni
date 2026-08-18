// 읽기 전용 — REGEN_POLICY_CUTOFF='2026-08-18'이 실제로 몇 건을 막는지 (스테이징·운영)
import { readFileSync } from 'fs'
import { join } from 'path'
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) throw new Error(`${ref} ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}
const CUTOFF = '2026-08-18'
const SQL = `
SELECT
  COUNT(*) AS all_insp,
  COUNT(*) FILTER (WHERE COALESCE(inspection_end_date, inspection_start_date) < DATE '${CUTOFF}') AS blocked,
  COUNT(*) FILTER (WHERE COALESCE(inspection_end_date, inspection_start_date) >= DATE '${CUTOFF}') AS allowed,
  COUNT(*) FILTER (WHERE COALESCE(inspection_end_date, inspection_start_date) IS NULL) AS no_date,
  MIN(COALESCE(inspection_end_date, inspection_start_date)) AS oldest,
  MAX(COALESCE(inspection_end_date, inspection_start_date)) AS newest
  FROM inspections
 WHERE plan_type IS NULL OR plan_type LIKE 'special%'`
for (const [label, ref] of [['스테이징', 'nwflnzugwylhpdyodyog'], ['운영', 'ryuozdhnilfjlahorizh']]) {
  const rows = await q(ref, SQL)
  console.log(`[${label}]`, JSON.stringify(Array.isArray(rows) ? rows[0] : rows))
}
// 최근 점검 몇 건의 날짜 — 새 규약으로 입력됐을 법한 건이 막히는지 확인
const recent = await q('nwflnzugwylhpdyodyog', `
  SELECT c.customer_name, i.year, i.sequence_num,
         to_char(COALESCE(i.inspection_end_date, i.inspection_start_date),'YYYY-MM-DD') AS anchor,
         (SELECT COUNT(*) FROM inspection_sheet_responses r WHERE r.inspection_id = i.id) AS responses
    FROM inspections i JOIN customers c ON c.id = i.customer_id
   WHERE (i.plan_type IS NULL OR i.plan_type LIKE 'special%')
   ORDER BY COALESCE(i.inspection_end_date, i.inspection_start_date) DESC NULLS LAST LIMIT 8`)
console.log('\n스테이징 최근 자체점검 (anchor = 차단 판정 기준일):')
for (const r of (Array.isArray(recent) ? recent : [])) {
  console.log(`  ${r.anchor} ${r.anchor < CUTOFF ? '🚫차단' : '✅허용'} | ${r.customer_name} ${r.year}년 ${r.sequence_num}차 | 응답 ${r.responses}건`)
}
