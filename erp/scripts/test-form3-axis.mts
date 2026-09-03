/** 별지 4호 1쪽 · 9호 3쪽 1절 — 설치(√) 축과 점검결과(○/×) 축의 귀속 규칙 회귀 고정.
 *  DB·서버 불필요, 결정적. 실행: npx tsx scripts/test-form3-axis.mts
 *
 *  이 파일이 지키는 것:
 *    ①  한 시트가 여러 FORM3 항목을 덮을 때, 응답은 **설치된 형제**의 것이지 미설치 항목으로 번지지 않는다
 *    ②  **미설치(대장 미체크)는 응답이 있어도 ／로 인쇄한다** — 대장이 정본이다
 *        (2026-09-03 사용자 결정, image-51 강순건물. 종전 '결과를 지우지 않는다'(2026-08-21)를 번복).
 *        응답 데이터는 남고 respondedNotInstalled 경고로 표면화된다 — 대장에 체크하면 되살아난다.
 *    ③  설치 항목의 마크는 이 규칙과 무관하게 종전과 같다(실점검이 지워지면 안 된다)
 *    ④  하위 행을 거느린 부모(소화기구·피난기구)의 결과칸은 **항상 공란**이다(distributeSubMarks)
 *
 *  어휘는 리터럴로 쓴다 — FORM3_ITEMS(report9.ts)를 끌어오면 서식 템플릿 편집이 이 검사를 흔든다.
 *  대신 그 어휘가 표준 42종에 실재하는지를 마지막에 대조해, 오타로 검사가 헛도는 걸 막는다. */
import {
  rollUpForm3Results, foldSheetResult, foldSheetGroupStats, sheetGroupMapErrors, distributeSubMarks,
  SHEET_FACILITY_MAP, SHEET_GROUP_FORM3_MAP, type SheetGroupStat,
} from '../src/lib/sheet-facility-map.ts'
import { ALL_STANDARD_CODES, SUB_ROW_PARENT_ITEMS } from '../src/lib/facility-codes.ts'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}
type Stat = { any: boolean; x: boolean; o: boolean }
/** 롤업 입력 1건. group을 생략하면 **중분류 미상**(시트 단위) — 종전 동작의 대조군이다 */
const S = (sheet: string, stat: Stat, group: string | null = null): SheetGroupStat => ({ sheet, group, stat })
const ok1: Stat = { any: true, x: false, o: true }    // ○ 응답 있음
const bad: Stat = { any: true, x: true, o: false }    // ✕ 응답 있음
const naOnly: Stat = { any: true, x: false, o: false } // 응답은 있는데 전부 ／ (소방계획서_26 S1)

// 검사에 쓰는 어휘 — SHEET_FACILITY_MAP의 값 어휘와 같아야 한다
const 자탐 = '자동화재탐지설비 및 시각경보기'
const 화재알림 = '화재알림설비'
const 상수도 = '상수도소화용수설비'
const 소화수조 = '소화수조 및 저수조'
const 소화기구 = '소화기구 및 자동소화장치'
const 스프링클러 = '스프링클러설비'
const 조기진압 = '화재조기진압용 스프링클러설비'
const 옥내 = '옥내소화전설비'
const ITEMS = [자탐, 화재알림, 상수도, 소화수조, 소화기구, 스프링클러, 조기진압, 옥내]

console.log('── 1) 종전 동작 보존 — 설치 항목의 마크는 달라지지 않는다')
{
  const r = rollUpForm3Results([S('옥내소화전설비', ok1)], ITEMS, [옥내])
  check('설치 + 응답 양호 → ○', r.resultMarks[옥내] === 'O', JSON.stringify(r.resultMarks[옥내]))
  const rx = rollUpForm3Results([S('옥내소화전설비', bad)], ITEMS, [옥내])
  check('설치 + 불량 → ×', rx.resultMarks[옥내] === 'X')
  const r0 = rollUpForm3Results([], ITEMS, [옥내])
  check('설치 + 무응답 → 공란(키 없음)', r0.resultMarks[옥내] === undefined, JSON.stringify(r0.resultMarks[옥내]))
  check('미설치 + 무응답 → ／', r0.resultMarks[화재알림] === 'N')
}

