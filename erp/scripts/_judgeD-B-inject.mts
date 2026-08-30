/** 독립 판정 B — D7(조립 노출)·D8(주입 배선·missed/500 정책·헤더 절단)
 *  구현자 프로브(_probe-d5-roundtrip.mts)와 **다른 축**으로 짠다:
 *   A. 조립 반환의 순수성 — sheetResponses가 DB 실카운트와 같고 sheetSections의 부분집합이 아님
 *   B. planDonorInjection 4갈래를 **합성 입력**으로 각각 유도 + 차등(differential) 이빨 확인
 *   C. 시트 집합 동일성 — 산출 워크북에 실재하는 시트 == keptSheets (sheetRemoved 분류의 진위)
 *   D. X-Workbook-Missing IIFE를 route.ts **소스에서 뽑아** 실행 — 착지 고지 생존 + 절단 부기
 *  실행: npx tsx scripts/_judgeD-B-inject.mts
 *  ⚠ 읽기 전용. 자산·DB 무변경. */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'
import { donorGroupsToKeep, allDonorSheets, DONOR_TOC_SHEET, DONOR_GROUPS } from '../src/lib/xlsx-donors'
import { sheetMatchesFacilities } from '../src/lib/sheet-facility-map'
import { removeSheets } from '../src/lib/xlsx-sheet-surgery'
import { planDonorInjection, donorInjectSummary, donorCellForItem, DONOR_ITEM_COUNT } from '../src/lib/xlsx-donor-inject'
import { assembleReport9 } from '../src/lib/report9-assemble'
import itemmap from '../src/lib/xlsx-donor-itemmap.json' with { type: 'json' }

