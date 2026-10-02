import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Wrench } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadQuoteDocBase } from '@/app/(dashboard)/inspections/repair-sales-actions'
import { RepairSalesPage } from '@/components/inspections/repair-sales-page'
import type { GridDefect } from '@/components/inspections/defect-grid'

/** 보수 견적 전용 화면 (불량 → 매출 1단계 후속, 2026-10-02) — 5단계 칸이 좁아 전체 폭 페이지로 뺐다.
 *
 *  구성: 왼쪽 불량 목록(견적 줄 편집) / 오른쪽 견적서 미리보기(PDF와 같은 조립 quoteDocFrom) /
 *  아래 보내기(관계인 메일, PDF 첨부)·이력. 발송·승인·수주·청구 동작은 repair-sales-actions 그대로다.
 *  점검표 입력 페이지(sheet)와 같은 규약: 전용 경로 /inspections/[id]/repair · [←]는 from= 우선, 없으면 ?step=5. */
export default async function RepairSalesRoute({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ from?: string }>
}) {
  const { id } = await params
  const sp = (await searchParams) ?? {}

  const profile = await getProfile()
  if (!profile) redirect('/login')
  const role = profile.role as UserRole
  if (!can(role, 'inspection_register')) redirect('/dashboard')

  const admin = createAdminClient()
  const { data: inspRaw } = await admin.from('inspections')
    .select('id, customer_id, year, sequence_num, inspection_type, customers:customer_id (customer_name, report_email, email_delivery_consent)')
    .eq('id', id).maybeSingle()
  if (!inspRaw) notFound()
  const insp = inspRaw as unknown as {
    id: string; customer_id: string; year: number | null; sequence_num: number | null; inspection_type: string
    customers: { customer_name: string; report_email: string | null; email_delivery_consent: boolean | null } | null
  }

  // 불량(견적 줄 원천)·관계인(수신 후보)·문서 머리(미리보기·PDF 공용)를 한 물결로
  const [defectsRes, contactsRes, docBase] = await Promise.all([
    admin.from('inspection_defects')
      .select('id, defect_name, defect_detail, severity, photo_url, after_photo_url, action_plan, action_start, action_end, action_taken, action_completed_at')
      .eq('inspection_id', id).order('created_at'),
    admin.from('customer_contacts').select('role, name, email').eq('customer_id', insp.customer_id),
    loadQuoteDocBase(admin, insp.customer_id, id),
  ])
  const defects = (defectsRes.data ?? []) as GridDefect[]
  const contacts = ((contactsRes.data ?? []) as Array<{ role: string; name: string; email: string | null }>)
    .filter(c => !!c.email)
    .map(c => ({ label: `${c.role} ${c.name}`, email: c.email! }))
  // 보고서 수신 이메일(송달 동의) — 관계인 이메일과 다른 값일 수 있어 후보에 함께 올린다
  if (insp.customers?.email_delivery_consent && insp.customers.report_email) {
    const dup = contacts.some(c => c.email.toLowerCase() === insp.customers!.report_email!.toLowerCase())
    if (!dup) contacts.unshift({ label: '보고서 수신(송달 동의)', email: insp.customers.report_email })
  }

  const fromRaw = sp.from?.trim() ?? ''
  const backHref = fromRaw.startsWith('/') && !fromRaw.startsWith('//') ? fromRaw : `/inspections/${id}?step=5`
  const customerName = insp.customers?.customer_name ?? '고객'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href={backHref} className="inline-flex items-center gap-1 rounded-lg border border-brand-line px-2 py-1 text-form-xs text-brand hover:bg-brand-tint"
          data-testid="repair-back">
          <ChevronLeft className="size-3.5" /> 점검 상세
        </Link>
        <Wrench className="size-4 text-brand" />
        <h1 className="text-lg font-bold">{customerName} — 보수 견적</h1>
        <span className="text-form-xs text-ink-meta">{insp.year ?? ''}년 {insp.inspection_type}점검{insp.sequence_num ? ` ${insp.sequence_num}차` : ''}</span>
      </div>
      <RepairSalesPage
        inspectionId={id}
        defects={defects}
        docBase={docBase}
        recipients={contacts}
        canManage={can(role, 'quote_create')}
        perms={{ order: can(role, 'order_manage'), bill: can(role, 'billing_manage') }}
        companyName={docBase.company.name}
        customerName={customerName}
      />
    </div>
  )
}