console.log('\n── 2) 번짐 차단 — 응답은 설치된 형제의 것 (사용자 지적 2026-08-20)')
{
  // '자동화재탐지설비 및 시각경보장치' 시트 하나가 자탐·화재알림 두 항목을 덮는다.
  // 자탐만 설치된 건에서 시트에 응답하면 종전엔 화재알림설비까지 ○였다(서림사 실측).
  const r = rollUpForm3Results([S('자동화재탐지설비 및 시각경보장치', ok1)], ITEMS, [자탐])
  check('설치된 자탐은 ○', r.resultMarks[자탐] === 'O')
  check('미설치 화재알림설비는 ／ (○로 번지지 않는다)', r.resultMarks[화재알림] === 'N',
    `실제: ${r.resultMarks[화재알림]}`)
  check('번짐 차단이 경고로 남는다', r.axisWarnings.spillSuppressed.includes(화재알림),
    JSON.stringify(r.axisWarnings))
  check('차단된 항목은 대장 누락 경고에 들어가지 않는다',
    !r.axisWarnings.respondedNotInstalled.includes(화재알림))

  const rx = rollUpForm3Results([S('스프링클러설비', bad)], ITEMS, [스프링클러])
  check('불량도 형제로 번지지 않는다 (조기진압 ／)',
    rx.resultMarks[스프링클러] === 'X' && rx.resultMarks[조기진압] === 'N',
    JSON.stringify({ 스프링클러: rx.resultMarks[스프링클러], 조기진압: rx.resultMarks[조기진압] }))
}

console.log('\n── 3) 대장이 정본 — 미체크는 응답이 있어도 ／, 경고로 표면화 (2026-09-03 image-51)')
{
  // 전용 시트(1항목)에 응답이 있는데 대장에 없다 → 종전(2026-08-21)엔 ○를 유지했으나
  // 사용자 결정으로 번복: [ ] 체크 없는 행에 ○가 찍히는 모순을 인쇄에서 막는다.
  // 응답 자체는 지우지 않으므로 경고를 보고 대장에 체크하면 ○가 그대로 되살아난다(아래 대조).
  const r = rollUpForm3Results([S('소화기구 및 자동소화장치', ok1)], ITEMS, [])
  check('미설치 + ○ 응답 → ／로 눌린다 (대장이 정본)', r.resultMarks[소화기구] === 'N',
    `실제: ${r.resultMarks[소화기구]}`)
  check('대장 누락 경고로 표면화된다', r.axisWarnings.respondedNotInstalled.includes(소화기구),
    JSON.stringify(r.axisWarnings))
  // 되살아남 대조 — 같은 응답, 대장에 체크만 하면 ○ (데이터가 지워지지 않았다는 증거)
  const rBack = rollUpForm3Results([S('소화기구 및 자동소화장치', ok1)], ITEMS, [소화기구])
  check('대장에 체크하는 순간 같은 응답이 ○로 되살아난다', rBack.resultMarks[소화기구] === 'O')

  // 다항목 시트인데 형제가 전부 미설치인 경우 — 마크는 둘 다 ／, 경고는 둘 다.
  const r2 = rollUpForm3Results([S('소화용수설비', ok1)], ITEMS, [])
  check('형제 전부 미설치 → 두 항목 모두 ／',
    r2.resultMarks[상수도] === 'N' && r2.resultMarks[소화수조] === 'N',
    JSON.stringify({ 상수도: r2.resultMarks[상수도], 소화수조: r2.resultMarks[소화수조] }))
  check('둘 다 대장 누락 경고', r2.axisWarnings.respondedNotInstalled.length === 2)
  check('이 경우 번짐 차단은 없다', r2.axisWarnings.spillSuppressed.length === 0)
  // 불량(×)도 같은 축 — 미체크면 ／로 눌리고 경고로만 남는다
  const rx = rollUpForm3Results([S('소화기구 및 자동소화장치', bad)], ITEMS, [])
  check('미설치 + × 응답도 ／', rx.resultMarks[소화기구] === 'N',
    `실제: ${rx.resultMarks[소화기구]}`)
}

