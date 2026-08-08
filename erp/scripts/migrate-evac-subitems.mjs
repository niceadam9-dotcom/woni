/**
 * 피난기구 하위 체크 이관 — fire_facilities 개별 행 → customer_facility_specs.s36_evac (2026-08-08)
 *
 *   node scripts/migrate-evac-subitems.mjs           # .env.local (스테이징)
 *   node scripts/migrate-evac-subitems.mjs --prod    # .env.production (운영)
 *   node scripts/migrate-evac-subitems.mjs --dry     # 저장 없이 계획만
 *
 * 배경: 피난기구 종류를 두 곳에서 서로 다른 어휘로 받고 있었고, 그중 대장 하위 8종은
 *   **어느 문서에도 인쇄되지 않았다**(fire-plan-generate가 표준 42종만 남기고 필터,
 *   별지 9호 3쪽은 ck(false) 하드코딩). 인쇄되는 세부제원 types를 단일 저장소로 통일하면서
 *   이미 체크돼 있던 대장 하위 행을 통합 어휘 11종으로 옮긴다.
 *
 * 규칙:
 *   - '(간이)완강기' 한 칸은 완강기·간이완강기 두 종을 겸했다 → 둘 다 켠다(EVAC_LEGACY_TO_TYPES).
 *   - 세부제원에 이미 값이 있으면 **합집합**으로 병합한다(사용자 입력 우선, 유실 없음).
 *   - 이관 후 레거시 행은 installed=false로 내린다(행 삭제 대신 — 되돌릴 수 있게).
 *   - customer_facility_specs는 (customer_id, building_id, section_key) 단위 1행이다.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

const prod = process.argv.includes('--prod')
const dry = process.argv.includes('--dry')
config({ path: resolve(process.cwd(), prod ? '.env.production' : '.env.local') })

const LEGACY_TO_TYPES = {
  '공기안전매트': ['공기안전매트'],
  '피난사다리': ['피난사다리'],
  '(간이)완강기': ['완강기', '간이완강기'],
  '미끄럼대': ['미끄럼대'],
  '구조대': ['구조대'],
  '다수인피난장비': ['다수인피난장비'],
  '승강식피난기': ['승강식피난기'],
  '하향식피난구용내림식사다리': ['하향식피난구용내림식사다리'],
}
const EVAC_TYPES = [
  '피난사다리', '완강기', '간이완강기', '구조대', '공기안전매트', '미끄럼대',
  '다수인피난장비', '승강식피난기', '하향식피난구용내림식사다리', '피난교', '피난용트랩',
]
const SECTION = 's36_evac'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Supabase 환경변수가 없습니다.'); process.exit(1) }
const admin = createClient(url, key, { auth: { persistSession: false } })
console.log(`대상: ${url} ${dry ? '(dry run)' : ''}`)

// 1) 체크된 레거시 하위 행 수집
const { data: rows, error } = await admin.from('fire_facilities')
  .select('id, building_id, facility_code')
  .in('facility_code', Object.keys(LEGACY_TO_TYPES)).eq('installed', true)
if (error) { console.error('✗ fire_facilities 조회:', error.message); process.exit(1) }
if (!rows.length) { console.log('이관할 레거시 하위 체크가 없습니다 — 종료'); process.exit(0) }

// 2) 건물 → 종류 집합
const byBuilding = new Map()
for (const r of rows) {
  const set = byBuilding.get(r.building_id) ?? new Set()
  for (const t of LEGACY_TO_TYPES[r.facility_code]) set.add(t)
  byBuilding.set(r.building_id, set)
}
console.log(`레거시 체크 ${rows.length}행 → 건물 ${byBuilding.size}곳`)

// 3) 건물 → 고객 (specs는 customer_id 필수)
const { data: blds, error: e2 } = await admin.from('buildings')
  .select('id, customer_id, building_name').in('id', [...byBuilding.keys()])
if (e2) { console.error('✗ buildings 조회:', e2.message); process.exit(1) }
const custOf = new Map(blds.map(b => [b.id, b.customer_id]))
const nameOf = new Map(blds.map(b => [b.id, b.building_name]))

let done = 0
for (const [buildingId, typeSet] of byBuilding) {
  const customerId = custOf.get(buildingId)
  if (!customerId) { console.log(`  ⚠ 건물 ${buildingId} — customers 연결 없음, 건너뜀`); continue }

  const { data: exRows } = await admin.from('customer_facility_specs')
    .select('id, spec').eq('customer_id', customerId).eq('building_id', buildingId)
    .eq('section_key', SECTION).limit(1)
  const ex = exRows?.[0]
  const spec = (ex?.spec ?? {})
  const block = { ...(spec['evac_equipment'] ?? {}) }
  const before = Array.isArray(block.types) ? block.types.map(String) : []
  // 합집합 후 통합 어휘 정의 순서로 정렬 — 서식 인쇄 순서와 어긋나지 않게
  const merged = EVAC_TYPES.filter(t => before.includes(t) || typeSet.has(t))
  block.types = merged
  const nextSpec = { ...spec, evac_equipment: block }

  console.log(`  ${nameOf.get(buildingId) ?? buildingId}: [${before.join(', ') || '없음'}] + [${[...typeSet].join(', ')}] → [${merged.join(', ')}]`)
  if (dry) { done++; continue }

  const { error: e3 } = ex
    ? await admin.from('customer_facility_specs').update({ spec: nextSpec }).eq('id', ex.id)
    : await admin.from('customer_facility_specs')
      .insert({ customer_id: customerId, building_id: buildingId, section_key: SECTION, spec: nextSpec })
  if (e3) { console.error(`  ✗ specs 저장 실패(${buildingId}): ${e3.message}`); process.exit(1) }
  done++
}

if (dry) { console.log(`\ndry run — ${done}건 계획만 출력했습니다.`); process.exit(0) }

// 4) 레거시 행 내리기 — 삭제하지 않는다(되돌릴 수 있게)
const { error: e4 } = await admin.from('fire_facilities')
  .update({ installed: false }).in('id', rows.map(r => r.id))
if (e4) { console.error('✗ 레거시 행 정리 실패:', e4.message); process.exit(1) }

console.log(`\n완료 — 건물 ${done}곳 이관, 레거시 ${rows.length}행 installed=false 처리`)
