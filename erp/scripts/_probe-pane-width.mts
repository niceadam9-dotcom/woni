/** 작업대 3칸 폭 조절 계산 검증 — 순수 함수 단언(DB·브라우저 불필요)
 *  실행: npx tsx --conditions=react-server scripts/_probe-pane-width.mts */
import { readFileSync } from 'node:fs'
import mod from '../src/lib/pane-width.ts'

const {
  PANE_BASE, PANE_STEP, PANE_MIN, nudgePaneW, paneCols, paneWidthOk, parsePaneW, paneLabels,
} = mod as unknown as typeof import('../src/lib/pane-width.ts')

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const ZERO = [0, 0, 0] as [number, number, number]
const sum = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100

console.log('— 합 보존: 한 칸이 얻은 만큼 나머지 둘이 나눠 낸다(전체 폭 불변)')
for (let i = 0; i < 3; i++) {
  const w = nudgePaneW('preview', ZERO, i, 1)!
  ok(`${i}번 칸 넓히기 — 합 0 유지`, sum(w) === 0, JSON.stringify(w))
  ok(`${i}번 칸이 +${PANE_STEP}`, w[i] === PANE_STEP, JSON.stringify(w))
  ok(`나머지 둘이 각 -${PANE_STEP / 2}`,
    w.every((v, j) => j === i || v === -PANE_STEP / 2), JSON.stringify(w))
}

console.log('— 되돌리기: 넓힌 뒤 좁히면 원위치')
{
  const w = nudgePaneW('preview', nudgePaneW('preview', ZERO, 2, 1)!, 2, -1)!
  ok('넓히기 → 좁히기 = [0,0,0]', JSON.stringify(w) === JSON.stringify(ZERO), JSON.stringify(w))
}

console.log('— 최소폭: 어느 화면폭에서도 칸이 뭉개지지 않는다')
{
  // 가운데 칸을 계속 좁혀 본다 — 2xl 미리보기 기본값 0.9가 가장 먼저 바닥에 닿는다
  let w: readonly number[] = ZERO, steps = 0
  while (steps < 50) {
    const n = nudgePaneW('preview', w, 1, -1)
    if (!n) break
    w = n; steps++
  }
  ok('좁히기가 유한 번에 멈춘다(무한 진행 아님)', steps > 0 && steps < 50, `steps=${steps}`)
  ok('멈춘 지점도 lg·2xl 양쪽 최소폭 이상', paneWidthOk('preview', w), JSON.stringify(w))
  ok('한 걸음 더 가면 최소폭 위반 — 즉 경계까지 갔다',
    nudgePaneW('preview', w, 1, -1) === null
    && [PANE_BASE.lg.preview, PANE_BASE.xl.preview].some(b => b[1] + w[1] - PANE_STEP < PANE_MIN),
    JSON.stringify(w))
}
{
  // ⚠ lg만 보고 판정하면 통과하지만 2xl에서 뭉개지는 값 — 양쪽 검사가 실제로 걸리는지
  //    가운데 칸 -0.48: lg 0.95→0.47(통과) / 2xl 0.9→0.42(위반)
  const lgOnly: [number, number, number] = [0.24, -0.48, 0.24]
  ok('lg(0.95)만 보면 통과할 값이 2xl(0.9) 때문에 거부된다',
    PANE_BASE.lg.preview[1] + lgOnly[1] >= PANE_MIN && !paneWidthOk('preview', lgOnly),
    `lg=${PANE_BASE.lg.preview[1] + lgOnly[1]} / 2xl=${PANE_BASE.xl.preview[1] + lgOnly[1]}`)
}

console.log('— CSS 값 생성')
{
  const css = paneCols(PANE_BASE.lg.preview, ZERO)
  ok('기본값은 종전 하드코딩 비율과 동일', css === 'minmax(0,1.15fr) minmax(0,0.95fr) minmax(0,1.5fr)', css)
  const wide = paneCols(PANE_BASE.xl.preview, nudgePaneW('preview', ZERO, 2, 1)!)
  ok('셋째 칸 넓히면 3번째 값이 커진다', wide.includes('2.05fr'), wide)
  // 3자리까지는 정상(눈금 0.125). 그보다 길면 반올림이 빠진 것 — 0.30000000000000004 류
  ok('부동소수 잔재 없음(0.30000000000000004 류)', !/\d\.\d{4,}fr/.test(wide), wide)
}

