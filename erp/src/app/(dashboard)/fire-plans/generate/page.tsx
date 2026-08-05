import { redirect } from 'next/navigation'

/** 구 소방계획서 생성 페이지 — 배치 발행(/inspection-plans/batch)으로 이전 (소방계획서_8 Phase B H-6c) */
export default function FirePlanGenerateRedirect() {
  redirect('/inspection-plans/batch')
}
