export type StepReportType = 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6'
export type LegacyReportType = 'fire_station' | 'stakeholder' | 'completion'
export type ReportType = StepReportType | LegacyReportType

export const STEP_REPORT_LABELS: Record<StepReportType, string> = {
  step1: '1단계 — 점검완료 보고서',
  step2: '2단계 — 배치확인서 보고서',
  step3: '3단계 — 관계인 보고서',
  step4: '4단계 — 소방서 제출 / 이행계획서',
  step5: '5단계 — 소방보수 완료 확인서',
  step6: '6단계 — 이행완료 보고서',
}

export const STEP_REPORT_TYPES: StepReportType[] = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6']

export const REPORT_LABELS: Record<ReportType, string> = {
  ...STEP_REPORT_LABELS,
  fire_station: '소방서 제출용',
  stakeholder:  '이해관계자 보고서',
  completion:   '이행완료 보고서',
}
