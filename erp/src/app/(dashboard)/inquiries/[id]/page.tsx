import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { MessageCircle, ChevronRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InquiryDetailClient } from '@/components/inquiries/inquiry-detail-client'

export default async function InquiryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { id } = await params
  const admin = createAdminClient()

  const { data: inquiry } = await admin
    .from('inquiries')
    .select(`
      *,
      customers:customer_id (id, customer_name, customer_code),
      creator:created_by (name),
      resolver:resolved_by (name)
    `)
    .eq('id', id)
    .single()

  if (!inquiry) notFound()

  type InquiryWithRelations = {
    id: string
    customer_id: string
    inquiry_type: string
    title: string
    content: string
    status: string
    contact_name: string | null
    contact_phone: string | null
    resolution_notes: string | null
    created_at: string
    resolved_at: string | null
    customers: { id: string; customer_name: string; customer_code: string } | null
    creator: { name: string } | null
    resolver: { name: string } | null
  }

  const inq = inquiry as InquiryWithRelations

  return (
    <div className="space-y-6">
      {/* 브레드크럼 */}
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/inquiries" className="hover:text-[#7b68ee] flex items-center gap-1">
          <MessageCircle className="size-3.5" />
          문의요청 관리
        </Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium truncate max-w-[200px]">{inq.title}</span>
      </div>

      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">{inq.title}</h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-[#514b81]">
            {inq.customers && <span>{inq.customers.customer_name}</span>}
            <span>등록자: {inq.creator?.name ?? '-'}</span>
            <span>접수일: {inq.created_at.slice(0, 10)}</span>
            {inq.resolver && <span>처리자: {inq.resolver.name}</span>}
          </div>
        </div>
        {inq.customers && (
          <Link
            href={`/customers/${inq.customers.id}`}
            className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors flex items-center shrink-0"
          >
            고객사 상세보기
          </Link>
        )}
      </div>

      <InquiryDetailClient
        inquiry={{
          id: inq.id,
          customer_id: inq.customer_id,
          inquiry_type: inq.inquiry_type,
          title: inq.title,
          content: inq.content,
          status: inq.status,
          contact_name: inq.contact_name,
          contact_phone: inq.contact_phone,
          resolution_notes: inq.resolution_notes,
          created_at: inq.created_at,
          resolved_at: inq.resolved_at,
        }}
      />
    </div>
  )
}
