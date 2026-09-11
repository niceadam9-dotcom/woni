/** 소방계획서_41 — 별지 9호 8쪽 「불량내용」 4상태 fold 검증
 *
 *  [1] foldDefectGroups 단위 — ①사용자 행만 ②결과참조 ③이상없음 ④해당없음 + 혼재 그룹
 *  [2] PDF page8 — renderReport9 HTML에서 그룹별 문구·행 접기 단언
 *  [3] 갑지 엑셀 — buildWorkbookValues 값맵의 defectCode·defectContent 칸 + defectOverflow 분모
 *  [4] 대조군 — applicableGroups 미공급(구 호출부·픽스처) 경로는 **무변경**
 *  [5] 조립 규칙 isUserEnteredDefectName — **픽스처가 아니라 실제 스탬프 규칙**을 탄다
 *  [6] 별지 10호 7행(annexPlanRows) — 미공급이면 자동 문구를 쓰지 않는다
 *
 *  ⚠ [5]가 있는 이유: [1]~[4]는 userEntered를 손으로 박은 픽스처만 봐서, 쓰기 경로가 메모 없는
 *    X행에 항목명을 굳히는 바람에 「결과참조」가 발화하지 않던 실결함을 23/23 초록인 채 통과시켰다.
 *
 *  실행: npx tsx --conditions=react-server scripts/test-defect-fold.mts */
import {
  DEFECT_FOLD_TEXT, DEFECT_GROUPS, foldDefectGroups, renderReport9,
  type Report9Data, type Report9DefectRow,
} from '../src/lib/doc-templates/report9.ts'
import { isUserEnteredDefectName, annexPlanRows } from '../src/lib/report9-assemble.ts'
import { buildWorkbookValues, defectOverflow, DEFECT_ROWS_PER_GROUP } from '../src/lib/xlsx-workbook.ts'
import { DEFECT_GROUP_ROWS } from '../src/lib/xlsx-anchors.ts'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const userRow: Report9DefectRow = { group: '소화설비', code: '1-A-001', content: '소화기 지시압력 미달', userEntered: true }
const autoRow: Report9DefectRow = { group: '소화설비', code: '1-A-002', content: '항목명 폴백 자동행', userEntered: false }
const alarmAuto: Report9DefectRow = { group: '경보설비', code: '15-A-001', content: '감지기 항목명', userEntered: false }
const MIXED = [userRow, autoRow, alarmAuto]
const APPLICABLE = ['소화설비', '경보설비', '피난구조설비']

// ── [1] fold 단위 ─────────────────────────────────────────────────────
console.log('[1] foldDefectGroups 4상태')
{
  const f = foldDefectGroups(MIXED, APPLICABLE)
  check('전 그룹이 판정된다(7종)', DEFECT_GROUPS.every(g => f.has(g)))
  const ext = f.get('소화설비')!
  check('① 혼재 그룹 — 사용자 입력 행만 남는다',
    ext.kind === 'rows' && ext.rows.length === 1 && ext.rows[0].code === '1-A-001',
    JSON.stringify(ext))
  check('② 불량 있음+입력 전무 → 결과참조', f.get('경보설비')!.kind === 'refer')
  check('③ 불량 없음+해당 → 이상없음', f.get('피난구조설비')!.kind === 'ok')
  check('④ 불량 없음+미해당 → 해당없음(소화용수·소화활동·기타·안전시설등)',
    (['소화용수설비', '소화활동설비', '기타', '안전시설등'] as const).every(g => f.get(g)!.kind === 'na'))
  check('기타에 불량이 있으면 ①/②는 산다',
    foldDefectGroups([{ group: '기타', code: '', content: '수기 사유', userEntered: true }], APPLICABLE)
      .get('기타')!.kind === 'rows')
  check('userEntered 미표기(구 데이터)는 자동행 취급 → 결과참조',
    foldDefectGroups([{ group: '소화설비', code: '1-A-001', content: 'x' }], APPLICABLE).get('소화설비')!.kind === 'refer')
}