console.log('\n── 4) 경계 — 한쪽만 설치면 그쪽만 산다')
{
  const r = rollUpForm3Results([S('소화용수설비', ok1)], ITEMS, [상수도])
  check('설치된 상수도 ○ · 미설치 소화수조 ／',
    r.resultMarks[상수도] === 'O' && r.resultMarks[소화수조] === 'N',
    JSON.stringify({ 상수도: r.resultMarks[상수도], 소화수조: r.resultMarks[소화수조] }))
  // 같은 항목을 여러 시트가 덮을 때, 한 시트에서 차단돼도 다른 시트가 정당하게 마크하면 살아난다
  const r2 = rollUpForm3Results(
    [S('자동화재탐지설비 및 시각경보장치', ok1), S('화재알림설비', ok1)], ITEMS, [자탐, 화재알림])
  check('둘 다 설치면 둘 다 ○', r2.resultMarks[자탐] === 'O' && r2.resultMarks[화재알림] === 'O')
  check('두 경고 모두 비어 있다',
    r2.axisWarnings.spillSuppressed.length === 0 && r2.axisWarnings.respondedNotInstalled.length === 0)
}

console.log('\n── 5) 두 경고는 서로 배타 — 같은 항목이 양쪽에 들어가지 않는다')
{
  const r = rollUpForm3Results(
    [S('자동화재탐지설비 및 시각경보장치', ok1), S('소화기구 및 자동소화장치', ok1)], ITEMS, [자탐])
  const both = r.axisWarnings.spillSuppressed.filter(i => r.axisWarnings.respondedNotInstalled.includes(i))
  check('교집합 없음', both.length === 0, JSON.stringify(r.axisWarnings))
  check('한 건에서 두 갈래가 함께 잡힌다 (번짐 1 · 누락 1)',
    r.axisWarnings.spillSuppressed.length === 1 && r.axisWarnings.respondedNotInstalled.length === 1,
    JSON.stringify(r.axisWarnings))
}

console.log('\n── 5b) 전부 ／ 시트 — 해당없음이 양호로 둔갑하지 않는다 (소방계획서_26 S1)')
{
  // 종전 {any,x} 두 축은 '전부 ／'를 표현할 수 없어 any=true·x=false = ○로 인쇄됐다.
  // [／ 전체] 버튼 하나로 만들 수 있는 상태였다 — 이 검사가 그 결함의 재발을 막는다.
  const r = rollUpForm3Results([S('옥내소화전설비', naOnly)], ITEMS, [옥내])
  check('설치 + 전부 ／ → ／ (○가 아니다)', r.resultMarks[옥내] === 'N', `실제: ${r.resultMarks[옥내]}`)
  // 같은 시트에 ／와 ○가 섞이면 ○ — foldSheetResult가 접은 {any,x:false,o:true}로 표현된다
  const mixed = rollUpForm3Results([S('옥내소화전설비', { any: true, x: false, o: true })], ITEMS, [옥내])
  check('／+○ 혼합 → ○', mixed.resultMarks[옥내] === 'O')
  const mixedX = rollUpForm3Results([S('옥내소화전설비', { any: true, x: true, o: true })], ITEMS, [옥내])
  check('／+○+✕ 혼합 → ×', mixedX.resultMarks[옥내] === 'X')
  // 미설치 설비의 전용 시트가 전부 ／ — '해당 없다'는 진술이지 점검 흔적이 아니므로 대장 누락 경고 제외
  const rn = rollUpForm3Results([S('소화기구 및 자동소화장치', naOnly)], ITEMS, [])
  check('미설치 + 전부 ／ → ／ 유지', rn.resultMarks[소화기구] === 'N', `실제: ${rn.resultMarks[소화기구]}`)
  check('전부 ／ 시트는 대장 누락 경고에 들어가지 않는다',
    !rn.axisWarnings.respondedNotInstalled.includes(소화기구), JSON.stringify(rn.axisWarnings))

  // foldSheetResult — 구성 지점(별지 조립·1.4 배지)이 쓰는 단일 접기 함수. N은 any만 올린다.
  const f0 = foldSheetResult(undefined, 'N')
  const f1 = foldSheetResult(f0, 'O')
  const f2 = foldSheetResult(f1, 'X')
  check('fold: N → {any,!x,!o} / +O → o / +X → x',
    f0.any && !f0.x && !f0.o && f1.o && !f1.x && f2.x && f2.o, JSON.stringify({ f0, f1, f2 }))
}

