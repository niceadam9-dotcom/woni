/** ④ 「총 이행기간 (수동 보정)」이 갑지 엑셀까지 닿는가 (2026-09-10 사용자 지시)
 *
 *  왜 새로 만드는가 — **이 축을 단언하는 검사가 하나도 없었다.** `test-report10-plan-rows`는
 *  PDF HTML만 보고, `test-xlsx-anchors`는 칸이 있는지만 본다. 그래서 엑셀이 수기값을 통째로
 *  무시하고 자동 산출값을 찍는 동안 두 스위트 모두 초록이었다.
 *
 *  판정 축:
 *   A. 파싱·일수 — 완성 날짜 두 개일 때만 기간, 일수는 양끝 포함
 *   B. 음성 — 자유 텍스트·한쪽만·역전(종료<시작)·비문자열은 전부 null
 *   C. 우선순위 — 수기 > 자동, 수기 없으면 자동
 *   D. **착지** — 수기 기간이 개요 4칸(G9·I9·J9·G10)과 계획서 21칸에 실제로 실린다
 *   E. **대조군** — 자동값과 다를 때 수기가 이긴다(같은 값으로 재면 아무것도 증명 못 한다)
 *   F. **서식 항등** — G10 = I9, 그리고 I9 = G9 + J9 - 1
 *
 *  실행: npx tsx scripts/test-annex-total-period.mts */
