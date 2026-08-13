// 운영 DB 마이그레이션 적용 상태 조회 (읽기 전용) — Management API
// 실행: node scripts/_probe-prod-migration-state.mjs   (토큰: %TEMP%/sbtok.txt)
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const PROD = 'ryuozdhnilfjlahorizh'

const SQL = `
select
  (select count(*) from information_schema.columns
     where table_name='customers' and column_name='manager_appointment_type')            as m124_컬럼,
  (select count(*) from information_schema.tables  where table_name='plan_text_library') as m119_테이블,
  (select count(*) from information_schema.tables  where table_name='fire_plan_revisions') as m120_테이블,
  (select count(*) from information_schema.columns
     where table_name='company_profile' and column_name='management_reg_no')             as m123_컬럼,
  (select count(*) from information_schema.columns
     where table_name='inspection_sheet_responses' and column_name='month')              as m125_컬럼,
  (select count(*) from information_schema.check_constraints
     where constraint_name='fire_plan_gen_jobs_report_type_check'
       and check_clause like '%report4%')                                                as m113_check,
  (select count(*) from information_schema.check_constraints
     where constraint_name='annex_inputs_annex_no_check'
       and check_clause like '%exterior%')                                               as m126_check,
  (select count(*) from pg_publication_tables
     where pubname='supabase_realtime' and tablename='inspection_sheet_responses')       as m122_publication,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where p.proname='create_inspection_steps'
       and pg_get_functiondef(p.oid) like '%inspection_end_date%')                       as m121_함수,
  (select count(*) from customers)                                                       as 고객수
`

const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: SQL }),
})
const text = await r.text()
if (!r.ok) { console.log('HTTP', r.status, text.slice(0, 500)); process.exit(1) }
const row = JSON.parse(text)[0]
console.log('운영 DB 마이그레이션 상태 (1=적용, 0=미적용)\n')
for (const [k, v] of Object.entries(row)) {
  const mark = k.startsWith('m') ? (Number(v) > 0 ? '적용  ' : '미적용') : '      '
  console.log('  ' + k.padEnd(20) + String(v).padEnd(8) + mark)
}
