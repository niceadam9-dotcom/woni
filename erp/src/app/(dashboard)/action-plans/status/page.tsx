import { redirect } from 'next/navigation'

// 소방계획서_8 Phase B(H-6b) — 제출 현황은 대시보드 위젯으로 이전 (보고서 센터 해체).
export default function ActionPlanStatusRedirect() {
  redirect('/dashboard#submissions')
}
