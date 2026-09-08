/** 「주용도」가 어디서 오는지 추적 — DB 값 · 조립 값 · 산출물 셀을 나란히 본다.
 *  렌더를 눈으로 보고 짐작하지 않는다(오늘 그렇게 여러 번 틀렸다). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { assembleFirePlan } from '../src/lib/fire-plan-generate.ts'
import { buildFirePlanValues } from '../src/lib/fire-plan-xlsx-values.ts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'

config({ path: '.env.local' })
const HERE = dirname(fileURLToPath(import.meta.url))
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { data: cust } = await db.from('customers').select('id, customer_name').eq('customer_name', '강순기 건물_2').single()
const cid = cust!.id as string

console.log('① DB 원값')
const { data: bs } = await db.from('buildings').select('building_name, purpose, etc_purpose').eq('customer_id', cid)
for (const b of (bs ?? []) as Record<string, unknown>[]) {
  console.log(`   buildings.purpose = «${b.purpose}» · etc_purpose = «${b.etc_purpose}»`)
}

console.log('\n② 조립 결과(FirePlanGenData)')
const year = new Date(Date.now() + 9 * 3600_000).getFullYear()
const { data } = await assembleFirePlan(db as never, cid, year)
console.log(`   d.purpose = «${(data as Record<string, unknown>).purpose}»`)

console.log('\n③ 값 맵')
const values = buildFirePlanValues(data)
const pv = values.get('purpose')
console.log(`   values['purpose'] = ${JSON.stringify(pv)}`)

console.log('\n④ 산출물 셀 (앵커가 지목한 자리)')
const a = FIRE_PLAN_ANCHORS.find(x => x.field === 'purpose')!
console.log(`   앵커 ${a.sheet}!${a.cell} (라벨칸 ${a.labelCell})`)
const wb = XLSX.read(readFileSync('F:\\AI\\sjfire\\_강순기_형식비교\\_e2e_소방계획서.xlsx'), { sheetStubs: true })
const ws = wb.Sheets[a.sheet]
console.log(`   셀 값 = «${ws?.[a.cell]?.v ?? '(빈)'}»`)
console.log(`   라벨칸 = «${ws?.[a.labelCell]?.v ?? '(빈)'}»`)
