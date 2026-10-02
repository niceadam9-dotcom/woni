'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { SELF_INSPECTION_OR } from '@/lib/doc-status'
import {
  inspectionSheet, staffSheet, invoiceSheet,
  type EvalInspection, type EvalInvoice, type EvalStaff,
} from '@/lib/capability-eval'
import type { SubmissionVia, PlacementResult } from '@/lib/legal-link'

/** B5 — 점검능력평가 실적 묶음 조회. 엑셀은 클라이언트가 만든다(대장 엑셀과 같은 방식).
 *  세금계산서 금액이 들어가므로 `billing_manage`(매니저 이상) — 대장의 계약료 열과 같은 정책. */
export async function getCapabilityEvalAction(year: number): Promise<
  { year: number; inspections: Record<string, string | number>[]; staff: Record<string, string | number>[]; invoices: Record<string, string | number>[]; warnings: string[] }
  | { error: string }
> {
  await requirePermission('billing_manage')
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return { error: '연도를 확인해주세요.' }
  const admin = createAdminClient()
  const from = `${year}-01-01`, to = `${year}-12-31`
  const warnings: string[] = []

  type IRow = {
    id: string; customer_id: string; inspection_type: string; plan_type: string | null; status: string
    inspection_start_date: string | null; inspection_end_date: string | null; assigned_employee_id: string | null
    customer: { customer_name: string; address: string | null; fire_station: string | null } | null
  }
  // 제네릭을 걸지 않는다 — supabase-js가 임베드 customer를 배열로 추론하지만 실제 행은 객체다(아래서 캐스팅)
  const insRes = await fetchAllRows((f, t) => admin.from('inspections')
    .select('id, customer_id, inspection_type, plan_type, status, inspection_start_date, inspection_end_date, assigned_employee_id, customer:customer_id(customer_name, address, fire_station)')
    .or(SELF_INSPECTION_OR).gte('inspection_start_date', from).lte('inspection_start_date', to)
    .order('inspection_start_date').order('id').range(f, t))
  if (insRes.error) return { error: `점검 조회 실패: ${typeof insRes.error === "string" ? insRes.error : (insRes.error as { message: string }).message}` }
  if (insRes.truncated) warnings.push('점검 조회가 상한에서 잘렸습니다 — 일부 행이 빠졌을 수 있습니다')
  const ins = insRes.rows as unknown as IRow[]
  const ids = ins.map(i => i.id), custIds = [...new Set(ins.map(i => i.customer_id))]

  // 167 열은 별도 조회 — 미적용 DB에서 본 조회가 0행으로 떨어지지 않게
  type LRow = { id: string; placement_reported_at: string | null; placement_result: PlacementResult | null; placement_no: string | null
    report9_submitted_at: string | null; report9_submitted_via: SubmissionVia | null; report9_receipt_no: string | null }
  const [legalRes, partRes, bldRes, staffRes, billRes] = await Promise.all([
    ids.length ? admin.from('inspections').select('id, placement_reported_at, placement_result, placement_no, report9_submitted_at, report9_submitted_via, report9_receipt_no').in('id', ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? admin.from('inspection_participants').select('inspection_id, role, sort_order, profiles:employee_id(name, license_no)').in('inspection_id', ids).eq('role', '보조').order('sort_order') : Promise.resolve({ data: [], error: null }),
    custIds.length ? admin.from('buildings').select('customer_id, total_area, is_primary').in('customer_id', custIds).eq('is_active', true) : Promise.resolve({ data: [], error: null }),
    admin.from('profiles').select('id, name, position, license_grade, license_no, hire_date').eq('is_active', true).eq('is_system', false),
    admin.from('bills').select('customer_id, billing_month, bill_type, supply_value, tax_value, total_amount, customers:customer_id(customer_name), tax_invoices(issue_date, approval_num, invoice_status)')
      .like('billing_month', `${year}.%`),
  ])
  for (const [n, r] of [['배치신고·제출', legalRes], ['참여 인력', partRes], ['건물', bldRes], ['직원', staffRes], ['청구', billRes]] as const) {
    if (r.error && !/column .* does not exist/i.test(r.error.message)) warnings.push(`${n} 조회 실패: ${r.error.message}`)
  }
  const legal = new Map(((legalRes.data ?? []) as LRow[]).map(r => [r.id, r]))
  const aux = new Map<string, Array<{ name: string; license: string | null }>>()
  for (const p of (partRes.data ?? []) as unknown as Array<{ inspection_id: string; profiles: { name: string; license_no: string | null } | null }>) {
    const a = aux.get(p.inspection_id) ?? []
    a.push({ name: p.profiles?.name ?? '(삭제된 직원)', license: p.profiles?.license_no ?? null })
    aux.set(p.inspection_id, a)
  }
  // 연면적 — 대표 건물(is_primary) 우선, 없으면 첫 건물. 대장과 같은 「고객 1 : 대표 건물」 축
  const area = new Map<string, number>()
  for (const b of (bldRes.data ?? []) as Array<{ customer_id: string; total_area: number | null; is_primary: boolean | null }>) {
    if (b.total_area == null) continue
    if (b.is_primary || !area.has(b.customer_id)) area.set(b.customer_id, b.total_area)
  }
  const staffRows = (staffRes.data ?? []) as Array<{ id: string; name: string; position: string | null; license_grade: string | null; license_no: string | null; hire_date: string | null }>
  const staffById = new Map(staffRows.map(s => [s.id, s]))

  const evalRows: EvalInspection[] = ins.map(i => {
    const l = legal.get(i.id), m = i.assigned_employee_id ? staffById.get(i.assigned_employee_id) : undefined
    return {
      id: i.id, customerId: i.customer_id, customerName: i.customer?.customer_name ?? '—', address: i.customer?.address ?? null,
      area: area.get(i.customer_id) ?? null, inspectionType: i.inspection_type, planType: i.plan_type, status: i.status,
      startDate: i.inspection_start_date, endDate: i.inspection_end_date,
      mainName: m?.name ?? null, mainLicense: m?.license_no ?? null, aux: aux.get(i.id) ?? [],
      placementReportedAt: l?.placement_reported_at ?? null, placementResult: l?.placement_result ?? null, placementNo: l?.placement_no ?? null,
      report9SubmittedAt: l?.report9_submitted_at ?? null, report9Via: l?.report9_submitted_via ?? null, report9ReceiptNo: l?.report9_receipt_no ?? null,
      fireStation: i.customer?.fire_station ?? null,
    }
  })
  const invoices: EvalInvoice[] = ((billRes.data ?? []) as unknown as Array<{
    customer_id: string; billing_month: string; bill_type: string; supply_value: number; tax_value: number; total_amount: number
    customers: { customer_name: string } | null
    tax_invoices: { issue_date: string | null; approval_num: string | null; invoice_status: string } | Array<{ issue_date: string | null; approval_num: string | null; invoice_status: string }> | null
  }>).flatMap(b => {
    const t = Array.isArray(b.tax_invoices) ? b.tax_invoices[0] : b.tax_invoices
    if (!t) return []
    return [{ customerId: b.customer_id, customerName: b.customers?.customer_name ?? '—', issueDate: t.issue_date, approvalNo: t.approval_num,
      status: t.invoice_status, billingMonth: b.billing_month, billType: b.bill_type,
      supply: Number(b.supply_value) || 0, tax: Number(b.tax_value) || 0, total: Number(b.total_amount) || 0 }]
  })
  const staff: EvalStaff[] = staffRows.map(s => ({ id: s.id, name: s.name, position: s.position, grade: s.license_grade, license: s.license_no, hireDate: s.hire_date }))

  if (evalRows.some(r => r.status === 'completed' && !r.placementReportedAt)) warnings.push('완료 점검 중 배치신고일이 비어 있는 건이 있습니다(작업대 ②에서 기록)')
  if (staff.some(s => !s.license)) warnings.push('경력수첩번호가 없는 직원이 있습니다(사용자 관리에서 입력)')
  return { year, inspections: inspectionSheet(evalRows, invoices), staff: staffSheet(staff, evalRows), invoices: invoiceSheet(invoices), warnings }
}
