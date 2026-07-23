import { redirect } from 'next/navigation'

// 소방계획서_5 §7-A R14-c — 보고서 제출현황(수기)은 보고서 센터 '제출 현황'(타임라인 단일 소스)으로 통합.
// 즐겨찾기·기존 링크 보호를 위해 리다이렉트만 유지.
export default function InspectionReportStatusRedirect() {
  redirect('/reports?form=submissions')
}
