import type { UserRole } from '@/types'

// ── 기능별 허용 역할 정의 ────────────────────────────────────────────────────
// 권한을 변경할 때는 이 파일의 배열만 수정하면 됩니다.
// 키를 추가하면 actions.ts / page.tsx에서 requirePermission('새키') 로 바로 사용 가능합니다.
//
// 역할 체계
//   employee : 일반 직원
//   manager  : 팀장 / 관리자
//   admin    : 시스템 관리자 (모든 권한)
export const PERMISSIONS = {

  // ── 관리자 ────────────────────────────────────────────────────────────────
  user_manage:    ['admin'],           // 직원 등록 · 수정 · 비활성화
  holiday_manage: ['admin'],           // 공휴일 등록 · 삭제
  company_manage: ['admin'],           // 본사 정보 수정

  // ── 회계관리 ──────────────────────────────────────────────────────────────
  accounting_view:    ['manager', 'admin'], // 회계 메뉴 접근 (손익·재무·부가세)
  voucher_manage:     ['manager', 'admin'], // 전표 등록 · 수정 · 삭제
  tax_invoice_manage: ['manager', 'admin'], // 세금계산서 발행

  // ── 영업관리 ──────────────────────────────────────────────────────────────
  quote_create:   ['employee', 'manager', 'admin'], // 견적 작성 (전 직원)
  quote_manage:   ['manager', 'admin'],             // 견적 수정 · 삭제 · 확정
  order_manage:   ['manager', 'admin'],             // 수주 등록 · 관리
  partner_manage: ['manager', 'admin'],             // 거래처 등록 · 수정

  // ── 구매 / 재고 ───────────────────────────────────────────────────────────
  item_manage:           ['manager', 'admin'], // 품목 등록 · 수정 · 삭제
  item_category_manage:  ['manager', 'admin'], // 품목 분류 관리
  stock_manage:          ['manager', 'admin'], // 입출고 등록 · 재고 조정
  purchase_order_manage: ['manager', 'admin'], // 발주 등록 · 관리

  // ── 소방안전관리 (사이드바 순서) ──────────────────────────────────────────
  customer_manage:             ['manager', 'admin'],            // 고객 등록 · 수정 · 담당자 배정
  building_manage:             ['manager', 'admin'],            // 건물 등록 · 수정
  inspection_sheet_manage:     ['manager', 'admin'],            // 점검표 양식 등록 · 수정
  inspection_plan_manage:      ['manager', 'admin'],            // 점검계획 생성 · 확정 · 삭제
  inspection_plan_item_update: ['employee', 'manager', 'admin'], // 점검 업무 상태 변경 (전 직원)
  inspection_status_edit:      ['employee', 'manager', 'admin'], // 점검현황 날짜 입력 (전 직원)
  inspection_sms_send:         ['employee', 'manager', 'admin'], // 점검 SMS 발송 기록 (전 직원)
  report_status_manage:        ['manager', 'admin'],            // 보고서 제출현황 관리
  action_plan_manage:          ['manager', 'admin'],            // 이행계획서 등록 · 제출현황
  billing_manage:              ['manager', 'admin'],            // 정산현황 관리

  // ── 업무관리 ──────────────────────────────────────────────────────────────
  task_manage: ['manager', 'admin'], // 업무지시 생성 · 수정

} as const satisfies Record<string, UserRole[]>

export type PermissionKey = keyof typeof PERMISSIONS

/** 해당 역할이 특정 권한을 가지고 있는지 확인 */
export function can(role: UserRole, key: PermissionKey): boolean {
  return (PERMISSIONS[key] as readonly UserRole[]).includes(role)
}
