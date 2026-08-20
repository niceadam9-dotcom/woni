// 3-1 소화기구 동별 수량 표 개편 프로브 (2026-08-20)
//   ① 체크한 종류의 칸만 열린다 (enabledBy가 설치 종류 6개와 1:1)
//   ② 동을 추가해도 합계가 난다 (동별 행의 세로 합)
//   ③ 인쇄가 서식 표대로 — 동명 + 수량 6칸 + 비고 (종전 colspan=6 자유 텍스트 아님)
//   ④ 구 저장분(합계 수량 6칸) 폴백 — 다시 저장하기 전에도 문서가 비지 않는다
// 서버·DB 불필요. 실행: npx tsx scripts/_probe-s31-dong-table.mjs
const {
  FACILITY_SPEC_SECTIONS, S31_COLUMNS, S31_TYPE_OPTIONS,
  normalizeRows, rowIsEmpty, rowsHaveValue, columnTotal, s31LegacyRow,
} = await import('../src/lib/facility-spec-schema.ts')
const { renderSpecSections } = await import('../src/lib/doc-templates/spec-sections.ts')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}
const s31 = FACILITY_SPEC_SECTIONS.find(s => s.key === 's31_extinguisher')
const html = spec => renderSpecSections({ s31_extinguisher: spec })[0]
/** 인쇄 표의 본문 행들을 [셀문자열...] 로 — 헤더(th) 행은 제외 */
function bodyRows(h) {
  return [...h.matchAll(/<tr>((?:(?!<\/tr>)[\s\S])*)<\/tr>/g)]
    .map(m => m[1])
    .filter(r => !r.includes('<th'))
    .map(r => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(c => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()))
}

console.log('\n── 1) 스키마: 체크박스 ↔ 수량 열이 1:1로 묶였는가 ──')
check('블록은 하나로 합쳐졌다(구 by_dong 자유 기입 블록 없음)',
  s31.blocks.length === 1 && !s31.blocks.some(b => b.key === 'by_dong'),
  `현재 블록: ${s31.blocks.map(b => b.key).join(', ')}`)
const fTypes = s31.blocks[0].fields.find(f => f.key === 'types')
const fRows = s31.blocks[0].fields.find(f => f.type === 'rowtable')
check('설치 종류 6개 + 동별 수량 표(rowtable) 두 필드', !!fTypes && !!fRows && fTypes.options.length === 6)
check('구 합계 수량 6칸(qty_*)은 개별 필드에서 사라졌다',
  !s31.blocks[0].fields.some(f => f.key.startsWith('qty_')))
const gated = S31_COLUMNS.filter(c => c.enabledBy)
check('수량 열 6개 전부 enabledBy를 갖는다', gated.length === 6,
  `가진 열: ${gated.map(c => c.key).join(', ')}`)
check('enabledBy 값이 설치 종류 선택지와 정확히 일치(오타 하나면 칸이 영영 안 열린다)',
  gated.every(c => S31_TYPE_OPTIONS.includes(c.enabledBy))
  && S31_TYPE_OPTIONS.every(o => gated.some(c => c.enabledBy === o)),
  `열: ${gated.map(c => c.enabledBy).join(' / ')}`)
check('동명·비고는 게이트 없음(항상 입력 가능)',
  S31_COLUMNS.filter(c => !c.enabledBy).map(c => c.key).join(',') === 'dong,note')
check('합계 대상(total)은 수량 6열뿐 — 동명·비고를 더하지 않는다',
  S31_COLUMNS.filter(c => c.total).length === 6 && !S31_COLUMNS.find(c => c.key === 'note')?.total)

console.log('\n── 2) 합계 = 동별 행의 세로 합 ──')
const rows2 = [
  { dong: 'A동', qty_ext_powder: 10, qty_ext_other: 2, qty_auto_diffuse: 4 },
  { dong: 'B동', qty_ext_powder: 2, qty_auto_diffuse: 2 },
]
check('동 2개 합산 — 분말 10+2=12', columnTotal(normalizeRows(rows2), 'qty_ext_powder') === 12)
check('동 2개 합산 — 확산 4+2=6', columnTotal(normalizeRows(rows2), 'qty_auto_diffuse') === 6)
check('한 동에만 있는 열도 합산 — 기타 2', columnTotal(normalizeRows(rows2), 'qty_ext_other') === 2)
check('값이 하나도 없는 열은 0이 아니라 null(= 서식 빈칸, 0을 찍으면 거짓말)',
  columnTotal(normalizeRows(rows2), 'qty_simple_throw') === null)
check('숫자 아닌 칸은 합계를 깨뜨리지 않고 무시된다',
  columnTotal(normalizeRows([{ qty_ext_powder: '3' }, { qty_ext_powder: '약간' }]), 'qty_ext_powder') === 3)
