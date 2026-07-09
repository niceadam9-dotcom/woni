import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

import { SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY } from './_env.mjs'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  // admin 계정 UUID 조회
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

  // JSON 로드
  const raw = readFileSync(join(__dirname, 'mockdata/customers.json'), 'utf-8')
  const { customers } = JSON.parse(raw)
  console.log(`✓ 총 ${customers.length}개 고객 데이터 로드 완료`)

  // created_by 주입
  const rows = customers.map(c => ({
    customer_code: c.customer_code,
    customer_name: c.customer_name,
    contract_date: c.contract_date,
    inspection_type: c.inspection_type,
    address: c.address ?? null,
    notes: c.notes ?? null,
    is_active: c.is_active,
    created_by: adminId,
    assigned_employee_id: null,
  }))

  // 10개씩 배치 삽입
  const BATCH = 10
  let inserted = 0
  let skipped = 0

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { data, error } = await supabase
      .from('customers')
      .upsert(batch, { onConflict: 'customer_code', ignoreDuplicates: true })
      .select('id')

    if (error) {
      console.error(`✗ 배치 ${i / BATCH + 1} 오류:`, error.message)
    } else {
      const count = data?.length ?? 0
      inserted += count
      skipped += batch.length - count
      console.log(`  배치 ${i / BATCH + 1}: ${count}개 삽입 (누적 ${inserted}개)`)
    }
  }

  console.log(`\n완료: 삽입 ${inserted}개 / 중복 스킵 ${skipped}개`)
}

main().catch(e => { console.error(e); process.exit(1) })
