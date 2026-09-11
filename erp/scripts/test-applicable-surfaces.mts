/** 설비 구분 fold가 **표면마다 제 몫의 말을 하는가** (소방계획서_43 S5-6)
 *
 *  원천은 `foldDefectGroups` 하나인데 그것을 읽는 표면은 넷이다:
 *    ① PDF 별지 9호 8쪽 (renderReport9 page8)                       — 원문 축
 *    ② 갑지 엑셀 현5 불량 세부 7행 (defectContent{row})              — 원문 축
 *    ③ PDF 별지 10호 「이행조치 계획사항」 7행 (annexPlanRows)        — 접기 축
 *    ④ 갑지 엑셀 계획서 「이행조치 사항」 7행 (planContent{row})      — 접기 축
 *
 *  🎯 **2026-09-11부터 넷이 두 짝으로 갈린다**(사용자 지시). ①②는 불량 내용 **원문**을 싣고,
 *    ③④는 불량이 있는 구분을 **「결과참조」 한 낱말**로 접는다. 갈라진 것이 결함이 아니라 계약이다 —
 *    「결과참조」가 가리키는 그 결과가 ①②에 남아 있어야 말이 되기 때문이다.
 *    ⚠ 그러므로 "네 표면이 다르다"며 통일하지 말 것. 통일해야 하는 것은 **짝 안에서**다
 *      (①=② 이고 ③=④ 인가).
 *
 *  원천이 하나여도 **표면마다 fold를 부르는 조건이 다르면** 갈라진다 — 실제로 그런 일이 있었다:
 *  10호는 `applicableGroups ?? []`로 미공급을 '전 구분 미해당'으로 읽어 7행을 전부 「해당없음」으로
 *  단정했고(2026-09-08 정정), 8쪽·현5는 공란이었다. 그래서 이 검사는 값이 아니라 **세 표면의
 *  일치**를 묻는다. 한 곳만 고치면 즉시 붉어진다([[feedback_fix_the_sibling_too]]).
 *
 *  실행: npx tsx --conditions=react-server scripts/test-applicable-surfaces.mts */
import {
  DEFECT_GROUPS, DEFECT_FOLD_TEXT, foldDefectGroups, renderReport9,
  type Report9Data, type Report9DefectRow,
} from '../src/lib/doc-templates/report9.ts'
import { annexPlanRows } from '../src/lib/report9-assemble.ts'
import { buildWorkbookValues } from '../src/lib/xlsx-workbook.ts'
import { DEFECT_GROUP_ROWS, PLAN_DATE_ROWS } from '../src/lib/xlsx-anchors.ts'
import { ETC_CODES } from '../src/lib/facility-codes.ts'
import { isMultiUseApplicable } from '../src/lib/multi-use.ts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${m}${d ? ` — ${d}` : ''}`); c ? pass++ : fail++
}

const R9_BLANK = {
  ckOp: true, ckInitial: false, ckCompEtc: false, consent: null, repRole: '',
  managerGrade: '', mgrEduDate: '', rampCount: '', main: null, assistants: [],
  hasFirePlan: false, prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false,
  insuranceJoined: null, insCompany: '', insPeriod: '', insPerson: '', insProperty: '',
  multiUseNone: false, multiUseCounts: {},
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  stairsCount: '', elvR: '', elvE: '', elvV: '',
  pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
  resultMarks: {},
}
const xlsxFold = (defectRows: Report9DefectRow[], applicableGroups?: string[]) => buildWorkbookValues({
  official: {
    company: { name: 'X', address: 'X', phone: 'X', fax: 'X' },
    docNo: 'X', sendDate: 'X', recipient: 'X', reference: 'X', sender: 'X',
    senderSign: { name: 'X', title: 'X', rep: 'X' }, year: 2026, typeLabel: 'X',
  },
  delegation: {
    typeLabel: 'X', owner: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
    agent: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
    periodLabel: 'X', daysLabel: '1일', submitDate: 'X', station: 'X',
  },
  customerAddress: 'X', startISO: '2026-09-06', endISO: '2026-09-06', useApprovalISO: null,
  installedCodes: [], evacTypes: [], building: null,
  report9: { ...R9_BLANK, defectRows, applicableGroups } as never,
})
const rowOf = (g: string) => DEFECT_GROUP_ROWS.find(r => r.group === g)!.row
/** 엑셀 계획서(별지 10호) 행 — 현5와 행 번호가 다르다(12행부터 2행 간격) */
const planRowOf = (g: string) => PLAN_DATE_ROWS.find(r => r.group === g)!.row
// renderReport9는 3쪽(설치 √)까지 그리므로 8쪽 픽스처보다 넓은 형태가 필요하다 —
// 목록은 test-defect-fold.mts의 BASE9와 같은 관례(같은 렌더를 재는 이웃)
const base9 = (defectRows: Report9DefectRow[], applicableGroups?: string[]) =>
  ({
    ...R9_BLANK, customerName: '표본',
    facilityChecks: [], muResults: {}, specs: {},
    defectRows, applicableGroups,
  }) as unknown as Report9Data

