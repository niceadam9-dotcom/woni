/** 조립 데이터 → 갑지 워크북 주입 값 (소방계획서_27 S4-1 — 순수 변환, 조회 0)
 *
 *  조회 코드는 여기 없다(D-7). 기존 assembleOfficial·assembleDelegation의 반환을 그대로 받아
 *  앵커 값으로 바꾼다 — 그래서 annex_inputs 수동 오버레이가 공짜로 따라오고,
 *  PDF와 엑셀이 같은 값을 쓴다는 것이 구조적으로 보장된다. */
import type { OfficialData } from '@/lib/doc-templates/official'
import type { DelegationData } from '@/lib/doc-templates/delegation'
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
  }
}

/** field → 값. 앵커에 있는 field가 여기 없으면 빌드가 아니라 **테스트가** 잡는다(test-xlsx-anchors) */
export function buildWorkbookValues(src: WorkbookSource): Map<string, CellValue> {
  const { official: o, delegation: d, building: b, report9: p } = src
  const days = d.daysLabel.trim()
  // √ 통문자열 조각 — 서식 원문의 괄호 어휘(반각 [  ]·전각 ［  ］)를 그대로 따른다
  const ck = (on: boolean) => (on ? '[√]' : '[  ]')
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