console.log('— 저장값 검증(깨진 값이 화면을 망가뜨리지 않는다)')
/* 🚨 2026-09-11(2) — 저장 형식이 또 바뀌었다(키 v2→v3). v2는 **칸 수별** 묶음 `{"2":…,"3":…}`
   이었는데, ①도 2칸이 되면서 ④와 한 칸을 공유하게 됐다. 칸 수가 같아도 칸의 **뜻이 다르므로**
   (④=생성·제출/미리보기, ①=점검표/불량) `PaneKind`별로 가른다. */
ok('null → null', parsePaneW(null, 'preview') === null)
ok('빈 문자열 → null', parsePaneW('', 'preview') === null)
ok('JSON 아님 → null', parsePaneW('{oops', 'preview') === null)
ok('배열(v1 옛 형식) → null — 구성별 묶음이 아니다', parsePaneW('[0.25,-0.125,-0.125]', 'preview') === null)
ok('🚨 v2(칸 수 키) 저장값 → null — 조용히 얹지 않고 기본값으로 떨어진다',
  parsePaneW('{"2":[0.25,-0.25],"3":[0.25,-0.125,-0.125]}', 'preview') === null
  && parsePaneW('{"2":[0.25,-0.25],"3":[0.25,-0.125,-0.125]}', 'duo') === null)
ok('그 구성 항목이 없으면 → null', parsePaneW('{"duo":[0,0]}', 'preview') === null)
ok('길이가 그 구성의 칸 수와 다르면 → null', parsePaneW('{"preview":[0,0]}', 'preview') === null)
ok('숫자 아님 → null', parsePaneW('{"preview":[0,"a",0]}', 'preview') === null)
ok('NaN → null', parsePaneW('{"preview":[0,null,0]}', 'preview') === null)
ok('최소폭 위반 저장값 → null(기본 비율로 복귀)', parsePaneW('{"preview":[0,-5,5]}', 'preview') === null)
ok('정상값은 그대로',
  JSON.stringify(parsePaneW('{"preview":[0.25,-0.125,-0.125]}', 'preview')) === '[0.25,-0.125,-0.125]')

/* 🎯 이번 변경의 **핵심 축** — ④(duo)와 ①(entry)은 둘 다 2칸이다. 칸 수로 갈랐다면 한 값을
   공유해서 ④에서 미리보기를 넓히면 ①의 불량 칸이 덩달아 넓어졌다. 섞이지 않는지 양·음 둘 다 묻는다. */
const MIXED = '{"duo":[0.25,-0.25],"entry":[-0.25,0.25]}'
ok('🎯 같은 2칸이라도 duo와 entry가 섞이지 않는다(양성)',
  JSON.stringify(parsePaneW(MIXED, 'duo')) === '[0.25,-0.25]'
  && JSON.stringify(parsePaneW(MIXED, 'entry')) === '[-0.25,0.25]',
  `duo=${JSON.stringify(parsePaneW(MIXED, 'duo'))} entry=${JSON.stringify(parsePaneW(MIXED, 'entry'))}`)
ok('🚨 (음성) entry만 저장돼 있으면 duo는 기본값이다 — 남의 폭을 물려받지 않는다',
  parsePaneW('{"entry":[-0.25,0.25]}', 'duo') === null)
ok('🚨 (음성) 3칸 값을 2칸 구성으로 읽지 않는다',
  parsePaneW('{"duo":[0,0,0]}', 'duo') === null)

console.log('\n— 2칸 축 — 3칸을 타입으로 못 박고 있던 것을 푼 자리')
const ZERO2 = [0, 0]
ok('duo 기본값이 2칸이다', PANE_BASE.lg.duo.length === 2 && PANE_BASE.xl.duo.length === 2,
  JSON.stringify([PANE_BASE.lg.duo, PANE_BASE.xl.duo]))
// 🎯 사용자 요청의 본질: 생성·제출 칸이 종전 3칸 preview보다 **넓어졌는가**
ok('🎯 생성·제출 칸이 종전보다 넓다(lg)', PANE_BASE.lg.duo[0] > PANE_BASE.lg.preview[1],
  `${PANE_BASE.lg.duo[0]} vs ${PANE_BASE.lg.preview[1]}`)