/** 8쪽 HTML에서 그 구분의 **내용 칸**을 전부 꺼낸다(서식 3열: 구분 / 점검번호 / 불량내용).
 *
 *  ⚠ 마크업이 두 모양이다 — 빈 구분은 `<td>구분</td><td>&nbsp;</td><td class="center">문구</td>`
 *    한 줄이고, 행이 있는 구분은 **첫 줄만 rowspan**을 달고 나머지 줄엔 구분 칸이 없다.
 *    한 모양만 보는 정규식은 행이 있는 구분을 통째로 '(행 없음)'으로 읽는다 — 처음에 그렇게
 *    짰다가 멀쩡한 제품을 3건 붉게 만들었다. 두 모양 모두 **마지막 <td>가 내용 칸**이라는
 *    성질을 쓴다. */
const page8Text = (html: string, g: string): string => {
  const body = html.slice(html.indexOf('4. 소방시설등 불량 세부 사항'))
  const start = body.search(new RegExp(`<td class="center"(?: rowspan="\\d+")?>${g}</td>`))
  if (start < 0) return '(행 없음)'
  // 다음 구분(또는 비고 행)까지가 이 구분의 영역
  const rest = body.slice(start)
  const nexts = DEFECT_GROUPS.filter(x => x !== g)
    .map(x => rest.search(new RegExp(`<td class="center"(?: rowspan="\\d+")?>${x}</td>`)))
    .filter(i => i > 0)
  const end = Math.min(...[...nexts, rest.indexOf('<th>비고</th>')].filter(i => i > 0))
  const slice = rest.slice(0, Number.isFinite(end) ? end : undefined)
  return (slice.match(/<tr>[\s\S]*?<\/tr>/g) ?? [slice])
    .map(tr => {
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1])
      return (tds[tds.length - 1] ?? '').replace(/&nbsp;/g, '').trim()
    })
    .filter(t => t !== '')
    .join('\n')
}

type Case = { name: string; defectRows: Report9DefectRow[]; applicable?: string[] }
const D = (group: string, code: string, content: string, userEntered: boolean): Report9DefectRow =>
  ({ group, code, content, userEntered })

const CASES: Case[] = [
  {
    name: 'A. 기타 설치됨 + 소화설비 사용자입력 + 경보 자동만',
    defectRows: [D('소화설비', '1-A-001', '소화기 지시압력 미달', true), D('경보설비', '12-A-003', '수신기', false)],
    applicable: ['소화설비', '경보설비', '피난구조설비', '기타'],
  },
  {
    name: 'B. 기타 미설치(1.4 기타 7종 체크 0) — S6-1의 반대 방향',
    defectRows: [D('소화설비', '1-A-001', '소화기', true)],
    applicable: ['소화설비'],
  },
  {
    name: 'C. 안전시설등만 해당(1.10.3 해당 토글) — S6-2',
    defectRows: [],
    applicable: ['안전시설등'],
  },
  {
    name: 'D. 전 구분 미해당',
    defectRows: [],
    applicable: [],
  },
  {
    name: 'E. applicableGroups 미공급(대장 공란) — S6-3 가드가 만드는 상태',
    defectRows: [D('소화설비', '1-A-001', '소화기', true)],
    applicable: undefined,
  },
]

/** 관측된 결과 종류 — 검사가 **판별자로 살아 있는지** 스스로 증명하는 데 쓴다.
 *  세 표면이 늘 같다는 단언은 추출기가 상수(예: 전부 '')를 돌려줘도 초록이다. 그래서
 *  '실제로 여러 값을 구별해 봤다'를 함께 단언한다([[project_soban35]] 변이축과 같은 취지). */
const seen = new Set<string>()

