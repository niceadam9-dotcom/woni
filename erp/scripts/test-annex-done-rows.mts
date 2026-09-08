/** 별지 11호 완료 축 단일 원천 검사 (소방계획서_43 S5-1)
 *  판정 축: ①5상태(rows/refer/ok/na)가 규칙대로 갈린다 ②엑셀 4행 접기가 앞 3건 + 「외 N건」
 *  ③내용·일자가 **같은 인덱스**로 잘려 짝이 유지된다 ④문구 행은 일자 칸 공란 ⑤overflow 건수
 *  ⑥PDF는 접지 않는다(전건) ⑦갑지 엑셀 8칸 entries가 접힌 결과와 일치
 *  실행: npx tsx scripts/test-annex-done-rows.mts */
import { annexDoneRows } from '../src/lib/report9-assemble'
import { doneCells, DONE_CELL_ROWS, DEFECT_FOLD_TEXT, type AnnexDone } from '../src/lib/doc-templates/report9'
import { DONE_ROWS } from '../src/lib/xlsx-anchors'
import { buildWorkbookValues, doneOverflow } from '../src/lib/xlsx-workbook'
import { renderReport11, type Annex1011Data } from '../src/lib/doc-templates/report1011'
import { kdate } from '../src/lib/report9-assemble'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  ✅ ${m}`) } else { fail++; console.log(`  ❌ ${m}`) } }

const d = (name: string, taken: string | null, at: string | null) =>
  ({ defect_name: name, action_taken: taken, action_completed_at: at })

console.log('── A. 5상태 ──')
// ① 완료 건 있음
const s1 = annexDoneRows([d('소화기 불량', '소화기 교체', '2026-08-20')], { hasAnyDefect: true, applicable: true })
ok(s1.kind === 'rows' && s1.rows.length === 1, '① 완료 건 있음 → rows')
ok(s1.rows[0]?.content === '소화기 교체', '① 내용은 action_taken')
ok(s1.rows[0]?.doneISO === '2026-08-20', '① 일자는 action_completed_at(ISO 10자)')
// ② action_taken 공란 → defect_name 폴백 (E11-3 규약 — 경고는 라우트가 따로 낸다)
const s2 = annexDoneRows([d('소화기 불량', null, '2026-08-20')], { hasAnyDefect: true, applicable: true })
ok(s2.rows[0]?.content === '소화기 불량', '② action_taken 공란 → defect_name 폴백')
// ③ 불량 있음 · 완료 0건
const s3 = annexDoneRows([d('소화기 불량', '소화기 교체', null)], { hasAnyDefect: true, applicable: true })
ok(s3.kind === 'refer' && s3.rows.length === 0, '③ 불량 있음·완료 0 → refer')
// ④ 불량 0건 + 대상
const s4 = annexDoneRows([], { hasAnyDefect: false, applicable: true })
ok(s4.kind === 'ok', '④ 불량 0건 + 소방시설 대상 → ok(이상없음)')
// ⑤ 미대상
const s5 = annexDoneRows([], { hasAnyDefect: false, applicable: false })
ok(s5.kind === 'na', '⑤ 미대상 → na(해당없음)')
// 어휘가 DEFECT_FOLD_TEXT 키와 정확히 같다 — 새 어휘가 끼어들 자리가 없다는 것이 S1-1의 축
ok((['refer', 'ok', 'na'] as const).every(k => k in DEFECT_FOLD_TEXT), 'kind 어휘 ≡ DEFECT_FOLD_TEXT 키')

console.log('── B. 문구 행의 일자 칸 ──')
for (const f of [s3, s4, s5]) {
  const c = doneCells(f)
  ok(c.cells.length === 1 && c.cells[0].content === DEFECT_FOLD_TEXT[f.kind as 'refer' | 'ok' | 'na'],
    `${f.kind} → 문구 1행 「${DEFECT_FOLD_TEXT[f.kind as 'refer' | 'ok' | 'na']}」`)
  ok(c.cells[0].doneISO === '', `${f.kind} → 일자 칸 공란(날짜 자리표 금지)`)
}

console.log('── C. 4행 접기 ──')
const many = (n: number) => Array.from({ length: n }, (_, i) => d(`불량${i + 1}`, `조치${i + 1}`, `2026-08-${String(i + 1).padStart(2, '0')}`))
// 개수 하한 선단언 — 공허 통과 방지([[feedback_exhaustive_has_an_axis]])
ok(DONE_CELL_ROWS === 4 && DONE_ROWS.length === 4, `분모 확인: DONE_CELL_ROWS=${DONE_CELL_ROWS} · DONE_ROWS=${DONE_ROWS.length}칸`)
ok(DONE_ROWS.join(',') === '19,20,21,22', `앵커 행 = ${DONE_ROWS.join(',')} (서식 실측 r19~r22)`)

for (const n of [1, 2, 3, 4]) {
  const c = doneCells(annexDoneRows(many(n), { hasAnyDefect: true, applicable: true }))
  ok(c.cells.length === n && c.overflow === 0, `${n}건 → ${n}행 그대로·overflow 0`)
  ok(c.cells.every((x, i) => x.content === `조치${i + 1}`), `${n}건 → 순서 보존`)
}
const c5 = doneCells(annexDoneRows(many(5), { hasAnyDefect: true, applicable: true }))
ok(c5.cells.length === 4, '5건 → 4행')
ok(c5.cells.slice(0, 3).map(x => x.content).join('|') === '조치1|조치2|조치3', '5건 → 앞 3건 그대로')
ok(c5.cells[3].content === '외 2건 (별첨 참조)', `5건 → 4행 「외 2건 (별첨 참조)」 (실제 "${c5.cells[3].content}")`)
ok(c5.overflow === 2, '5건 → overflow 2 (4행에 못 실린 건수)')
ok(c5.cells[3].doneISO === '', '접기 행 → 일자 칸 공란')
const c9 = doneCells(annexDoneRows(many(9), { hasAnyDefect: true, applicable: true }))
ok(c9.cells[3].content === '외 6건 (별첨 참조)' && c9.overflow === 6, '9건 → 「외 6건」·overflow 6')

console.log('── D. 내용·일자 짝 유지(같은 인덱스로 자름) ──')
ok(c5.cells.every((x, i) => i >= 3 || x.doneISO === `2026-08-0${i + 1}`),
  '접힌 3행의 일자가 자기 조치의 일자다(남의 날짜가 붙지 않는다)')
// 역방향 — 일자만 있고 내용이 다른 순서였다면 잡혔어야 한다
ok(c5.cells[0].doneISO === '2026-08-01' && c5.cells[2].doneISO === '2026-08-03', '1·3행 일자 대조')

console.log('── E. PDF는 접지 않는다(전건) ──')
const pdf9 = annexDoneRows(many(9), { hasAnyDefect: true, applicable: true })
ok(pdf9.rows.length === 9, `annexDoneRows는 전건 반환(${pdf9.rows.length}건) — 접기는 doneCells만`)

console.log('── F. 갑지 엑셀 8칸 배선 ──')
// 픽스처 형태는 test-defect-fold.mts의 R9_BLANK/valueMap과 같은 관례를 따른다(같은 함수를 재는 이웃).
type R9 = Parameters<typeof buildWorkbookValues>[0]['report9']
const R9_BLANK: R9 = {
  ckOp: true, ckInitial: false, ckCompEtc: false, consent: null, repRole: '',
  managerGrade: '', mgrEduDate: '', rampCount: '', main: null, assistants: [],
  hasFirePlan: false, prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false,
  insuranceJoined: null, insCompany: '', insPeriod: '', insPerson: '', insProperty: '',
  multiUseNone: false, multiUseCounts: {},
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  stairsCount: '', elvR: '', elvE: '', elvV: '',
  pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
  resultMarks: {}, defectRows: [],
}
const mkSrc = (done?: AnnexDone) => buildWorkbookValues({
  official: {
    company: { name: 'X', address: 'X', phone: 'X', fax: 'X' },
    docNo: '승 진 2609-1', sendDate: 'X', recipient: 'X', reference: 'X', sender: 'X',
    senderSign: { name: 'X', title: 'X', rep: 'X' }, year: 2026, typeLabel: 'X',
  },
  delegation: {
    typeLabel: 'X', owner: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
    agent: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
    periodLabel: 'X', daysLabel: '1일', submitDate: 'X', station: 'X',
  },
  customerAddress: 'X', startISO: '2026-09-06', endISO: '2026-09-06', useApprovalISO: null,
  installedCodes: [], evacTypes: [], building: null,
  report9: { ...R9_BLANK, done },
})
const vFull = mkSrc(annexDoneRows(many(5), { hasAnyDefect: true, applicable: true }))
ok(DONE_ROWS.every(r => vFull.has(`doneContent${r}`) && vFull.has(`doneDate${r}`)), '8칸 전부 entries에 존재')
ok(vFull.get('doneContent19') === '조치1', 'B19 = 조치1')
ok(vFull.get('doneContent22') === '외 2건 (별첨 참조)', 'B22 = 「외 2건 (별첨 참조)」')
ok(typeof vFull.get('doneDate19') === 'number', 'I19 = 날짜 시리얼(숫자)')
ok(vFull.get('doneDate22') === ' ', 'I22 = 공백 1칸(접기 행은 일자 없음)')

const vNa = (mkSrc(annexDoneRows([], { hasAnyDefect: false, applicable: false })))
ok(vNa.get('doneContent19') === '해당없음', 'na → B19 「해당없음」')
ok(vNa.get('doneContent20') === ' ' && vNa.get('doneContent22') === ' ', 'na → 나머지 3행 공백 1칸(빈 셀 금지 — 0으로 읽힌다)')
ok(DONE_ROWS.every(r => vNa.get(`doneDate${r}`) === ' '), 'na → 일자 4칸 전부 공백 1칸')

// 미공급(구 호출부·픽스처) — 종전 빈 서식과 같아야 한다(대조군 보호)
const vNone = (mkSrc(undefined))
ok(DONE_ROWS.every(r => vNone.get(`doneContent${r}`) === ' ' && vNone.get(`doneDate${r}`) === ' '),
  'done 미공급 → 8칸 전부 공백 1칸(하위 호환)')

console.log('── G. 대조군 — ①② PDF 11호는 무손상(바이트 동일) ──')
// 기준선은 **sha 상수로 박는다**. `HEAD:`로 잡으면 이 수리가 커밋되는 순간 원문이 사라져
// 검사가 영구히 깨진다([[feedback_probe_baseline_pin]]). 아래 4줄은 `cf7319f`의
// report9-actions.ts:117-122(별지 11호 분기)를 **축자 복사**한 것이다.
const BASELINE_SHA = 'cf7319f'
const baselineRows = (defects: Array<{ defect_name: string; action_taken: string | null; action_completed_at: string | null }>) => {
  const done = defects.filter(d => d.action_completed_at)
  return done.map(d => ({
    content: d.action_taken || d.defect_name || '',
    period: d.action_completed_at ? kdate(d.action_completed_at.slice(0, 10)) : '',
  }))
}
const currentRows = (defects: Array<{ defect_name: string; action_taken: string | null; action_completed_at: string | null }>) => {
  const f = annexDoneRows(defects, { hasAnyDefect: true, applicable: true })
  return f.kind === 'rows'
    ? f.rows.map(r => ({ content: r.content, period: r.doneISO ? kdate(r.doneISO) : '' }))
    : [{ content: DEFECT_FOLD_TEXT[f.kind], period: '' }]
}
const base11: Annex1011Data = {
  customerName: '서림사', purpose: '문화및집회시설', address: '경기 양평군 강상면 가레밭골길 40',
  ownerName: '홍길동2', ownerPhone: '010-1234-3432', mgrName: '홍길동2', mgrPhone: '010-1234-3432',
  rows: [], reportDate: '2026년 7월 23일', submitTo: '양평소방서장',
}
const CASES: Array<[string, Array<{ defect_name: string; action_taken: string | null; action_completed_at: string | null }>]> = [
  ['① 완료 1건', [d('소화기 불량', '소화기 교체', '2026-08-20')]],
  ['① 완료 3건', [d('a', '조치a', '2026-08-20'), d('b', '조치b', '2026-08-21'), d('c', '조치c', '2026-08-22')]],
  ['① 완료 9건(PDF는 접지 않는다)', many(9)],
  ['② action_taken 공란 → 불량명 폴백', [d('소화기 불량', null, '2026-08-20')]],
  ['② 완료·미완료 혼재(미완료는 탈락)', [d('a', '조치a', '2026-08-20'), d('b', '조치b', null)]],
  // Q-4 축 — 공백만 든 action_taken은 **종전 그대로** 통과시킨다(b안: 대조군 완전 동일 우선)
  ['② action_taken 공백문자만 — 종전 동작 보존(Q-4 b안)', [d('소화기 불량', '   ', '2026-08-20')]],
]
for (const [name, defects] of CASES) {
  const a = renderReport11({ ...base11, rows: baselineRows(defects) })
  const b = renderReport11({ ...base11, rows: currentRows(defects) })
  ok(a === b, `${name} — ${BASELINE_SHA} 렌더와 바이트 동일 (${a.length}자)`)
}
// 대조군이 공허하지 않다는 증거 — 의도된 변경(③)에서는 **갈라져야** 한다
{
  const onlyOpen = [d('소화기 불량', '소화기 교체', null)]
  const a = renderReport11({ ...base11, rows: baselineRows(onlyOpen) })
  const b = renderReport11({ ...base11, rows: currentRows(onlyOpen) })
  ok(a !== b && b.includes('결과참조'), '③ 완료 0건은 **의도적으로 갈라진다**(대조군이 항진명제가 아니라는 증거)')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed · ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
