/** 세부현황 행 머리 [ ]가 **설치(√)**를 따르는가 — 문서 내 모순 회귀 프로브. 읽기 전용.
 *
 *  서식 원문 지시(별지 9호 4쪽 비고 2 · 9쪽 작성방법):
 *    "[ ]에는 해당 시설에 √표를 하고, 세부 현황 및 설치된 수량을 기입합니다."
 *  → √의 근거는 **설치 여부**이고 기입은 그 다음이다. 종전 구현은 '세부현황에 값이 있는가'만 봐서
 *  순서가 뒤집혀 있었고, 그 탓에 대장에 설치한 설비가
 *    3쪽 1절(facilityChecks 축) = [√]   /   6쪽 3-5(입력 축) = [ ]
 *  로 **한 문서 안에서 모순**되게 인쇄됐다(2026-08-20, 화재알림설비·가스누설경보기 문의).
 *
 *  H-1 설치했으면 세부현황 미입력이어도 행 머리가 [√]
 *  H-2 미설치이고 입력도 없으면 [ ] (설치 안 한 설비를 체크하지 않는다)
 *  H-3 미설치라도 입력이 있으면 [√] (종전 동작 보존 — 대장 누락분을 숨기지 않는다)
 *  H-4 3쪽 1절과 6쪽 3-5가 같은 설비에 대해 어긋나지 않는다(모순 재발 방지)
 *  H-5 installed 미공급(구 호출)이면 종전과 동일
 *  실행: npx tsx scripts/_probe-spec-head-check.mts */
import r9mod from '../src/lib/doc-templates/report9.ts'

const { renderReport9 } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const BASE = {
  ckOp: false, ckInitial: false, ckCompEtc: false, customerName: '', purpose: '', address: '',
  inspPeriod: '', inspDays: '', companyName: '', companyPhone: '', consent: null, reportEmail: '',
  main: null, assistants: [], reportDate: '', submitTo: '', repRole: '', ownerName: '', ownerPhone: '',
  managerGrade: '', mgrName: '', mgrPhone: '', mgrEduDate: '', hasFirePlan: false,
  prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false, insuranceJoined: null,
  insCompany: '', insPeriod: '', insPerson: '', insProperty: '', multiUseCounts: {}, multiUseNone: true,
  permitDate: '', useApprovalDate: '', totalArea: '', buildingArea: '', households: '',
  floorsAbove: '', floorsBelow: '', heightM: '', buildingCount: '',
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  elvR: '', elvE: '', elvV: '', pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
  rampCount: '', stairsCount: '', facilityChecks: [], resultMarks: {}, muResults: {}, defectRows: [],
}
/** 3-5 경보설비 **구간만** 잘라 라벨 앞 체크 상태를 읽는다.
 *  ⚠ 문서 전체에서 찾으면 3쪽 1절의 같은 라벨('[√]화재알림설비')을 먼저 집어 거짓 통과한다 —
 *  실제로 초판 프로브가 그 오탐으로 H-4를 통과시켰다. 반드시 절 경계로 좁힐 것. */
function section35(html: string): string {
  const s = html.indexOf('3-5. 경보설비')
  const e = html.indexOf('3-6.', s + 1)
  if (s < 0) throw new Error('3-5 절을 찾지 못했다')
  return html.slice(s, e > 0 ? e : undefined)
}
function headChecked(html: string, label: string): boolean {
  const plain = section35(html).replace(/<br>/g, '').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ')
  const re = new RegExp(`\\[([√ ]+)\\]\\s*\\n?\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  return /√/.test(re.exec(plain)?.[1] ?? '')
}

const FA = '화재알림설비', GA = '가스누설경보기'
const render = (o: Record<string, unknown>) => renderReport9({ ...BASE, ...o } as never)

console.log('=== H-1 설치했으면 세부현황이 비어도 [√]')
const installed = render({ ledgerCodes: [FA, GA] })
check(`${FA} 행 머리 [√]`, headChecked(installed, FA))
check(`${GA} 행 머리 [√]`, headChecked(installed, GA.replace(GA, '가스누설')))

console.log('=== H-2 미설치 + 미입력이면 [ ]')
const none = render({})
check(`${FA} 행 머리 [ ]`, !headChecked(none, FA))
check(`${GA} 행 머리 [ ]`, !headChecked(none, '가스누설'))

console.log('=== H-3 미설치라도 입력이 있으면 [√] (종전 동작 보존)')
const typed = render({ specs: { s35_alarm: { fire_alert: { receiver_dong: 'A동' } } } })
check(`${FA} 행 머리 [√]`, headChecked(typed, FA))

console.log('=== H-4 3쪽 1절 ↔ 6쪽 3-5 일치 (문서 내 모순 없음)')
const both = render({ facilityChecks: [FA, GA], ledgerCodes: [FA, GA] })
// 3쪽 1절은 facilityChecks 축 — 같은 설비가 √면 세부현황도 √여야 한다
const sec1 = both.includes(`[√]${FA}`)
check('3쪽 1절 [√]', sec1)
check('6쪽 3-5도 [√] — 어긋나지 않음', sec1 === headChecked(both, FA))

console.log('=== H-5 installed 미공급이면 종전과 동일')
const legacy = render({ ledgerCodes: undefined })
check(`${FA} 행 머리 [ ] 유지`, !headChecked(legacy, FA))

console.log(`\n=== 결과 — ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
