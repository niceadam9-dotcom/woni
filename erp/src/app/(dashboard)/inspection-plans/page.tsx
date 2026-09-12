import { redirect } from 'next/navigation'

/** 점검확정 화면 폐지 → 점검 달력으로 리다이렉트 (2026-09-12 사용자 결정)
 *
 *  폐지한 이유: **확정 절차 자체가 사라졌다** — 점검계획일=점검확정일.
 *  계획 항목은 고객 등록·수정(generateRollingPlanItems)과 매월 1일 크론
 *  (generate-yearly-plans)이 전건 확정(confirmed) 상태로 생성한다. 사람이 날짜를
 *  골라 확정하던 일이 없어졌으니 그 일을 하던 화면도 없다.
 *
 *  이 화면에만 있던 기능의 행방:
 *  · 날짜 이동(드래그·인라인 달력) → 점검 달력(/inspections/calendar) 드래그·데이 패널 일괄 이동
 *  · 점검 시작 → 고객 상세 회차 카드 [작성 시작] · 달력 데이 패널 [시작+완료]
 *  · 담당 재배정 → 고객 관리(원래부터 단일 소스)
 *  · 점검일 규칙의 정본(confirmPlanItemStageOneAction·moveMonthlyPlanItemAction)
 *    → inspections/plan-date-actions.ts로 이관 (화면과 함께 죽으면 안 되는 축)
 *  · 자동생성 마법사·연체 해소·항목 추가·일괄 확정 → 폐지 (생성은 등록·크론이 전담, 확정할 게 없다)
 *
 *  라우트를 지우지 않고 리다이렉트로 두는 이유: 즐겨찾기·기존 링크가 404가 되지 않게 (monitor와 동일 규약). */
export default function InspectionPlansPage() {
  redirect('/inspections/calendar')
}