console.log('\n── 7) 중분류 축 — 한 점검표가 설비 여럿을 덮을 때 (2026-09-01 유도등 실사고)')
{
  // 서림사 작동 회차 실데이터 재현: 유도등(21-A) 4문항 전부 ／ · 유도표지(21-B) 4문항 전부 ／ ·
  // 피난유도선(21-C) 5문항 ○. 셋 다 대장 설치. 갑지 「현황」에 세 칸 모두 ○가 찍혀 있었다.
  const G = ['유도등', '유도표지', '피난유도선']
  const GI = [...G, '비상조명등', '휴대용비상조명등']
  const 유도시트 = '유도등 및 유도표지'
  const 실데이터: SheetGroupStat[] = [
    S(유도시트, naOnly, '21-A'), S(유도시트, naOnly, '21-B'), S(유도시트, ok1, '21-C'),
  ]

  // ⭐ 대조군 먼저 — 같은 응답을 **시트 단위로 접으면** 옛 결함이 그대로 재현된다.
  //    이게 없으면 아래 초록이 '고쳐서 초록'인지 '원래 초록'인지 구별할 수 없다.
  const 옛방식 = rollUpForm3Results([S(유도시트, ok1)], GI, GI)
  check('[대조군] 시트 단위로 접으면 ／로 입력한 유도등·유도표지까지 ○ (옛 결함)',
    옛방식.resultMarks['유도등'] === 'O' && 옛방식.resultMarks['유도표지'] === 'O',
    JSON.stringify(옛방식.resultMarks))

  // 설치는 5종 전부 — 서림사 대장 그대로다(비상조명등·휴대용도 [√]). 그래야 '설치인데 무응답=공란'이 검사된다
  const r = rollUpForm3Results(실데이터, GI, GI)
  check('／로 입력한 유도등은 ／', r.resultMarks['유도등'] === 'N', `실제: ${r.resultMarks['유도등']}`)
  check('／로 입력한 유도표지는 ／', r.resultMarks['유도표지'] === 'N', `실제: ${r.resultMarks['유도표지']}`)
  check('○로 입력한 피난유도선만 ○', r.resultMarks['피난유도선'] === 'O', `실제: ${r.resultMarks['피난유도선']}`)
  check('입력하지 않은 비상조명등은 공란(설치+무응답) — ○로 지어내지 않는다',
    r.resultMarks['비상조명등'] === undefined, `실제: ${r.resultMarks['비상조명등']}`)

  // 불량도 같은 축으로 갈린다 — ×가 형제 칸으로 새면 없는 불량이 인쇄된다
  const rx = rollUpForm3Results([S(유도시트, bad, '21-A'), S(유도시트, ok1, '21-C')], GI, G)
  check('×는 그 중분류에만 (유도등 × · 피난유도선 ○)',
    rx.resultMarks['유도등'] === 'X' && rx.resultMarks['피난유도선'] === 'O',
    JSON.stringify(rx.resultMarks))
  check('응답 없는 중분류는 공란 유지 (유도표지)', rx.resultMarks['유도표지'] === undefined)

  // 비상조명등 시트(22-A/22-B)도 같은 규칙
  const 조명 = '비상조명등 및 휴대용비상조명등'
  const r2 = rollUpForm3Results([S(조명, ok1, '22-A'), S(조명, bad, '22-B')], GI,
    ['비상조명등', '휴대용비상조명등'])
  check('비상조명등 ○ · 휴대용 ×', r2.resultMarks['비상조명등'] === 'O' && r2.resultMarks['휴대용비상조명등'] === 'X',
    JSON.stringify(r2.resultMarks))

  // 등재 밖은 폴백 — STD-15는 중분류가 구성요소축이라 일부러 안 이었다(감지기 응답이 화재알림설비로 가면 안 된다)
  const r3 = rollUpForm3Results([S('자동화재탐지설비 및 시각경보장치', ok1, '15-D')], ITEMS, [자탐, 화재알림])
  check('미등재 시트의 중분류는 종전대로 시트 전개(폴백)',
    r3.resultMarks[자탐] === 'O' && r3.resultMarks[화재알림] === 'O', JSON.stringify(r3.resultMarks))
  const r4 = rollUpForm3Results([S(유도시트, ok1, '21-Z')], GI, G)
  check('없는 중분류 코드도 폴백(마크를 잃지 않는다)', r4.resultMarks['유도등'] === 'O')

  // 접기 — 같은 중분류의 여러 응답은 합쳐지고, 다른 중분류로는 섞이지 않는다
  const folded = foldSheetGroupStats([
    { sheet: 유도시트, group: '21-A', result: 'N' },
    { sheet: 유도시트, group: '21-A', result: 'N' },
    { sheet: 유도시트, group: '21-C', result: 'O' },
  ])
  check('fold: (시트,중분류) 3응답 → 2엔트리', folded.length === 2, JSON.stringify(folded))
  check('fold: 21-A는 전부 ／로 남는다(○가 새지 않는다)',
    folded.find(f => f.group === '21-A')?.stat.o === false, JSON.stringify(folded))

  // legacySheetOnlyStats(중분류를 버리는 대조군 도구)가 **제품 코드로 새지 않았는지** —
  // 검사가 목록을 들고 있으면 파일이 늘 때 썩는다. '토큰을 쓰는가'로 자기정의하는 스캔이라 늘 최신이다.
  const srcDir = path.join(import.meta.dirname, '..', 'src')
  const leaked: string[] = []
  let scanned = 0, positive = 0
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx)$/.test(e.name)) continue
      scanned++
      const src = readFileSync(p, 'utf8')
      if (src.includes('rollUpForm3Results')) positive++        // 양성 대조 — 스캐너가 실제로 읽고 있다
      if (src.includes('legacySheetOnlyStats') && !p.endsWith(path.join('lib', 'sheet-facility-map.ts'))) leaked.push(p)
    }
  }
  walk(srcDir)
  // 분모를 먼저 단언한다 — 0개를 훑고 '유출 없음'이라 말하면 공허 통과다(측정 없는 초록)
  check(`유출 스캐너가 실제로 훑는다 (${scanned}파일 · 양성대조 ${positive}건)`, scanned > 100 && positive >= 3,
    `scanned=${scanned} positive=${positive}`)
  check('legacySheetOnlyStats가 제품 코드(src/)에 없다', leaked.length === 0, leaked.join(' / '))

  // 매핑표 자기 검사 — 오타는 조용한 폴백이 되어 사고가 되살아난다
  const errs = sheetGroupMapErrors(ALL_STANDARD_CODES)
  check('SHEET_GROUP_FORM3_MAP 자기 검사 0건', errs.length === 0, errs.join(' / '))
  check('등재 시트 6종', Object.keys(SHEET_GROUP_FORM3_MAP).length === 6,
    `실제: ${Object.keys(SHEET_GROUP_FORM3_MAP).length}`)
}

