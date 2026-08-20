/** 설치장소 12칸이 실제로 인쇄되는가 — 칸별 고유값을 넣고 출력 HTML에서 되찾는다. 읽기 전용.
 *
 *  질문(2026-08-20): 시작 층·끝 지상/지하·끝 층·(2행)…이 정말 필요한가? 안 쓰이면 지우자.
 *  판정은 추측이 아니라 **렌더 결과**로 한다. 세부현황은 별지 9호 4~7쪽과 별지 4호 3~7쪽이
 *  같은 원본(renderSpecSections)을 쓰므로 두 문서를 모두 확인한다.
 *  실행: npx tsx scripts/_probe-place-fields-used.mts */
import r9mod from '../src/lib/doc-templates/report9.ts'
import r4mod from '../src/lib/doc-templates/report4.ts'

const { renderReport9 } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')
const { renderReport4 } = r4mod as unknown as typeof import('../src/lib/doc-templates/report4.ts')

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// 자동화재탐지설비(2줄 블록) 12칸에 서로 다른 표식을 넣는다
const place = {
  dong: 'DONGA', coverage: '전체층', from_ground: '지상', from_floor: 'FF1', to_ground: '지하', to_floor: 'TT1',
  dong2: 'DONGB', coverage2: '일부층', from_ground2: '지하', from_floor2: 'FF2', to_ground2: '지상', to_floor2: 'TT2',
}
const specs = { s35_alarm: { fire_detection: place } }
const base = {
  facilityChecks: [], resultMarks: {}, muResults: {}, assistants: [], defectRows: [],
  multiUseCounts: {}, multiUseNone: true, specs,
}
const html9 = renderReport9(base as never)
const html4 = renderReport4({ ...base, sheetSections: [] } as never)

/** 값이 그대로 인쇄되는 칸 */
const TEXT: Array<[string, string]> = [
  ['동명', 'DONGA'], ['시작 층', 'FF1'], ['끝 층', 'TT1'],
  ['(2행) 동명', 'DONGB'], ['(2행) 시작 층', 'FF2'], ['(2행) 끝 층', 'TT2'],
]
/** 체크(√)로 인쇄되는 칸 — 표식 문자열이 아니라 체크된 라벨로 확인한다 */
const CHECKED: Array<[string, string]> = [
  ['전체층/일부층', '[√]전체층'], ['(2행) 전체층/일부층', '[√]일부층'],
]

console.log('=== 별지 9호 (4~7쪽 세부현황)')
for (const [label, mark] of TEXT) check(`${label} 인쇄됨`, html9.includes(mark), `'${mark}' 없음`)
for (const [label, mark] of CHECKED) check(`${label} 인쇄됨`, html9.includes(mark), `'${mark}' 없음`)
// 지상/지하는 1행·2행이 서로 반대라 √ 개수로 본다(전체 서식에 지상/지하 쌍이 많아 포함 여부로는 못 가린다)
const g9 = (html9.match(/\[√\]지상/g) ?? []).length
const u9 = (html9.match(/\[√\]지하/g) ?? []).length
check('시작/끝 지상·지하 √ 반영', g9 >= 2 && u9 >= 2, `지상 √ ${g9}개 · 지하 √ ${u9}개`)

console.log('=== 별지 4호 (3~7쪽 — 같은 원본 공용)')
for (const [label, mark] of TEXT) check(`${label} 인쇄됨`, html4.includes(mark), `'${mark}' 없음`)
for (const [label, mark] of CHECKED) check(`${label} 인쇄됨`, html4.includes(mark), `'${mark}' 없음`)

console.log('=== 2행이 없는 블록은 (2행) 칸을 만들지 않는다')
// 단독경보형 감지기 = rangeLocFields()를 second 없이 쓰는 블록 — 2행 칸 자체가 없다
// (비상방송설비를 골랐다가 실패했다: 그 블록은 rangeLocFields를 아예 안 쓴다 — dong 필드가 없음)
const single = renderReport9({
  ...base, specs: { s35_alarm: { standalone_detector: { dong: 'ONLY1', dong2: 'SHOULD_NOT_PRINT' } } },
} as never)
check('단일 줄 블록: 1행은 인쇄', single.includes('ONLY1'))
check('단일 줄 블록: 2행은 미인쇄', !single.includes('SHOULD_NOT_PRINT'))

console.log(`\n=== 결과 — ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
