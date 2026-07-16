// 운영 프로젝트에 지정 마이그레이션 순차 적용 (2026-07-16: 056~086 갭 해소)
// 실행: node scripts/_apply-migrations-prod.mjs  (토큰: %TEMP%/sbtok.txt)
import { readFileSync } from 'fs'
import { join } from 'path'

const PROD_REF = 'ryuozdhnilfjlahorizh'
const FILES = [
  '056_fire_plans.sql',
  '063_report_base_fields.sql',
  '064_inspection_participants.sql',
  '065_region_fire_stations.sql',
  '066_defect_catalog.sql',
  '067_fire_facilities.sql',
  '068_generated_reports.sql',
  '069_sheet_responses.sql',
  '078_sheet_item_scope.sql',
  '079_inspection_initial_multiday.sql',
  '080_billing_profiles.sql',
  '081_billing_autopay.sql',
  '082_bills_fee_type.sql',
  '083_owner_groups.sql',
  '084_defect_action_completion.sql',
  '085_buildings_multi.sql',
  '086_fire_plan_revisions.sql',
]

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

let ok = 0, fail = 0
for (const f of FILES) {
  const sql = readFileSync(join(dir, f), 'utf8')
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (r.ok) { ok++; console.log('OK  ', f) }
  else {
    fail++
    const body = (await r.text()).slice(0, 300)
    console.log('FAIL', f, r.status, body)
    break // 순서 의존(086→056 등) — 실패 시 중단
  }
}
console.log(`\n적용 ${ok} / 실패 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
