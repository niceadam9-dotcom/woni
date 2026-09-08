/** 42 산출본 ↔ 47 산출본 육안 비교용 — **같은 고객**으로 42 쪽을 굽는다(일회성·읽기 전용).
 *
 *  47은 `_gs-book50.mts`가 이미 `F:\AI\sjfire\_강순기_형식비교\강순기_소방계획서_v6.xlsx`를
 *  만들어 두었다(정본 고객 = 강순기 건물_2). 여기서는 **42의 라우트가 실제로 내보내는 것과
 *  같은 경로**로 그 고객의 엑셀을 만들어 같은 폴더에 나란히 놓는다.
 *
 *  🚨 산출물은 **저장소 밖**에만 쓴다 — 강순기는 실고객이다(R-2).
 *  ⚠ 라우트를 그대로 흉내 낸다: assembleFirePlan → validateAnchors → 값 → toInjectTargets →
 *    injectWorkbook. 다른 길로 만들면 '비교한 것'이 실제 납품물이 아니게 된다.
 *
 *  실행: npx tsx --conditions=react-server --env-file=.env.local scripts/_probe-42-vs47.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { assembleFirePlan } from '../src/lib/fire-plan-generate.ts'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'
import { buildFirePlanValues, missingValueFields, zoneRowOverflow, brigadeRowOverflow } from '../src/lib/fire-plan-xlsx-values.ts'

const CUSTOMER = process.argv[2] ?? 'afd786d5-7fa8-42d2-bfbb-8e877ba630e5' // 강순기 건물_2
const OUT_DIR = process.argv[3] ?? 'F:\\AI\\sjfire\\_강순기_형식비교'

const HERE = dirname(fileURLToPath(import.meta.url))
const TPL = resolve(HERE, '../templates/fire-plan-workbook.xlsx')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.log('환경변수 없음 — --env-file=.env.local 로 실행하라'); process.exit(1) }
const admin = createClient(url, key, { auth: { persistSession: false } })

const bytes = new Uint8Array(readFileSync(TPL))
const { data, missing } = await assembleFirePlan(admin as never, CUSTOMER, new Date().getFullYear())

// 라우트가 500으로 끊는 네 자리를 그대로 통과시킨다 — 여기서 조용히 넘기면 비교본이 거짓이 된다
const check = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
if (!check.ok) { console.error('앵커 불일치:\n  ' + check.failures.join('\n  ')); process.exit(1) }
if (check.healed.length) console.log(`⚠ 자가치유 ${check.healed.length}건: ${check.healed.join(' · ')}`)

const values = buildFirePlanValues(data)
const gaps = missingValueFields(values)
if (gaps.length) { console.error(`값 맵 구멍 ${gaps.length}: ${gaps.join(',')}`); process.exit(1) }

const { targets, unmapped } = toInjectTargets(values, check.anchors)
if (unmapped.length) { console.error(`unmapped ${unmapped.length}`); process.exit(1) }
const inj = await injectWorkbook(bytes, targets)
if (inj.missed.length) { console.error(`missed ${inj.missed.length}: ${inj.missed.join(',')}`); process.exit(1) }

mkdirSync(OUT_DIR, { recursive: true })
const out = join(OUT_DIR, '42_강순기_소방계획서.xlsx')
writeFileSync(out, inj.bytes)

console.log(`✅ ${out}  (${inj.bytes.length} bytes)`)
console.log(`   고객=${data.buildingName} · 앵커 ${FIRE_PLAN_ANCHORS.length} · 착지 ${targets.length} · missed 0`)
console.log(`   구역 넘침 ${zoneRowOverflow(data)} · 대원 넘침 ${brigadeRowOverflow(data)}`)
console.log(`   조립 고지(미입력) ${missing.length}건: ${missing.slice(0, 8).join(' | ')}`)
