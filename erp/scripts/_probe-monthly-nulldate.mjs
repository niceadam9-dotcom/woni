// 읽기 전용 — 정기(monthly) 계획 항목 중 scheduled_date가 비어 있는 건이 있는가.
// 있으면 bulkConfirmPlanItemsAction의 `scheduled_date ?? today` 폴백이 '다른 달'이 될 수 있어,
// confirmPlanItemStageOneAction에 '같은 달' 가드를 넣으면 그 경로가 막힌다.
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
const SQL = `
SELECT
  COUNT(*) FILTER (WHERE i.plan_type='monthly') AS 정기전체,
  COUNT(*) FILTER (WHERE i.plan_type='monthly' AND i.scheduled_date IS NULL) AS 정기_날짜없음,
  COUNT(*) FILTER (WHERE i.plan_type='monthly' AND i.scheduled_date IS NOT NULL
                     AND to_char(i.scheduled_date,'YYYY-MM') <> (p.year || '-' || lpad(p.month::text,2,'0'))) AS 정기_계획월밖,
  COUNT(*) FILTER (WHERE i.plan_type='monthly' AND i.status='planned' AND i.scheduled_date IS NULL) AS 정기_미확정_날짜없음,
  COUNT(*) FILTER (WHERE i.plan_type NOT IN ('monthly') AND i.scheduled_date IS NULL) AS 비정기_날짜없음
  FROM inspection_plan_items i JOIN inspection_plans p ON p.id = i.plan_id`
for (const [label, ref] of [['운영', 'ryuozdhnilfjlahorizh'], ['스테이징', 'nwflnzugwylhpdyodyog']]) {
  const rows = await q(ref, SQL)
  console.log(`[${label}]`, JSON.stringify(Array.isArray(rows) ? rows[0] : rows))
}
