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
}

/** field → 값. 앵커에 있는 field가 여기 없으면 빌드가 아니라 **테스트가** 잡는다(test-xlsx-anchors) */
export function buildWorkbookValues(src: WorkbookSource): Map<string, CellValue> {
  const { official: o, delegation: d } = src
  const days = d.daysLabel.trim()
  return new Map<string, CellValue>([
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
    ['mainInspector', d.agent.name],
    ['agentName', d.agent.name],
    ['agentPosition', d.agent.position],
    ['agentPhone', d.agent.phone],
    ['agentBirth', d.agent.birth],
    ['repName', o.senderSign.rep],
    // 표지 제목(S7-3) — typeLabel은 표지 PDF(assembleCover)와 같은 inspectionTypeLabel 축에서
    // 파생된 delegation 값이라 두 산출물이 갈라지지 않는다(D-7)
    ['coverTitle', `소방시설 ${d.typeLabel} 결과보고서`],
  ])
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
