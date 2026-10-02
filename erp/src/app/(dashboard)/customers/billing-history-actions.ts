'use server'

/** 고객 상세 「청구」 탭 — 이 고객의 청구·세금계산서 이력 (불량 → 매출 3단계, 2026-10-02)
 *  종전 탭엔 사업자정보·자동이체·소유자 그룹만 있고 정작 이 고객의 청구 목록이 없었다(정산현황 링크만).
 *  관계인 청구 이력 링크(/p/{token}, kind=billing)가 같은 범위(최근 36건)를 보여 준다 — 직원은 그 위에 수주 연결까지. */
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'

export type CustomerBillRow = {
  id: string
  billing_month: string
  bill_type: string
  fee_type: string | null
  bill_date: string
  total_amount: number
  paid_amount: number
  paid_at: string | null
  order_id: string | null
  invoice: { status: string; issue_date: string | null; approval_num: string | null } | null
}

/** ⚠ requirePermission(redirect)을 쓰지 않는다 — 청구 탭은 고객 관리 권한(전 직원)으로 열리는데 청구 조회는 manager+다.
 *  redirect면 직원이 탭을 여는 순간 홈으로 튕긴다. 권한이 없으면 forbidden만 돌려주고 패널이 스스로 숨는다. */
export async function getCustomerBillingHistoryAction(customerId: string): Promise<{ error?: string; forbidden?: boolean; bills: CustomerBillRow[]; unpaid: number }> {
  const profile = await getProfile()
  if (!profile || !can(profile.role as UserRole, 'billing_manage')) return { forbidden: true, bills: [], unpaid: 0 }
  const admin = createAdminClient()
  const { data, error } = await admin.from('bills')
    .select('id, billing_month, bill_type, fee_type, bill_date, total_amount, paid_amount, paid_at, order_id')
    .eq('customer_id', customerId).order('bill_date', { ascending: false }).limit(36)
  if (error) { console.error('[billing-history] 조회 실패:', error.message); return { error: '청구 이력을 불러오지 못했습니다.', bills: [], unpaid: 0 } }
  const rows = (data ?? []) as Array<Omit<CustomerBillRow, 'invoice'>>
  const { data: inv, error: invErr } = rows.length
    ? await admin.from('tax_invoices').select('bill_id, invoice_status, issue_date, approval_num').in('bill_id', rows.map(r => r.id))
    : { data: [], error: null }
  if (invErr) console.error('[billing-history] 세금계산서 조회 실패:', invErr.message)
  const byBill = new Map(((inv ?? []) as Array<{ bill_id: string; invoice_status: string; issue_date: string | null; approval_num: string | null }>)
    .map(i => [i.bill_id, { status: i.invoice_status, issue_date: i.issue_date, approval_num: i.approval_num }]))
  const bills = rows.map(r => ({ ...r, invoice: byBill.get(r.id) ?? null }))
  const unpaid = bills.reduce((s, b) => s + Math.max(0, Number(b.total_amount) - Number(b.paid_amount)), 0)
  return { bills, unpaid }
}
