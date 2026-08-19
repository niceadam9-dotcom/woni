import { redirect } from 'next/navigation'

/** 구 소방계획서 생성 페이지 — 배치 발행(소방계획서_8 Phase B H-6c)으로 갔다가 그마저 폐지(2026-08-19).
 *  계획서 생성은 고객 상세 소방계획서 탭이 단일 창구라 고객관리 목록으로 보낸다. */
export default function FirePlanGenerateRedirect() {
  redirect('/customers')
}