ok('🎯 생성·제출 칸이 종전보다 넓다(xl)', PANE_BASE.xl.duo[0] > PANE_BASE.xl.preview[1],
  `${PANE_BASE.xl.duo[0]} vs ${PANE_BASE.xl.preview[1]}`)
// 🚨 미리보기 칸은 줄이지 않는다 — 서식을 읽는 칸이라 좁히면 이 화면의 목적이 무너진다
ok('🚨 미리보기 칸을 좁히지 않았다(xl)', PANE_BASE.xl.duo[1] >= PANE_BASE.xl.preview[2],
  `${PANE_BASE.xl.duo[1]} vs ${PANE_BASE.xl.preview[2]}`)
// ⚠ 나누는 수가 length-1이어야 합이 0이다. 3으로 박아 두면 2칸에서 전체 폭이 흔들린다.
for (let i = 0; i < 2; i++) {
  const w = nudgePaneW('duo', ZERO2, i, 1)!
  ok(`2칸 ${i}번을 넓혀도 합이 0`, !!w && sum([...w]) === 0, JSON.stringify(w))
  ok(`2칸 ${i}번이 실제로 넓어진다`, !!w && w[i] === PANE_STEP, JSON.stringify(w))
}
ok('2칸 왕복(넓혔다 좁히면) 원위치',
  JSON.stringify(nudgePaneW('duo', nudgePaneW('duo', ZERO2, 0, 1)!, 0, -1)!) === '[0,0]')
ok('🚨 (음성) 칸 수가 그 구성과 안 맞으면 거부한다', paneWidthOk('duo', [0, 0, 0, 0]) === false)
ok('paneCols가 2칸이면 두 칸만 낸다', paneCols(PANE_BASE.xl.duo, ZERO2).split(' ').length === 2,
  paneCols(PANE_BASE.xl.duo, ZERO2))

console.log('\n— ① 점검표 2칸(entry) 축 — 셋째 칸을 없애고 남는 폭을 둘이 나눈다')
ok('entry 기본값이 2칸이다', PANE_BASE.lg.entry.length === 2 && PANE_BASE.xl.entry.length === 2,
  JSON.stringify([PANE_BASE.lg.entry, PANE_BASE.xl.entry]))
/* 🎯 사용자 요청의 본질: 칸 하나를 없앴으니 **남은 둘이 둘 다 넓어져야** 한다.
   종전 ①은 normal `[1.15, 1, 1]`이었다. 한쪽만 넓어지고 다른 쪽이 그대로면 "화면을 크게 쓴다"가 절반만 된다. */
ok('🎯 점검표 입력 칸이 종전(normal[0])보다 넓다(lg)', PANE_BASE.lg.entry[0] > PANE_BASE.lg.normal[0],
  `${PANE_BASE.lg.entry[0]} vs ${PANE_BASE.lg.normal[0]}`)
ok('🎯 불량 내역 칸도 종전(normal[1])보다 넓다(lg)', PANE_BASE.lg.entry[1] > PANE_BASE.lg.normal[1],
  `${PANE_BASE.lg.entry[1]} vs ${PANE_BASE.lg.normal[1]}`)
ok('🎯 두 칸 모두 넓어진다(xl)',
  PANE_BASE.xl.entry[0] > PANE_BASE.xl.normal[0] && PANE_BASE.xl.entry[1] > PANE_BASE.xl.normal[1],
  JSON.stringify(PANE_BASE.xl.entry))
/* 🚨 entry는 duo와 **반대 방향**이다 — ①의 주 작업면은 첫째 칸(시트 트리)이고, ④의 주 읽기면은
   둘째 칸(미리보기)이다. 두 구성이 같은 모양으로 수렴하면 한쪽이 잘못 맞춰진 것이다. */
ok('🚨 entry는 첫째 칸이 더 넓다(duo는 둘째가 더 넓다) — 두 구성이 같은 값으로 수렴하지 않았다',
  PANE_BASE.xl.entry[0] > PANE_BASE.xl.entry[1] && PANE_BASE.xl.duo[1] > PANE_BASE.xl.duo[0],
  `entry=${JSON.stringify(PANE_BASE.xl.entry)} duo=${JSON.stringify(PANE_BASE.xl.duo)}`)
