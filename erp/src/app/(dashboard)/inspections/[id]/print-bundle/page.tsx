import { redirect, notFound } from 'next/navigation'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { PrintPdfClient } from '@/components/customers/print-pdf-client'

/** 회차 별지 묶음 자동 인쇄 (소방계획서_18 S1) — 종이 보관용 일괄 출력.
 *  PDF 자체는 같은 출처의 /inspections/{id}/bundle 라우트가 즉석 병합해 반환한다(저장 안 함, D-4). */
export default async function InspectionBundlePrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role as UserRole, 'inspection_register')) redirect('/dashboard')

  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('id, year, sequence_num, customers:customer_id (customer_name)')
    .eq('id', id).maybeSingle()
  if (!insp) notFound()

  const r = insp as unknown as {
    year: number; sequence_num: number; customers: { customer_name: string } | null
  }
  const title = `${r.customers?.customer_name ?? ''} — ${r.year}년 ${r.sequence_num}차 자체점검 서류 일괄`
  return <PrintPdfClient url={`/inspections/${id}/bundle`} title={title}
    fileName={`${r.customers?.customer_name ?? '자체점검'} ${r.year}년 ${r.sequence_num}차 서류.pdf`} />
}
