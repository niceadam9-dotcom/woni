import { redirect } from 'next/navigation'

/** 구 소방계획서 생성 페이지 — 보고서 센터(/reports)로 흡수 (소방계획서_4.md §10-3, R-1) */
export default function FirePlanGenerateRedirect() {
  redirect('/reports')
}
