// 056~092 마이그레이션 적용 상태 점검 (스테이징·운영 동시) — 시그니처 객체 존재 여부
// 실행: node scripts/_check-migration-state.mjs  (토큰: %TEMP%/sbtok.txt)
import { readFileSync } from 'fs'
import { join } from 'path'
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()

const SQL = `SELECT
  to_regclass('public.fire_plans') IS NOT NULL AS m056,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='license_no') AS m063,
  to_regclass('public.inspection_participants') IS NOT NULL AS m064,
  to_regclass('public.region_fire_stations') IS NOT NULL AS m065,
  to_regclass('public.defect_catalog') IS NOT NULL AS m066,
  to_regclass('public.fire_facilities') IS NOT NULL AS m067,
  to_regclass('public.generated_reports') IS NOT NULL AS m068,
  to_regclass('public.inspection_sheet_responses') IS NOT NULL AS m069,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='inspection_sheet_items' AND column_name='comprehensive_only') AS m078,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='is_initial') AS m079,
  to_regclass('public.billing_profiles') IS NOT NULL AS m080,
  to_regclass('public.billing_autopay') IS NOT NULL AS m081,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='bills' AND column_name='fee_type') AS m082,
  to_regclass('public.owners') IS NOT NULL AS m083,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='inspection_defects' AND column_name='action_taken') AS m084,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='buildings' AND column_name='structure') AS m085,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='fire_plans' AND column_name='revision') AS m086,
  EXISTS(SELECT 1 FROM pg_proc WHERE proname='create_inspection_steps' AND prosrc LIKE '%일반관리%') AS m087_fn,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='inspections' AND column_name='plan_type') AS m088_col,
  EXISTS(SELECT 1 FROM pg_proc WHERE proname='create_inspection_steps' AND prosrc LIKE '%monthly%') AS m088_fn,
  (SELECT count(*) FROM inspection_plan_items WHERE plan_type='monthly' AND status='planned' AND planned_date IS NOT NULL AND inspection_id IS NULL) AS m089_pending_rows,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='buildings' AND column_name='receiver_location') AS m090,
  to_regclass('public.fire_brigade_members') IS NOT NULL AS m091,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='buildings' AND column_name='bcode') AS m092`

const projects = { staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }
for (const [name, ref] of Object.entries(projects)) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL }),
  })
  const body = await r.json()
  console.log(`\n=== ${name} (${ref}) — status ${r.status} ===`)
  console.log(JSON.stringify(Array.isArray(body) ? body[0] : body, null, 2))
}
