/** 「근생」이 어디에 남아 있나 — 산출물 파일별 + ERP. 어느 파일을 보고 계신지 가른다. */
import { readFileSync, existsSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const DIR = 'F:\\AI\\sjfire\\_강순기_형식비교'
console.log('── 산출물 파일별 「근생」 ──')
for (const f of readdirSync(DIR).filter(n => n.endsWith('.xlsx') && !n.startsWith('render'))) {
  const p = `${DIR}\\${f}`
  if (!existsSync(p)) continue
  let geun = 0, full = 0
  try {
    const wb = XLSX.read(readFileSync(p), { sheetStubs: true })
    for (const s of wb.SheetNames) {
      const ws = wb.Sheets[s]
      if (!ws['!ref']) continue
      const r = XLSX.utils.decode_range(ws['!ref'])
      for (let R = r.s.r; R <= r.e.r; R++) for (let C = r.s.c; C <= r.e.c; C++) {
        const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]
        if (!c || c.v === undefined) continue
        const v = String(c.v).trim()
        if (v === '근생') geun++
        if (v === '제2종근린생활시설') full++
      }
    }
    console.log(`  ${f.padEnd(34)} 근생 ${geun} · 제2종근린생활시설 ${full}${geun ? '  ← 아직 안 바뀐 판' : ''}`)
  } catch (e) { console.log(`  ${f}: 읽기 실패(${(e as Error).message.slice(0, 40)})`) }
}

/* ERP 쪽 */
config({ path: '.env.local' })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: cs } = await db.from('customers').select('id, customer_name').ilike('customer_name', '%강순%')
console.log('\n── ERP 건물 용도 ──')
for (const c of (cs ?? []) as Record<string, unknown>[]) {
  const { data: bs } = await db.from('buildings').select('building_name, purpose, etc_purpose').eq('customer_id', c.id as string)
  for (const b of (bs ?? []) as Record<string, unknown>[]) {
    console.log(`  ${String(c.customer_name).padEnd(14)} 건물 «${b.building_name}» purpose=«${b.purpose ?? '(빈)'}» etc=«${b.etc_purpose ?? '(빈)'}»`)
  }
}

/* 1.2.2 화재취약장소가 ERP에 있나 */
console.log('\n── 화재취약장소(hazards) ──')
for (const c of (cs ?? []) as Record<string, unknown>[]) {
  const { data, error } = await db.from('fire_plan_sections').select('*').eq('customer_id', c.id as string).limit(1)
  if (error) { console.log(`  ${c.customer_name}: fire_plan_sections 조회 실패 — ${error.message}`); continue }
  const row = (data?.[0] ?? {}) as Record<string, unknown>
  const keys = Object.keys(row)
  const hz = row.hazards ?? (row.sections as Record<string, unknown> | undefined)?.hazards
  console.log(`  ${c.customer_name}: 컬럼[${keys.join(',') || '행 없음'}] hazards=${hz ? JSON.stringify(hz).slice(0, 120) : '(없음)'}`)
}
