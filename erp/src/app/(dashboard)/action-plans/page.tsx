import { redirect } from 'next/navigation'

// 소방계획서_5 §7-A R14-d — 이행계획서 등록(수기) 폐지. 신규 건은 점검 타임라인 ⑤⑥ + 불량내역 조치 필드가 대체.
// 점검 업무 목록으로 리다이렉트.
export default function ActionPlansRegisterRedirect() {
  redirect('/inspections')
}
