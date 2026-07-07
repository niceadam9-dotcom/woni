import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://ryuozdhnilfjlahorizh.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dW96ZGhuaWxmamxhaG9yaXpoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU4ODYzMSwiZXhwIjoyMDk3MTY0NjMxfQ.0HDCXsF-z2GTEhi8n50DAUOmMZrnO22_qFkMmBafunI'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  // ── admin 계정 조회 ──────────────────────────────────────────
  const { data: admins, error: adminErr } = await supabase
    .from('profiles')
    .select('id, name, role')
    .eq('role', 'admin')
    .limit(1)

  if (adminErr || !admins?.length) {
    console.error('admin 계정을 찾을 수 없습니다:', adminErr?.message)
    process.exit(1)
  }

  const adminId = admins[0].id
  console.log(`✓ admin 계정: ${admins[0].name} (${adminId})`)

  // ── 1단계: 고객 50건 삽입 ────────────────────────────────────
  const { customers } = JSON.parse(
    readFileSync(join(__dirname, 'mockdata/customers-yangpyeong.json'), 'utf-8')
  )
  console.log(`\n[고객] ${customers.length}건 로드`)

  // region 컬럼 존재 여부 확인 (018_region 마이그레이션 적용 여부)
  const { data: sampleCustomer } = await supabase
    .from('customers')
    .select('region_si')
    .limit(1)
  const hasRegionCols = sampleCustomer !== null

  const customerRows = customers.map(c => {
    const row = {
      customer_code:   c.customer_code,
      customer_name:   c.customer_name,
      contract_date:   c.contract_date,
      inspection_type: c.inspection_type,
      address:         c.address ?? null,
      notes:           c.notes ?? null,
      is_active:       c.is_active,
      created_by:      adminId,
      assigned_employee_id: null,
    }
    if (hasRegionCols) {
      row.region_si    = c.region_si ?? null
      row.region_myeon = c.region_myeon ?? null
      row.region_ri    = c.region_ri ?? null
    }
    return row
  })

  let custInserted = 0
  let custSkipped = 0
  const BATCH = 10

  for (let i = 0; i < customerRows.length; i += BATCH) {
    const batch = customerRows.slice(i, i + BATCH)
    const { data, error } = await supabase
      .from('customers')
      .upsert(batch, { onConflict: 'customer_code', ignoreDuplicates: true })
      .select('id')

    if (error) {
      console.error(`  ✗ 고객 배치 ${i / BATCH + 1} 오류:`, error.message)
    } else {
      const count = data?.length ?? 0
      custInserted += count
      custSkipped += batch.length - count
      console.log(`  배치 ${i / BATCH + 1}: ${count}건 삽입`)
    }
  }
  console.log(`→ 고객 완료: 삽입 ${custInserted}건 / 중복 스킵 ${custSkipped}건`)

  // ── 2단계: 삽입된 고객 ID 조회 (customer_code → id 맵) ───────
  const codes = customers.map(c => c.customer_code)
  const { data: inserted, error: fetchErr } = await supabase
    .from('customers')
    .select('id, customer_code')
    .in('customer_code', codes)

  if (fetchErr || !inserted?.length) {
    console.error('고객 ID 조회 실패:', fetchErr?.message)
    process.exit(1)
  }

  const codeToId = Object.fromEntries(
    inserted.map(r => [r.customer_code, r.id])
  )
  console.log(`✓ 고객 ID 맵 완성: ${Object.keys(codeToId).length}건`)

  // ── 3단계: 건물 50건 삽입 ────────────────────────────────────
  const { buildings } = JSON.parse(
    readFileSync(join(__dirname, 'mockdata/buildings-yangpyeong.json'), 'utf-8')
  )
  console.log(`\n[건물] ${buildings.length}건 로드`)

  const buildingRows = buildings
    .filter(b => {
      if (!codeToId[b.customer_code]) {
        console.warn(`  ⚠ customer_code "${b.customer_code}" 에 해당하는 고객 없음 — 스킵`)
        return false
      }
      return true
    })
    .map(b => ({
      customer_id:  codeToId[b.customer_code],
      building_name: b.building_name,
      address:      b.address ?? null,
      purpose:      b.purpose ?? null,
      total_area:   b.total_area ?? null,
      floors_above: b.floors_above ?? null,
      floors_below: b.floors_below ?? null,
      year_built:   b.year_built ?? null,
      notes:        b.notes ?? null,
      created_by:   adminId,
    }))

  let bldInserted = 0

  for (let i = 0; i < buildingRows.length; i += BATCH) {
    const batch = buildingRows.slice(i, i + BATCH)
    const { data, error } = await supabase
      .from('buildings')
      .insert(batch)
      .select('id')

    if (error) {
      console.error(`  ✗ 건물 배치 ${i / BATCH + 1} 오류:`, error.message)
    } else {
      bldInserted += data?.length ?? 0
      console.log(`  배치 ${i / BATCH + 1}: ${data?.length ?? 0}건 삽입`)
    }
  }
  console.log(`→ 건물 완료: 삽입 ${bldInserted}건`)

  console.log('\n✅ 양평군 Mock 데이터 시딩 완료')
  console.log(`   고객 ${custInserted}건 + 건물 ${bldInserted}건`)
}

main().catch(e => { console.error(e); process.exit(1) })
