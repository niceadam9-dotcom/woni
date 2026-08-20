// 3-2 수계공통 '◦ 설비의 종류' 8종 체크줄 배치 프로브 (2026-08-20)
//   종전: 3+5 두 줄, 쉼표 구분, 전각공백 들여쓰기 → 둘째 줄에 5종이 몰려 '포소화설비'가 칸 끝에서 접혔다.
//   현행 원문(_form/_별지4호_현행판_추출.txt:184-186)은 3·2·3 세 줄, 공백 구분, 목록이 라벨 아래 정렬.
// 서버·DB 불필요. 실행: node node_modules/tsx/dist/cli.mjs scripts/_probe-s32-syslist.mjs
const { renderSpecSections } = await import('../src/lib/doc-templates/spec-sections.ts')
const { BASE_CSS } = await import('../src/lib/doc-templates/base.ts')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}

/** 원문 순서 그대로 — 이 배열이 3·2·3으로 끊겨야 한다 */
const ROWS = [
  ['옥내소화전설비', '옥외소화전설비', '스프링클러설비'],
  ['간이스프링클러설비', '화재조기진압용스프링클러설비'],
  ['물분무소화설비', '미분무소화설비', '포소화설비'],
]
const BLOCKS = ['main_water', 'pump_elevated', 'pump_pressure', 'pump_pressurized', 'pump_type']

const html = renderSpecSections({
  s32_water_common: {
    main_water: { systems: ['옥내소화전설비', '포소화설비'] },
    pump_type: { used: true, systems: ['옥내소화전설비'] },
  },
}).join('\n')

// ── 1) 5블록 전부 출력 · 판정 스크립트의 기존 앵커 유지 ──────────────────────
console.log('\n── 1) 5블록 · 기존 앵커 ──')
check('5개 블록 전부 체크줄 출력',
  (html.match(/◦ 설비의 종류:/g) ?? []).length === BLOCKS.length,
  `실제 ${(html.match(/◦ 설비의 종류:/g) ?? []).length}건`)
// _judge19-annex.mjs:266 / _probe-soban19-b.mts:187 이 세는 리터럴이 쪼개지지 않았는가
check('앵커 "◦ 설비의 종류:"가 태그로 쪼개지지 않았다', html.includes('◦ 설비의 종류:'))
// _probe-soban19-b.mts:189 는 라벨↔첫 항목 사이를 80자로 제한한다 — 스팬 마크업이 그 안에 들어가야 한다
check('라벨→첫 항목 간격이 80자 이내(기존 프로브 정규식 호환)',
  /설비의 종류:[\s\S]{0,80}?\[√\]옥내소화전설비/.test(html))

// ── 2) 3·2·3 배치 ───────────────────────────────────────────────────────────
console.log('\n── 2) 원문 3·2·3 배치 ──')
const groups = [...html.matchAll(
  /<span class="syslist">◦ 설비의 종류: <\/span><span class="syslist">([\s\S]*?)<\/span>/g)]
check('라벨·목록이 두 칸(.syslist)으로 갈렸다 — 5블록 전부', groups.length === BLOCKS.length,
  `실제 ${groups.length}건`)

// 빈 체크박스는 spec-sections의 CB — 4~7쪽 서식은 한 칸이라 '[&nbsp;]'(base.ts ck의 두 칸과 다르다)
const EMPTY = '[&nbsp;]'
/** '[√]옥내소화전설비 [&nbsp;]옥외…' → [{name, checked}] */
const parseLine = line => line.split(' ').filter(Boolean).map(tok => ({
  checked: tok.startsWith('[√]'),
  name: tok.replace(/^\[√\]|^\[&nbsp;\]/, ''),
}))

let shapeOk = true, orderOk = true, sepOk = true
for (const g of groups) {
  const lines = g[1].split('<br>')
  if (lines.length !== 3) { shapeOk = false; continue }
  lines.forEach((line, i) => {
    const items = parseLine(line)
    if (items.length !== ROWS[i].length) shapeOk = false
    if (items.map(x => x.name).join('|') !== ROWS[i].join('|')) orderOk = false
    if (line.includes(',')) sepOk = false
  })
}
check('블록마다 정확히 3행', shapeOk,
  groups.map(g => g[1].split('<br>').length).join(', '))
check('행별 항목 수·순서가 원문과 동일(3·2·3)', orderOk)
check('구분자는 쉼표가 아닌 공백(원문)', sepOk)
check('종전 전각공백 들여쓰기 제거', !/설비의 종류[\s\S]{0,200}?　　/.test(html))

// ── 3) 체크 상태가 배치를 타고 살아있는가 ────────────────────────────────────
console.log('\n── 3) 체크 상태 ──')
const first = groups[0]?.[1] ?? ''
const firstItems = first.split('<br>').flatMap(parseLine)
check('주된수원 선택분 2종만 √ — 옥내소화전설비·포소화설비',
  firstItems.filter(x => x.checked).map(x => x.name).join('|') === '옥내소화전설비|포소화설비',
  firstItems.filter(x => x.checked).map(x => x.name).join('|'))
// 마지막 행 마지막 항목까지 체크가 살아있는지 — 3행 배치에서 가장 깨지기 쉬운 자리
check('셋째 행 끝 항목(포소화설비)도 √가 붙는다',
  /<br>[^<]*\[√\]포소화설비/.test(first))
check('미선택은 빈 체크박스', first.includes(`${EMPTY}옥외소화전설비`))
check('8종 전부 나열', ROWS.flat().every(s => first.includes(s)))
check('선택 없는 블록도 8종 빈 체크로 출력',
  (groups[1]?.[1].match(/\[&nbsp;\]/g) ?? []).length === 8)

// ── 4) 정렬 CSS ─────────────────────────────────────────────────────────────
console.log('\n── 4) 정렬 CSS ──')
check('.syslist 규칙이 공통 CSS(BASE_CSS)에 있다 — 별지4·9호 양쪽 적용',
  /\.syslist\s*\{[^}]*\}/.test(BASE_CSS))
check('.syslist가 inline-block', /\.syslist\s*\{[^}]*display:\s*inline-block/.test(BASE_CSS))
// 없으면 1줄 라벨이 3줄 목록의 마지막 줄 베이스라인에 붙어 라벨만 아래로 내려간다
check('.syslist가 vertical-align:top', /\.syslist\s*\{[^}]*vertical-align:\s*top/.test(BASE_CSS))

console.log(`\n결과: ${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
