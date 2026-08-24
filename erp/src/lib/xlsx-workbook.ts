/** 조립 데이터 → 갑지 워크북 주입 값 (소방계획서_27 S4-1 — 순수 변환, 조회 0)
 *
 *  조회 코드는 여기 없다(D-7). 기존 assembleOfficial·assembleDelegation의 반환을 그대로 받아
 *  앵커 값으로 바꾼다 — 그래서 annex_inputs 수동 오버레이가 공짜로 따라오고,
 *  PDF와 엑셀이 같은 값을 쓴다는 것이 구조적으로 보장된다. */
import type { OfficialData } from '@/lib/doc-templates/official'
import type { DelegationData } from '@/lib/doc-templates/delegation'
import { MULTI_USE_COLS } from '@/lib/doc-templates/report9'
import { ANCHORS, type Anchor } from '@/lib/xlsx-anchors'
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
const BLANK_INS_CO = '            '      // 보험사 12칸
const BLANK_INS_PERIOD = '                            '  // 가입기간 — 표본 날짜 자리(28칸)
/** 가입금액 줄은 **주입하지 않는다** — ERP 입력 단위는 천만원(fire-plan-info-panel:407 '천만원',
 *  placeholder '예: 10')인데 갑지 서식 리터럴은 `만원`이라 그대로 넣으면 10배로 오인쇄된다.
 *  표본 잔재도 없는 빈 슬롯이므로 서식 원문을 그대로 남기는 것이 정답이다(단위 통일은 사용자 결정 몫). */
const INS_AMOUNT_LINE = '가입금액:  대인(                  만원 )    대물(                  만원 )'

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
      + `보험사:${p.insCompany.trim() ? ` ${p.insCompany.trim()} ` : BLANK_INS_CO},  가입기간:  ${p.insPeriod.trim() || BLANK_INS_PERIOD}\n`
      + INS_AMOUNT_LINE],
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
  return new Map<string, CellValue>(entries)
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
    targets.push({ sheet: a.sheet, cell: a.cell, value: v === '' ? null : v, dropFormula: a.dropFormula })
  }
  return { targets, unmapped }
}
