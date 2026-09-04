// 소방계획서_40 E2E 픽스처 실측 — 어느 설비를 쓸지 추측하지 않는다.
// 시트 실재 + 형제 설비(한 시트가 여러 설비를 덮는지)를 미리 재서 단언을 그 사실 위에 세운다.
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'
import { facilitiesForSheet } from '../src/lib/sheet-facility-map'
import { ALL_STANDARD_CODES } from '../src/lib/facility-codes'

const raw = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const CAND = ['옥내소화전설비', '연결송수관설비', '비상콘센트설비', '물분무소화설비', '스프링클러설비', '유도등']

const { data: sheets, error } = await raw.from('inspection_sheets')
  .select('id, sheet_code, sheet_name, version').eq('version', 'v2025')
if (error) throw new Error(error.message)

for (const c of CAND) {
  const sh = (sheets ?? []).find((s: { sheet_name: string }) => s.sheet_name === c)
  if (!sh) { console.log(`${c}: ❌ 시트 없음`); continue }
  const { count } = await raw.from('inspection_sheet_items')
    .select('*', { count: 'exact', head: true }).eq('sheet_id', sh.id)
  const sibs = facilitiesForSheet(sh.sheet_name, ALL_STANDARD_CODES)
  console.log(`${c}: ${sh.sheet_code} · 항목 ${count} · 이 시트가 덮는 설비 [${sibs.join(', ')}]`)
}
