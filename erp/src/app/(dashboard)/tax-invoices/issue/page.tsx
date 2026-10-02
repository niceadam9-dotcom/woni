import { redirect, notFound } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatBizNo, formatTel } from '@/lib/format-contact'
import { TaxInvoiceIssueClient } from '@/components/billing/tax-invoice-issue-client'
import { COMPANY_PROFILE_ORDER } from '@/lib/company-profile'

interface Props {
  searchParams: Promise<{ billId?: string }>
}

export default async function TaxInvoiceIssuePage({ searchParams }: Props) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role, 'tax_invoice_manage')) redirect('/dashboard')

  const { billId } = await searchParams
  if (!billId) redirect('/tax-invoices')

  const admin = createAdminClient()

  const { data: bill } = await admin
    .from('bills')
    .select(`
      id, billing_month, bill_type, bill_date,
      supply_value, tax_value, total_amount, notes,
      customer_id,
      customers:customer_id ( customer_name, customer_code, address ),
      tax_invoices ( id, issue_date, approval_num, invoice_status, issued )
    `)
    .eq('id', billId)
    .single()

  if (!bill) notFound()

  // B2 — 종전엔 공급받는자 사업자정보(billing_profiles)를 **읽지 않아** 사업자번호·대표자가 늘 「—」였다.
  // 공급자 행은 다른 화면과 같은 정렬 축(COMPANY_PROFILE_ORDER)으로 읽는다 — 이 표엔 실제로 2행이 있다.
  // 169 열(업태·종목)은 미적용 DB에서 select 전체를 0행으로 만들지 않게 **따로** 읽는다.
  const customerId = (bill as { customer_id?: string }).customer_id ?? ''
  const [{ data: company }, { data: taxCo }, { data: buyer }] = await Promise.all([
    admin.from('company_profile')
      .select('company_name, business_number, representative, address, phone')
      .order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle(),
    admin.from('company_profile')
      .select('business_type, business_item')
      .order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle(),
    admin.from('billing_profiles')
      .select('business_no, company_name, rep_name, address, business_type, business_item, tax_email')
      .eq('customer_id', customerId).maybeSingle(),
  ])

  const co = { ...((company ?? {}) as Record<string, unknown>), ...((taxCo ?? {}) as Record<string, unknown>) }
  return (
    <TaxInvoiceIssueClient
      bill={bill as Record<string, unknown>}
      company={{
        ...co,
        business_number: formatBizNo(co.business_number as string | null),
        phone: formatTel(co.phone as string | null),
      }}
      buyer={(buyer ?? null) as Record<string, unknown> | null}
    />
  )
}