// 라벨도 칸 수를 따라야 한다 — 2칸에서 「가운데 칸」이라 부르면 가운데가 없어 거짓말이 된다
ok('2칸 라벨은 2개이고 「가운데」가 없다',
  paneLabels(2).length === 2 && !paneLabels(2).some(l => l.includes('가운데')), paneLabels(2).join('·'))
ok('3칸 라벨은 종전 그대로', paneLabels(3).join('·') === '첫째 칸·가운데 칸·셋째 칸')

console.log('\n— ④ 화면 구조 — 계산이 옳아도 화면이 그걸 안 쓰면 소용없다')
/* 🚨 순수 함수만 보면 「duo가 2칸이다」까지만 안다. **작업대가 ④에서 duo를 고르는가**,
   그리고 칸을 없애면서 **잃으면 안 되는 것을 옮겼는가**는 소스를 읽어야 알 수 있다.
   [종료일 고치기]는 살아 있는 화면에서 유일한 입구라(timeline-client는 렌더 안 됨),
   지우면 기한 자체를 못 고치고 법정 15일 판정이 통째로 어긋난다. */
const wbSrc = readFileSync(new URL('../src/components/inspections/inspection-workbench.tsx', import.meta.url), 'utf8')
const submit9Block = (() => {
  const i = wbSrc.indexOf("{sel === 'submit9' && (<>")
  const j = wbSrc.indexOf("{sel === 'repair'", i)
  return i < 0 ? '' : wbSrc.slice(i, j < 0 ? undefined : j)
})()
ok('④ 블록을 찾았다', submit9Block.length > 0)
ok("🎯 ④가 duo(2칸)를 고른다", /sel === 'submit9' \? 'duo'/.test(wbSrc))
ok('🎯 ④는 Pane이 정확히 2개다',
  (submit9Block.match(/<Pane\s/g) ?? []).length === 2, String((submit9Block.match(/<Pane\s/g) ?? []).length))
/* 🚨 단언은 **주석이 아니라 요소**를 물어야 한다. 처음엔 `includes('종료일 고치기')`로 썼는데,
   바로 위 주석에 그 말을 적어 둬서 **버튼을 지워도 초록이었다**(변이 실험이 잡았다).
   같은 이유로 `p.href`만 보면 `{false && p.href && …}`로 죽여도 통과한다 — 조건까지 본다. */
ok('🚨 [종료일 고치기] **버튼**이 ④ 안에 살아 있다(유일한 입구)',
  />종료일 고치기<\/button>/.test(submit9Block))
ok('  · 그 버튼이 종료일 편집을 실제로 연다', /setAnchorEdit\(true\)/.test(submit9Block))
/* 🚨 2026-09-11 — 「제출 전제」는 **폐지됐다**(`228739a`, 사용자 지시 image-8).
   종전 네 단언(전제 존재·detail 표시·href 링크·접이식)은 그 커밋 이후 **빨간 채로 남아 있었다** —
   그 세션이 이 프로브를 함께 갱신하지 않았다. 지우지 않고 **새 계약으로 갈아끼운다**:
   폐지의 핵심은 "표시만이 아니라 그 값을 만들던 조회까지 걷었다"이므로, 되살아남을
   **표시 축과 데이터 축 양쪽**에서 묻는다. 표시만 지우고 조회가 남으면 비용만 남는다. */
ok('🚨 (음성) ④에 제출 전제 표시가 없다(폐지)', !submit9Block.includes('data.prereqs')
  && !/submit9-prereq-toggle/.test(submit9Block))
/* ⚠ 이 단언을 처음엔 `/prereqs|report9Checks|computeQuickReadiness/`로 썼다가 **주석에 걸려**
   빨개졌다 — 폐지 경위를 설명하는 주석에 그 이름들이 그대로 적혀 있다(page.tsx :332·:361,
   workbench :865). 위 :128이 경고한 함정을 이 파일 안에서 내가 다시 밟은 것이다.
   그래서 **산문에는 못 나오는 코드 모양**으로만 묻는다: 호출의 `(`, 객체 필드의 `:`. */
