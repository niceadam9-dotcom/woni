/** 조립 데이터 → 갑지 워크북 주입 값 (소방계획서_27 S4-1 — 순수 변환, 조회 0)
 *
 *  조회 코드는 여기 없다(D-7). 기존 assembleOfficial·assembleDelegation의 반환을 그대로 받아
 *  앵커 값으로 바꾼다 — 그래서 annex_inputs 수동 오버레이가 공짜로 따라오고,
 *  PDF와 엑셀이 같은 값을 쓴다는 것이 구조적으로 보장된다. */
import type { OfficialData } from '@/lib/doc-templates/official'
import type { DelegationData } from '@/lib/doc-templates/delegation'
import { MULTI_USE_COLS } from '@/lib/doc-templates/report9'
import { resultMark } from '@/lib/doc-templates/base'
import { ANCHORS, DEFECT_GROUP_ROWS, type Anchor } from '@/lib/xlsx-anchors'
import {
  FORM4_ROWS, isForm4Installed, form4InstallField, form4VerdictField, form4VerdictMarks,
} from '@/lib/xlsx-form4'
import { isoToSerial, type InjectTarget, type CellValue } from '@/lib/xlsx-inject'

export type WorkbookSource = {
  official: OfficialData
  delegation: DelegationData
  /** 고객 소재지 — 계약서·개요!B16. 조립 데이터에 없어 라우트가 1컬럼 조회로 보탠다 */
  customerAddress: string
  /** 점검 시작·종료 ISO — 날짜 칸은 시리얼 숫자로 넣어야 셀의 날짜 서식이 산다 */
  startISO: string | null
  endISO: string | null
  /** 사용승인일 ISO — customers.use_approval_date (S3-5 1차 확장) */
  useApprovalISO: string | null
  /** 설치 설비 코드 — fire_facilities.facility_code (installed=true). 별지 4호 1쪽 설치 체크칸의 원천.
   *  라우트가 도너 시트 선별(installedCodes)에 쓰는 **바로 그 목록**을 그대로 넘긴다 —
   *  '동봉된 점검표'와 '현황 쪽의 √'가 한 축이라 갈라질 수 없다. */
  installedCodes: string[]
  /** 피난기구 종류 — 세부제원 s36_evac.evac_equipment.types(evacTypesFromSpecs).
   *  피난기구 하위 3칸만 대장이 아니라 이 축을 본다(별지 9호 3쪽 PDF와 같은 원천) */
  evacTypes: string[]
  /** 건축물 현황 — buildings 활성·최고참 1동(report9-actions:225와 같은 축). 없으면 전부 공란 */
  building: {
    purpose: string | null; totalArea: number | null; buildingArea: number | null
    floorsAbove: number | null; floorsBelow: number | null; height: number | null
    households: number | null; buildingCount: number | null; permitDateISO: string | null
  } | null
  /** 별지 9호 조립(assembleReport9 — lib/report9-assemble) 반환의 사용 부분집합(S7-1·2 + S3-5 2차).
   *  전체 Report9Data를 요구하면 픽스처가 60여 칸을 만들어야 해서 구조적 부분형으로 받는다 —
   *  라우트는 r9.data를 그대로 넘긴다(D-7: PDF와 같은 조립·같은 해석) */
  report9: {
    ckOp: boolean; ckInitial: boolean; ckCompEtc: boolean
    consent: boolean | null
    repRole: string
    managerGrade: string
    mgrEduDate: string
    /** 경사로 개소 — 개요!D21. `정보!J20`이 `=개요!D21`을 읽는데 앵커가 없어 전 고객 엑셀에
     *  '경사로 0 개소'가 인쇄됐다(2026-08-23 F세대 판정). PDF(report9.ts:329)는 실값을 찍고
     *  있었으므로 **D-7('PDF와 엑셀이 갈라지지 않는다')이 깨진 유일한 칸**이었다 */
    rampCount: string
    /** 세부제원(customer_facility_specs) — 별지 9호 4~7쪽 세부현황의 원천. PDF는
     *  `renderSpecSections()`로 이미 인쇄하는데 엑셀 현1~현4는 통째로 비어 있었다(D-7 파손).
     *  라우트가 `evacTypes`를 뽑을 때 이미 손에 쥐고 있던 값이라 전달 경로 추가는 없다. */
    specs?: Record<string, unknown> | null
    /** ⭐ 점검표 응답 롤업 — **별지 9호 3쪽 / 별지 4호 1쪽 PDF가 인쇄하는 바로 그 맵**(D-7).
     *  키는 FORM3_ITEMS(별지 9호 표기 = 저장 어휘). 여기서 다시 판정하지 않는다 —
     *  라우트가 넘기는 r9.data의 것을 그대로 받아 `현황` 시트 결과칸에 놓기만 한다.
     *  ⚠ 없는 키 = **무응답 = 공란**이다. 'O'로 메우지 않는다(점검 사실 위조). */
    resultMarks: Record<string, 'O' | 'X' | 'N'>
    /** 설비 대장 코드(**대표 1동** — assembleReport9가 본 축). 소화기구 하위 5종의 설치 판정에 쓴다.
     *  `src.installedCodes`(전 동 합집합)와 **다른 축**이라 섞으면 하위 마크가 옆 줄로 내려간다
     *  (xlsx-form4.form4VerdictMarks 주석). 미공급이면 installedCodes로 폴백한다(픽스처·구 호출부). */
    ledgerCodes?: string[]
    /** 불량 세부(별지 9호 8쪽 = `현5` 시트) — PDF `page8()`이 인쇄하는 바로 그 배열(D-7).
     *  옵션인 이유는 구 호출부·픽스처 호환이며, 미공급이면 7행이 전부 명시적 공란이 된다
     *  (서식의 `=""`가 살아남아 계획서!H12가 `0`을 인쇄하지 않는다 — keepFormulaWhenEmpty). */
    defectRows?: Array<{ group: string; code: string; content: string }>
    /** 이행조치 총 기간(별지 10호 축) — PDF `totalPeriod`·`totalDays`와 **같은 원천**
     *  (`actionPlanPeriod()`). 개요!G9·I9·J9·G10의 값이자, 계획서·완료보고서가 전부 여기서 온다. */
    actionPeriod?: { startISO: string; endISO: string; days: number } | null
    main: { name: string; grade: string; licenseNo: string } | null
    assistants: Array<{ name: string; grade: string; licenseNo: string; period: string }>
    // ── 정보 시트 12칸(별지 9호 2쪽) — 필수/옵션 구분은 **Report9Data와 정확히 같게** 둔다.
    // 옵션을 필수로 올리면 라우트가 넘기는 r9.data가 구조적으로 안 맞아 tsc가 막는다(그리고
    // 옵션 칸은 '미공급이면 ☐'가 PDF의 확정 규약이다 — A9-6: 자동 판정은 부정을 단정하지 않는다)
    mgrAppointType?: string
    hasFirePlan: boolean
    firePlanStored?: boolean; firePlanUnstored?: boolean; firePlanNone?: boolean
    prevOpDone: boolean; prevOpNone?: boolean
    prevCompDone: boolean; prevCompNone?: boolean
    eduDone: boolean; eduNone?: boolean
    drillDone: boolean; drillNone?: boolean
    insuranceJoined: boolean | null
    insCompany: string
    insPeriod: string
    /** 가입금액 — 단위는 **만원**(2026-08-24 확정, insAmountLine 주석 참조) */
    insPerson: string
    insProperty: string
    multiUseNone: boolean
    multiUseCounts: Record<string, string>
    stCon: boolean; stSteel: boolean; stBrick: boolean; stWood: boolean; stEtc: boolean
    rfSlab: boolean; rfTile: boolean; rfSlate: boolean; rfEtc: boolean
    stairsCount: string
    specialStairCount?: string
    elvR: string; elvE: string; elvV: string
    pkIn: boolean; pkMech: boolean; pkRoof: boolean; pkOut: boolean
    pkInUg?: boolean; pkInGround?: boolean; pkInPiloti?: boolean
  }
}

