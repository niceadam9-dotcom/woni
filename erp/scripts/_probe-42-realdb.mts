/** 소방계획서_42 S7-4 — 실 DB 고객 1건 왕복.
 *
 *  ⚠ **HTTP 왕복과 파이프라인 왕복은 다른 축이다.** 앞은 라우트 배선(권한·헤더·스트리밍)을,
 *    뒤는 조립→값→주입을 본다. dev 서버가 성치 않으면 앞이 못 도는데, 그때 '검증했다'고
 *    말하면 안 되므로 **둘을 따로 세고 따로 보고**한다.
 *
 *  실행: npx tsx --env-file=.env.local scripts/_probe-42-realdb.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'
import { buildFirePlanValues, missingValueFields, zoneRowOverflow } from '../src/lib/fire-plan-xlsx-values.ts'
import { FIRE_PLAN_SCRUB_NEEDLES } from '../src/lib/fire-plan-scrub.ts'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { assembleFirePlan } from '../src/lib/fire-plan-generate.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')

let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${l}${d ? ' — ' + d : ''}`) }
  else { fail++; console.log(`  FAIL ${l}${d ? ' — ' + d : ''}`) }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.log('환경변수 없음 — --env-file=.env.local 로 실행하라'); process.exit(1) }
// ⚠ 테스트가 환경의 결핍에 기대면 안 된다(feedback_test_hermetic_env) — 키가 있어야만 도는 검사다
const admin = createClient(url, key, { auth: { persistSession: false } })

console.log('\n[1] 실 고객 선택 — 분모부터')
const { data: custs, error } = await admin.from('customers')
  .select('id, customer_name').eq('is_active', true).order('created_at').limit(50)
if (error) { console.log(`  조회 실패: ${error.message}`); process.exit(1) }
check('활성 고객이 0건이 아니다(눈멂 가드)', (custs?.length ?? 0) > 0, `${custs?.length ?? 0}건`)
if (!custs?.length) { console.log('  운영 데이터가 비어 있다 — S7-4는 여기서 판정 불가'); process.exit(1) }

console.log(`       후보: ${custs.slice(0, 5).map(c => c.customer_name).join(' · ')}${custs.length > 5 ? ` …외 ${custs.length - 5}` : ''}`)

const templateBytes = new Uint8Array(readFileSync(XLSX_PATH))
const year = new Date(Date.now() + 9 * 3600_000).getFullYear()

console.log('\n[2] 파이프라인 왕복 — 라우트가 하는 일을 그대로')
let okCount = 0
const report: string[] = []
let sample: { name: string; bytes: Uint8Array; notice: string[]; values: Map<string, unknown>; who: string } | null = null

for (const c of custs.slice(0, 5)) {
  try {
    const av = validateAnchors(templateBytes, FIRE_PLAN_ANCHORS)
    if (!av.ok) { report.push(`${c.customer_name}: 앵커 실패 ${av.failures[0]}`); continue }
    const { data, missing } = await assembleFirePlan(admin as never, c.id, year)
    const values = buildFirePlanValues(data)
    const gaps = missingValueFields(values)
    if (gaps.length) { report.push(`${c.customer_name}: 값 구멍 ${gaps.join(',')}`); continue }
    const { targets, unmapped } = toInjectTargets(values, av.anchors)
    if (unmapped.length) { report.push(`${c.customer_name}: unmapped ${unmapped.length}`); continue }
    const inj = await injectWorkbook(templateBytes, targets)
    if (inj.missed.length) { report.push(`${c.customer_name}: missed ${inj.missed.join(',')}`); continue }
    okCount++
    const notice = [
      ...av.healed.map(h => `자가치유: ${h}`),
      ...(zoneRowOverflow(data) ? [`구역 ${zoneRowOverflow(data)}개 미표기`] : []),
      ...missing,
    ]
    report.push(`${c.customer_name}: ok ${inj.bytes.length}B · 고지 ${notice.length}건`)
    if (!sample) sample = {
      name: data.buildingName || c.customer_name, bytes: inj.bytes, notice, values,
      // 대표·관리자가 동일인이면 전화가 같은 것이 **정상**이다(assembleFirePlan의 해석기가
      // 145 지목 → 1.7 → 대표 순으로 폴백한다). 같은 값을 보고 R-1 재발이라 오판하지 않으려면
      // 사람 이름을 함께 봐야 한다 — 이름이 다른데 전화가 같으면 그때가 결함이다.
      who: `대표='${data.ownerName}'(${data.ownerPhone}) 관리자='${data.managerName}'(${data.managerPhone})`,
    }
  } catch (e) {
    report.push(`${c.customer_name}: throw ${e instanceof Error ? e.message : String(e)}`)
  }
}
for (const r of report) console.log(`       ${r}`)
check('표본 전건 성공(라우트라면 전부 200)', okCount === Math.min(5, custs.length), `${okCount}/${Math.min(5, custs.length)}`)

console.log('\n[3] 산출물 성질 — spreadsheetml · >30KB · 니들 0건')
if (!sample) { check('표본 산출물 존재', false) }
else {
  check('>30KB', sample.bytes.length > 30_000, `${sample.bytes.length} bytes`)
  // spreadsheetml 판정은 확장자가 아니라 **파트 구조**로 — zip 안에 workbook.xml이 있는가
  const z = await JSZip.loadAsync(sample.bytes)
  check('workbook.xml 파트 존재(=spreadsheetml)', !!z.file('xl/workbook.xml'))
  check('sharedStrings 부재', !z.file('xl/sharedStrings.xml'))
  // 🚨 **니들 0건은 템플릿의 불변식이지 산출물의 불변식이 아니다.**
  //   실측으로 배웠다: 양평 소재 실고객의 관할소방서가 실제로 '양평소방서'라, 올바른 값이
  //   니들과 글자 그대로 겹친다. 여기서 0건을 요구하면 **맞는 값을 결함이라 부르게 된다**.
  //   (반대로 injectWorkbook의 `forbidden`에 이 니들을 넘겼다면 그 칸이 데이터에 따라 조용히
  //   사라졌을 것이다 — 갑지 workbook/route.ts:225 가 경고한 바로 그 함정. 넘기지 않았다.)
  //   옳은 질문은 "니들이 있는가"가 아니라 **"있다면 그것이 우리가 주입한 값인가"** 다.
  const injectedText = new Set([...sample.values.values()].map(x => String(x ?? '')).filter(Boolean))
  const unexplained: string[] = []
  const explained: string[] = []
  for (const n of Object.keys(z.files)) {
    if (z.files[n].dir) continue
    const raw = await z.file(n)!.async('string')
    for (const nd of FIRE_PLAN_SCRUB_NEEDLES) {
      if (!raw.includes(nd)) continue
      // 주입한 값 중 하나가 그 니들을 품고 있으면 '설명됨' — 템플릿 잔재가 아니라 고객의 실값이다
      if ([...injectedText].some(v => v.includes(nd))) explained.push(`${nd}(주입값)`)
      else unexplained.push(`${n}⊃${nd}`)
    }
  }
  check('설명되지 않는 니들 0건(템플릿 잔재 없음)', unexplained.length === 0, unexplained.slice(0, 3).join(','))
  if (explained.length) console.log(`       (실값과 겹친 니들 ${[...new Set(explained)].join(' · ')} — 정상)`)

  // 그리고 템플릿 축은 여전히 0이어야 한다 — 두 축을 갈라서 둘 다 센다
  const zt = await JSZip.loadAsync(templateBytes)
  const tHits: string[] = []
  for (const n of Object.keys(zt.files)) {
    if (zt.files[n].dir) continue
    const raw = await zt.file(n)!.async('string')
    for (const nd of FIRE_PLAN_SCRUB_NEEDLES) if (raw.includes(nd)) tHits.push(`${n}⊃${nd}`)
  }
  check('템플릿 축은 니들 0건(이쪽은 무조건 0)', tHits.length === 0, tHits.slice(0, 3).join(','))

  const wb = XLSX.read(sample.bytes, { cellStyles: false })
  check('시트 28장', wb.SheetNames.length === FIRE_PLAN_MANIFEST.sheets.length, `${wb.SheetNames.length}`)
  const at = (s: string, c: string) => String((wb.Sheets[s]?.[c] as XLSX.CellObject | undefined)?.v ?? '')
  check('실 고객명이 표지에 착지', at('표지', 'A3').includes(sample.name), at('표지', 'A3'))
  check('1.1 명칭 착지', at('1.1 건축물 일반현황', 'C4') === sample.name, at('1.1 건축물 일반현황', 'C4'))
  console.log(`       1.1 주소='${at('1.1 건축물 일반현황', 'C5')}' 용도='${at('1.1 건축물 일반현황', 'G9')}' 관할='${at('1.3 소방차 진입경로', 'C5')}'`)
  console.log(`       대표전화='${at('1.1 건축물 일반현황', 'E7')}' 관리자전화='${at('1.1 건축물 일반현황', 'I7')}'`)
  console.log(`       ${sample.who}`)
  // R-1 재발 판정 — 이름이 다른데 전화가 같으면 배선이 다시 어긋난 것이다
  const nameE7 = at('1.1 건축물 일반현황', 'E6'), nameI6 = at('1.1 건축물 일반현황', 'I6')
  const samePhone = at('1.1 건축물 일반현황', 'E7') === at('1.1 건축물 일반현황', 'I7')
  check('R-1 미재발(이름이 다른데 전화가 같지는 않다)', !(samePhone && nameE7 !== nameI6),
    `대표='${nameE7}' 관리자='${nameI6}' 전화동일=${samePhone}`)
  if (sample.notice.length) console.log(`       고지: ${sample.notice.slice(0, 4).join(' | ')}`)

  const out = join(HERE, '..', '..', `_확인용_소방계획서_${sample.name}_${year}.xlsx`)
  writeFileSync(out, sample.bytes)
  console.log(`\n       📄 육안 확인용 파일: ${out}`)
  console.log('       ⚠ 실고객 데이터다 — 커밋하지 말 것(R-2)')
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
