// 소방계획서 HWP 워커 큐 스모크 (A안 placeholder 모드 검증, 2026-07-16)
// 큐에 생성 요청 → 워커 처리 대기 → 결과 JSON·fire_plans 행 확인 → 생성물 정리
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: custs } = await sb.from('customers').select('id, customer_name').eq('customer_name', '개군면복지회관').limit(1)
if (!custs?.length) { console.error('고객 없음'); process.exit(1) }
const cust = custs[0]
const reqName = `smoke-aplan-${Date.now()}.json`
const before = await sb.from('fire_plans').select('id').eq('customer_id', cust.id)
const beforeIds = new Set((before.data ?? []).map(r => r.id))

await sb.storage.from('fire-plans').upload(`_queue/${reqName}`,
  new Blob([JSON.stringify({ customerId: cust.id, year: 2026, customerName: cust.customer_name })], { type: 'application/json' }))
console.log('큐 등록:', reqName)

let result = null
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 5000))
  const { data } = await sb.storage.from('fire-plans').download(`_results/${reqName}`)
  if (data) { result = JSON.parse(await data.text()); break }
}
if (!result) { console.error('타임아웃: 결과 없음 (워커 로그 확인)'); process.exit(1) }
console.log('결과:', JSON.stringify(result, null, 2).slice(0, 800))

const after = await sb.from('fire_plans').select('id, title, pdf_path, hwp_path, revision').eq('customer_id', cust.id)
if (after.error) { console.error('fire_plans 조회 실패:', after.error.message); process.exit(1) }
const newRows = (after.data ?? []).filter(r => !beforeIds.has(r.id))
console.log('신규 fire_plans 행:', newRows.length, newRows.map(r => `${r.title} rev${r.revision}`).join(', '))

// PDF 시그니처 확인
if (newRows.length) {
  const { data: pdf } = await sb.storage.from('fire-plans').download(newRows[0].pdf_path)
  if (pdf) {
    const head = Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()
    console.log('PDF 시그니처:', head, head === '%PDF-' ? 'OK' : 'FAIL')
  }
  // 정리: 스모크 생성물 삭제
  for (const r of newRows) {
    await sb.storage.from('fire-plans').remove([r.pdf_path, r.hwp_path].filter(Boolean))
    await sb.from('fire_plans').delete().eq('id', r.id)
  }
  console.log('정리 완료 (스모크 생성물 삭제)')
}
console.log(result.ok === false ? 'SMOKE FAIL' : 'SMOKE PASS')
process.exit(result.ok === false ? 1 : 0)
