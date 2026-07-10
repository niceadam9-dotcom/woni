// 소방안전관리 도메인 테이블 스키마·FK 추출 (관계도 작성용)
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const q = (sql) => fetch('https://api.supabase.com/v1/projects/ryuozdhnilfjlahorizh/database/query', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
}).then(r => r.json())

const FIRE = ['customers', 'buildings', 'inspections', 'inspection_steps', 'inspection_plans',
  'inspection_plan_items', 'inspection_logs', 'inspection_status_log', 'inspection_sheets',
  'inspection_reports', 'action_plans', 'holidays', 'inquiries', 'building_purposes']
const list = FIRE.map(t => `'${t}'`).join(',')

// FK
const fks = await q(`
  SELECT tc.table_name AS child, kcu.column_name AS fk_col,
         ccu.table_name AS parent, ccu.column_name AS parent_col, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
  JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name IN (${list})
  ORDER BY tc.table_name, kcu.column_name;`)

// 컬럼
const cols = await q(`
  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN (${list})
  ORDER BY table_name, ordinal_position;`)

// 행 수
const counts = {}
for (const t of FIRE) {
  const r = await q(`SELECT count(*)::int AS n FROM ${t};`)
  counts[t] = Array.isArray(r) ? r[0]?.n : (r.message ? 'N/A' : 0)
}

console.log('###FK###')
console.log(JSON.stringify(fks))
console.log('###COLS###')
console.log(JSON.stringify(cols))
console.log('###COUNTS###')
console.log(JSON.stringify(counts))