check('동을 더 추가해도 합계가 따라온다 (12 → 15)',
  columnTotal(normalizeRows([...rows2, { dong: 'C동', qty_ext_powder: 3 }]), 'qty_ext_powder') === 15)
check('빈 행만 든 표는 입력됨이 아니다(완성도 거짓 계상 방지)',
  rowsHaveValue(normalizeRows([{}, { dong: '' }])) === false && rowsHaveValue(normalizeRows(rows2)) === true)
check('빈 행 판정', rowIsEmpty({}) && rowIsEmpty({ dong: '   ' }) === false /* 공백은 normalize에서 제거됨 */
  || rowIsEmpty(normalizeRows([{ dong: '   ' }])[0]))

console.log('\n── 3) 인쇄: 서식 표대로 (동명 + 수량 6 + 비고) ──')
const printed = html({ summary: { types: ['소화기(분말)', '소화기(기타)', '자동확산소화기'], dong_rows: rows2 } })
check('종전의 자유 텍스트 한 칸(colspan=6)이 사라졌다', !printed.includes('colspan="6"'))
const br = bodyRows(printed)
check('합계 행이 세로 합을 찍는다 — 합계 12 2 · · 6 ·',
  br[0][0] === '합계' && br[0][1] === '12' && br[0][2] === '2' && br[0][5] === '6',
  `실제: ${JSON.stringify(br[0])}`)
check('동별 행이 각자 칸에 찍힌다 — A동 10 2 · · 4',
  br[1][0] === 'A동' && br[1][1] === '10' && br[1][2] === '2' && br[1][5] === '4',
  `실제: ${JSON.stringify(br[1])}`)
check('둘째 동도 자기 행에 — B동 2 · · · 2',
  br[2][0] === 'B동' && br[2][1] === '2' && br[2][5] === '2', `실제: ${JSON.stringify(br[2])}`)
check('모든 본문 행이 8칸(구분+수량6+비고)', br.every(r => r.length === 8),
  `칸 수: ${br.map(r => r.length).join(',')}`)
check('빈 서식 5행 유지(2동 입력 → 합계1 + 5행)', br.length === 6, `행 수: ${br.length}`)
check('체크한 종류만 헤더에 [√]',
  printed.includes('[√] 분말') && printed.includes('[√] 기타') && printed.includes('[&nbsp;] 투척용'),
  printed.match(/<th>[^<]*<\/th>/g)?.join(' ') ?? '')
check('비고는 동별 행에 찍히고 합계 행에 중복되지 않는다', (() => {
  const p = bodyRows(html({ summary: { dong_rows: [{ dong: 'A동', note: '지하 포함' }] } }))
  return p[1][7] === '지하 포함' && p[0][7] === ''
})())

console.log('\n── 4) 구 저장분 폴백 — 다시 저장하기 전에도 문서가 비지 않는다 ──')
const legacySpec = { summary: { types: ['소화기(분말)'], qty_ext_powder: 12, qty_ext_other: 2, qty_auto_diffuse: 6, note: '구 비고' } }
const lrow = s31LegacyRow(legacySpec, '본관')
check('구 합계 수량 → 첫 행으로 이관', lrow?.qty_ext_powder === '12' && lrow?.qty_auto_diffuse === '6')
check('구 비고도 첫 행 비고로 따라온다', lrow?.note === '구 비고')
check('동명은 건물명으로 채워진다', lrow?.dong === '본관')
check('구 저장분이 비면 null(빈 행을 만들지 않는다)', s31LegacyRow({ summary: { types: ['소화기(분말)'] } }) === null)
const lb = bodyRows(html(legacySpec))
check('구 저장분도 인쇄 합계가 종전과 같은 12/2/6', lb[0][1] === '12' && lb[0][2] === '2' && lb[0][5] === '6',
  `실제: ${JSON.stringify(lb[0])}`)
check('새 구조가 있으면 구 값을 쓰지 않는다(둘 다 있을 때 새 쪽이 이긴다)', (() => {
  const both = bodyRows(html({ summary: { ...legacySpec.summary, dong_rows: [{ dong: 'A동', qty_ext_powder: 1 }] } }))
  return both[0][1] === '1' && both[1][0] === 'A동'
})())
check('아무 값도 없으면 종전처럼 빈 서식(합계1 + 5행, 동명 라벨)', (() => {
  const e = bodyRows(html({}))
  return e.length === 6 && e[1][0] === '동명' && e[0][0] === '합계'
})())

console.log(`\n결과: ${pass} pass / ${fail} fail\n`)
process.exit(fail ? 1 : 0)
