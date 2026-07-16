import { redirect } from 'next/navigation'

/** 건물관리 메뉴 A안 완전 삭제 (탭개편 설계 §6, 2026-07-16) —
 *  건물 조회·등록·수정은 고객 상세 > 건물·시설 탭으로 일원화. 기존 북마크 보호용 리다이렉트만 유지. */
export default function BuildingsPage() {
  redirect('/customers')
}