for (const c of CASES) {
  console.log(`── ${c.name} ──`)
  const html = renderReport9(base9(c.defectRows, c.applicable))
  const plan = annexPlanRows(base9(c.defectRows, c.applicable))
  const xv = xlsxFold(c.defectRows, c.applicable)
  const folds = c.applicable ? foldDefectGroups(c.defectRows, c.applicable) : null

  for (const g of DEFECT_GROUPS) {
    const f = folds?.get(g)
    // 기대값 = 원천이 말하는 것.
    // ⚠ applicableGroups **미공급**이면 fold를 아예 타지 않고 세 표면 모두 **원본 불량내용**을
    //   그대로 찍는다(구 호출부·픽스처 하위 호환). 그때의 기대값을 ''로 두면 멀쩡한 제품이
    //   붉어진다 — 처음에 그렇게 짰다가 E 케이스에서 걸렸다.
    const want = !folds
      ? c.defectRows.filter(r => r.group === g).map(r => r.content).join('\n')
      : f!.kind === 'rows' ? f!.rows.map(r => r.content).join('\n') : DEFECT_FOLD_TEXT[f!.kind]
    const p8 = page8Text(html, g)
    const p10 = plan.find(r => r.group === g)?.content ?? '(행 없음)'
    const x5 = String(xv.get(`defectContent${rowOf(g)}`) ?? '')
    const xPlanRaw = xv.get(`planContent${planRowOf(g)}`)
    // 🎯 접기 축의 기대값 — 불량이 있는 구분(rows·refer)은 「결과참조」.
    //   미공급(folds 없음)이면 접기를 타지 않으므로 **원문 축과 같은 값**이다(종전 거울과 같은 결과).
    //   ⚠ 엑셀 계획서 칸을 비워 둘 수는 없다 — 라우트가 `unmapped`를 코드 결함으로 보고 500을 낸다.
    const wantFold = !folds ? want
      : f!.kind === 'rows' || f!.kind === 'refer' ? DEFECT_FOLD_TEXT.refer : DEFECT_FOLD_TEXT[f!.kind]
    const xPlan = String(xPlanRaw ?? '')

    // 짝 ① — 원문 축: 8쪽 = 현5
    const rawAgree = p8 === want && x5 === want
    ok(rawAgree, `${g}: 원문 축 일치(8쪽 = 현5)`,
      rawAgree ? `「${want || '(공란)'}」` : `8쪽="${p8}" / 현5="${x5}" / 원천="${want}"`)
    // 짝 ② — 접기 축: 10호 = 계획서
    const foldAgree = p10 === wantFold && xPlan === wantFold
    ok(foldAgree, `${g}: 접기 축 일치(10호 = 엑셀 계획서)`,
      foldAgree ? `「${wantFold || '(공란)'}」` : `10호="${p10}" / 계획서="${xPlan}" / 기대="${wantFold}"`)
    // 🚨 갈라짐이 **의도대로**인가 — 불량 있는 구분에서만 두 축이 다르고, 나머지는 같아야 한다.
    //   이게 없으면 양쪽을 같은 값으로 되돌려도(=이 변경을 취소해도) 위 둘이 초록으로 통과한다.
    const shouldDiffer = !!folds && (f!.kind === 'rows') && want !== DEFECT_FOLD_TEXT.refer
    ok(shouldDiffer ? p8 !== p10 : p8 === p10,
      `${g}: 두 축의 갈라짐이 의도대로(${shouldDiffer ? '달라야' : '같아야'} 한다)`,
      `8쪽="${p8}" / 10호="${p10}"`)
    seen.add(want === '' ? '(공란)' : (Object.values(DEFECT_FOLD_TEXT) as string[]).includes(want) ? want : '(실불량내용)')
  }
}

console.log('── F. 판별자 생존 + 축 상수 자기점검 ──')
// 추출기가 상수를 돌려주면 '세 표면 일치'는 항진명제가 된다 — 5종을 실제로 구별했는지 단언한다
for (const kind of ['(실불량내용)', '결과참조', '이상없음', '해당없음', '(공란)']) {
  ok(seen.has(kind), `판별자가 「${kind}」를 실제로 구별했다`)
}
// S6-1이 읽는 목록이 실재하는가 — 비면 `some()`이 상시 false가 되어 '기타'가 영구 미해당이 된다
ok(ETC_CODES.length === 7, `ETC_CODES = ${ETC_CODES.length}종(1.4 기타 7종)`, ETC_CODES.join(', '))
// S6-2가 읽는 판정 — **개소수와 무관**해야 한다(1.10.3 '해당' 토글 하나뿐).
// ⚠ 값은 문자열 '해당'이 아니라 **불리언 true**다(multi-use.ts: `mu?.applicable === true`).
//   처음에 '해당'을 넣어 멀쩡한 함수를 붉게 만들었다 — 축의 타입부터 원문에서 확인할 것.
ok(isMultiUseApplicable({ applicable: true }) === true, '1.10.3 applicable=true면 해당')
ok(isMultiUseApplicable({ applicable: false }) === false, 'applicable=false면 미해당')
ok(isMultiUseApplicable(null) === false, '섹션 미입력(null)도 미해당 — 모름을 해당으로 올리지 않는다')
// 개소수를 담는 키가 판정에 끼어들지 않는가(hasMultiUse와 축이 다르다는 것이 S6-2의 핵심)
ok(isMultiUseApplicable({ applicable: true } as never) === true, '개소수 없이도 해당 판정 성립(S6-2)')
ok(DEFECT_GROUPS.length === DEFECT_GROUP_ROWS.length, `구분 ${DEFECT_GROUPS.length}종 = 현5 행 ${DEFECT_GROUP_ROWS.length}개`)

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed · ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
