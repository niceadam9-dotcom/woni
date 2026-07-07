import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const ADMIN_ID = 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'

const migration020 = readFileSync(
  join(root, 'supabase/migrations/020_buildings.sql'), 'utf-8'
)
const { buildings } = JSON.parse(
  readFileSync(join(__dirname, 'mockdata/buildings-yangpyeong.json'), 'utf-8')
)

function esc(v) {
  if (v === null || v === undefined) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

const insertRows = buildings.map(b =>
  `  ((SELECT id FROM customers WHERE customer_code = ${esc(b.customer_code)} LIMIT 1), ` +
  `${esc(b.building_name)}, ${esc(b.address)}, ` +
  `${b.total_area ?? 'NULL'}, ${b.floors_above ?? 'NULL'}, ${b.floors_below ?? 'NULL'}, ` +
  `${esc(b.purpose)}, ${b.year_built ?? 'NULL'}, ${esc(b.notes)}, ` +
  `TRUE, '${ADMIN_ID}'::UUID, NOW(), NOW())`
).join(',\n')

const sql = `-- ============================================================
-- 승진소방 ERP: 건물 테이블 생성 + 양평군 건물 Mock 데이터 50건
-- Supabase SQL Editor에 전체 붙여넣기 후 Run
-- 전제조건: 020_buildings 마이그레이션 & 양평군 고객(YP001~YP050) 삽입 완료
-- ============================================================

${migration020}

-- ============================================================
-- SEED: buildings 50건 (양평군 고객 연결)
-- ============================================================
INSERT INTO buildings
  (customer_id, building_name, address,
   total_area, floors_above, floors_below,
   purpose, year_built, notes,
   is_active, created_by, created_at, updated_at)
VALUES
${insertRows}
ON CONFLICT DO NOTHING;

SELECT COUNT(*) AS total_buildings FROM buildings;
`

const outPath = join(__dirname, 'mockdata/buildings-yangpyeong-seed.sql')
writeFileSync(outPath, sql, 'utf-8')
console.log(`✓ SQL 파일 생성: ${outPath}`)
console.log(`  - buildings 테이블 생성 (020_buildings)`)
console.log(`  - buildings INSERT ${buildings.length}건`)