// ── [2] PDF page8 ────────────────────────────────────────────────────
console.log('[2] PDF 8쪽 렌더')
const r9base = {
  ckOp: true, ckInitial: false, ckCompEtc: false,
  customerName: '접기검증빌딩', purpose: '', address: '', inspPeriod: '', inspDays: '',
  companyName: '', companyPhone: '', consent: null, reportEmail: '',
  main: null, assistants: [], reportDate: '', submitTo: '',
  repRole: '', ownerName: '', ownerPhone: '', managerGrade: '',
  mgrName: '', mgrPhone: '', mgrEduDate: '',
  hasFirePlan: false, prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false,
  insuranceJoined: null, insCompany: '', insPeriod: '', insPerson: '', insProperty: '',
  multiUseNone: false, multiUseCounts: {}, permitDate: '', useApprovalDate: '',
  totalArea: '', buildingArea: '', households: '', floorsAbove: '', floorsBelow: '',
  heightM: '', buildingCount: '',
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  elvR: '', elvE: '', elvV: '', pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
  rampCount: '', stairsCount: '',
  facilityChecks: [], resultMarks: {}, muResults: {}, specs: {}, defectRows: [],
} as unknown as Report9Data
{
  const html = renderReport9({ ...r9base, defectRows: MIXED, applicableGroups: APPLICABLE })
  check('① 사용자 입력 불량은 그 행 그대로(rowspan=1·점검번호)',
    /rowspan="1">소화설비<\/td><td class="center">1-A-001<\/td><td>소화기 지시압력 미달<\/td>/.test(html))
  check('① 자동 폴백 행은 개별 인쇄하지 않는다', !html.includes('항목명 폴백 자동행'))
  // 2026-09-08 F-4 — 자동 문구 칸은 .defect-auto(빨강+자간)를 함께 단다. 단언도 같이 옮긴다
  // (클래스를 바꾸고 단언을 안 고치면 그날부터 스위트가 빨강이 된다 — `6011144` 전례)
  check('② 결과참조 — 점검번호 공란 1행',
    /<td class="center">경보설비<\/td><td>&nbsp;<\/td><td class="center defect-auto">결과참조<\/td>/.test(html))
  check('③ 이상없음', /<td class="center">피난구조설비<\/td><td>&nbsp;<\/td><td class="center defect-auto">이상없음<\/td>/.test(html))
  check('④ 해당없음(기타 포함 — Q-1 확정)',
    (['소화용수설비', '소화활동설비', '기타', '안전시설등'] as const).every(g =>
      new RegExp(`<td class="center">${g}</td><td>&nbsp;</td><td class="center defect-auto">해당없음</td>`).test(html)))

  // ── F-4 스타일 축(목업 image-61 빨강+자간) — 양방향으로 단언한다 ──
  check('F-4 .defect-auto 규칙이 문서 CSS에 실린다(빨강+자간)',
    /\.defect-auto\s*\{[^}]*color:\s*#FF0000[^}]*letter-spacing:/i.test(html))
  check('F-4 사람이 쓴 불량내용 칸에는 안 붙는다',
    html.includes('<td>소화기 지시압력 미달</td>')
    && !/defect-auto"[^>]*>소화기 지시압력 미달/.test(html))
  check('F-4 붙은 칸 수 = 자동 문구 행 수(6) — 공란 칸에는 안 붙는다',
    (html.match(/class="center defect-auto"/g) ?? []).length === 6,
    `실제 ${(html.match(/class="center defect-auto"/g) ?? []).length}`)
}

// ── [3] 갑지 엑셀 값맵 ────────────────────────────────────────────────
console.log('[3] buildWorkbookValues (현5)')
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
  resultMarks: {},
}
const valueMap = (report9: R9) => buildWorkbookValues({
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
  installedCodes: [], evacTypes: [], building: null, report9,
})
const rowOf = (group: string) => DEFECT_GROUP_ROWS.find(r => r.group === group)!.row
{
  const v = valueMap({ ...R9_BLANK, defectRows: MIXED, applicableGroups: APPLICABLE })
  check('① 사용자 행만 접힌다(코드·내용 짝 유지)',
    v.get(`defectCode${rowOf('소화설비')}`) === '1-A-001'
    && v.get(`defectContent${rowOf('소화설비')}`) === '소화기 지시압력 미달')
  check('② 결과참조 — 번호 칸 null·내용 칸 문구',
    v.get(`defectCode${rowOf('경보설비')}`) === null
    && v.get(`defectContent${rowOf('경보설비')}`) === DEFECT_FOLD_TEXT.refer)
  check('③ 이상없음', v.get(`defectContent${rowOf('피난구조설비')}`) === DEFECT_FOLD_TEXT.ok)
  check('④ 해당없음(기타 포함)',
    (['소화용수설비', '소화활동설비', '기타', '안전시설등'] as const)
      .every(g => v.get(`defectContent${rowOf(g)}`) === DEFECT_FOLD_TEXT.na))
}
{
  // defectOverflow 분모 = 인쇄 대상 행(fold) — 사용자 7행이면 넘치고, 자동 7행(결과참조 1행)은 안 넘친다
  const seven = (user: boolean) => Array.from({ length: 7 }, (_, i): Report9DefectRow =>
    ({ group: '소화설비', code: `1-A-00${i}`, content: `불량${i}`, userEntered: user }))
  check('overflow — 사용자 7행은 상한 초과분을 알린다',
    defectOverflow(seven(true), APPLICABLE).some(o => o.group === '소화설비' && o.dropped === 7 - DEFECT_ROWS_PER_GROUP))
  check('overflow — 자동 7행은 결과참조 1행이라 넘치지 않는다',
    defectOverflow(seven(false), APPLICABLE).length === 0)
  check('overflow — 구 호출(미공급)은 종전 분모(전 행)',
    defectOverflow(seven(false)).some(o => o.group === '소화설비' && o.dropped === 7 - DEFECT_ROWS_PER_GROUP))
}

// ── [4] 대조군 — applicableGroups 미공급이면 종전과 동일 ──────────────
console.log('[4] 대조군(구 경로 무변경)')
{
  const html = renderReport9({ ...r9base, defectRows: MIXED })
  // ⚠ 문서 전체가 아니라 8쪽 구간만 본다 — 2쪽 다중이용업 「해당없음」 라벨이 원래 있다
  const p8 = html.slice(html.indexOf('4. 소방시설등 불량 세부 사항'), html.indexOf('점검번호는 소방시설등'))
  check('PDF — 전 행 인쇄(자동 폴백 행 포함)·rowspan=2', /rowspan="2">소화설비<\/td>/.test(p8) && p8.includes('항목명 폴백 자동행'))
  check('PDF — 8쪽에 자동 문구 3종이 나오지 않는다',
    !p8.includes(DEFECT_FOLD_TEXT.refer) && !p8.includes(DEFECT_FOLD_TEXT.ok) && !p8.includes(DEFECT_FOLD_TEXT.na))
  const v = valueMap({ ...R9_BLANK, defectRows: MIXED })
  check('엑셀 — 전 행 접기(종전 join)·빈 그룹 null 유지',
    v.get(`defectCode${rowOf('소화설비')}`) === '1-A-001\n1-A-002'
    && v.get(`defectContent${rowOf('피난구조설비')}`) === null)
  const blank = valueMap(R9_BLANK)
  check('엑셀 — defectRows 자체 미공급도 종전 그대로(전 행 null)',
    DEFECT_GROUP_ROWS.every(({ row }) => blank.get(`defectCode${row}`) === null && blank.get(`defectContent${row}`) === null))
}

// ── [5] 조립 스탬프 규칙(실제 함수) ──────────────────────────────────
console.log('[5] isUserEnteredDefectName — 쓰기 경로 폴백 사슬 대조')
{
  const CODE = '15-A-004'
  const ITEM = '수신기 도통시험 회로 정상 여부'   // 점검표 항목명 = 질문문
  const CAT = '주경종 불량'                        // defect_catalog.description
  check('메모(사람이 적은 문구) → 사람 입력', isUserEnteredDefectName('감지기 탈락', CODE, ITEM))
  check('카탈로그 문구 → 사람 입력으로 인정(2026-09-08 확정)', isUserEnteredDefectName(CAT, CODE, ITEM))
  check('항목명 폴백(질문문) → 자동 = 결과참조', !isUserEnteredDefectName(ITEM, CODE, ITEM))
  check('이름=코드 유물 → 자동', !isUserEnteredDefectName(CODE, CODE, ITEM))
  check('빈 이름·공백만 → 자동', !isUserEnteredDefectName('', CODE, ITEM) && !isUserEnteredDefectName('   ', CODE, ITEM)
    && !isUserEnteredDefectName(null, CODE, ITEM) && !isUserEnteredDefectName(undefined, CODE, ITEM))
  check('항목명을 모르면 이름을 지우지 않는다(폴백 사슬 밖)', isUserEnteredDefectName(ITEM, CODE, undefined))
  // 이 규칙이 fold와 실제로 이어지는지 — 항목명이 이름인 행만 있는 그룹은 결과참조
  const autoByRule: Report9DefectRow = {
    group: '경보설비', code: CODE, content: ITEM,
    userEntered: isUserEnteredDefectName(ITEM, CODE, ITEM),
  }
  check('규칙 → fold 연결: 항목명뿐인 그룹은 결과참조',
    foldDefectGroups([autoByRule], APPLICABLE).get('경보설비')!.kind === 'refer')
}

// ── [6] 별지 10호 7행 ────────────────────────────────────────────────
console.log('[6] annexPlanRows(별지 10호 계획사항)')
{
  const supplied = annexPlanRows({ ...r9base, defectRows: MIXED, applicableGroups: APPLICABLE })
  /* 🎯 2026-09-11 — 10호는 8쪽과 **일부러 다르다**: 불량이 있는 구분(rows·refer)을 「결과참조」로
   *   접는다(사용자 지시). 종전 계약은 「소화설비 = '소화기 지시압력 미달'」로, 8쪽과 같은 문구였다.
   *   원문은 8쪽·현5가 계속 싣는다 — 두 축의 갈라짐 자체는 test-applicable-surfaces가 본다. */
  check('공급 시 불량 있는 구분은 「결과참조」로 접힌다(8쪽과 갈라지는 축)',
    supplied.find(r => r.group === '경보설비')!.content === DEFECT_FOLD_TEXT.refer
    && supplied.find(r => r.group === '기타')!.content === DEFECT_FOLD_TEXT.na
    && supplied.find(r => r.group === '소화설비')!.content === DEFECT_FOLD_TEXT.refer)
  // 🚨 음성 — 원문이 10호로 새면 접기가 풀린 것이다(되돌리면 여기가 붉어진다)
  check('(음성) 불량 내용 원문이 10호 7행에 없다',
    supplied.every(r => !r.content.includes('소화기 지시압력 미달')),
    JSON.stringify(supplied.map(r => r.content)))
  const bare = annexPlanRows({ ...r9base, defectRows: MIXED })
  check('미공급이면 자동 문구 0 — 「해당없음」 단정 금지(2026-09-08 정정)',
    bare.every(r => !Object.values(DEFECT_FOLD_TEXT).includes(r.content)),
    JSON.stringify(bare.map(r => r.content)))
  check('미공급이면 그 구분의 불량을 그대로 싣는다',
    bare.find(r => r.group === '소화설비')!.content === '소화기 지시압력 미달\n항목명 폴백 자동행'
    && bare.find(r => r.group === '피난구조설비')!.content === '')
}

console.log(`\n결과: ${pass}/${pass + fail}${fail ? ` — 실패 ${fail}` : ''}`)
process.exit(fail ? 1 : 0)
