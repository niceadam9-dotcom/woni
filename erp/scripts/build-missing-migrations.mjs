// 미적용 마이그레이션을 멱등(idempotent) SQL로 변환해 하나로 합침
// 사용법: node scripts/build-missing-migrations.mjs
// 출력: scripts/apply-missing-migrations.sql
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIG_DIR = join(__dirname, '..', 'supabase', 'migrations')

// 진단 결과 미적용으로 확인된 마이그레이션 (023은 IF NOT EXISTS라 안전 재실행)
const MISSING = [
  '007_inspection_report_status.sql',
  '008_action_plans.sql',
  '009_billing.sql',
  '010_storage_buckets.sql',
  '011_my_page.sql',
  '012_messages.sql',
  '013_sales.sql',
  '014_accounting.sql',
  '015_payroll.sql',
  '016_mobile_documents.sql',
  '023_stage_reports.sql',
]

function makeIdempotent(sql) {
  // CREATE TABLE → CREATE TABLE IF NOT EXISTS
  sql = sql.replace(/CREATE TABLE (?!IF NOT EXISTS)([\w.]+)/g, 'CREATE TABLE IF NOT EXISTS $1')
  // CREATE [UNIQUE] INDEX → IF NOT EXISTS
  sql = sql.replace(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)([\w.]+)/g, 'CREATE $1INDEX IF NOT EXISTS $2')
  // CREATE POLICY → DROP POLICY IF EXISTS 선행
  sql = sql.replace(
    /CREATE POLICY ("[^"]+")\s+ON\s+([\w.]+)/g,
    'DROP POLICY IF EXISTS $1 ON $2;\nCREATE POLICY $1\n  ON $2'
  )
  // CREATE TRIGGER → DROP TRIGGER IF EXISTS 선행
  sql = sql.replace(
    /CREATE TRIGGER (\w+)(\s+(?:BEFORE|AFTER)[\s\S]*?ON\s+)([\w.]+)/g,
    'DROP TRIGGER IF EXISTS $1 ON $3;\nCREATE TRIGGER $1$2$3'
  )
  // CREATE TYPE → 중복 시 무시
  sql = sql.replace(
    /CREATE TYPE ([\w.]+) AS ENUM \(([^)]*)\);/g,
    "DO $$ BEGIN CREATE TYPE $1 AS ENUM ($2); EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
  )
  return sql
}

let out = `-- ============================================================
-- 미적용 마이그레이션 통합 적용 SQL (자동 생성)
-- 생성일: ${new Date().toISOString().split('T')[0]}
-- Supabase 대시보드 → SQL Editor에 전체 붙여넣기 후 실행
-- 멱등 변환됨: 이미 존재하는 객체는 건너뜀 (재실행 안전)
-- ============================================================

`

for (const f of MISSING) {
  const raw = readFileSync(join(MIG_DIR, f), 'utf-8')
  out += `\n-- ────────────────────────────────────────────────────────────\n`
  out += `-- ▼ ${f}\n`
  out += `-- ────────────────────────────────────────────────────────────\n`
  out += makeIdempotent(raw) + '\n'
}

// 026 (모바일 점검 시작 RLS)도 포함
out += `
-- ────────────────────────────────────────────────────────────
-- ▼ 026_employee_create_inspections.sql
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Employees create own inspections" ON inspections;
CREATE POLICY "Employees create own inspections"
  ON inspections FOR INSERT
  WITH CHECK (assigned_employee_id = auth.uid());
`

const outPath = join(__dirname, 'apply-missing-migrations.sql')
writeFileSync(outPath, out, 'utf-8')
console.log('생성 완료:', outPath)
console.log('총 길이:', out.length, '자')
