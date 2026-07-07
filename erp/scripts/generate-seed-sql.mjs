import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const migration002 = readFileSync(join(root, 'supabase/migrations/002_fire_safety.sql'), 'utf-8')
const migration003 = readFileSync(join(root, 'supabase/migrations/003_customer_assignee.sql'), 'utf-8')
const { customers } = JSON.parse(readFileSync(join(__dirname, 'mockdata/customers.json'), 'utf-8'))

// admin UUID (조회된 값)
const ADMIN_ID = 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'

function esc(v) {
  if (v === null || v === undefined) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

const inserts = customers.map(c =>
  `(gen_random_uuid(), ${esc(c.customer_code)}, ${esc(c.customer_name)}, ${esc(c.contract_date)}::DATE, ` +
  `${esc(c.inspection_type)}::inspection_type, ${esc(c.address)}, ${esc(c.notes)}, ${c.is_active}, ` +
  `'${ADMIN_ID}'::UUID, NOW(), NOW())`
).join(',\n')

const seedSQL = `
-- ============================================================
-- SEED: customers 100건
-- admin UUID: ${ADMIN_ID}
-- ============================================================
INSERT INTO customers
  (id, customer_code, customer_name, contract_date,
   inspection_type, address, notes, is_active,
   created_by, created_at, updated_at)
VALUES
${inserts}
ON CONFLICT (customer_code) DO NOTHING;

SELECT COUNT(*) AS inserted_customers FROM customers;
`

const combined = `-- ============================================================
-- 승진소방 ERP: 마이그레이션 002 + 003 + 고객 시드 데이터
-- Supabase SQL Editor에 전체 붙여넣기 후 Run
-- ============================================================

${migration002}

${migration003}

${seedSQL}
`

const outPath = join(__dirname, 'mockdata/full-seed.sql')
writeFileSync(outPath, combined, 'utf-8')
console.log(`✓ SQL 파일 생성: ${outPath}`)
console.log(`  - 마이그레이션 002 (소방 스키마)`)
console.log(`  - 마이그레이션 003 (담당직원 컬럼)`)
console.log(`  - 고객 INSERT ${customers.length}건`)