const pageSrc = readFileSync(new URL('../src/app/(dashboard)/inspections/[id]/page.tsx', import.meta.url), 'utf8')
ok('🚨 (음성) 전제를 만들던 서버 계산도 걷혔다 — 표시만 지우면 비용이 남는다',
  !/computeQuickReadiness\(/.test(pageSrc) && !/\bprereqs:/.test(pageSrc),
  `호출=${/computeQuickReadiness\(/.test(pageSrc)} 필드=${/\bprereqs:/.test(pageSrc)}`)
// 양성 대조 — 파일을 실제로 읽었는가(경로가 틀리면 빈 문자열이라 위가 공허하게 초록이다)
ok('  · page.tsx를 실제로 읽었다(공허 통과 방지)', pageSrc.includes('InspectionWorkbench'), `${pageSrc.length}자`)
// 초기화 버튼이 마지막 칸에 붙는가 — `i === 2`로 박혀 있으면 2칸 화면에서 통째로 사라진다
ok('🚨 폭 초기화 버튼이 마지막 칸 기준이다(2칸에서도 보인다)', /i === paneCount - 1/.test(wbSrc))
ok('🚨 (음성) 3칸을 못 박은 PANE_LABELS·PANE_W_DEFAULT를 더 쓰지 않는다',
  !/PANE_LABELS|PANE_W_DEFAULT/.test(wbSrc))

console.log('\n— ① 화면 구조 — 지운 것과 **남긴 것**을 함께 묻는다')
/* 🚨 2026-09-11 사용자 지시로 ① 셋째 칸(점검 인력·생성물)을 없앴다. 셋은 딴 데 있었지만
   [재방문 안내]만은 작업대에서 여기뿐이라 첫째 칸으로 옮겼다 — **그 이동이 실제로 됐는지**를
   묻지 않으면 "지웠다"만 초록이고 기능은 사라진 채로 통과한다.
   ⚠ 단언은 주석이 아니라 **요소**를 문다(위 :128의 교훈). 새 주석에도 '재방문 안내'가 적혀 있어
     `includes('재방문 안내')`는 버튼을 지워도 초록이다. testid + 핸들러로 묻는다. */
const checklistBlock = (() => {
  const i = wbSrc.indexOf("{sel === 'checklist' && (<>")
  const j = wbSrc.indexOf("{sel === 'cert'", i)
  return i < 0 ? '' : wbSrc.slice(i, j < 0 ? undefined : j)
})()
ok('① 블록을 찾았다', checklistBlock.length > 0)
ok("🎯 ①이 entry(2칸)를 고른다", /sel === 'checklist' \? 'entry'/.test(wbSrc))
ok('🎯 ①은 Pane이 정확히 2개다',
  (checklistBlock.match(/<Pane\s/g) ?? []).length === 2,
  String((checklistBlock.match(/<Pane\s/g) ?? []).length))
ok('🚨 (음성) ① 안에 점검 참여자 슬롯이 없다 — ②로 일원화',
  !/slots\?\.participants/.test(checklistBlock))
ok('  · 그래도 ②에는 남아 있다(참여자가 통째로 사라지지 않았다)',
  /slots\?\.participants/.test(wbSrc))
ok('🚨 (음성) ① 안에 생성물 목록(DocPane)이 없다 — ④·첫째 칸이 이미 들고 있다',
  !/<DocPane/.test(checklistBlock))
ok('🚨 (음성) ① 안에 [별지 4호 생성] 버튼이 없다 — ④ report4 칩이 대체',
  !/generate\('report4'\)/.test(checklistBlock))
ok('  · 그래도 별지 4호는 ④ 칩으로 만들 수 있다',
  /type: 'report4', label: '별지 4호'/.test(wbSrc))
ok('🚨 [재방문 안내] **버튼**이 ①으로 옮겨져 살아 있다(작업대 유일 입구)',
  /data-testid="workbench-adhoc-sms"/.test(checklistBlock))
ok('  · 그 버튼이 실제로 발송 모달을 연다', /setAdhocSms\(true\)/.test(checklistBlock))
ok('  · 모달 자체도 남아 있다', /kind: 'adhoc'/.test(wbSrc))

console.log(`\n결과: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
