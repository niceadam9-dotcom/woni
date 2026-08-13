// R5-6 폐지 후 **남겨야 할 것이 남았는지** 확인 — 삭제는 되돌리기 쉽지만 유실은 아니다
// 실행: node scripts/_probe-r56-preserved.mjs
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('F:/AI/ERP/erp/.env.local', 'utf8')
const db = createClient(
  /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(env)[1].trim(),
  /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(env)[1].trim(),
  { auth: { persistSession: false } })

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

// ① 대조 능력 — 템플릿을 지웠다면 스테이징 레이아웃 대조를 영영 못 한다
const { data: tpl } = await db.storage.from('reports').list('templates')
const names = (tpl ?? []).map(f => f.name)
check('Storage 템플릿 보존 — operational_v2026.xlsx',
  names.includes('operational_v2026.xlsx'), names.join(',') || '(빈 목록)')

// ② 과거 생성물 — 실고객 xlsx에 닿는 길
const { data: rows } = await db.from('generated_reports')
  .select('id, file_name, xlsx_path').order('generated_at', { ascending: false })
check('generated_reports 행 보존', (rows ?? []).length > 0, `${(rows ?? []).length}행`)

let reachable = 0
for (const r of rows ?? []) {
  const { data: signed } = await db.storage.from('reports').createSignedUrl(r.xlsx_path, 60)
  if (signed?.signedUrl) reachable++
  else console.log(`     ⚠ 파일 없음: ${r.file_name} (${r.xlsx_path})`)
}
check('과거 생성물 파일이 실제로 내려받아진다',
  reachable === (rows ?? []).length, `${reachable}/${(rows ?? []).length}`)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
