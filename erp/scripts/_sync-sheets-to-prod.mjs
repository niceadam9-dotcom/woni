// 점검표(inspection_sheets + items) 스테이징 → 운영 동기화 (2026-07-16, 사용자 지시)
// 운영 기존 시트는 전부 교체(사전 조건: 운영 sheet_responses 0건 확인). created_by는 프로필 FK 불일치로 null 처리.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

function loadEnv(file) {
  return Object.fromEntries(
    readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  )
}
const stg = loadEnv('.env.local')
const prd = loadEnv('.env.local.prod-backup')
if (!prd.NEXT_PUBLIC_SUPABASE_URL.includes('ryuozdhnilfjlahorizh')) { console.error('운영 env 아님'); process.exit(1) }
const S = createClient(stg.NEXT_PUBLIC_SUPABASE_URL, stg.SUPABASE_SERVICE_ROLE_KEY)
const P = createClient(prd.NEXT_PUBLIC_SUPABASE_URL, prd.SUPABASE_SERVICE_ROLE_KEY)

// 사전 조건: 운영 응답 0건 (응답이 있으면 교체 금지)
const { count: respCnt } = await P.from('inspection_sheet_responses').select('id', { count: 'exact', head: true })
if (respCnt !== 0) { console.error(`중단: 운영 sheet_responses ${respCnt}건 존재`); process.exit(1) }

// 스테이징 전량 조회 (.range 페이지 순회 — 1,000행 한도 룰)
async function fetchAll(client, table, cols) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(cols).order('id').range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}
const sheets = await fetchAll(S, 'inspection_sheets', '*')
const items = await fetchAll(S, 'inspection_sheet_items', '*')
console.log(`스테이징: 시트 ${sheets.length} / 항목 ${items.length}`)

// 운영 기존 데이터 제거 (items는 sheet CASCADE지만 명시 삭제)
await P.from('inspection_sheet_items').delete().gte('created_at', '1970-01-01')
const { error: delErr } = await P.from('inspection_sheets').delete().gte('created_at', '1970-01-01')
if (delErr) { console.error('운영 기존 시트 삭제 실패:', delErr.message); process.exit(1) }

// 삽입 (id 보존, created_by는 운영 프로필에 없으므로 null)
const { error: sErr } = await P.from('inspection_sheets').insert(sheets.map(s => ({ ...s, created_by: null })))
if (sErr) { console.error('시트 삽입 실패:', sErr.message); process.exit(1) }
for (let i = 0; i < items.length; i += 500) {
  const { error: iErr } = await P.from('inspection_sheet_items').insert(items.slice(i, i + 500))
  if (iErr) { console.error(`항목 삽입 실패(${i}~):`, iErr.message); process.exit(1) }
}

// 검증: 건수 + 샘플 대조
const { count: ps } = await P.from('inspection_sheets').select('id', { count: 'exact', head: true })
const { count: pi } = await P.from('inspection_sheet_items').select('id', { count: 'exact', head: true })
const { data: sample } = await P.from('inspection_sheets').select('sheet_code, sheet_name, version, is_active').order('sheet_code').limit(3)
console.log(`운영 결과: 시트 ${ps} / 항목 ${pi}`)
console.log('샘플:', JSON.stringify(sample))
const ok = ps === sheets.length && pi === items.length
console.log(ok ? '✅ 동기화 완료 (건수 일치)' : '❌ 건수 불일치')
process.exit(ok ? 0 : 1)
