// 마이그레이션 150(조기진압·할론 전용 시트) 적용 — 사용자 승인 2026-08-22.
//
// 관리 API 토큰 만료·DB 직결 문자열 부재라 서비스 키(supabase-js)로 DO 블록과 동일한 절차를
// 수행한다: 시트 존재 게이트(재실행 안전) → inspection_sheets insert → inspection_sheet_items insert.
// 원천은 SQL과 동일한 scripts/_out/f1f-sheets.json — 적용 후 _probe-150-vs-source 2부가
// DB를 같은 JSON과 전 필드 축자 대조하므로 SQL 경로와의 등가가 검증된다.
// 대상: ENV_FILE로 선택(기본 .env.local=스테이징). 실행: node scripts/_apply-150-staging.mjs --run
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
for (const line of readFileSync(join(here, '..', process.env.ENV_FILE ?? '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
if (!process.argv.includes('--run')) { console.error('적용 스크립트 — 실행하려면 --run 을 붙이세요.'); process.exit(1) }

const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
console.log(`대상 DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

const sheets = JSON.parse(readFileSync(join(here, '_out', 'f1f-sheets.json'), 'utf8'))

for (const s of sheets) {
  const code = `STD-${String(s.num).padStart(2, '0')}`
  // 게이트 — error를 반드시 함께 본다(없는 컬럼이 조용한 0행이 되는 함정 방지)
  const gate = await admin.from('inspection_sheets').select('id').eq('sheet_code', code).eq('version', 'v2025')
  if (gate.error) throw new Error(`게이트 조회 실패 ${code}: ${gate.error.message}`)
  if ((gate.data ?? []).length > 0) { console.log(`SKIP ${code} — 이미 존재(재실행)`); continue }

  const ins = await admin.from('inspection_sheets').insert({
    sheet_code: code, sheet_name: s.sheetName, version: 'v2025',
    description: `소방시설 자체점검사항 등에 관한 고시 별지4 — ${s.num}번 점검표 (150 편입, F-1f 이중 귀속 분리)`,
    is_active: true,
  }).select('id').single()
  if (ins.error) throw new Error(`시트 insert 실패 ${code}: ${ins.error.message}`)
  const sheetId = ins.data.id

  const rows = s.items.map(i => ({
    sheet_id: sheetId, item_code: i.item_code, item_name: i.item_name,
    facility_type: s.facility, order_num: i.order_num, comprehensive_only: i.comprehensive_only,
    group_code: i.group_code, group_name: i.group_name, group_order: i.group_order,
    subgroup_name: i.subgroup_name, subgroup_order: i.subgroup_order,
  }))
  for (let k = 0; k < rows.length; k += 100) {
    const r = await admin.from('inspection_sheet_items').insert(rows.slice(k, k + 100))
    if (r.error) {
      // 부분 삽입 잔재를 남기지 않는다 — 시트째 되돌리고 중단(항목은 sheet_id로 귀속)
      await admin.from('inspection_sheet_items').delete().eq('sheet_id', sheetId)
      await admin.from('inspection_sheets').delete().eq('id', sheetId)
      throw new Error(`항목 insert 실패 ${code} @${k}: ${r.error.message} — 시트째 되돌림`)
    }
  }
  const cnt = await admin.from('inspection_sheet_items').select('id', { count: 'exact', head: true }).eq('sheet_id', sheetId)
  console.log(`OK   ${code} '${s.sheetName}' — 항목 ${cnt.count}/${s.items.length}`)
  if (cnt.count !== s.items.length) throw new Error(`${code} 항목 수 불일치`)
}
console.log('150 적용 완료')