/** 갑지 다중이용업소 칸의 **줄바꿈 자리** — 서식이 긴 업종명을 두 줄로 쪼갠다(원문 실측).
 *  대부분은 `업종명\n    ` 처럼 개소 괄호만 내려가지만, '인터넷컴퓨터게임시설제공업'은 **이름
 *  자체가** 쪼개져 있다. 여기 없는 업종은 한 줄. 키는 MULTI_USE_COLS(별지 9호 PDF와 단일 원천)
 *  의 어휘여야 한다 — 어긋나면 test-xlsx-anchors [7]이 잡는다. */
const MU_BREAK: Record<string, string> = {
  '비디오물감상실업': '비디오물감상실업\n    ',
  '복합유통게임제공업': '복합유통게임제공업\n    ',
  '가상체험 체육시설업': '가상체험 체육시설업\n    ',
  '비디오물소극장업': '비디오물소극장업\n    ',
  '복합영상물제공업': '복합영상물제공업\n    ',
  '인터넷컴퓨터게임시설제공업': '인터넷컴퓨터게임시설\n    제공업',
}

/** 손으로 채우는 빈 칸(write-in slot) — 갑지의 용도는 **손으로 고쳐 쓰기**라, 값이 없으면
 *  0이나 공백 1칸이 아니라 서식 원문의 빈 슬롯을 그대로 남긴다(원문 공백 런 실측:
 *  scripts/_probe-info-spaces.mts). 값이 있으면 그 슬롯 자리에 값을 넣는다. */
/** 화재보험 줄(정보!B13)의 슬롯 폭 — **원문 실측**(`_verify-afind.mts`):
 *  줄2 58자 = 고정부 14 + 보험사 12 + 가입기간 32 · 줄3 61자 = 고정부 25 + 대인 18 + 대물 18.
 *  ⚠ 종전 가입기간 상수는 28칸이었다(주석엔 '28칸'이라 적고 실제 원문은 32칸) — 미입력 고객의
 *  줄2가 원문보다 4칸 짧게 나갔다(2026-08-24 독립 판정 실측). 눈대중한 상수는 이렇게 썩는다. */
const INS_SLOT_CO = 12, INS_SLOT_PERIOD = 32, INS_SLOT_AMOUNT = 18

/** 폭 고정 write-in 슬롯 — 값이 있으면 **폭을 지키며 가운데 맞춤**한다.
 *  폭을 지키는 이유: 한 줄에 두 칸(보험사·가입기간 / 대인·대물)이 나란히 있어 왼쪽이 밀리면
 *  오른쪽이 따라 밀린다. 폭보다 긴 값은 **자르지 않는다** — 법정 서식에서 값을 잃는 것이
 *  정렬이 틀어지는 것보다 나쁘다(그 경우에만 줄이 길어진다).
 *  ⚠ 경계는 `> w`다. `>= w`이면 **정확히 w자일 때** 폭을 지킬 수 있는데도 초과 분기로 새어
 *  w+2를 낸다(2026-08-24 독립 판정 실측: 18자 입력 → 슬롯 20칸·줄3 63자). 검사 픽스처가
 *  5·6자뿐이라 경계를 한 번도 밟지 않아 초록이었다 — 경계값을 검사에 넣어 고정한다. */
const slot = (v: string, w: number) => {
  const s = v.trim()
  if (!s) return ' '.repeat(w)
  if (s.length > w) return ` ${s} `
  const pad = w - s.length, left = Math.floor(pad / 2)
  return ' '.repeat(left) + s + ' '.repeat(pad - left)
}

/** 가입금액 줄 — 단위는 **만원**(2026-08-24 사용자 확정).
 *  ⚠경위: 종전엔 미주입이었다. ERP 입력 UI가 '천만원'이라 갑지의 `만원` 슬롯에 넣으면 10배
 *  오인쇄였기 때문이다. 그런데 **법정 서식 원문에는 단위가 아예 없다**(_form/별지9호-placeholder.hwpx:
 *  `가입금액: 대인( {{ins_person}} ) 대물( {{ins_property}} )` — '천만원'은 벌금 조항에만 나온다).
 *  PDF가 원문에 없는 단위를 발명했던 것이고, 실무 서식인 갑지의 `만원`이 옳다. 세 곳(PDF report9.ts
 *  page2 · 입력 UI fire-plan-info-panel · 이 파일)이 **한 단위**여야 한다 — 갈라지면 같은 값이
 *  문서마다 10배씩 달라진다. 입력값은 자유 텍스트라 '1억'처럼 단위를 적으면 '1억 만원'이 되므로
 *  입력 UI가 title로 경고한다(데이터 정정은 사용자 몫). */
const insAmountLine = (person: string, property: string) =>
  `가입금액:  대인(${slot(person, INS_SLOT_AMOUNT)}만원 )    대물(${slot(property, INS_SLOT_AMOUNT)}만원 )`

/** √ 통문자열의 체크 표기 — 반각 `[  ]`/`[√]`(전각 ［ ］는 보고서 A2 한 곳뿐) */
const ck = (on: boolean) => (on ? '[√]' : '[  ]')
/** 개소·대수 write-in 슬롯 — 빈 칸은 서식 원문의 공백 런(3칸·4칸)을 그대로 남긴다 */
const slot3 = (v: string) => (v ? ` ${v} ` : '   ')
const slot4 = (v: string) => (v ? ` ${v} ` : '    ')

/** 다중이용업소 한 열(정보!B14·E14·I14) 조립 — 업종 목록·순서는 MULTI_USE_COLS 단일 원천.
 *  '해당없음'은 1열에만 붙고(PDF report9.ts:259와 같은 축), 2·3열은 서식의 높이 맞춤 빈 줄
 *  3개로 끝난다(원문 실측: `…(  개소)\n\n\n`). 개소는 값이 있으면 체크 — 없으면 빈 슬롯. */
function muColumn(col: number, counts: Record<string, string>, none: boolean): string {
  const lines = MULTI_USE_COLS[col].map(cat => {
    const cnt = (counts[cat] ?? '').trim()
    return `${ck(!!cnt)}${MU_BREAK[cat] ?? cat}(${cnt ? ` ${cnt} ` : '  '}개소)`
  })
  if (col === 0) lines.push(`${ck(none)}해당없음`)
  else lines.push('', '', '')
  return lines.join('\n')
}

