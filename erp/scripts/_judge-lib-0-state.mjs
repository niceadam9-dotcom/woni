// [판정자] 공통 서술 라이브러리 — 스테이징 DB 사전 상태 스냅샷 (소방계획서_15 §5 판정 전)
// 실행: node scripts/_judge-lib-0-state.mjs
import { raw } from './_e2e-helpers.mjs'

const { data: lib, error: e1 } = await raw.from('plan_text_library')
  .select('id, section_key, title, is_default, is_active, version, created_at')
  .order('created_at')
if (e1) { console.error('plan_text_library 조회 실패:', e1.message); process.exit(1) }
console.log(`plan_text_library ${lib.length}행:`)
for (const r of lib) console.log(`  ${r.section_key} | "${r.title}" | default=${r.is_default} active=${r.is_active} v${r.version} | ${r.id}`)

const { count, error: e2 } = await raw.from('plan_text_applied').select('*', { count: 'exact', head: true })
if (e2) { console.error('plan_text_applied 조회 실패:', e2.message); process.exit(1) }
console.log(`plan_text_applied ${count}행`)

const judge = lib.filter(r => r.title.startsWith('[JUDGE]'))
console.log(`[JUDGE] 잔재: ${judge.length}건`)
