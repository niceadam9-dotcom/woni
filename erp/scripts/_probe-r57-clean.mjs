// R5-7 대조용으로 남겨 둔 시드 정리 — 대조가 끝난 뒤 실행
// 실행: node scripts/_probe-r57-clean.mjs
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('F:/AI/ERP/erp/.env.local', 'utf8')
const db = createClient(
  /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(env)[1].trim(),
  /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(env)[1].trim(),
  { auth: { persistSession: false } })

const { data: custs } = await db.from('customers').select('id, customer_name').like('customer_name', 'R57대조%')
console.log(`대상 고객 ${(custs ?? []).length}건`)

for (const c of custs ?? []) {
  const { data: insps } = await db.from('inspections').select('id').eq('customer_id', c.id)
  for (const i of insps ?? []) {
    for (const t of ['inspection_pump_tests', 'inspection_sheet_responses', 'inspection_defects',
      'inspection_participants', 'inspection_reports', 'inspection_steps', 'generated_reports', 'annex_inputs']) {
      await db.from(t).delete().eq('inspection_id', i.id)
    }
    await db.from('fire_plan_gen_jobs').delete().eq('inspection_id', i.id)
    for (const bucket of ['fire-plans', 'reports']) {
      const { data: files } = await db.storage.from(bucket).list(`${c.id}/inspections/${i.id}`)
      const paths = (files ?? []).map(f => `${c.id}/inspections/${i.id}/${f.name}`)
      if (paths.length) await db.storage.from(bucket).remove(paths)
      const { data: f2 } = await db.storage.from(bucket).list(`${c.id}/${i.id}`)
      const p2 = (f2 ?? []).map(f => `${c.id}/${i.id}/${f.name}`)
      if (p2.length) await db.storage.from(bucket).remove(p2)
    }
    await db.from('inspections').delete().eq('id', i.id)
  }
  await db.from('inspection_plan_items').delete().eq('customer_id', c.id)
  await db.from('customers').delete().eq('id', c.id)
  console.log(`  정리: ${c.customer_name}`)
}

// 대조용 임시 계정
let removed = 0
for (let page = 1; ; page++) {
  const { data } = await db.auth.admin.listUsers({ page, perPage: 200 })
  const us = data?.users ?? []
  for (const u of us) {
    if (!/^r57c?-.*@erp-test\.com$/.test(u.email ?? '')) continue
    await db.from('profiles').delete().eq('id', u.id)
    const { error } = await db.auth.admin.deleteUser(u.id)
    if (!error) removed++
  }
  if (us.length < 200) break
}
console.log(`임시 계정 ${removed}건 삭제`)

const { data: left } = await db.from('customers').select('id').like('customer_name', 'R57대조%')
console.log(`잔존 고객: ${(left ?? []).length}건`)