/** field → 값. 앵커에 있는 field가 여기 없으면 빌드가 아니라 **테스트가** 잡는다(test-xlsx-anchors) */
export function buildWorkbookValues(src: WorkbookSource): Map<string, CellValue> {
  const { official: o, delegation: d, building: b, report9: p } = src
  const days = d.daysLabel.trim()
  // √ 통문자열 조각 — 서식 원문의 괄호 어휘를 그대로 따른다. 반각은 모듈 최상단 ck(정보 시트
  // 조립부와 공용), 전각은 보고서!A2 한 곳뿐이라 여기 둔다
  const fk = (on: boolean) => (on ? '［√］' : '［  ］')
  const entries: Array<[string, CellValue]> = [
    ['year', o.year],
    // 발신일자·점검일자는 시리얼 — 문자열로 넣으면 스포크의 날짜 서식('2026년 7월 16일')이 죽는다
    ['sendDateSerial', isoToSerial(src.endISO) ?? isoToSerial(src.startISO)],
    // 공문은 'B6 고정 접두("승     진") + C6 번호' 2칸 구조다 — 전체 문서번호를 넣으면 접두가 겹친다
    ['docNo', o.docNo.replace(/^\D+/, '')],
    ['inspectSerial', isoToSerial(src.startISO)],
    ['customerName', o.recipient],
    ['station', d.station],
    ['address', src.customerAddress],
    ['managerName', d.owner.name],
    ['managerPosition', d.owner.position],
    ['managerPhone', d.owner.phone],
    ['managerBirth', d.owner.birth],
    ['periodLabel', d.periodLabel],
    // 원본 F1 = "1일   )" — 위임장 S10의 여는 괄호와 짝이라 닫는 괄호가 값에 포함된다
    ['daysLabel', days ? `${days}   )` : null],
    // 주된 점검인력 — 종전엔 위임장 대리인(d.agent)이었으나 별지 9호 축(참여자 '주된' 우선,
    // 없으면 담당 직원 — assembleReport9)으로 교체. 개요!B1과 보고서!C17(리터럴 앵커)이 같이 받는다
    ['mainInspector', p.main?.name || null],
    ['mainGrade', p.main?.grade || null],
    ['mainLicenseNo', p.main?.licenseNo || null],
    ['agentName', d.agent.name],
    ['agentPosition', d.agent.position],
    ['agentPhone', d.agent.phone],
    ['agentBirth', d.agent.birth],
    ['repName', o.senderSign.rep],
    // 표지 제목(S7-3) — typeLabel은 표지 PDF(assembleCover)와 같은 inspectionTypeLabel 축에서
    // 파생된 delegation 값이라 두 산출물이 갈라지지 않는다(D-7)
    ['coverTitle', `소방시설 ${d.typeLabel} 결과보고서`],
    // 건축물 현황(S3-5 1차 확장) — 날짜 둘은 시리얼(셀 서식 m/d/yy 실측), 나머지는 원시 숫자/문자.
    // building이 null(대장 미등록)이면 전부 명시적 공란 — 조용한 잔재보다 빈칸이 낫다(S3-4)
    ['households', b?.households ?? null],
    ['purpose', b?.purpose ?? null],
    ['buildingCount', b?.buildingCount ?? null],
    ['totalArea', b?.totalArea ?? null],
    ['buildingArea', b?.buildingArea ?? null],
    ['useApprovalSerial', isoToSerial(src.useApprovalISO)],
    ['permitDateSerial', isoToSerial(b?.permitDateISO ?? null)],
    ['heightM', b?.height ?? null],
    ['floorsAbove', b?.floorsAbove ?? null],
    ['floorsBelow', b?.floorsBelow ?? null],
    // ── S3-5 2차 — 등급(대상물 급수)·교육이수일. B20은 ;@ 서식이라 kdate 문자열 그대로 산다
    ['managerGrade', p.managerGrade || null],
    ['managerEduDate', p.mgrEduDate || null],
    ['rampCount', p.rampCount || null],
    // ── 보고서 1·2쪽 √ 통문자열(S7-1·S7-2) — 원문(_probe-s7-raw-literals)과 자구 동일 조립.
    // 점검자 3행은 상수(우리는 항상 소방시설관리업자 — renderReport9:204와 같은 축)지만,
    // 갑지 표본이 √ 위치를 바꿔 오면 자기 라벨 검증이 막는다
    ['reportTypeHeader', `${ck(p.ckOp)} 작동점검, 종합점검(${fk(p.ckInitial)}최초점검, ${fk(p.ckCompEtc)}그 밖의 종합점검) \n               소방시설등 자체점검 실시결과 보고서`],
    ['inspectorOwnerRow', '[  ]관계인            (성명:'],
    ['inspectorManagerRow', '[  ]소방안전관리자    (성명:                  '],
    ['inspectorCompanyRow', '[√]소방시설관리업자  (업체명:             '],
    ['emailConsent', `[${p.consent === true ? '√' : '  '}] 동의함      [${p.consent === false ? '√' : '  '}] 동의하지 않음`],
    ['repRoleLine', `${ck(p.repRole === '소유자')}소유자, ${ck(p.repRole === '관리자')}관리자, ${ck(p.repRole === '점유자')}점유자`],
    // ── 정보 시트 12칸(F세대 판정 §1-②) — 공백 런까지 서식 원문 그대로.
    // 표본 답(√ 위치)을 그대로 넣으면 원문과 **자구 동일**해야 한다: test-xlsx-anchors [7]이
    // 12칸 전수를 왕복 대조한다(자구가 틀리면 붉어진다 — '열리는가'와 '자구가 사는가'는 다른 검사).
    ['mgrAppointLine', `${ck(p.mgrAppointType === '소방기술자격')}소방기술자격, ${ck(p.mgrAppointType === '소방안전관리자수첩')}소방안전관리자수첩, ${ck(p.mgrAppointType === '업무대행감독')}업무대행감독, ${ck(p.mgrAppointType === '겸직')}겸직, ${ck(p.mgrAppointType === '기타')}기타`],
    // 보관 칸은 미공급 시 hasFirePlan을 따른다 — PDF(report9.ts:284)와 같은 폴백
    ['firePlanLine', `${ck(p.hasFirePlan)}작성 (${ck(p.firePlanStored ?? p.hasFirePlan)}보관 ${ck(!!p.firePlanUnstored)}미보관),          ${ck(!!p.firePlanNone)}미작성`],
    // 갑지는 구 용어(작동기능점검·종합정밀점검)를 쓴다 — PDF는 현행 용어지만 서식 자구는 그대로 둔다
    ['prevInspectLine', `작동기능점검 (${ck(p.prevOpDone)}실시 ${ck(!!p.prevOpNone)}미실시),     종합정밀점검 (${ck(p.prevCompDone)}실시 ${ck(!!p.prevCompNone)}미실시)`],
    ['trainingLine', `소방안전교육 (${ck(p.eduDone)}실시 ${ck(!!p.eduNone)}미실시),      소방훈련 (${ck(p.drillDone)}실시 ${ck(!!p.drillNone)}미실시)`],
    ['insuranceLine', `${ck(p.insuranceJoined === true)}가입, ${ck(p.insuranceJoined === false)}미가입\n`
      + `보험사:${slot(p.insCompany, INS_SLOT_CO)},  가입기간:  ${slot(p.insPeriod, INS_SLOT_PERIOD)}\n`
      + insAmountLine(p.insPerson, p.insProperty)],
    ['multiUseCol1', muColumn(0, p.multiUseCounts, p.multiUseNone)],
    ['multiUseCol2', muColumn(1, p.multiUseCounts, p.multiUseNone)],
    ['multiUseCol3', muColumn(2, p.multiUseCounts, p.multiUseNone)],
    // 구조·지붕 판정은 assembleReport9(:357~365)의 배타 분기 그대로 — 여기서 다시 판정하지 않는다
    [
      'structureLine',
      ` ${ck(p.stCon)}철근콘크리트구조, ${ck(p.stSteel)}철골구조, ${ck(p.stBrick)}조적조, ${ck(p.stWood)}목구조, ${ck(p.stEtc)}기타`,
    ],
    ['roofLine', ` ${ck(p.rfSlab)}슬라브, ${ck(p.rfTile)}기와, ${ck(p.rfSlate)}슬레이트, ${ck(p.rfEtc)}기타`],
    // 계단·승강기는 개소/대수가 있으면 체크(PDF ck(!!stairsCount)와 같은 축) — 표본은 ( 1 개소 )였다
    ['stairsLine', ` ${ck(!!p.stairsCount)}직통(또는 피난계단) (${slot3(p.stairsCount)}개소 ), ${ck(!!p.specialStairCount)}특별피난계단 (${slot4(p.specialStairCount ?? '')}개소)`],
    ['elevatorLine', ` ${ck(!!p.elvR)}승용(${slot4(p.elvR)}대 ), ${ck(!!p.elvE)}비상용(${slot4(p.elvE)}대), ${ck(!!p.elvV)}피난용(${slot4(p.elvV)}대)`],
    ['parkingLine', ` ${ck(p.pkIn)}옥내(${ck(!!p.pkInUg)}지하 ${ck(!!p.pkInGround)}지상 ${ck(!!p.pkInPiloti)}필로티 ${ck(p.pkMech)}기계식), ${ck(p.pkRoof)}옥상, ${ck(p.pkOut)}옥외`],
    // ── 다수동일때(2·3·4동) — 값이 아니라 **빈 서식**을 넣는다(사유는 xlsx-anchors 주석).
    // 서식 원문에서 마크만 `[  ]`로, 개소 슬롯만 공란으로 바꾼 것 — 어휘는 그 시트의 것을 따른다
    // ('콘크리트구조'. 정보!B19는 '철근콘크리트구조'로 **다르다** — 시트별 자구를 섞지 않는다)
    ['mbStructureBlank', ` ${ck(false)}콘크리트구조, ${ck(false)}철골구조, ${ck(false)}조적조, ${ck(false)}목구조, ${ck(false)}기타`],
    ['mbRoofBlank', ` ${ck(false)}슬라브, ${ck(false)}기와, ${ck(false)}슬레이트, ${ck(false)}기타`],
    ['mbStairsBlank', ` ${ck(false)}직통(또는 피난계단) (${slot3('')}개소 ), ${ck(false)}특별피난계단 (${slot4('')}개소)`],
    ['mbElevatorBlank', ` ${ck(false)}승용(${slot4('')}대 ), ${ck(false)}비상용(${slot4('')}대), ${ck(false)}피난용(${slot4('')}대)`],
    ['mbParkingBlank', ` ${ck(false)}옥내(${ck(false)}지하 ${ck(false)}지상 ${ck(false)}필로티 ${ck(false)}기계식), ${ck(false)}옥상, ${ck(false)}옥외`],
  ]
  // ── 별지 4호 1쪽(현황) 설비 설치 체크 + 점검결과 ──────────────────────────────
  //
  // 설치칸: 대장 실값으로 **상시 덮는다**(값 또는 명시적 빈 마크) — 잔존 경로가 없다.
  // 결과칸: **PDF와 같은 해석기**(D-7, 2026-08-25). 종전엔 '미설치면 ／, 설치면 공란'까지였는데,
  //   그건 절반이었다 — ERP는 점검 결과를 이미 알고 있었고(resultMarks) 별지 9호 3쪽·별지 4호
  //   1쪽 **PDF는 그 판정을 이미 인쇄 중**이었다. 같은 점검 건에서 PDF는 ○/×를 찍고 엑셀은
  //   비어 있는 상태였다. 값을 여기서 새로 계산하지 않고 form4VerdictMarks가 그 맵을 조회한다.
  //
  // ⚠ 설치=`[√]`에서 `○`(양호)를 만들어내지 않는다. 그건 서식 수식이 하던 일이고,
  //   **점검을 했는지조차 모르는 채 양호를 인쇄**하는 것이었다(법정 서식에서 가장 위험한 방향).
  //   설치인데 응답이 없으면 지금도 **공란**이다 — '무응답 → 양호'는 없다.
  // ⚠ 폴백(`on ? null : '/'`)은 resultMarks가 아예 없을 때의 **종전 동작**이다. 운영 경로에서는
  //   rollUpForm3Results가 미설치 항목에 'N'을 반드시 채우므로 이 가지가 결과를 바꾸지 않는다
  //   (그래도 남긴다 — 조립이 실패해 빈 맵이 와도 서식이 ○로 번지지 않게).
  // ⚠ `／`(전각)가 아니라 `/`(반각)를 쓴다 — 서식 자신의 어휘다(현황!A3 범례 '해당없는 항목은 /표시',
  //   제거된 수식의 리터럴도 "/"였다). resultMark('N')이 같은 반각 '/'를 돌려준다(base.ts).
  const verdicts = form4VerdictMarks(p.resultMarks ?? {}, p.ledgerCodes ?? src.installedCodes, src.evacTypes)
  for (const r of FORM4_ROWS) {
    const on = isForm4Installed(r, src.installedCodes, src.evacTypes)
    entries.push([form4InstallField(r), ck(on)])
    // ⚠ 빈 칸은 **셀을 비우는 게 아니라** 서식의 `=""`를 살려 두는 것이다
    //   (앵커가 keepFormulaWhenEmpty). 빈 셀로 두면 `대상물`의 복제칸이 `0`을 인쇄한다
    if (r.verdictCell) {
      const m = verdicts.get(r.verdictCell)
      entries.push([form4VerdictField(r), m ? resultMark(m) : (on ? null : '/')])
    }
  }
  // 보조 점검인력 7행(S3-5 2차) — 허브 B·C·D·E 열. 없는 행은 명시적 공란(S3-4).
  // 8명 이상은 허브 서식상 실을 수 없다 — 라우트가 missing 헤더로 알린다(S8-2 규약과 같은 축)
  for (let i = 0; i < 7; i++) {
    const a = p.assistants[i] ?? null
    entries.push(
      [`assist${i + 1}Name`, a?.name || null],
      [`assist${i + 1}Grade`, a?.grade || null],
      [`assist${i + 1}LicenseNo`, a?.licenseNo || null],
      // 사람이 없는 행은 **공백 1칸** — `null`(빈 셀)이면 이 칸을 단일 참조하는 보고서!F18~F24가
      // 재계산으로 `0`을 인쇄한다(빈 셀·빈 inlineStr·빈 <v> 전부 0, 살아남는 건 공백 1칸과 `=""`
      // — `_probe-empty-repr.mts` 5종 왕복 실측). 앵커의 dropFormula가 `=E1` 사슬을 함께 끊는다.
      [`assist${i + 1}Period`, a ? a.period || null : ' '],
    )
  }
  // ── 현1 3-1 소화기구·자동소화장치 체크 7칸 (소방계획서_27 Phase 4 / S9-1) ──
  //
  // 여태 현1~현4는 통째로 미배선이라 **PDF는 그 고객 제원을 인쇄하는데 엑셀만 빈칸**이었다(D-7 파손).
  // 여기서 여는 것은 3-1의 √ 7칸뿐이다 — 셀 내용이 마크 하나(`[  ]`)라 자구 재조립이 필요 없고
  // PDF `renderS31`(spec-sections.ts:174-186)과 **완전히 같은 6종 어휘**를 쓴다.
  //
  // ⚠ 소화기·간이소화용구 두 상위 칸은 서식이 하위 2종의 **합집합**으로 정의한다
  //   (renderS31의 `tAny` — 분말·기타 중 하나라도 있으면 '소화기'가 켜진다). 여기서 다시
  //   판정하지 않고 같은 식을 쓴다. 상위 '소화기'(C3)는 이미 `=현황!D7` 수식이라 건드리지 않는다.
  // ⚠ 값을 지어내지 않는다 — types가 없으면 전부 `[  ]`다(미설치 단정이 아니라 '모른다'의 표현).
  {
    const s31 = ((p.specs?.['s31_extinguisher'] ?? null) as Record<string, unknown> | null)
    const summary = ((s31?.['summary'] ?? null) as Record<string, unknown> | null)
    const raw = summary?.['types']
    const types = new Set(Array.isArray(raw) ? raw.map(String) : [])
    const on = (...opts: string[]) => opts.some(o => types.has(o))
    entries.push(
      ['s31SimpleAny',   ck(on('간이소화용구(투척용)', '간이소화용구(기타)'))],
      ['s31AutoDiffuse', ck(on('자동확산소화기'))],
      ['s31AutoDevice',  ck(on('자동소화장치'))],
      ['s31ExtPowder',   ck(on('소화기(분말)'))],
      ['s31ExtOther',    ck(on('소화기(기타)'))],
      ['s31SimpleThrow', ck(on('간이소화용구(투척용)'))],
      ['s31SimpleOther', ck(on('간이소화용구(기타)'))],
    )
  }

  // ── 현1 3-2 수계소화설비(공통사항) 25칸 (Phase 4 / S9-1) ──────────────
  //
  // 서식 원문과 **자구 동일**하게 재조립한다(정보 12칸·다수동일때 15칸과 같은 부류) —
  // 공백 런까지 `_p4-hyeon1-literals.mts` 실측값이다(동명 12·층 3·값 9·불연성가스 18·줄머리 15).
  // 값은 PDF `renderS32`(spec-sections.ts:230-266)와 **같은 블록·같은 필드**를 읽는다(D-7).
  //
  // ⚠ `G25`만 서식 원문을 **따르지 않는다**. 갑지 자산이 구판이라 `◦ 유효수량: (   )㎥`인데,
  //   별지 4호 현행판 원문과 별지 9호 hwpx는 `◦ 유효낙차: (   )m`다(2026-09-01 대조,
  //   scripts/_p4-form-source-check.mts). 고가수조는 낙차가 맞고 PDF도 그렇게 인쇄한다.
  //   앵커가 이 칸을 통째로 덮으므로 **자산을 건드리지 않고** 여기서 현행판으로 바로잡는다.
  {
    const s32 = ((p.specs?.['s32_water_common'] ?? null) as Record<string, unknown> | null)
    const blk = (k: string) => ((s32?.[k] ?? null) as Record<string, unknown> | null)
    const mw = blk('main_water'), aw = blk('aux_water')
    const el = blk('pump_elevated'), pr = blk('pump_pressure'), pz = blk('pump_pressurized')
    // 현2로 이어지는 3-2 후반 — 펌프방식·송수구·비상전원도 같은 섹션이다
    const pm = blk('pump_type'), inlet = blk('inlet'), ep = blk('emergency_power')

    const str = (b: Record<string, unknown> | null, k: string) => String(b?.[k] ?? '').trim()
    /** write-in 슬롯 — 값이 있으면 앞뒤 한 칸씩, 없으면 서식 원문의 공백 런 그대로 */
    const w = (b: Record<string, unknown> | null, k: string, n: number) => {
      const s = str(b, k)
      return s ? ` ${s} ` : ' '.repeat(n)
    }
    const isSel = (b: Record<string, unknown> | null, k: string, opt: string) => str(b, k) === opt
    /** 배열 필드(다중선택)에 그 값이 들어 있는가 */
    const inArr = (b: Record<string, unknown> | null, key: string, o: string) => {
      const v = b?.[key]
      return Array.isArray(v) && v.map(String).includes(o)
    }
    const hasSys = (b: Record<string, unknown> | null, o: string) => inArr(b, 'systems', o)
    /** 블록이 '쓰임'인가 — PDF `cb(has(used) || blockHas(b))`와 같은 축.
     *  값이 하나라도 적혀 있으면 켠다(체크만 빼먹은 입력을 서식에서 되살린다). */
    const used = (b: Record<string, unknown> | null) => {
      if (b?.['used'] === true) return true
      return Object.entries(b ?? {}).some(([k, v]) =>
        k !== 'used' && (Array.isArray(v) ? v.length > 0 : !!String(v ?? '').trim()))
    }
    // 배치는 원문 그대로 3·2·3행 — renderS32의 sysLine과 같은 분할이다
    const SYS = ['옥내소화전설비', '옥외소화전설비', '스프링클러설비', '간이스프링클러설비',
      '화재조기진압용스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비']
    const seg = (b: Record<string, unknown> | null, from: number, to: number) =>
      SYS.slice(from, to).map(o => `${ck(hasSys(b, o))}${o}`).join(' ')
    const sys1 = (b: Record<string, unknown> | null) => `◦ 설비의 종류: ${seg(b, 0, 3)}`
    const sys2 = (b: Record<string, unknown> | null) => `${' '.repeat(15)}${seg(b, 3, 5)} `
    const sys3 = (b: Record<string, unknown> | null) => `${' '.repeat(15)}${seg(b, 5, 8)}`
    /** 설치장소 — 동명/지상·지하/층/실명 (PDF locLine과 같은 필드·같은 폭) */
    const loc = (b: Record<string, unknown> | null) =>
      `◦ 설치장소: 동명(${w(b, 'dong', 12)}) ${ck(isSel(b, 'ground', '지상'))}지상/${ck(isSel(b, 'ground', '지하'))}지하 (${w(b, 'floor', 3)})층, 실명(${w(b, 'room', 12)})`
    /** 수조용량·가압압력 한 줄 — 압력수조·가압수조가 같은 자구를 쓴다 */
    const tank = (b: Record<string, unknown> | null) =>
      `◦ 수조용량: (${w(b, 'tank_volume', 9)})ℓ, 수조가압압력:(${w(b, 'tank_pressure', 9)})Mpa`

    entries.push(
      // 주된수원
      ['s32MwSys1', sys1(mw)], ['s32MwSys2', sys2(mw)], ['s32MwSys3', sys3(mw)],
      ['s32MwLoc', loc(mw)],
      ['s32MwIntake', `◦ 흡입방식: ${ck(isSel(mw, 'intake', '정압'))}정압 ${ck(isSel(mw, 'intake', '부압'))}부압,   ◦ 유효수량: (${w(mw, 'capacity', 9)})㎥`],
      // 보조수원 — 지상/지하·층이 없는 짧은 설치장소다(원문 그대로)
      ['s32AwLoc', `◦ 설치장소: 동명(${w(aw, 'dong', 12)}) 실명(${w(aw, 'room', 12)}), ◦ 유효수량: (${w(aw, 'capacity', 9)})㎥`],
      // 고가수조 — 마지막 칸이 유효'낙차'(m)다. 위 ⚠ 참조
      ['s32ElMark', `${ck(used(el))}고가수조`],
      ['s32ElSys1', sys1(el)], ['s32ElSys2', sys2(el)], ['s32ElSys3', sys3(el)],
      ['s32ElLoc', `◦ 설치장소: 동명(${w(el, 'dong', 12)}) 실명(${w(el, 'room', 12)}), ◦ 유효낙차: (${w(el, 'head_drop', 9)})m`],
      // 압력수조
      ['s32PrMark', `${ck(used(pr))}압력수조`],
      ['s32PrSys1', sys1(pr)], ['s32PrSys2', sys2(pr)], ['s32PrSys3', sys3(pr)],
      ['s32PrLoc', loc(pr)], ['s32PrTank', tank(pr)],
      ['s32PrComp', `◦ 자동식공기압축기 용량:(${w(pr, 'compressor_capacity', 9)})㎥/min, 동 력:(${w(pr, 'compressor_power', 9)})Kw`],
      // 가압수조
      ['s32PzMark', `${ck(used(pz))}가압수조`],
      ['s32PzSys1', sys1(pz)], ['s32PzSys2', sys2(pz)], ['s32PzSys3', sys3(pz)],
      ['s32PzLoc', loc(pz)], ['s32PzTank', tank(pz)],
      ['s32PzGas', `◦ 가압가스의 종류: ${ck(isSel(pz, 'gas_type', '공기'))}공기 ${ck(isSel(pz, 'gas_type', '불연성가스'))}불연성가스(${w(pz, 'gas_etc', 18)})`],
    )

    // ── 현2로 이어지는 3-2 후반 — 펌프방식·송수구·비상전원 ────────────────────
    //
    // 🔴 D2~D5·C16~C18은 서식이 **수식**으로 남의 값을 복사한다(D2=현1!G16 … C16=D2).
    //    그런데 PDF renderS32는 `sysLine(pm)`·`inletSys()`로 **각자 블록의 systems**를 인쇄한다.
    //    두 블록 값이 다르면 PDF와 엑셀이 갈라진다(D-7 위반). 앵커 쪽 dropFormula로 사슬을
    //    끊고 여기서 자기 값을 준다. ⚠ 현1!G16을 배선한 순간 전이 폐포가 주된수원 값을 D2로
    //    밀어 넣으므로, 이 갈라짐은 **이번 작업이 활성화시킨 것**이다 — 함께 닫아야 한다.
    //
    // ⚠ D7·D9(전동기/내연기관)는 **세부제원에 대응 필드가 없다**(PDF pumpLines에도 없다).
    //    값을 지어내지 않고 서식 원문의 빈 서식을 그대로 준다 — 다수동일때와 같은 처리.
    // ⚠ D13은 '압력챔버'다. PDF는 annexLabel로 '압력체임버'를 쓸 수 있으나 **시트별 자구를
    //    섞지 않는다**(다수동일때 주석과 같은 규약) — 이 시트의 어휘를 따른다.
    const pumpRow = (label: string, head: string, flow: string) =>
      `◦ ${label}  전양정:(${w(pm, head, 9)})m, 토출량:(${w(pm, flow, 9)})ℓ/min`
    const engineBlank = `  ${ck(false)}전동기 ${ck(false)}내연기관(연료:${ck(false)}경유 ${ck(false)}기타`
    entries.push(
      ['s32PmMark', `${ck(used(pm))}펌프방식`],
      ['s32PmSys1', sys1(pm)], ['s32PmSys2', sys2(pm)], ['s32PmSys3', sys3(pm)],
      ['s32PmLoc', loc(pm)],
      ['s32PmMain', pumpRow('주펌프', 'main_head', 'main_flow')],
      ['s32PmMainEngine', engineBlank],
      ['s32PmReserve', pumpRow('예비펌프', 'reserve_head', 'reserve_flow')],
      ['s32PmReserveEngine', engineBlank],
      ['s32PmJockey', pumpRow('충압펌프', 'jockey_head', 'jockey_flow')],
      ['s32PmPriming', `◦ ${ck(!!str(pm, 'priming') || !!str(pm, 'priming_capacity') || !!str(pm, 'priming_pipe'))}물올림장치(유효수량: (${w(pm, 'priming_capacity', 9)})ℓ, 급수배관: (${w(pm, 'priming_pipe', 9)})㎜`],
      ['s32PmStarter', `◦ 기동장치: ${ck(inArr(pm, 'starter', '기동용수압개폐장치'))}기동용수압개폐장치, ${ck(inArr(pm, 'starter', 'ON/OFF 방식'))}ON/OFF 방식`],
      ['s32PmChamber', `  ${ck(!!str(pm, 'chamber') || !!str(pm, 'chamber_capacity') || !!str(pm, 'chamber_pressure'))}압력챔버(용량:(${w(pm, 'chamber_capacity', 9)})ℓ, 사용압력:(${w(pm, 'chamber_pressure', 9)})MPa)`],
      ['s32PmSwitch', `  ${ck(!!str(pm, 'pressure_switch'))}기동용압력스위치(${ck(isSel(pm, 'pressure_switch', '부르동관식'))}부르동관식 ${ck(isSel(pm, 'pressure_switch', '전자식'))}전자식 ${ck(isSel(pm, 'pressure_switch', '그 밖의 것'))}그 밖의 것)`],
      ['s32PmDecomp', `◦ ${ck(!!str(pm, 'decompress') || !!str(pm, 'decompress_place'))}감압장치 ${ck(isSel(pm, 'decompress_ground', '지상'))}지상/${ck(isSel(pm, 'decompress_ground', '지하'))}지하 (${w(pm, 'decompress_floor', 3)})층, 설치장소:(${w(pm, 'decompress_place', 18)})`],
      // 송수구 — 자기 systems를 쓴다(수식이 복사하던 펌프방식 것이 아니다)
      ['s32InSys1', sys1(inlet)], ['s32InSys2', sys2(inlet)], ['s32InSys3', sys3(inlet)],
      ['s32InPlace', `◦ 설치장소:(${w(inlet, 'place', 17)}), ${ck(!!str(inlet, 'twin_count'))}쌍구형 (${w(inlet, 'twin_count', 3)})개/${ck(!!str(inlet, 'single_count'))}단구형 (${w(inlet, 'single_count', 3)})개`],
      // 비상전원 — 줄머리 공백 1칸이 서식 원문이다(지우면 자구 왕복이 붉어진다)
      ['s32EpGen', ` ${ck(inArr(ep, 'types', '자가발전설비'))}자가발전설비(${ck(isSel(ep, 'gen_type', '소방전용'))}소방전용 ${ck(isSel(ep, 'gen_type', '소방부하겸용'))}소방부하겸용 ${ck(isSel(ep, 'gen_type', '소방전원보존형'))}소방전원보존형 ${ck(isSel(ep, 'gen_type', '기타'))}기타(${w(ep, 'gen_etc', 10)}))`],
      ['s32EpEtc', ` ${ck(inArr(ep, 'types', '비상전원수전설비'))}비상전원수전설비 ${ck(inArr(ep, 'types', '축전지설비'))}축전지설비 ${ck(inArr(ep, 'types', '전기저장장치'))}전기저장장치`],
      ['s32EpLoc', loc(ep)],
    )
  }

  // ── 현2 3-3 수계소화설비(개별사항)·3-4 가스계소화설비 23칸 (Phase 4 / S9-1) ──
  //
  // 설비 설치 마크(A24·A27·A28·A30·A32·A34·A36·A40~A46)는 **배선하지 않는다** —
  // `현황!C12~C25` 수식이라 이미 흐른다(실측 _p4-hyeon-labels). 여기서 덮으면 두 축이 겹친다.
  //
  // ⚠ 층 범위 줄(rangeLine)의 **둘째 줄 자구가 PDF와 다르다**: PDF rangeLines2는 `: `를 앞에
  //   붙이는데(spec-sections:116) 이 시트는 공백 12칸이다. 시트별 자구를 섞지 않는다.
  // ⚠ 엑셀 3-3에는 **미분무소화설비 행이 없다**(PDF에는 있다 — `현황!C17`도 건너뛴다).
  //   서식에 칸이 없으므로 실을 곳이 없다. 없는 칸을 만들지 않는다.
  // ⚠ C43의 단위 대괄호는 `[ ]`(공백 1칸)로 다른 칸(`[  ]`)과 **폭이 다르다** — 원문 그대로다.
  {
    const s33 = ((p.specs?.['s33_water_each'] ?? null) as Record<string, unknown> | null)
    const s34 = ((p.specs?.['s34_gas'] ?? null) as Record<string, unknown> | null)
    const b3 = (k: string) => ((s33?.[k] ?? null) as Record<string, unknown> | null)
    const gas = ((s34?.['gas_system'] ?? null) as Record<string, unknown> | null)

    const str = (b: Record<string, unknown> | null, k: string) => String(b?.[k] ?? '').trim()
    const w = (b: Record<string, unknown> | null, k: string, n: number) => {
      const s = str(b, k)
      return s ? ` ${s} ` : ' '.repeat(n)
    }
    const isSel = (b: Record<string, unknown> | null, k: string, o: string) => str(b, k) === o
    const inArr = (b: Record<string, unknown> | null, k: string, o: string) => {
      const v = b?.[k]
      return Array.isArray(v) && v.map(String).includes(o)
    }
    /** 단위 칸만 쓰는 폭 1 대괄호 — 서식 원문이 여기만 `[ ]`다 */
    const ck1 = (on: boolean) => (on ? '[√]' : '[ ]')
    /** 층 범위 — 동명 3 · 층 2. 접미사 '2'면 둘째 줄 필드를 읽는다(PDF rangeLine과 같은 키) */
    const range = (b: Record<string, unknown> | null, sfx = '') =>
      `동명(${w(b, `dong${sfx}`, 3)}) ${ck(isSel(b, `coverage${sfx}`, '전체층'))}전체층/${ck(isSel(b, `coverage${sfx}`, '일부층'))}일부층 `
      + `${ck(isSel(b, `from_ground${sfx}`, '지상'))}지상/${ck(isSel(b, `from_ground${sfx}`, '지하'))}지하(${w(b, `from_floor${sfx}`, 2)})층 ~ `
      + `${ck(isSel(b, `to_ground${sfx}`, '지상'))}지상/${ck(isSel(b, `to_ground${sfx}`, '지하'))}지하(${w(b, `to_floor${sfx}`, 2)})층`
    const locRange = (b: Record<string, unknown> | null) => `◦ 설치장소: ${range(b)}`
    const locRange2 = (b: Record<string, unknown> | null) => `${' '.repeat(12)}${range(b, '2')}`

    const ih = b3('indoor_hydrant'), oh = b3('outdoor_hydrant')
    const sp = b3('sprinkler'), ss = b3('simple_sprinkler')
    const es = b3('early_suppression'), ws = b3('water_spray'), fo = b3('foam')

    entries.push(
      // 3-3
      ['s33IhLoc', locRange(ih)], ['s33IhLoc2', locRange2(ih)],
      ['s33IhMax', `◦ 설치개수가 가장 많은 층의 설치개수: (${w(ih, 'max_count', 3)})개`],
      ['s33OhCount', `◦ 설치개수: (${w(oh, 'count', 3)})개`],
      ['s33SpType', `◦ 종류: ${ck(isSel(sp, 'type', '습식'))}습식 ${ck(isSel(sp, 'type', '부압식'))}부압식 ${ck(isSel(sp, 'type', '준비작동식'))}준비작동식 ${ck(isSel(sp, 'type', '건식'))}건식 ${ck(isSel(sp, 'type', '일제살수식'))}일제살수식`],
      ['s33SpLoc', locRange(sp)],
      ['s33SsType', `◦ 종류: ${ck(isSel(ss, 'type', '펌프'))}펌프 ${ck(isSel(ss, 'type', '캐비닛'))}캐비닛 ${ck(isSel(ss, 'type', '상수도'))}상수도`],
      ['s33SsLoc', locRange(ss)],
      ['s33EsLoc', locRange(es)], ['s33EsLoc2', locRange2(es)],
      ['s33WsLoc', locRange(ws)], ['s33WsLoc2', locRange2(ws)],
      ['s33FoSystem', `${ck(inArr(fo, 'system', '포워터스프링클러설비'))}포워터스프링클러설비 ${ck(inArr(fo, 'system', '포헤드설비'))}포헤드설비 ${ck(inArr(fo, 'system', '고정포방출설비'))}고정포방출설비 ${ck(inArr(fo, 'system', '기타'))}기타(${w(fo, 'system_etc', 15)})`],
      ['s33FoAgent', `◦ 소화약제 ${ck(inArr(fo, 'agent', '단백포'))}단백포 ${ck(inArr(fo, 'agent', '합성계면활성제포'))}합성계면활성제포 ${ck(inArr(fo, 'agent', '수성막포'))}수성막포 ${ck(inArr(fo, 'agent', '내알코올포'))}내알코올포`],
      ['s33FoLoc', locRange(fo)],
      // 3-4 — 전부 gas_system 한 블록이다
      ['s34Discharge', `${ck(inArr(gas, 'discharge', '전역방출'))}전역방출 ${ck(inArr(gas, 'discharge', '국소방출'))}국소방출 ${ck(inArr(gas, 'discharge', '호스릴'))}호스릴 / ${ck(isSel(gas, 'pressure_class', '고압식'))}고압식 ${ck(isSel(gas, 'pressure_class', '저압식'))}저압식 / ${ck(isSel(gas, 'charge_type', '축압식'))}축압식 ${ck(isSel(gas, 'charge_type', '가압식'))}가압식`],
      ['s34Loc', locRange(gas)],
      ['s34Storage', `◦ 저장용기 설치장소: ${ck(isSel(gas, 'storage_ground', '지상'))}지상/${ck(isSel(gas, 'storage_ground', '지하'))}지하 (${w(gas, 'storage_floor', 3)})층, ${ck(isSel(gas, 'storage_room', '전용실'))}전용실 ${ck(isSel(gas, 'storage_room', '기타'))}기타(${w(gas, 'storage_room_etc', 15)})`],
      ['s34Qty', `  수량: (${w(gas, 'qty_amount', 9)})${ck1(isSel(gas, 'qty_unit', '㎏'))}㎏,${ck1(isSel(gas, 'qty_unit', '㎥'))}㎥ (${w(gas, 'qty_liter', 9)})ℓ (${w(gas, 'qty_count', 9)})개`],
      ['s34Agent1', `◦ 소화약제 ${ck(inArr(gas, 'agent', '이산화탄소'))}이산화탄소 ${ck(inArr(gas, 'agent', '할론1301'))}할론1301 ${ck(inArr(gas, 'agent', '할론2402'))}할론2402 ${ck(inArr(gas, 'agent', '할론1211'))}할론1211 ${ck(inArr(gas, 'agent', '할론104'))} 할론104`],
      ['s34Agent2', `  ${ck(inArr(gas, 'agent', 'FC-3-1-10'))}FC-3-1-10 ${ck(inArr(gas, 'agent', 'HCFC BLEND A'))}HCFC BLEND A ${ck(inArr(gas, 'agent', 'HCFC-124'))}HCFC-124 ${ck(inArr(gas, 'agent', 'HFC-125'))}HFC-125 ${ck(inArr(gas, 'agent', 'HFC-227ea'))}HFC-227ea`],
      ['s34Agent3', `  ${ck(inArr(gas, 'agent', 'HFC-23'))}HFC-23 ${ck(inArr(gas, 'agent', 'IG-541'))}IG-541 ${ck(inArr(gas, 'agent', 'IG-100'))}IG-100 ${ck(inArr(gas, 'agent', '기타'))} 기타(${w(gas, 'agent_etc', 11)})`],
      ['s34Agent4', `  ${ck(inArr(gas, 'agent', '제1종분말'))}제1종분말 ${ck(inArr(gas, 'agent', '제2종분말'))}제2종분말 ${ck(inArr(gas, 'agent', '제3종분말'))}제3종분말 ${ck(inArr(gas, 'agent', '제4종분말'))}제4종분말`],
    )
  }

  // ── 현3 3-5 경보설비 21칸 (Phase 4 / S9-1) ────────────────────────────────
  //
  // 설비 설치 마크 8칸(A3·A5·A8·A13·A15·A16·A19·A21)은 `현황!C26~C33` 수식이라 배선하지 않는다.
  //
  // ⚠ **빈칸 폭이 칸마다 다르다** — 수신기 위치는 동명 3/층 3/실명 5인데, 증폭기·속보기·
  //   주수신기 줄은 12/4/13이고 그 줄만 실명 앞에 쉼표가 붙는다. 하나로 통일하면 자구 왕복이
  //   붉어진다. loc3/loc12 두 벌을 두는 이유다.
  // ⚠ 이 시트에는 **화재알림설비 행이 없다**(PDF는 annexHasItem으로 9호에만 낸다).
  //   서식에 칸이 없으므로 실을 곳이 없다 — 3-3의 미분무와 같은 처리.
  {
    const s35 = ((p.specs?.['s35_alarm'] ?? null) as Record<string, unknown> | null)
    const b5 = (k: string) => ((s35?.[k] ?? null) as Record<string, unknown> | null)
    const str = (b: Record<string, unknown> | null, k: string) => String(b?.[k] ?? '').trim()
    const w = (b: Record<string, unknown> | null, k: string, n: number) => {
      const s = str(b, k)
      return s ? ` ${s} ` : ' '.repeat(n)
    }
    const isSel = (b: Record<string, unknown> | null, k: string, o: string) => str(b, k) === o
    const inArr = (b: Record<string, unknown> | null, k: string, o: string) => {
      const v = b?.[k]
      return Array.isArray(v) && v.map(String).includes(o)
    }
    const range = (b: Record<string, unknown> | null, sfx = '') =>
      `동명(${w(b, `dong${sfx}`, 3)}) ${ck(isSel(b, `coverage${sfx}`, '전체층'))}전체층/${ck(isSel(b, `coverage${sfx}`, '일부층'))}일부층 `
      + `${ck(isSel(b, `from_ground${sfx}`, '지상'))}지상/${ck(isSel(b, `from_ground${sfx}`, '지하'))}지하(${w(b, `from_floor${sfx}`, 2)})층 ~ `
      + `${ck(isSel(b, `to_ground${sfx}`, '지상'))}지상/${ck(isSel(b, `to_ground${sfx}`, '지하'))}지하(${w(b, `to_floor${sfx}`, 2)})층`
    /** 접두 붙은 설치장소 — PDF locLine(b, prefix)와 같은 키. 폭·구두점은 칸마다 실측값을 준다 */
    const locP = (b: Record<string, unknown> | null, pre: string, dw: number, fw: number, rw: number, comma: boolean) =>
      `동명(${w(b, `${pre}_dong`, dw)}) ${ck(isSel(b, `${pre}_ground`, '지상'))}지상/${ck(isSel(b, `${pre}_ground`, '지하'))}지하 (${w(b, `${pre}_floor`, fw)})층${comma ? ',' : ''} 실명(${w(b, `${pre}_room`, rw)})`
    const breaker = (b: Record<string, unknown> | null) =>
      `${ck(isSel(b, 'breaker', '무'))}무 ${ck(isSel(b, 'breaker', '유'))}유(설치장소:${w(b, 'breaker_place', 20)})`

    const sd = b5('standalone_detector'), eb = b5('emergency_bell'), fd = b5('fire_detection')
    const bc = b5('broadcast'), ar = b5('auto_report'), im = b5('integrated_monitor')
    const la = b5('leakage_alarm'), ga = b5('gas_leak_alarm')
    const det = fd?.['detector']
    const detEtc = ['불꽃', '아날로그식', '복합형'].some(o => Array.isArray(det) && det.map(String).includes(o))

    entries.push(
      ['s35SdLoc', `◦ 설치장소: ${range(sd)}`],
      ['s35SdPower', `◦ 주전원 ${ck(isSel(sd, 'power', '상용전원'))}상용전원 ${ck(isSel(sd, 'power', '건전지'))}건전지`],
      ['s35EbType', `${ck(inArr(eb, 'type', '비상벨설비'))}비상벨설비 ${ck(inArr(eb, 'type', '자동식사이렌설비'))}자동식사이렌설비`],
      ['s35EbLoc', `◦ 설치장소: ${range(eb)}`],
      ['s35EbPanel', `◦ 조작장치 설치장소: ${locP(eb, 'panel', 12, 3, 14, false)}`],
      // 자동화재탐지설비 — PDF detectionLines(second=true)와 같은 5줄 구성
      ['s35FdReceiver', `◦ 수신기 위치: ${locP(fd, 'receiver', 3, 3, 5, false)}`],
      ['s35FdMode', `◦ 경보방식 ${ck(isSel(fd, 'alarm_mode', '전층경보'))}전층경보 ${ck(isSel(fd, 'alarm_mode', '우선경보'))}우선경보, 시각경보기 ${ck(isSel(fd, 'visual_alarm', '유'))}유 ${ck(isSel(fd, 'visual_alarm', '무'))}무`],
      ['s35FdLoc', `◦ 설치장소: ${range(fd)}`],
      ['s35FdLoc2', `${' '.repeat(12)}${range(fd, '2')}`],
      ['s35FdDet', `◦ 감지기종류 ${ck(inArr(fd, 'detector', '열'))}열 ${ck(inArr(fd, 'detector', '연기'))}연기 ${ck(detEtc)}그 밖의 것(${ck(inArr(fd, 'detector', '불꽃'))}불꽃 ${ck(inArr(fd, 'detector', '아날로그식'))}아날로그식 ${ck(inArr(fd, 'detector', '복합형'))}복합형)`],
      ['s35BcUsage', `${ck(isSel(bc, 'usage', '전용'))}전용 ${ck(isSel(bc, 'usage', '겸용'))}겸용 / ${ck(isSel(bc, 'alarm_mode', '전층경보'))}전층경보 ${ck(isSel(bc, 'alarm_mode', '우선경보'))}우선경보`],
      ['s35BcAmp', `◦ 증폭기 설치장소: ${locP(bc, 'amp', 12, 4, 13, true)}`],
      ['s35ArLoc', `◦ 속보기 설치장소: ${locP(ar, 'reporter', 12, 4, 13, true)}`],
      ['s35ImMain', `◦ 주수신기 설치장소: ${locP(im, 'main', 12, 4, 13, true)}`],
      ['s35ImSub', `◦ 부수신기 설치장소: ${locP(im, 'sub', 12, 4, 13, true)}`],
      ['s35ImNet', `◦ 정보통신망 ${ck(isSel(im, 'network', '광케이블'))}광케이블 ${ck(isSel(im, 'network', '기타'))}기타(${w(im, 'network_etc', 12)}) / 예비선로 ${ck(isSel(im, 'spare_line', '유'))}유 ${ck(isSel(im, 'spare_line', '무'))}무`],
      // 누전경보기 — 서식 라벨이 '주수신기'다(PDF는 '수신기'). 시트 자구를 따른다.
      // ⚠ 차단기구 '무'만 폭 1 대괄호(`[ ]`)다 — 원문 그대로.
      ['s35LaLoc', `◦ 주수신기 설치장소: ${locP(la, 'receiver', 12, 4, 13, true)}`],
      ['s35LaGrade', `◦ 수신기 형식 ${ck(isSel(la, 'grade', '1급'))}1급 ${ck(isSel(la, 'grade', '2급'))}2급, 차단기구 ${isSel(la, 'breaker', '무') ? '[√]' : '[ ]'}무 ${ck(isSel(la, 'breaker', '유'))}유(설치장소:${w(la, 'breaker_place', 20)})`],
      ['s35GaForm', `◦ ${ck(isSel(ga, 'form', '단독형'))}단독형 ${ck(isSel(ga, 'form', '분리형'))}분리형, 사용가스종류 ${ck(isSel(ga, 'gas', 'LNG'))}LNG ${ck(isSel(ga, 'gas', 'LPG'))}LPG, 경계구역 수: (${w(ga, 'zone_count', 5)})개`],
      ['s35GaLoc', `◦ 수신기 설치장소: ${locP(ga, 'receiver', 12, 4, 13, true)}`],
      ['s35GaBreaker', `◦ 차단기구 ${breaker(ga)}`],
    )
  }

  // ── 이행조치 기간 4칸(별지 10·11호 축) ──
  // 서식은 J9(총 일수)만 실입력이고 G9{=B10}·I9{=G9+J9-1}·G10{=I9}은 수식이다. 그런데 I9가
  // **산술 복합 수식**이라 단일 참조 폐포가 못 따라가고 LO는 재계산을 안 하므로(D-9), 파생 칸의
  // 캐시까지 여기서 계산해 준다. 값은 PDF와 같은 `actionPlanPeriod()` 단일 원천에서 온다(D-7).
  // ⚠ 서식의 G9는 발신일자를 가리키지만 PDF는 **실제 시작일**을 인쇄한다 — 실제 날짜로 덮는다.
  //   `I9 = G9 + J9 - 1`이 그대로 성립하므로(days가 양끝 포함) 엑셀에서 재계산해도 어긋나지 않는다.
  const ap = p.actionPeriod ?? null
  entries.push(
    ['actionStartSerial', ap ? isoToSerial(ap.startISO) : null],
    ['actionEndSerial', ap ? isoToSerial(ap.endISO) : null],
    ['actionDoneSerial', ap ? isoToSerial(ap.endISO) : null],
    ['actionDays', ap ? ap.days : null],
  )
  // ── 현5(별지 9호 8쪽) 불량 세부 7행 — 그룹당 1칸으로 접는다 ──
  // PDF는 그룹당 N행을 rowspan으로 펼치지만 엑셀 서식은 그룹당 1행 고정이라 접기가 불가피하다.
  // 서식이 접기를 전제한다: r4~r10이 ht="77.25"(헤더의 2배)로 한 칸에 5줄 안팎이 들어간다.
  // ⚠ B열(점검번호)과 C열(불량내용)을 **같은 인덱스로** 자른다 — 따로 자르면 남의 불량에 남의
  //   번호가 붙는다(짝이 어긋난 채로도 인쇄는 멀쩡해 보인다).
  // ⚠ 넘치는 분은 자르되 `defectOverflow`로 남겨 라우트가 missing에 실을 수 있게 한다(S8-2 규약).
  for (const { group, row } of DEFECT_GROUP_ROWS) {
    const rows = (p.defectRows ?? []).filter(r => r.group === group)
    const kept = rows.slice(0, DEFECT_ROWS_PER_GROUP)
    entries.push(
      [`defectCode${row}`, kept.length ? kept.map(r => r.code).join('\n') : null],
      [`defectContent${row}`, kept.length ? kept.map(r => r.content).join('\n') : null],
    )
  }
  return new Map<string, CellValue>(entries)
}