const CUST = 'c98d316f-21ba-463b-9493-62dacdf44f56'   // 서림사 C330
const INSP = '98e3a13b-881d-4e20-9e42-b68c7c3b88f4'   // 2026 1차
let pass = 0, fail = 0
const ck = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  OK  ${label}`) } else { fail++; console.log(`  NG  ${label}${detail ? ' -- ' + detail : ''}`) }
}
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').split('=')[1] ?? ''
const run = (s: string) => !ONLY || ONLY.includes(s)

const CELLS = (itemmap as unknown as { cells: Record<string, [string, string]> }).cells
type Resp = { item_code: string; result: 'O' | 'X' | 'N'; month: number }

// ───────────────────────────── A. D7 조립 노출
if (run('A')) {
  console.log('\n[A] D7 — 조립이 원본 응답을 그대로 내는가')
  const { count, error: cErr } = await raw.from('inspection_sheet_responses')
    .select('item_code', { count: 'exact', head: true }).eq('inspection_id', INSP)
  if (cErr) throw new Error(`count 실패: ${cErr.message}`)
  const r9 = await assembleReport9(raw as never, CUST, INSP)
  ck(`[A1] sheetResponses ${r9.sheetResponses.length}건 == DB 실카운트 ${count}건 (필터·중복제거 없음)`,
    r9.sheetResponses.length === count, `${r9.sheetResponses.length} vs ${count}`)
  const secItems = r9.annex4.sheetSections.reduce((n, s) => n + (s.items?.length ?? 0), 0)
  ck(`[A2] annex4.sheetSections 항목 ${secItems}개 != sheetResponses ${r9.sheetResponses.length}건 (부분집합 축이 다름)`,
    secItems !== r9.sheetResponses.length, `둘이 같으면 '분모가 줄어든다'는 주장 근거가 약해진다`)
  const hasMonth = r9.sheetResponses.every(r => typeof r.month === 'number')
  ck('[A3] month 축이 실려 온다 (125)', hasMonth && r9.sheetResponses.length > 0,
    `표본: ${JSON.stringify(r9.sheetResponses[0] ?? null)}`)
  const keys = new Set(r9.sheetResponses.flatMap(r => Object.keys(r)))
  ck('[A4] 응답 객체 키가 item_code·result·month 3개뿐 (가공 흔적 없음)',
    keys.size === 3 && ['item_code', 'result', 'month'].every(k => keys.has(k)), [...keys].join(','))
  // 재조회 금지 축 — route.ts가 inspection_sheet_responses를 직접 읽지 않는가(소스 축)
  const routeSrc = readFileSync('src/app/(dashboard)/inspections/[id]/workbook/route.ts', 'utf8')
  ck('[A5] route.ts가 inspection_sheet_responses를 직접 재조회하지 않는다',
    !routeSrc.includes('inspection_sheet_responses'))
  ck('[A6] route.ts가 r9.sheetResponses를 주입 원천으로 쓴다', routeSrc.includes('planDonorInjection(r9.sheetResponses'))
  ck('[A7] route.ts가 annex4.sheetSections를 주입 원천으로 쓰지 않는다', !routeSrc.includes('sheetSections'))
  // 호출부 수 — 3곳 무변경 주장
  const actSrc = readFileSync('src/app/(dashboard)/inspections/report9-actions.ts', 'utf8')
  const callsInActions = (actSrc.match(/await assembleReport9\(/g) ?? []).length
  const callsInRoute = (routeSrc.match(/assembleReport9\(/g) ?? []).length
  ck(`[A8] 기존 호출부 3곳(report9-actions) + 신규 1곳(route) — 실측 ${callsInActions}+${callsInRoute}`,
    callsInActions === 3 && callsInRoute === 1, `${callsInActions}+${callsInRoute}`)
  ck('[A9] 기존 호출부가 sheetResponses를 구조분해하지 않는다(순수 추가)', !actSrc.includes('sheetResponses'))
  // '분모가 줄어 눈이 먼다' 주장의 실측 — sheetSections에서 사라지는 응답이 실제로 있는가
  const secCodes = new Set(r9.annex4.sheetSections.flatMap(s => s.items.map(i => i.code)))
  const lost = r9.sheetResponses.filter(r => !secCodes.has(r.item_code))
  console.log(`      (참고) sheetSections 항목 ${secCodes.size}코드 · 응답 중 sheetSections에 없는 것 ${lost.length}건`)
  ck(`[A10] sheetSections를 분모로 쓰면 응답 ${lost.length}건이 시야에서 사라진다 (주장 근거)`,
    lost.length > 0, `0이면 '분모가 줄어든다'는 note가 이 고객에서는 성립하지 않는다`)
  // 중복 축 — sheetSections는 코드 유일, 응답은 (코드,월) 유일이라 축 자체가 다르다
  const dupCodes = r9.sheetResponses.length - new Set(r9.sheetResponses.map(r => r.item_code)).size
  console.log(`      (참고) 응답 중 같은 코드 중복 ${dupCodes}건 (month 축)`)
}

// ───────────────────────────── B. D8 분류 4갈래 (합성 입력 + 차등)
if (run('B')) {
  console.log('\n[B] D8 — planDonorInjection 사유별 분류에 이빨이 있는가')
  // 서로 다른 시트에 있는 코드 2개를 매핑에서 실제로 고른다
  const entries = Object.entries(CELLS) as Array<[string, [string, string]]>
  const sheetsInMap = [...new Set(entries.map(([, v]) => v[0]))]
  const sA = sheetsInMap[0], sB = sheetsInMap.find(s => s !== sA)!
  const codeA = entries.find(([, v]) => v[0] === sA)![0]
  const codeA2 = entries.filter(([, v]) => v[0] === sA)[1][0]
  const codeA3 = entries.filter(([, v]) => v[0] === sA)[2][0]
  const codeB = entries.find(([, v]) => v[0] === sB)![0]
  const GHOST = 'ZZ-NOT-A-REAL-CODE-999'
  const kept = new Set([sA])

  const R = (c: string, r: 'O' | 'X' | 'N', m = 0): Resp => ({ item_code: c, result: r, month: m })
  const p = planDonorInjection([
    R(codeA, 'X'),                       // 착지
    R(codeB, 'O'),                       // 시트 제거
    R(GHOST, 'O'),                       // 좌표 없음
    R(codeA2, 'O', 1), R(codeA2, 'X', 2),// 중복(month 0 없음) → 미반영
    R(codeA3, 'N', 0), R(codeA3, 'O', 7),// month 0 유일 → 착지(값은 N='/')
  ], kept)
  ck(`[B1] 착지 2건 (codeA·codeA3)`, p.landed === 2, `landed=${p.landed} targets=${JSON.stringify(p.targets)}`)
  ck(`[B2] sheetRemoved 1건 == ${codeB}`, p.notLanded.sheetRemoved.length === 1 && p.notLanded.sheetRemoved[0] === codeB,
    JSON.stringify(p.notLanded.sheetRemoved))
  ck(`[B3] noDonorRow 1건 == GHOST`, p.notLanded.noDonorRow.length === 1 && p.notLanded.noDonorRow[0] === GHOST,
    JSON.stringify(p.notLanded.noDonorRow))
  ck(`[B4] duplicated 1건 == ${codeA2}(2행)`, p.notLanded.duplicated.length === 1 && p.notLanded.duplicated[0].startsWith(codeA2),
    JSON.stringify(p.notLanded.duplicated))
  ck(`[B5] 분모 total = 고유 코드 5개`, p.total === 5, `total=${p.total}`)
  const tA = p.targets.find(t => t.cell === CELLS[codeA][1] && t.sheet === sA)
  ck('[B6] 마크 어휘 — X는 ×', tA?.value === '×', JSON.stringify(tA))
  const tA3 = p.targets.find(t => t.cell === CELLS[codeA3][1])
  ck("[B7] month=0 우선 선택 — codeA3는 N('/')이지 O('○')가 아니다", tA3?.value === '/', JSON.stringify(tA3))

  // 차등(이빨) — 같은 입력에서 축 하나만 흔든다
  const pKept = planDonorInjection([R(codeB, 'O')], new Set([sA, sB]))
  ck('[B8] 차등: sB를 keptSheets에 넣으면 sheetRemoved→착지로 뒤집힌다',
    pKept.landed === 1 && pKept.notLanded.sheetRemoved.length === 0, JSON.stringify(pKept.notLanded))
  const pOne = planDonorInjection([R(codeA2, 'O', 1)], kept)
  ck('[B9] 차등: 같은 코드가 1행이면 duplicated가 아니라 착지',
    pOne.landed === 1 && pOne.notLanded.duplicated.length === 0, JSON.stringify(pOne.notLanded))
  const pBoth0 = planDonorInjection([R(codeA2, 'O', 0), R(codeA2, 'X', 0)], kept)
  ck('[B10] month 0이 둘이면(백필 사고 등) 임의 선택 없이 duplicated',
    pBoth0.landed === 0 && pBoth0.notLanded.duplicated.length === 1, JSON.stringify(pBoth0.notLanded))
  ck('[B11] 빈 입력이면 요약 null (헤더 오염 없음)', donorInjectSummary(planDonorInjection([], kept)) === null)
  const sum = donorInjectSummary(p) ?? ''
  ck(`[B12] 요약이 3사유를 모두 수치로 말한다 — «${sum}»`,
    sum.includes('5건 중 2건 반영') && sum.includes('시트 미동봉 1건') && sum.includes('자산 좌표 없음 1건') && sum.includes('중복'))
  ck('[B13] 요약에 코드 나열이 없다(600자 폭주 방지)', !sum.includes(GHOST) && !sum.includes(codeB))
}

// ───────────────────────────── C. 시트 집합 동일성
if (run('C')) {
  console.log('\n[C] D8 — keptSheets가 시트 선별과 같은 집합인가 (산출물로 확인)')
  const mapSheets = [...new Set(Object.values(CELLS).map(v => v[0]))]
  const allD = allDonorSheets()
  const notInDonors = mapSheets.filter(s => !allD.includes(s))
  ck(`[C1] 매핑 시트 ${mapSheets.length}장이 전부 allDonorSheets(${allD.length})에 있다`,
    notInDonors.length === 0, notInDonors.join(','))
  console.log(`      (참고) 매핑 없는 도너 시트: ${allD.filter(s => !mapSheets.includes(s)).join(', ')}`)

  const tplBytes = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
  const names = async (b: Uint8Array) => {
    const z = await JSZip.loadAsync(b)
    const xml = await z.file('xl/workbook.xml')!.async('string')
    return [...xml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map(m => m[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
  }
  const tplNames = await names(tplBytes)
  const ghosts = allD.filter(s => !tplNames.includes(s))
  ck(`[C2] allDonorSheets 전 시트가 자산에 실재 (유령 시트 0)`, ghosts.length === 0, `유령: ${ghosts.join(',')}`)

  // 소화기구 하나만 설치한 최소 고객 시뮬레이션 — 라우트와 같은 순서
  const keptGroups = donorGroupsToKeep(k => sheetMatchesFacilities(k, ['A-01']), false)
  const keptSheets = new Set(keptGroups.flatMap(g => g.sheets))
  const cut = await removeSheets(tplBytes, allD.filter(s => s !== DONOR_TOC_SHEET && !keptSheets.has(s)))
  const outNames = new Set(await names(cut.bytes))
  const wrong: string[] = []
  for (const s of mapSheets) {
    const present = outNames.has(s), expected = keptSheets.has(s)
    if (present !== expected) wrong.push(`${s} present=${present} kept=${expected}`)
  }
  ck(`[C3] 산출물 시트 실재 == keptSheets (매핑 ${mapSheets.length}장 전수) — '시트는 있는데 안 채워짐' 0`,
    wrong.length === 0, wrong.slice(0, 6).join(' · '))
  ck(`[C4] 라우트가 keptSheets를 한 변수로 두 곳에 넘긴다(두 벌 계산 없음)`,
    (() => {
      const src = readFileSync('src/app/(dashboard)/inspections/[id]/workbook/route.ts', 'utf8')
      return (src.match(/const keptSheets\s*=/g) ?? []).length === 1
        && src.includes('!keptSheets.has(s)') && src.includes('planDonorInjection(r9.sheetResponses, keptSheets)')
    })())
  // 다중이용업 축 — 라우트는 hasMultiUse를 넘기는데 구현자 프로브는 false 고정이다
  const muSheets = DONOR_GROUPS.filter(g => g.kind === 'multiUse').flatMap(g => g.sheets)
  const muMapped = muSheets.filter(s => mapSheets.includes(s))
  ck(`[C5] 다중이용업 시트 ${muSheets.join('·')} 중 매핑 보유 ${muMapped.length}장 — 프로브가 안 보는 구간`,
    true, `참고: _probe-d5는 donorGroupsToKeep(..., false)로 이 축을 항상 끈다`)
}

// ───────────────────────────── D. X-Workbook-Missing (route.ts 소스에서 실행)
if (run('D')) {
  console.log('\n[D] D8 — 헤더 600자 절단에서 착지 고지가 사는가')
  const src = readFileSync('src/app/(dashboard)/inspections/[id]/workbook/route.ts', 'utf8')
  const key = src.indexOf("'X-Workbook-Missing': encodeURIComponent(")
  ck('[D0] route.ts에서 헤더 식을 찾음', key >= 0)
  const start = src.indexOf('(() =>', key)
  let depth = 0, end = -1
  for (let i = start; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  const exprTs = src.slice(start, end)   // `(() => { ... })`
  const expr = exprTs.replace(/\)!/g, ')')   // TS 비-null 단언만 제거(런타임 의미 동일)
  const body = `${expr}()`
  ck('[D1] 착지 집계가 parts 배열 **맨 앞**이다', /const parts = \[\s*\.\.\.\(donorInjectSummary/.test(exprTs))
  ck("[D2] 절단 부기 '…외 N자 생략' 문구가 소스에 실재", exprTs.includes('외 ${full.length - cut.length}자 생략'))

  const mk = (n: number) => Array.from({ length: n }, (_, i) => `전년도(2025) 소방훈련 실적 없음 항목${String(i).padStart(3, '0')} 보정 필요`)
  const plan = { total: 243, landed: 182, notLanded: { sheetRemoved: new Array(27).fill('c'), noDonorRow: new Array(34).fill('c'), duplicated: [] as string[] } }
  const call = (missing: string[], order: 'front' | 'back') => {
    // 'back' = 수리 전 배치 재현: 착지 고지 조각을 배열 맨 앞에서 떼어 맨 뒤에 붙인다
    const HEAD = '...(donorInjectSummary(donorPlan) ? [donorInjectSummary(donorPlan)] : []),'
    if (order === 'back' && !expr.includes(HEAD)) throw new Error('back 변이 실패 — 조각을 못 찾음')
    const e = order === 'front' ? expr
      : expr.replace(HEAD, '').replace(/\]\s*\n(\s*)const full/, `, ${HEAD.replace(/,$/, '')}]\n$1const full`)
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const f = new Function('donorInjectSummary', 'donorPlan', 'official', 'delegation', 'r9', 'tocOverflow', 'donorGaps',
      `return ${order === 'front' ? body : `${e}()`}`)
    return f(donorInjectSummary, plan, { missing: [] }, { missing: [] },
      { missing, data: { assistants: [] } }, [], []) as string
  }
  const short = call(mk(1), 'front')
  ck(`[D3] 짧을 때 절단 없음 (${short.length}자)`, short.includes('243건 중 182건 반영') && !short.includes('생략'), short.slice(0, 90))
  const longMissing = mk(20)
  const full = call(longMissing, 'front')
  const raw0 = [`점검표 응답 243건 중 182건 반영 · 시트 미동봉 27건 · 자산 좌표 없음 34건`, ...longMissing].join(' | ')
  ck(`[D4] 원문 ${raw0.length}자 > 600자 (절단 시나리오 성립)`, raw0.length > 600, `${raw0.length}`)
  ck(`[D5] 절단 후에도 착지 고지가 살아 있다 (${full.length}자)`, full.startsWith('점검표 응답 243건 중 182건 반영'), full.slice(0, 80))
  ck('[D6] 절단 사실이 표기된다', /…외 \d+자 생략$/.test(full), full.slice(-60))
  ck(`[D7] 절단 결과가 600자 이하 (${full.length}자)`, full.length <= 600)
  // 부기 숫자의 정확도 — 실제로 빠진 글자 수와 일치하는가
  const m = full.match(/…외 (\d+)자 생략$/)
  const claimed = m ? Number(m[1]) : -1
  const kept = full.replace(/ \| …외 \d+자 생략$/, '')
  const actual = raw0.length - kept.length
  ck(`[D8] 부기 숫자 정확 — 주장 ${claimed}자 vs 실제 생략 ${actual}자`, claimed === actual, `차이 ${actual - claimed}자`)
  // 변이 — 맨 뒤로 되돌리면 고지가 사라지는가(수리가 실효인지)
  const back = call(longMissing, 'back')
  ck('[D9] 변이: 착지 고지를 맨 뒤로 되돌리면 절단에 사라진다(수리가 실효)',
    !back.includes('243건 중 182건 반영'), back.slice(-80))
  // 최악 사례 — 마지막 조각 하나가 길면 되감기가 커져 부기가 크게 어긋난다
  const bigOne = ['짧은 항목', 'X'.repeat(900)]
  const worst = call(bigOne, 'front')
  const raw1 = [`점검표 응답 243건 중 182건 반영 · 시트 미동봉 27건 · 자산 좌표 없음 34건`, ...bigOne].join(' | ')
  const mw = worst.match(/…외 (\d+)자 생략$/)
  const keptW = worst.replace(/ \| …외 \d+자 생략$/, '')
  ck(`[D10] 최악 사례 부기 정확 — 주장 ${mw ? mw[1] : '-'}자 vs 실제 ${raw1.length - keptW.length}자`,
    !!mw && Number(mw[1]) === raw1.length - keptW.length, `과소 신고 ${raw1.length - keptW.length - Number(mw?.[1] ?? 0)}자`)
  // 헤더 한도의 축 — 600은 '글자' 수인데 실제로 실려 나가는 것은 퍼센트 인코딩 바이트다
  const encoded = encodeURIComponent(full)
  ck(`[D11] 600자 가드가 실제 헤더 바이트를 제한하는가 — 587자 → ${encoded.length}바이트`,
    encoded.length <= 600, `가드는 인코딩 전 글자 수 축이라 한글에서 ${(encoded.length / full.length).toFixed(1)}배로 부푼다`)
}

// ───────────────────────────── E. missed/500 양방향
if (run('E')) {
  console.log('\n[E] D8 — missed>0 → 500 정책의 양방향')
  const tplBytes = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
  const { injectWorkbook } = await import('../src/lib/xlsx-inject')
  const allCodes = Object.keys(CELLS)
  const respAll: Resp[] = allCodes.map(c => ({ item_code: c, result: 'O', month: 0 }))

  // (1) 전 설비 설치 — 매핑 720좌표가 자산에 **전부 실재**해야 missed 0
  const gAll = donorGroupsToKeep(() => true, true)
  const keptAll = new Set(gAll.flatMap(g => g.sheets))
  const pAll = planDonorInjection(respAll, keptAll)
  ck(`[E1] 전 설비 시 착지 ${pAll.landed}/${allCodes.length} (미착지 0)`,
    pAll.landed === allCodes.length, JSON.stringify({ ...pAll.notLanded, targets: undefined }).slice(0, 200))
  const rAll = await injectWorkbook(tplBytes, pAll.targets, {})
  ck(`[E2] 매핑 전 좌표 ${pAll.targets.length}칸이 자산에 실재 — injectWorkbook.missed 0 (아니면 라우트 500)`,
    rAll.missed.length === 0, rAll.missed.slice(0, 6).join(','))

  // (2) 최소 설비(소화기구만) — 응답 720건 전건 + 시트 대부분 제거 = 신고자 시나리오의 극단
  const gMin = donorGroupsToKeep(k => sheetMatchesFacilities(k, ['A-01']), false)
  const keptMin = new Set(gMin.flatMap(g => g.sheets))
  const cut = await removeSheets(tplBytes, allDonorSheets().filter(s => s !== DONOR_TOC_SHEET && !keptMin.has(s)))
  const pMin = planDonorInjection(respAll, keptMin)
  const rMin = await injectWorkbook(cut.bytes, pMin.targets, {})
  ck(`[E3] '응답은 있고 시트는 제거됨' ${pMin.notLanded.sheetRemoved.length}건이 missed가 아니다 (정상 200)`,
    rMin.missed.length === 0 && pMin.notLanded.sheetRemoved.length > 0,
    `missed=${rMin.missed.length} sheetRemoved=${pMin.notLanded.sheetRemoved.length}`)

  // (3) 역방향 — 좌표가 낡으면 정말 missed로 잡히는가(500 경로에 이빨)
  const bad = pMin.targets.map(t => ({ ...t }))
  bad[0].cell = bad[0].cell.replace(/\d+$/, '9999')
  const rBad = await injectWorkbook(cut.bytes, bad, {})
  ck('[E4] 변이: 좌표 1칸을 낡게 하면 missed>0 (라우트가 500으로 끊는다)',
    rBad.missed.length === 1, JSON.stringify(rBad.missed))
  const routeSrc2 = readFileSync('src/app/(dashboard)/inspections/[id]/workbook/route.ts', 'utf8')
  ck('[E5] 라우트가 result.missed.length>0을 500으로 낸다', /result\.missed\.length > 0[\s\S]{0,220}status: 500/.test(routeSrc2))
  ck('[E6] 미착지(사유별)는 500이 아니라 헤더·warn으로만 나간다',
    !/donorPlan\.notLanded[\s\S]{0,160}status: 500/.test(routeSrc2))
}

// ───────────────────────────── F. 실데이터 — '정상 시나리오'라는 분류가 정말 정상인가
if (run('F')) {
  console.log('\n[F] 서림사 실데이터 — sheetRemoved 27건의 정체 (PDF ↔ 엑셀 갈라짐 축)')
  const r9 = await assembleReport9(raw as never, CUST, INSP)
  const { data: ff, error: fErr } = await raw.from('fire_facilities')
    .select('facility_code, buildings!inner(customer_id)').eq('buildings.customer_id', CUST).eq('installed', true)
  if (fErr) throw new Error(fErr.message)
  const installedCodes = [...new Set((ff as Array<{ facility_code: string }>).map(f => f.facility_code))]
  const keptGroups = donorGroupsToKeep(k => sheetMatchesFacilities(k, installedCodes), false)
  const keptSheets = new Set(keptGroups.flatMap(g => g.sheets))
  const p = planDonorInjection(r9.sheetResponses as Resp[], keptSheets)
  console.log(`      착지 ${p.landed} / 분모 ${p.total} · 시트제거 ${p.notLanded.sheetRemoved.length} · 좌표없음 ${p.notLanded.noDonorRow.length} · 중복 ${p.notLanded.duplicated.length}`)
  const bySheet = new Map<string, number>()
  for (const c of p.notLanded.sheetRemoved) { const s = donorCellForItem(c)!.sheet; bySheet.set(s, (bySheet.get(s) ?? 0) + 1) }
  console.log(`      시트제거 내역: ${[...bySheet].map(([s, n]) => `${s}=${n}`).join(', ')}`)
  // 그 코드들이 별지 4호 PDF(sheetSections)에는 실려 나가는가 = 두 산출물이 갈라진다
  const secCodes = new Set(r9.annex4.sheetSections.flatMap(s => s.items.map(i => i.code)))
  const inPdfNotXlsx = p.notLanded.sheetRemoved.filter(c => secCodes.has(c))
  ck(`[F1] 엑셀이 뺀 ${p.notLanded.sheetRemoved.length}건 중 별지 4호 PDF에는 실리는 것 ${inPdfNotXlsx.length}건 — D-7(두 산출물 불일치 금지) 위반 여부`,
    inPdfNotXlsx.length === 0,
    `PDF는 응답 있는 시트를 구제(report9-assemble:293 respSheetIds)하지만 엑셀은 설치 대장만 본다`)
  const noRowSheets = new Map<string, number>()
  for (const c of p.notLanded.noDonorRow) { const k = c.replace(/-\d+$/, ''); noRowSheets.set(k, (noRowSheets.get(k) ?? 0) + 1) }
  console.log(`      좌표없음 접두 내역: ${[...noRowSheets].map(([s, n]) => `${s}=${n}`).join(', ')}`)
  ck(`[F2] 헤더 요약이 이 실데이터에서 3수치를 모두 낸다`,
    (donorInjectSummary(p) ?? '').includes(`${p.total}건 중 ${p.landed}건 반영`), `«${donorInjectSummary(p)}»`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패  (매핑 ${DONOR_ITEM_COUNT}코드)`)
process.exit(fail ? 1 : 0)
