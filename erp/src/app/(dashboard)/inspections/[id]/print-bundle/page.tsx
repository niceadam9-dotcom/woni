import { redirect, notFound } from 'next/navigation'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { PrintPdfClient } from '@/components/customers/print-pdf-client'

/** 회차 별지 묶음 자동 인쇄 (소방계획서_18 S1) — 종이 보관용 일괄 출력.
 *  PDF 자체는 같은 출처의 /inspections/{id}/bundle 라우트가 즉석 병합해 반환한다(저장 안 함, D-4).
 *  `?types=report11` = 별지 1건만 인쇄 — 제목·파일명이 그 문서 이름을 따른다. */

/** 인쇄 제목·파일명용 짧은 이름 — 알 수 없는 값은 라우트가 400으로 거른다 */
const TYPE_LABEL: Record<string, string> = {
  official: '공문', delegation: '위임장', cover: '표지',
  report9: '별지 9호', report4: '별지 4호', report10: '별지 10호',
  report11: '별지 11호', exterior: '외관점검표',
}

export default async function InspectionBundlePrintPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ types?: string }>
}) {
  const { id } = await params
  const types = (await searchParams)?.types?.trim() || ''
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
  const cust = r.customers?.customer_name ?? ''
  const round = `${r.year}년 ${r.sequence_num}차`
  // 지정된 종류 이름 — 여러 개면 가운뎃점으로 잇는다. 없으면 종전 '자체점검 서류 일괄'
  const picked = types ? types.split(',').map(t => TYPE_LABEL[t.trim()] ?? t.trim()).join('·') : ''
  const what = picked || '자체점검 서류 일괄'
  return <PrintPdfClient
    url={`/inspections/${id}/bundle${types ? `?types=${encodeURIComponent(types)}` : ''}`}
    title={`${cust} — ${round} ${what}`}
    fileName={`${cust || '자체점검'} ${round} ${picked || '서류'}.pdf`} />
}
