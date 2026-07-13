import { redirect, notFound } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PrintPdfClient } from '@/components/customers/print-pdf-client'

/** 소방계획서 PDF 자동 인쇄 — 열리면 인쇄 대화상자가 바로 뜬다 (doc02 §8 ③) */
export default async function FirePlanPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const { data: plan } = await admin
    .from('fire_plans')
    .select('title, year, pdf_path, pdf_name, customers:customer_id (customer_name)')
    .eq('id', id)
    .single()
  if (!plan) notFound()

  const p = plan as unknown as {
    title: string | null; year: number; pdf_path: string; pdf_name: string
    customers: { customer_name: string } | null
  }

  const { data: signed, error } = await admin.storage
    .from('fire-plans')
    .createSignedUrl(p.pdf_path, 600)
  if (error || !signed?.signedUrl) notFound()

  const title = `${p.customers?.customer_name ?? ''} — ${p.title ?? `${p.year}년 소방계획서`}`
  return <PrintPdfClient url={signed.signedUrl} title={title} fileName={p.pdf_name} />
}
