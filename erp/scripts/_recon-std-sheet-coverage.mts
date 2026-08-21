/** 표준 42종 설비 ↔ STD 시트 커버리지 — 시트가 아예 없는 설비는 1.4 결과 입력으로도 못 채운다(읽기 전용).
 *  실행: npx tsx scripts/_recon-std-sheet-coverage.mts */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sheetMatchesFacilities } from '../src/lib/sheet-facility-map.ts'
import { ALL_STANDARD_CODES } from '../src/lib/facility-codes.ts'

for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const r = await admin.from('inspection_sheets').select('sheet_code, sheet_name, version')
if (r.error) throw new Error(r.error.message)
const sheets = (r.data ?? []) as Array<{ sheet_code: string; sheet_name: string; version: string | null }>
const std = sheets.filter(s => s.sheet_code.startsWith('STD-'))
console.log(`시트 총 ${sheets.length} (STD ${std.length}) · 버전: ${[...new Set(sheets.map(s => s.version))].join(', ')}`)

const uncovered: string[] = []
for (const code of ALL_STANDARD_CODES) {
  const hit = std.filter(s => sheetMatchesFacilities(s.sheet_name, [code]))
  if (hit.length === 0) uncovered.push(code)
  else if (hit.length > 1) console.log(`  복수 매칭 ${code} → ${hit.map(h => h.sheet_code).join(', ')}`)
}
console.log(`\nSTD 시트가 없는 설비 ${uncovered.length}종:`)
for (const c of uncovered) console.log(`  · ${c}`)
