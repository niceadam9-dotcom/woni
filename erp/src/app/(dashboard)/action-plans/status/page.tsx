import { redirect } from 'next/navigation'

// 소방계획서_5 §7-A R14-c — 이행계획 제출현황(수기)은 보고서 센터 '제출 현황'(타임라인 단일 소스)으로 통합.
export default function ActionPlanStatusRedirect() {
  redirect('/reports?form=submissions')
}
