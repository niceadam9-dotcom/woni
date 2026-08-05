import { redirect } from 'next/navigation'

// 소방계획서_8 Phase B(H-6b) — 제출 현황은 대시보드 위젯으로 이전 (보고서 센터 해체).
// 즐겨찾기·기존 링크 보호를 위해 리다이렉트만 유지.
export default function InspectionReportStatusRedirect() {
  redirect('/dashboard#submissions')
}