/** 현5 한 칸에 접어 넣는 불량 건수 상한 — 행 높이 77.25pt(≈5줄) 실측 기준.
 *  넘치면 자르되 조용히 버리지 않는다(`defectOverflow`). */
export const DEFECT_ROWS_PER_GROUP = 5

/** 접기로 잘려 나간 불량 건수 — 라우트가 missing에 싣는 축(S8-2: '자르되 missing에 남긴다').
 *  0이면 손실 없음. 이 함수를 따로 둔 이유는 buildWorkbookValues가 값만 돌려주기 때문이다. */
export function defectOverflow(
  defectRows?: Array<{ group: string; code: string; content: string }>,
): Array<{ group: string; dropped: number }> {
  const out: Array<{ group: string; dropped: number }> = []
  for (const { group } of DEFECT_GROUP_ROWS) {
    const n = (defectRows ?? []).filter(r => r.group === group).length
    if (n > DEFECT_ROWS_PER_GROUP) out.push({ group, dropped: n - DEFECT_ROWS_PER_GROUP })
  }
  return out
}

/** 앵커 × 값 → 주입 대상. 값이 없는 앵커는 **명시적 공란**(null)으로 넣는다 —
 *  완전 덮어쓰기 불변식(S3-4): 템플릿 잔재도, 조용한 생략도 없다.
 *  anchors는 validateAnchors가 돌려준(자가치유 반영) 목록을 넣는 것이 정본 — 기본값은 원본 좌표 */
export function toInjectTargets(
  values: Map<string, CellValue>, anchors: Anchor[] = ANCHORS,
): { targets: InjectTarget[]; unmapped: Anchor[] } {
  const targets: InjectTarget[] = []
  const unmapped: Anchor[] = []
  for (const a of anchors) {
    if (!values.has(a.field)) { unmapped.push(a); continue }
    const v = values.get(a.field)!
    const isEmpty = v === null || v === ''
    // 빈 값인데 `keepFormulaWhenEmpty`면 서식의 수식(`=""`)을 살려 둔다 — 이 칸을 복제하는
    // 수식이 **빈 셀을 0으로 읽기** 때문이다(Anchor.keepFormulaWhenEmpty 주석)
    const dropFormula = a.dropFormula === true && !(isEmpty && a.keepFormulaWhenEmpty)
    targets.push({ sheet: a.sheet, cell: a.cell, value: isEmpty ? null : v, dropFormula })
  }
  return { targets, unmapped }
}
