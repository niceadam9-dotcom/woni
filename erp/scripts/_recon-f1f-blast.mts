/** F-1f(조기진압·할론 독립 시트 분리) 결정 재료 — 읽기 전용 실측.
 *
 *  분리하면 무엇이 흔들리는지 계량한다:
 *   ① 조기진압/할론이 '설치'로 체크된 고객 수 (분리의 수혜/영향 대상)
 *   ② 그 고객들의 점검 회차에서 묶음 시트(스프링클러 STD-03·할로겐 STD-11)에 쌓인 응답 수
 *      — 분리 시 이 응답들이 새 시트로 재귀속되지 않으면 기존 회차 결과칸이 공란으로 퇴행한다
 *   ③ 형제(스프링클러/할로겐화합물)도 함께 설치인지 — 형제가 있으면 응답 귀속이 형제로 남아
 *      재귀속 없이도 그 형제 칸은 유지된다(조기진압/할론 칸만 공란화)
 *  실행: npx tsx scripts/_recon-f1f-blast.mts */
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ENV_FILE=.env.local.prod-backup 로 운영 대상 실측 가능(읽기 전용 쿼리뿐이라 안전)
for (const line of readFileSync(path.join(import.meta.dirname, '..', process.env.ENV_FILE ?? '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const q = async <T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> => {
  const r = await p
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return (r.data ?? []) as T[]
}

const TARGETS = [
  { code: '화재조기진압용 스프링클러설비', sibling: '스프링클러설비', sheet: '스프링클러설비' },
  { code: '할론소화설비', sibling: '할로겐화합물 및 불활성기체소화설비', sheet: '할로겐화합물 및 불활성기체소화설비' },
]

// 시트 → item_code 집합 (묶음 시트의 응답만 세기 위해)
const sheets = await q<{ id: string; sheet_name: string }>(
  admin.from('inspection_sheets').select('id, sheet_name').in('sheet_name', TARGETS.map(t => t.sheet)), 'sheets')
const items = await q<{ item_code: string; sheet_id: string }>(
  admin.from('inspection_sheet_items').select('item_code, sheet_id').in('sheet_id', sheets.map(s => s.id)), 'items')
const codesOfSheet = new Map<string, Set<string>>()
for (const s of sheets) codesOfSheet.set(s.sheet_name, new Set(items.filter(i => i.sheet_id === s.id).map(i => i.item_code)))

for (const t of TARGETS) {
  console.log(`\n===== ${t.code} (묶음 시트: '${t.sheet}') =====`)
  const facs = await q<{ building_id: string; facility_code: string }>(
    admin.from('fire_facilities').select('building_id, facility_code').eq('facility_code', t.code).eq('installed', true), 'fire_facilities')
  if (!facs.length) { console.log('  설치 0건 — 분리해도 지금 당장 영향받는 고객 없음'); continue }

  const blds = await q<{ id: string; customer_id: string }>(
    admin.from('buildings').select('id, customer_id').in('id', facs.map(f => f.building_id)), 'buildings')
  const custIds = [...new Set(blds.map(b => b.customer_id))]

  // 형제 동시 설치 여부 (같은 고객의 활성 건물 기준)
  const allBlds = await q<{ id: string; customer_id: string }>(
    admin.from('buildings').select('id, customer_id').in('customer_id', custIds).eq('is_active', true), 'buildings2')
  const sibRows = await q<{ building_id: string }>(
    admin.from('fire_facilities').select('building_id').eq('facility_code', t.sibling).eq('installed', true)
      .in('building_id', allBlds.map(b => b.id)), 'sibling')
  const sibCust = new Set(sibRows.map(r => allBlds.find(b => b.id === r.building_id)?.customer_id))

  const custs = await q<{ id: string; customer_name: string }>(
    admin.from('customers').select('id, customer_name').in('id', custIds), 'customers')
  console.log(`  설치 고객 ${custs.length}곳: ${custs.map(c => `${c.customer_name}${sibCust.has(c.id) ? '(형제도 설치)' : '(단독)'}`).join(', ')}`)

  // 그 고객들의 회차에서 묶음 시트 응답 수
  const insps = await q<{ id: string; customer_id: string; year: number; status: string }>(
    admin.from('inspections').select('id, customer_id, year, status').in('customer_id', custIds), 'inspections')
  const sheetCodes = codesOfSheet.get(t.sheet) ?? new Set()
  let total = 0
  for (const insp of insps) {
    const resp = await q<{ item_code: string }>(
      admin.from('inspection_sheet_responses').select('item_code').eq('inspection_id', insp.id), 'resp')
    const n = resp.filter(r => sheetCodes.has(r.item_code)).length
    if (n) {
      const cn = custs.find(c => c.id === insp.customer_id)?.customer_name
      console.log(`    · ${cn} ${insp.year}(${insp.status}) — 묶음 시트 응답 ${n}건`)
      total += n
    }
  }
  console.log(`  → 분리 시 재귀속 대상 응답 합계: ${total}건`)
}
