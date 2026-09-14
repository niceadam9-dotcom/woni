/** 서식 1.10.1 연간 점검 계획 — **PDF와 엑셀이 함께 쓰는 해석기**(사본 금지).
 *
 *  규칙은 둘뿐이다: 고객이 1.10.1에 적어 넣은 값이 **점검계획일 파생 자동값을 이긴다**, 그리고
 *  점검자를 고르지 않았으면 **외주**다(실무 기본값 — 이 ERP 운영사가 대행한다).
 *
 *  🚨 종전엔 이 네 줄이 `fire-plan-template.ts` 안에만 있었다. 엑셀 1.10.1 시트는 앵커가
 *    **0개**라 규칙을 두 번 적을 일이 아예 없었던 것이다(그래서 엑셀은 통째로 공란이었다).
 *    시트를 배선하면서 규칙이 두 표면을 갖게 되므로 `purpose-label`·`agency-status`와 같은
 *    갈래로 떼어 낸다 — 베껴 두면 한쪽만 고쳐지는 날이 온다.
 *
 *  ⚠ 의존은 타입뿐이다(격자·manifest를 물지 않는다).
 */
import type { InspectionPlanSection } from '@/components/customers/plan-form110'

/** 점검계획일에서 파생한 자동값 — `FirePlanGenData`의 그 두 필드다(구조적으로 받는다) */
export type InspectionPlanAuto = {
  operationMonth?: string | null
  comprehensiveMonth?: string | null
}

export type ResolvedInspectionPlan = {
  /** 작동점검 시기 `YYYY년 M월` (없으면 '') */
  opMonth: string
  /** 종합점검 시기 */
  compMonth: string
  /** 종합점검 2차(특급대상물) 시기 — 고객이 적었을 때만 값이 있다 */
  comp2Month: string
  /** 최초점검 시기 */
  initialMonth: string
  isInitial: boolean
  /** '자체' | '외주' — 미선택이면 '외주' */
  opInspector: string
  compInspector: string
}

export function resolveInspectionPlan(
  insp: InspectionPlanSection | null | undefined,
  auto: InspectionPlanAuto,
): ResolvedInspectionPlan {
  return {
    opMonth: insp?.opMonth?.trim() ? insp.opMonth : (auto.operationMonth ?? ''),
    compMonth: insp?.compMonth?.trim() ? insp.compMonth : (auto.comprehensiveMonth ?? ''),
    comp2Month: (insp?.comp2Month ?? '').trim(),
    initialMonth: (insp?.initialMonth ?? '').trim(),
    isInitial: !!insp?.isInitial,
    opInspector: insp?.opInspector || '외주',
    compInspector: insp?.compInspector || '외주',
  }
}

/**
 * 종합점검 블록이 켜지는가 — 서식 1.10.1의 `☐ 종합점검` 머리 상자가 묻는 것.
 *
 * ⚠ 「종합 고객인가」가 아니라 **「안쪽 세 줄 중 하나라도 켜지는가」**로 정의한다. 종합 대상이어도
 *   시기를 아직 안 정했으면 켤 근거가 없고, 반대로 최초점검만 잡힌 건은 종합월이 비어도 켜야
 *   한다(PDF가 최초점검을 독립 행으로 내는 것과 같은 판단 — 소방계획서_19 M-9).
 */
export function hasComprehensiveBlock(ip: ResolvedInspectionPlan): boolean {
  return !!ip.compMonth || ip.isInitial || !!ip.comp2Month
}
