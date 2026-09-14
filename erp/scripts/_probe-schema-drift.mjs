// 읽기 전용 — 마이그레이션 파일이 선언한 컬럼이 실제 DB에 있는가(스키마 드리프트 전수).
// 원장 테이블이 없으므로 「적용됐다」를 기록으로는 알 수 없다 → **결과(컬럼 실재)로 판정**한다.
// 163 사고처럼 코드가 없는 컬럼을 지목하면 42703으로 조회가 통째로 죽으므로, 미적용은 곧 잠재 500이다.
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const FROM = Number(process.argv[2] ?? 100) // 이 번호 이상 마이그레이션만
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const REFS = { staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.text()
  try { return JSON.parse(body) } catch { return null }
}

// 파일에서 ALTER TABLE … ADD COLUMN … 선언을 긁는다
const want = [] // {mig, table, column}
for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  const num = Number(f.slice(0, 3))
  if (!Number.isFinite(num) || num < FROM) continue
  const sql = readFileSync(join(dir, f), 'utf8')
  const re = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?["']?(\w+)["']?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/gi
  let m
  while ((m = re.exec(sql))) want.push({ mig: f, table: m[1].toLowerCase(), column: m[2].toLowerCase() })
}
console.log(`마이그 ${FROM}번 이상에서 선언된 ADD COLUMN = ${want.length}건`)

for (const [name, ref] of Object.entries(REFS)) {
  const rows = await q(ref, `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`)
  const have = new Set((rows ?? []).map(r => `${r.table_name}.${r.column_name}`))
  const missing = want.filter(w => !have.has(`${w.table}.${w.column}`))
  console.log(`\n===== ${name} — 미적용(컬럼 부재) ${missing.length}건 / ${want.length} =====`)
  const byMig = new Map()
  for (const m of missing) byMig.set(m.mig, [...(byMig.get(m.mig) ?? []), `${m.table}.${m.column}`])
  for (const [mig, cols] of [...byMig.entries()].sort()) console.log(`  ❌ ${mig}\n       ${cols.join(', ')}`)
  if (!missing.length) console.log('  ✅ 전건 적용됨')
}