import { manualActionPeriod, resolveActionPeriod, unifyDoneDates } from '../src/lib/annex-total-period'
import { buildWorkbookValues } from '../src/lib/xlsx-workbook'
import { PLAN_DATE_ROWS, DONE_ROWS } from '../src/lib/xlsx-anchors'
import { actionPlanPeriod, annexDoneRows } from '../src/lib/report9-assemble'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  ✅ ${m}`) } else { fail++; console.log(`  ❌ ${m}`) } }

console.log('── A. 파싱·일수 ──')
const p1 = manualActionPeriod({ totalPeriod: '2026-08-05 ~ 2026-08-14' })
ok(p1?.startISO === '2026-08-05', `시작일 = 2026-08-05 (실제 ${p1?.startISO})`)
ok(p1?.endISO === '2026-08-14', `종료일 = 2026-08-14 (실제 ${p1?.endISO})`)
ok(p1?.days === 10, `일수 = 10 (양끝 포함, 실제 ${p1?.days})`)
ok(manualActionPeriod({ totalPeriod: '2026-08-05~2026-08-14' })?.days === 10, '구분자 공백 없어도 같다(splitRange 단일 원천)')
ok(manualActionPeriod({ totalPeriod: '2026-08-05 ~ 2026-08-05' })?.days === 1, '당일 시작·종료 → 1일(하루짜리 이행은 정상 업무)')
// 자동 산출(actionPlanPeriod)과 **같은 셈법**이라야 수기/자동이 같은 날짜에서 같은 일수를 낸다
const auto1 = actionPlanPeriod([{ action_start: '2026-08-05', action_end: '2026-08-14' }])
ok(auto1?.days === p1?.days, `자동 산출과 일수 셈법 일치 (자동 ${auto1?.days} ≡ 수기 ${p1?.days})`)

console.log('── B. 음성 — 값이 없어야 하는 경우 ──')
ok(manualActionPeriod({}) === null, '칸 자체가 없으면 null')
ok(manualActionPeriod({ totalPeriod: '' }) === null, '빈 문자열 → null')
ok(manualActionPeriod({ totalPeriod: '8월 중' }) === null, '과거 자유 텍스트 → null (엑셀 날짜 칸은 serial이라 실을 수 없다)')
ok(manualActionPeriod({ totalPeriod: '2026-08-05 ~ ' }) === null, '한쪽만 완성 → null')
ok(manualActionPeriod({ totalPeriod: ' ~ 2026-08-14' }) === null, '시작만 비어도 null')
ok(manualActionPeriod({ totalPeriod: '2026-08-14 ~ 2026-08-05' }) === null, '🚨 역전(종료<시작) → null (음수 일수가 인쇄물에 실리면 안 된다)')
ok(manualActionPeriod({ totalPeriod: 20260805 as unknown as string }) === null, '비문자열 → null')

console.log('── C. 우선순위(수기 > 자동) ──')
const AUTO = { startISO: '2026-07-01', endISO: '2026-07-03', days: 3 }
ok(resolveActionPeriod({ totalPeriod: '2026-08-05 ~ 2026-08-14' }, AUTO)?.startISO === '2026-08-05', '수기 있으면 수기')
ok(resolveActionPeriod({}, AUTO)?.startISO === '2026-07-01', '수기 없으면 자동')
ok(resolveActionPeriod({ totalPeriod: '8월 중' }, AUTO)?.startISO === '2026-07-01', '수기가 판정 불가면 자동으로 떨어진다')
ok(resolveActionPeriod({}, null) === null, '둘 다 없으면 null')

console.log('── D·E·F. 갑지 엑셀 착지 (대조군 대조) ──')
type R9 = Parameters<typeof buildWorkbookValues>[0]['report9']
// 픽스처 형태는 test-annex-done-rows.mts의 R9_BLANK와 같은 관례(같은 함수를 재는 이웃)
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
// 계획 건이 **있는** 그룹 하나 — 없으면 계획서 21칸이 전부 공란이라 D가 공허 통과한다
const GROUP = PLAN_DATE_ROWS[0].group
const mk = (period: { startISO: string; endISO: string; days: number } | null) => buildWorkbookValues({
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
  report9: {
    ...R9_BLANK,
    defectRows: [{ group: GROUP, code: 'A-1', content: '소화기 불량' }],
    actionPeriod: period,
  },
})

// 대조군 — 자동값만 넣었을 때
const vAuto = mk(AUTO)
// 실험군 — 라우트가 resolveActionPeriod로 얹은 수기값
const MANUAL = manualActionPeriod({ totalPeriod: '2026-08-05 ~ 2026-08-14' })!
const vMan = mk(MANUAL)

// 선단언: 두 기간이 실제로 다르다 — 같은 값으로 재면 아래 전부가 항진명제가 된다
ok(AUTO.startISO !== MANUAL.startISO && AUTO.days !== MANUAL.days,
  `분모 확인: 자동(${AUTO.startISO}~${AUTO.endISO}·${AUTO.days}일) ≠ 수기(${MANUAL.startISO}~${MANUAL.endISO}·${MANUAL.days}일)`)

const num = (m: Map<string, unknown>, k: string) => m.get(k) as number
console.log('  · D. 개요 4칸')
ok(typeof num(vMan, 'actionStartSerial') === 'number', 'G9 = 날짜 시리얼(숫자)')
ok(num(vMan, 'actionStartSerial') !== num(vAuto, 'actionStartSerial'), '🎯 G9(시작)이 수기값을 따른다 — 자동값과 다르다')
ok(num(vMan, 'actionEndSerial') !== num(vAuto, 'actionEndSerial'), '🎯 I9(종료)가 수기값을 따른다')
ok(num(vMan, 'actionDays') === MANUAL.days, `🎯 J9(일수) = ${MANUAL.days} (실제 ${num(vMan, 'actionDays')})`)
ok(num(vMan, 'actionDoneSerial') !== num(vAuto, 'actionDoneSerial'), '🎯 G10(이행조치일자)이 수기값을 따른다 — 사용자가 신고한 바로 그 칸')

console.log('  · F. 서식 항등')
ok(num(vMan, 'actionDoneSerial') === num(vMan, 'actionEndSerial'),
  'G10 = I9 (서식 원문 수식 — 「이행조치일자」는 이행기간 종료일이다)')
ok(num(vMan, 'actionEndSerial') === num(vMan, 'actionStartSerial') + num(vMan, 'actionDays') - 1,
  'I9 = G9 + J9 - 1 (엑셀에서 재계산해도 종료일이 안 움직인다)')
// 자동값에서도 같은 항등이 서야 한다 — 항등이 수기 경로에만 성립하면 그건 우연이다
ok(num(vAuto, 'actionEndSerial') === num(vAuto, 'actionStartSerial') + num(vAuto, 'actionDays') - 1,
  '(자동 경로에서도) I9 = G9 + J9 - 1')

console.log('  · D. 계획서 7행 21칸')
const row0 = PLAN_DATE_ROWS[0].row
ok(num(vMan, `planStart${row0}`) === num(vMan, 'actionStartSerial'),
  `계획 있는 행(r${row0})의 일자 = 총 이행기간 (7행이 하나의 기간을 공유한다)`)
ok(num(vMan, `planDays${row0}`) === MANUAL.days, `계획 있는 행의 일수 = ${MANUAL.days}`)
ok(num(vMan, `planStart${row0}`) !== num(vAuto, `planStart${row0}`), '🎯 계획서 일자도 수기값을 따른다')
/* 🚨 2026-09-11 **계약 교체**(지우지 않고 반대로 세운다) — 사용자: "엑셀도 동일합니다".
 *   종전 계약: 「계획 없는 6개 구분은 공란 그대로」. 이제 PDF 10호 7행과 같이 **불량 유무와
 *   무관하게 21칸 전부 총 이행기간**이다.
 *   ⭐ 이로써 2026-09-10의 **의도된 D-7 예외가 해소**됐다 — 그때는 PDF가 「결과참조」(문자열)인데
 *     이 21칸은 날짜 셀(serial)이라 문자열을 못 받아 둘이 갈라져 있었다. 이제 양쪽 다 기간이다. */
const otherRows = PLAN_DATE_ROWS.filter(r => r.group !== GROUP)
ok(otherRows.length === 6, `분모 확인: 계획 없는 그룹 ${otherRows.length}개`)
ok(otherRows.every(r => num(vMan, `planStart${r.row}`) === num(vMan, 'actionStartSerial')
  && num(vMan, `planEnd${r.row}`) === num(vMan, 'actionEndSerial')),
  '🎯 계획 없는 6개 구분에도 총 이행기간이 들어간다(종전 공란에서 반전)')
ok(otherRows.every(r => num(vMan, `planDays${r.row}`) === MANUAL.days),
  '계획 없는 6개 구분의 일수도 총 일수')
/* 🎯 대조군 — **기간 자체가 없으면 여전히 공란**이다. 없는 기간을 지어내지는 않는다.
 *   이 단언이 없으면 「21칸에 무조건 무언가를 넣는다」로 넓혀 놔도 초록이 된다. */
const vNoPlan = mk(null)
ok(PLAN_DATE_ROWS.every(r => vNoPlan.get(`planStart${r.row}`) === ' '),
  '🎯 (대조군) 이행기간이 없으면 21칸 전부 공란')

console.log('  · 미공급 하위 호환')
const vNone = mk(null)
ok(vNone.get('actionStartSerial') === null && vNone.get('actionDoneSerial') === null,
  'actionPeriod 미공급 → 개요 4칸 null (종전 동작 — 서식 수식이 살아난다)')

/* ── G. 배선 — 라우트가 **실제로 report10을 읽어 넘기는가** ──
 *
 * 🚨 위 D·E·F는 `buildWorkbookValues`에 기간을 **넘겼을 때** 어디에 실리는지만 본다. 정작 이번
 *   결함은 값 빌더가 아니라 **라우트가 report10 칸을 아예 안 읽은 것**이었다 — 그래서 위 단언을
 *   전부 초록으로 두고도 사용자 화면은 그대로 틀릴 수 있다(포장은 옳은데 요청이 안 나가는 형태,
 *   [[project_allpass_skip56]]). 배선을 소스에서 직접 센다. */
console.log('── G. 라우트 배선 ──')
const ROUTE = 'src/app/(dashboard)/inspections/[id]/workbook/route.ts'
const routeSrc = readFileSync(new URL(`../${ROUTE}`, import.meta.url), 'utf8')
// 분모 확인 — 경로 오타로 빈 문자열을 읽으면 아래가 전부 조용히 빨강/초록이 된다
ok(routeSrc.length > 1000, `분모 확인: 라우트 소스 ${routeSrc.length}자 읽음`)
const loads = [...routeSrc.matchAll(/loadAnnexInputs\(([^)]*)\)/g)].map(m => m[1])
ok(loads.some(a => a.includes("'report10'")), "🎯 라우트가 loadAnnexInputs(…, 'report10')을 부른다")
ok(loads.some(a => a.includes("'report11'")), "(대조군) report11 조회는 그대로 살아 있다")
// 우선순위 규칙을 라우트에 다시 적지 않고 모듈에 물었는가 — 인자 둘(수기 fields, 자동 폴백)
const resolves = [...routeSrc.matchAll(/(?<!function\s)resolveActionPeriod\(([^)]*)\)/g)].map(m => m[1])
ok(resolves.length >= 1, `resolveActionPeriod 호출 ${resolves.length}건`)
ok(resolves.every(a => a.includes(',')), '자동 폴백까지 넘긴다(인자 2개) — 하나만 넘기면 수기 없는 회차가 공란이 된다')
// 그 결과가 실제로 값 빌더까지 가는가 — 계산해 놓고 안 넘기면 아무 일도 일어나지 않는다
ok(/report9:\s*\{[^}]*actionPeriod/s.test(routeSrc), '🎯 계산한 기간을 buildWorkbookValues(report9)에 넘긴다')

/* ── H. 「이행완료 사항」 일자 통일 (2026-09-10 사용자 지시) ──
 * 별지 11호 4행이 불량 건별 완료일이라 한 서식이 서로 다른 날짜를 말했다 → 총 이행기간 종료일. */
console.log('── H. 이행완료 일자 = 총 이행기간 종료일 ──')
const mkDone = (dates: string[]) =>
  annexDoneRows(dates.map((at, i) => ({ defect_name: `불량${i + 1}`, action_taken: `조치${i + 1}`, action_completed_at: at })),
    { hasAnyDefect: true, applicable: true })
const RAW = mkDone(['2026-08-11', '2026-08-13', '2026-08-19'])
// 선단언 — 원본이 실제로 **서로 다른 날짜**다(같으면 아래 통일 단언이 항진명제가 된다)
ok(new Set(RAW.rows.map(r => r.doneISO)).size === 3, `분모 확인: 통일 전 일자 ${new Set(RAW.rows.map(r => r.doneISO)).size}종`)
const UNI = unifyDoneDates(RAW, MANUAL.endISO)
ok(UNI.rows.length === RAW.rows.length, '행 수는 안 변한다(날짜만 바꾼다)')
ok(UNI.rows.every(r => r.doneISO === MANUAL.endISO), `🎯 전 행이 총 이행기간 종료일(${MANUAL.endISO})`)
ok(UNI.rows.map(r => r.content).join('|') === '조치1|조치2|조치3', '내용은 무손상 — 짝이 어긋나지 않는다')
ok(RAW.rows[0].doneISO === '2026-08-11', '(불변) 원본 배열을 제자리에서 고치지 않는다')
ok(unifyDoneDates(RAW, null) === RAW, '기간 없으면 무변경 — 건별 완료일이 그대로 남는다(빈 칸 금지)')
ok(unifyDoneDates(RAW, '') === RAW, '빈 문자열도 무변경')
for (const k of ['refer', 'ok', 'na'] as const) {
  const f = { kind: k, rows: [] }
  ok(unifyDoneDates(f, MANUAL.endISO) === f, `(음성) ${k}(문구 줄)은 손대지 않는다 — 「해당없음」 옆 날짜 금지`)
}

console.log('  · 엑셀 완료보고서 I19:I22 착지')
const mkWithDone = (done: ReturnType<typeof annexDoneRows>) => buildWorkbookValues({
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
  report9: { ...R9_BLANK, actionPeriod: MANUAL, done },
})
const xRaw = mkWithDone(RAW)
const xUni = mkWithDone(UNI)
const dates = (m: Map<string, unknown>) => DONE_ROWS.slice(0, 3).map(r => m.get(`doneDate${r}`) as number)
ok(new Set(dates(xRaw)).size === 3, `(대조군) 통일 전 엑셀 3칸이 서로 다르다 — ${dates(xRaw).join(',')}`)
ok(new Set(dates(xUni)).size === 1, `🎯 통일 후 엑셀 3칸이 한 날짜 — ${dates(xUni).join(',')}`)
ok(dates(xUni)[0] === (xUni.get('actionEndSerial') as number),
  '🎯 그 날짜 = 개요!I9(총 이행기간 종료일) — 같은 문서의 두 칸이 같은 말을 한다')
// 4행 접기 행은 여전히 공란 — 통일이 「외 N건」에 날짜를 붙이면 안 된다
const xMany = mkWithDone(unifyDoneDates(mkDone(['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']), MANUAL.endISO))
ok(xMany.get(`doneContent${DONE_ROWS[3]}`) === '외 2건 (별첨 참조)', '(대조군) 5건 → 4행은 접기 문구')
ok(xMany.get(`doneDate${DONE_ROWS[3]}`) === ' ', '(음성) 접기 행 일자는 공란 그대로')

console.log('  · 배선 — 두 표면이 **둘 다** 통일을 타는가')
ok(/unifyDoneDates\(/.test(routeSrc), '🎯 엑셀 라우트가 unifyDoneDates를 부른다')
const ACTIONS = 'src/app/(dashboard)/inspections/report9-actions.ts'
const actionsSrc = readFileSync(new URL(`../${ACTIONS}`, import.meta.url), 'utf8')
ok(actionsSrc.length > 1000, `분모 확인: 액션 소스 ${actionsSrc.length}자 읽음`)
const actResolves = [...actionsSrc.matchAll(/(?<!function\s)resolveActionPeriod\(([\s\S]{0,200}?)\)/g)]
ok(actResolves.length >= 1, `🎯 PDF 11호 조립도 resolveActionPeriod를 부른다 (${actResolves.length}건)`)
ok(actionsSrc.includes("loadAnnexInputs(admin, inspectionId, 'report10')"),
  "🎯 11호 분기가 report10 칸을 따로 읽는다 (그 분기의 fields는 report11이다)")

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
