// 안전시설등(다중이용업소) 점검표 시트 시딩 — 별지 9호 3쪽 2절 항목 (소방계획서_4.md §9-6e)
// 항목 원천 = 별지 9호 서식 2절(16종). 코드 MU-001~016은 make-report9.py MU_ITEMS와 1:1 — 변경 시 양쪽 동기화.
// 실행: node scripts/seed-mu-sheet.mjs                    (dry-run)
//       node scripts/seed-mu-sheet.mjs --execute          (스테이징)
//       node scripts/seed-mu-sheet.mjs --execute --prod   (운영)
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const VERSION = 'v2025' // 소방(작동·종합) 점검표 목록과 함께 노출
const SHEET_CODE = 'MU-01'
const execute = process.argv.includes('--execute')
const prod = process.argv.includes('--prod')

// 법정 순서·구분 축자 (별지 4호 2쪽 2열 표 — _별지4호_현행판_추출.txt:93-123, 소방계획서_23 §3-1).
// 마이그레이션 135와 1:1 미러 — seed 재실행이 135를 되돌리지 않게 한다(R-9). 배열 순서 = order_num.
//  · MU-007 피난안내도ㆍ피난안내영상물(구분자 U+318D 축자 — P-8 위치별 축자, 전역 치환 금지)과
//    MU-010 '창 문'(공백 포함)은 '피난구조설비'가 아니라 **기타** 구분이다(P-4·P-5 정정).
//  · group_order: 소화1·경보2·피난구조3·비상구4·기타5 (gord)
const ITEMS = [
  { code: 'MU-001', cat: '소화설비', gord: 1, name: '소화기 또는 자동확산소화기' },
  { code: 'MU-002', cat: '소화설비', gord: 1, name: '간이스프링클러설비' },
  { code: 'MU-003', cat: '경보설비', gord: 2, name: '비상경보설비 또는 자동화재탐지설비' },
  { code: 'MU-004', cat: '경보설비', gord: 2, name: '가스누설경보기' },
  { code: 'MU-005', cat: '피난구조설비', gord: 3, name: '피난기구' },
  { code: 'MU-006', cat: '피난구조설비', gord: 3, name: '피난유도선' },
  { code: 'MU-008', cat: '피난구조설비', gord: 3, name: '유도등, 유도표지 또는 비상조명등' },
  { code: 'MU-009', cat: '피난구조설비', gord: 3, name: '휴대용비상조명등' },
  { code: 'MU-011', cat: '비상구', gord: 4, name: '방화문' },
  { code: 'MU-012', cat: '비상구', gord: 4, name: '비상구(비상탈출구)' },
  { code: 'MU-013', cat: '기타', gord: 5, name: '영업장 내부 피난통로' },
  { code: 'MU-014', cat: '기타', gord: 5, name: '영상음향차단장치' },
  { code: 'MU-015', cat: '기타', gord: 5, name: '누전차단기' },
  { code: 'MU-010', cat: '기타', gord: 5, name: '창 문' },
  { code: 'MU-007', cat: '기타', gord: 5, name: '피난안내도ㆍ피난안내영상물' },
  { code: 'MU-016', cat: '기타', gord: 5, name: '방염대상물품' },
]

console.log(`안전시설등(다중이용업소) — ${ITEMS.length}항목`)
for (const it of ITEMS) console.log(`  ${it.code} [${it.cat}] ${it.name}`)
if (!execute) { console.log('\n[dry-run] --execute 로 반영 (--prod = 운영)'); process.exit(0) }

const envFile = prod ? '../.env.local.prod-backup' : '../.env.local'
const env = Object.fromEntries(
  readFileSync(new URL(envFile, import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
console.log('대상 DB:', env.NEXT_PUBLIC_SUPABASE_URL)

const { data: existing } = await admin.from('inspection_sheets').select('id').eq('sheet_code', SHEET_CODE).eq('version', VERSION).maybeSingle()
if (existing) await admin.from('inspection_sheets').delete().eq('id', existing.id)
const { data: sheet, error: se } = await admin.from('inspection_sheets')
  .insert({ sheet_code: SHEET_CODE, sheet_name: '안전시설등(다중이용업소)', version: VERSION, description: '별지 9호 3쪽 2절 안전시설등 점검 결과 — 다중이용업소 보유 고객용 (§9-6e)' })
  .select('id').single()
if (se) { console.error('시트 실패:', se.message); process.exit(1) }
const rows = ITEMS.map((it, i) => ({
  sheet_id: sheet.id, item_code: it.code, item_name: it.name, facility_type: it.cat, order_num: i + 1,
  // 그룹 축(마이그레이션 134·135 미러) — MU는 구분란이 곧 중분류, 소제목 없음
  group_code: it.cat, group_name: it.cat, group_order: it.gord, subgroup_name: null, subgroup_order: null,
}))
const { error: ie } = await admin.from('inspection_sheet_items').insert(rows)
if (ie) { console.error('항목 실패:', ie.message); process.exit(1) }
console.log(`✅ 시트 1 · 항목 ${rows.length} 반영 완료`)
console.log('⚠ 앱은 점검표 카탈로그를 캐시한다(lib/sheet-catalog.ts) — DB 직접 쓰기는 캐시를 비우지'
  + ' 않는다. /inspection-sheets 의 [캐시 비우기]를 누르거나 최대 1시간(TTL) 기다릴 것.')