console.log('\n── 8) image-51 강순건물 — 미체크 유도표지·피난유도선에 ○가 찍히지 않는다 (2026-09-03)')
{
  const G = ['유도등', '유도표지', '피난유도선']
  const 유도시트 = '유도등 및 유도표지'
  // 실사고 재현: 대장은 유도등만 체크. 점검표엔 세 중분류 모두 ○ 응답(일괄 입력 흔적) —
  // 종전엔 미체크 유도표지·피난유도선에 [ ]+○가 인쇄됐다(image-51 상단 경고 2건의 그 상태).
  const r = rollUpForm3Results(
    [S(유도시트, ok1, '21-A'), S(유도시트, ok1, '21-B'), S(유도시트, ok1, '21-C')], G, ['유도등'])
  check('체크된 유도등만 ○', r.resultMarks['유도등'] === 'O', `실제: ${r.resultMarks['유도등']}`)
  check('미체크 유도표지 → ／', r.resultMarks['유도표지'] === 'N', `실제: ${r.resultMarks['유도표지']}`)
  check('미체크 피난유도선 → ／', r.resultMarks['피난유도선'] === 'N', `실제: ${r.resultMarks['피난유도선']}`)
  check('두 항목 모두 대장 누락 경고 (응답은 지워지지 않았다)',
    r.axisWarnings.respondedNotInstalled.includes('유도표지')
    && r.axisWarnings.respondedNotInstalled.includes('피난유도선'), JSON.stringify(r.axisWarnings))
}

