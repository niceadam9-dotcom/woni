// 소방계획서_33 — 마이그레이션 153을 운영에 적용한다. (토큰: %TEMP%/sbtok.txt)
// 실행: node scripts/_apply-33-prod.mjs [--apply]
// 기본은 **미적용 사전점검**만 한다. 실제 적용은 --apply를 붙일 때만.
import { readFileSync } from 'fs'
import { join } from 'path'

const PROD_REF = 'ryuozdhnilfjlahorizh'
const FILE = '153_second_round_operational.sql'
const APPLY = process.argv.includes('--apply')

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 400)}`)
  try { return JSON.parse(text) } catch { return text }
}

// ── 사전 점검: 트리거 본문이 아직 옛 축(inspection_type)인가 ──
const before = await q(`
  SELECT pg_get_functiondef(oid) LIKE '%NEW.inspection_type%' AS old_axis,
         pg_get_functiondef(oid) LIKE '%inspection_sub_type%' AS new_axis
    FROM pg_proc WHERE proname = 'check_inspection_sequence'`)
console.log('트리거 축(적용 전):', JSON.stringify(before))

const counts = await q(`
  SELECT
    (SELECT count(*) FROM inspection_plan_items
      WHERE sequence_num = 2 AND plan_type LIKE 'special\\_%'
        AND plan_type <> 'special_' || U&'\\C791\\B3D9') AS plan_items_target,
    (SELECT count(*) FROM inspections
      WHERE sequence_num = 2 AND plan_type LIKE 'special\\_%'
        AND plan_type <> 'special_' || U&'\\C791\\B3D9') AS inspections_target`)
console.log('백필 대상(적용 전):', JSON.stringify(counts))

if (!APPLY) {
  console.log('\n※ 사전점검만 했다. 실제 적용하려면 --apply 를 붙일 것.')
  process.exit(0)
}

const sql = readFileSync(join(dir, FILE), 'utf8')
await q(sql)
console.log(`\nOK   ${FILE} 적용 완료`)

const after = await q(`
  SELECT pg_get_functiondef(oid) LIKE '%NEW.inspection_type%' AS old_axis,
         pg_get_functiondef(oid) LIKE '%inspection_sub_type%' AS new_axis
    FROM pg_proc WHERE proname = 'check_inspection_sequence'`)
console.log('트리거 축(적용 후):', JSON.stringify(after))
const countsAfter = await q(`
  SELECT
    (SELECT count(*) FROM inspection_plan_items
      WHERE sequence_num = 2 AND plan_type LIKE 'special\\_%'
        AND plan_type <> 'special_' || U&'\\C791\\B3D9') AS plan_items_left,
    (SELECT count(*) FROM inspections
      WHERE sequence_num = 2 AND plan_type LIKE 'special\\_%'
        AND plan_type <> 'special_' || U&'\\C791\\B3D9') AS inspections_left,
    (SELECT count(*) FROM inspection_plan_items
      WHERE sequence_num = 2 AND plan_type = 'special_' || U&'\\C791\\B3D9') AS plan_items_operational`)
console.log('백필 결과(적용 후):', JSON.stringify(countsAfter))
