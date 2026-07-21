// 소방계획서 HWP 워커 큐 스모크 (DB 큐 전환 검증, 2026-07-21)
// fire_plan_gen_jobs에 생성 요청 → 워커 처리 대기 → done 행·fire_plans 행 확인 → 생성물 정리
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
const before = await sb.from('fire_plans').select('id').eq('customer_id', cust.id)
const beforeIds = new Set((before.data ?? []).map(r => r.id))

const { data: job, error: insErr } = await sb.from('fire_plan_gen_jobs').insert({
  customer_id: cust.id, customer_name: cust.customer_name, year: 2026,
}).select('id').single()
if (insErr) { console.error('큐 등록 실패:', insErr.message); process.exit(1) }
console.log('큐 등록:', job.id)

let result = null
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 5000))
  const { data } = await sb.from('fire_plan_gen_jobs')
    .select('status, error, missing, finished_at').eq('id', job.id).single()
  if (data && (data.status === 'done' || data.status === 'failed')) { result = data; break }
}
if (!result) { console.error('타임아웃: 작업 미완료 (워커 로그 확인)'); process.exit(1) }
console.log('결과:', JSON.stringify(result, null, 2).slice(0, 800))

// 095 2단계: done 직후 HWP·HTML 먼저 등록되고 PDF는 뒤따라 변환 — ready까지 추가 대기
let newRows = []
for (let i = 0; i < 24; i++) {
  const after = await sb.from('fire_plans')
    .select('id, title, pdf_path, pdf_status, hwp_path, html_path, odt_path, revision').eq('customer_id', cust.id)
  if (after.error) { console.error('fire_plans 조회 실패:', after.error.message); process.exit(1) }
  newRows = (after.data ?? []).filter(r => !beforeIds.has(r.id))
  if (newRows.length && newRows.every(r => r.pdf_status !== 'converting')) break
  await new Promise(r => setTimeout(r, 5000))
}
console.log('신규 fire_plans 행:', newRows.length,
  newRows.map(r => `${r.title} rev${r.revision} pdf=${r.pdf_status} html=${r.html_path ? 'O' : 'X'}`).join(', '))

// PDF 시그니처 확인
if (newRows.length) {
  if (newRows[0].pdf_path) {
    const { data: pdf } = await sb.storage.from('fire-plans').download(newRows[0].pdf_path)
    if (pdf) {
      const head = Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()
      console.log('PDF 시그니처:', head, head === '%PDF-' ? 'OK' : 'FAIL')
    }
  } else {
    console.log('PDF 미생성 (pdf_status:', newRows[0].pdf_status + ')')
  }
  // 정리: 스모크 생성물 삭제
  for (const r of newRows) {
    await sb.storage.from('fire-plans').remove([r.pdf_path, r.hwp_path, r.html_path, r.odt_path].filter(Boolean))
    await sb.from('fire_plans').delete().eq('id', r.id)
  }
  console.log('정리 완료 (스모크 생성물 삭제)')
}
await sb.from('fire_plan_gen_jobs').delete().eq('id', job.id)
console.log(result.status === 'failed' ? 'SMOKE FAIL' : 'SMOKE PASS')
process.exit(result.status === 'failed' ? 1 : 0)
