// 113·119~127 적용 후 백필 결과 확인 (읽기 전용) — Management API
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const PROD = 'ryuozdhnilfjlahorizh'

const SQL = `
select
  (select count(*) from customers)                                              as 고객수,
  (select count(*) from customers where manager_appointment_type is null)       as m127_남은NULL_0이어야,
  (select count(*) from customers where manager_appointment_type='업무대행감독') as m127_업무대행감독,
  (select column_default from information_schema.columns
     where table_name='customers' and column_name='manager_appointment_type')   as m127_기본값,
  (select count(*) from fire_plans)                                             as 계획서_원본,
  (select count(*) from fire_plan_revisions)                                    as m120_개정이력_백필,
  (select count(*) from inspection_sheet_responses where item_code like 'X%')   as 외관응답,
  (select count(*) from inspection_sheet_responses
     where item_code like 'X%' and month between 1 and 12)                      as m125_월_백필,
  (select count(*) from plan_text_library)                                      as m119_라이브러리_행
`

const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: SQL }),
})
const text = await r.text()
if (!r.ok) { console.log('HTTP', r.status, text.slice(0, 600)); process.exit(1) }
console.log('운영 DB 백필 결과\n')
for (const [k, v] of Object.entries(JSON.parse(text)[0])) {
  console.log('  ' + k.padEnd(24) + String(v))
}
