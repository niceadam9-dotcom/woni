// 배포 게이트 — **코드가 지목하는 컬럼이 DB에 없는가**.
//
// 🚨 왜 생겼나(2026-09-14, 오늘만 두 번째):
//   · 163: `fire-plan-generate.ts`가 `agency_applies`를 select에 넣었는데 컬럼이 없어 PostgREST가
//     42703으로 **조회 전체를 거절**했다. 그 실패가 `cust = null`로 뭉개져 화면엔 「고객을 찾을 수
//     없습니다」가 떴고, 소방계획서 엑셀·PDF가 통째로 죽었다(dev 실측).
//   · 160(`is_primary`)도 같은 이유로 `select('*')`로 **우회**해 둔 자리가 남아 있다.
//   코드 주석에 「마이그레이션이 먼저 적용돼야 한다」고 적는 방식은 이미 두 번 실패했다.
//   사람이 순서를 기억하는 대신 여기서 막는다.
//
// ## 판정 규칙 (정밀하게 — 거짓 차단을 만들지 않는다)
//   ① 마이그레이션 파일이 선언한 `ADD COLUMN`을 모은다
//   ② 그중 DB에 **없는** 것을 찾는다
//   ③ 없는 컬럼을 **코드(src/)가 이름으로 지목하는가**를 본다
//   → ②∩③일 때만 차단한다. 마이그레이션만 먼저 써 두고 코드는 아직 안 쓴 정상 상태는 통과시킨다.
//
// ⚠ 검사 대상 DB는 **운영**이 기본이다(배포가 향하는 곳). `.env.production`이 없으면 건너뛰되
//   **조용히 통과시키지 않는다** — 건너뛴 사실을 화면에 남긴다(조용한 통과가 이 부류의 본질이다).
//
// 실행: node scripts/assert-schema-code-drift.mjs [.env.production]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const envFile = process.argv[2] ?? '.env.production'
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const migDir = join(root, 'supabase', 'migrations')
const srcDir = join(root, 'src')

if (!existsSync(envFile)) {
  console.log(`⚠ [스키마 드리프트] ${envFile} 없음 — 검사를 건너뜁니다(통과로 치지 마세요)`)
  process.exit(0)
}
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim()
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ── ① 마이그레이션이 선언한 컬럼 ───────────────────────────────────────────
const declared = new Map()   // "table.column" → 마이그 파일명
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(migDir, f), 'utf8')
  const re = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?["']?(\w+)["']?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/gi
  let m
  while ((m = re.exec(sql))) declared.set(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`, f)
}

// ── ② DB에 없는 것 ─────────────────────────────────────────────────────────
// 표 단위로 한 번에 물어 빠르게 끝낸다 — 통과가 정상이므로 통과 경로가 빨라야 한다.
const byTable = new Map()
for (const key of declared.keys()) {
  const [t, c] = key.split('.')
  byTable.set(t, [...(byTable.get(t) ?? []), c])
}
const missing = []
for (const [table, cols] of byTable) {
  const { error } = await admin.from(table).select(cols.join(', ')).limit(1)
  if (!error) continue                       // 그 표의 선언 컬럼이 전부 있다
  for (const c of cols) {                    // 하나씩 좁힌다
    const { error: e2 } = await admin.from(table).select(c).limit(1)
    if (e2 && /42703|does not exist/.test(`${e2.code} ${e2.message}`)) missing.push(`${table}.${c}`)
  }
}

if (missing.length === 0) {
  console.log(`✅ [스키마 드리프트] 선언 ${declared.size}칸 전건 적용됨 (${process.env.NEXT_PUBLIC_SUPABASE_URL})`)
  process.exit(0)
}

// ── ③ 없는 컬럼을 코드가 지목하는가 ────────────────────────────────────────
// 파일 전수를 한 번만 읽고 문자열로 찾는다. 컬럼명은 스네이크라 오탐이 드물다.
const files = []
;(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p)
  }
})(srcDir)

const referenced = []
for (const key of missing) {
  const col = key.split('.')[1]
  const hits = files.filter(f => readFileSync(f, 'utf8').includes(col))
  if (hits.length) referenced.push({ key, mig: declared.get(key), hits })
}

console.log(`\n[스키마 드리프트] DB에 없는 선언 컬럼 ${missing.length}칸: ${missing.join(', ')}`)
if (referenced.length === 0) {
  console.log('   코드가 아직 지목하지 않음 — 정상(마이그레이션을 먼저 써 둔 상태). 통과.')
  process.exit(0)
}

console.log('\n❌ 코드가 **없는 컬럼**을 이름으로 지목하고 있습니다 — 배포하면 그 조회가 42703으로')
console.log('   통째로 거절되고, 실패가 `null`로 뭉개져 화면엔 엉뚱한 메시지가 뜹니다(163 사고).')
for (const r of referenced) {
  console.log(`\n  · ${r.key}  (선언: ${r.mig})`)
  for (const h of r.hits.slice(0, 6)) console.log(`      ${h.replace(root, '').replace(/\\/g, '/')}`)
  if (r.hits.length > 6) console.log(`      … 외 ${r.hits.length - 6}개 파일`)
}
console.log('\n  조치: 해당 마이그레이션을 DB에 **먼저** 적용하세요(DDL이 코드보다 앞섭니다).')
process.exit(1)
