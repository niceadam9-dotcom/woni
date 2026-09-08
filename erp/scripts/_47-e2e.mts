/** Q-9 끝단 검증 — **라우트와 같은 순서**로 실제 고객의 소방계획서 엑셀을 만들어 본다.
 *
 *  템플릿·앵커·타입까지는 통과했지만 `assembleFirePlan → 값 → 주입`의 끝단은 안 돌려봤다.
 *  여기서 초록이 아니면 「엑셀 받기」가 500으로 끊긴다.
 *
 *  🚨 산출물은 실고객 문서다 — 저장소 밖에 쓴다.
 *  실행: npx tsx --conditions=react-server scripts/_47-e2e.mts
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
/* ⚠ 세 함수는 **서로 다른 모듈**에 있다 — 라우트의 import를 그대로 따랐다.
 *   한 파일에 있으리라 짐작했다가 `does not provide an export named 'injectWorkbook'`으로 섰다. */
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'
import { assembleFirePlan } from '../src/lib/fire-plan-generate.ts'
import { buildFirePlanValues, missingValueFields } from '../src/lib/fire-plan-xlsx-values.ts'

config({ path: '.env.local' })
const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = resolve(HERE, '../templates/fire-plan-workbook.xlsx')
const OUT = 'F:\\AI\\sjfire\\_강순기_형식비교\\_e2e_소방계획서.xlsx'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: cust } = await db.from('customers').select('id, customer_name').eq('customer_name', '강순기 건물_2').single()
if (!cust) { console.log('고객을 못 찾음'); process.exit(1) }
console.log(`고객 ${cust.customer_name}`)

const bytes = new Uint8Array(readFileSync(TEMPLATE))

console.log('\n① 앵커 검증')
const check = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
console.log(`   ${check.ok ? '✅ 통과' : `🚨 실패 ${check.failures.length}`}`)
if (!check.ok) { check.failures.slice(0, 10).forEach(f => console.log('   ' + JSON.stringify(f))); process.exit(1) }
if (check.healed?.length) console.log(`   ⚠ 자가치유 ${check.healed.length}건: ${check.healed.slice(0, 3).join(' / ')}`)

console.log('\n② 조립 + 값')
const year = new Date(Date.now() + 9 * 3600_000).getFullYear()
const { data, missing } = await assembleFirePlan(db as never, cust.id as string, year)
const values = buildFirePlanValues(data)
console.log(`   값 ${values.size}개 · 미입력 고지 ${missing.length}건`)
const gaps = missingValueFields(values)
console.log(`   ${gaps.length ? `🚨 값 매핑 불완전 ${gaps.length}칸: ${gaps.slice(0, 10).join(', ')}` : '✅ 값 매핑 완전'}`)
if (gaps.length) process.exit(1)

console.log('\n③ 주입 대상')
const { targets, unmapped } = toInjectTargets(values, check.anchors)
console.log(`   대상 ${targets.length} · 미매핑 ${unmapped.length}`)
if (unmapped.length) { unmapped.slice(0, 10).forEach(a => console.log(`   🚨 ${a.sheet}!${a.cell}`)); process.exit(1) }

console.log('\n④ 주입')
const result = await injectWorkbook(bytes, targets)
console.log(`   ${result.missed.length ? `🚨 실패 ${result.missed.length}칸` : '✅ 전건 착지'} · ${result.bytes.length}바이트`)
if (result.missed.length) { result.missed.slice(0, 10).forEach(m => console.log('   ' + JSON.stringify(m))); process.exit(1) }

writeFileSync(OUT, Buffer.from(result.bytes))
console.log(`\n✅ 끝단 통과 → ${OUT}`)
if (missing.length) console.log(`   (미입력 고지 ${missing.length}건 — 값이 없는 칸이지 결함이 아니다)`)
