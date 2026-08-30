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
      [`assist${i + 1}Period`, a ? a.period || null : null],
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