console.log('\n── 9) 부모 결과칸은 항상 공란 — 소화기구·피난기구 (2026-09-03 image-51 ④)')
{
  // 설치된 하위가 있으면: 종전과 같이 첫 설치 행에 롤업, 부모 공란
  const d1 = distributeSubMarks('O', [false, true, false])
  check('설치 하위 있음 → 부모 공란·첫 설치 행 ○·미설치 하위 ／',
    d1.parent === undefined && d1.subs[0] === 'N' && d1.subs[1] === 'O' && d1.subs[2] === 'N',
    JSON.stringify(d1))
  // 설치된 하위가 없어도: 종전엔 롤업이 부모 행으로 갔으나(image-51 소화기구 ○의 정체) 이제 공란
  const d0 = distributeSubMarks('O', [false, false])
  check('설치 하위 없음 → 부모도 공란 (종전 부모 ○ 번복)', d0.parent === undefined, JSON.stringify(d0))
  check('미설치 하위는 ／ 유지', d0.subs.every(s => s === 'N'), JSON.stringify(d0))
  const dx = distributeSubMarks('X', [true, false])
  check('×도 부모엔 안 가고 첫 설치 행으로', dx.parent === undefined && dx.subs[0] === 'X' && dx.subs[1] === 'N',
    JSON.stringify(dx))
  // 화면(1.4 배지)이 같은 두 항목을 숨기는 축 — 상수가 표준 어휘에 실재해야 배선이 성립한다
  check('SUB_ROW_PARENT_ITEMS = 소화기구·피난기구 (표준 42종에 실재)',
    SUB_ROW_PARENT_ITEMS.length === 2
    && SUB_ROW_PARENT_ITEMS.every(p => ALL_STANDARD_CODES.includes(p)),
    JSON.stringify(SUB_ROW_PARENT_ITEMS))
}

console.log('\n── 6) 어휘 실재 확인 — 오타로 검사가 헛돌지 않게')
{
  const std = new Set(ALL_STANDARD_CODES.map((c: string) => c.replace(/\s+/g, '')))
  const missing = ITEMS.filter(i => !std.has(i.replace(/\s+/g, '')))
  check('검사 어휘 8종이 표준 42종에 실재', missing.length === 0, `없는 어휘: ${missing.join(', ')}`)
  const mapped = new Set(Object.values(SHEET_FACILITY_MAP).flat().map(v => v.replace(/\s+/g, '')))
  const unmapped = ITEMS.filter(i => !mapped.has(i.replace(/\s+/g, '')))
  check('검사 어휘가 시트 매핑 값에도 실재', unmapped.length === 0, `매핑에 없음: ${unmapped.join(', ')}`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
