import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Paperclip } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ApprovalFlow } from '@/components/documents/approval-flow'
import { ApproveActions } from '@/components/documents/approve-actions'
import type { Document, DocumentApprover, DocumentAttachment, Profile } from '@/types'

const TEMPLATE_MAP: Record<string, string> = {
  general: '일반 기안서',
  business_trip: '출장 신청서',
  purchase_request: '구매 요청서',
  expense_report: '비용 청구서',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function ApprovalDetailPage({ params }: Props) {
  const { id } = await params
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  const { data: docRaw } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .single()
  const doc = docRaw as Document | null
  if (!doc) notFound()

  const [approversRes, attachmentsRes, authorRes] = await Promise.all([
    supabase
      .from('document_approvers')
      .select('*')
      .eq('document_id', id)
      .order('order_num', { ascending: true }),
    supabase
      .from('document_attachments')
      .select('*')
      .eq('document_id', id),
    supabase
      .from('profiles')
      .select('id, name, email, position')
      .eq('id', doc.author_id)
      .single(),
  ])

  const approvers = (approversRes.data ?? []) as DocumentApprover[]
  const attachments = (attachmentsRes.data ?? []) as DocumentAttachment[]
  const author = authorRes.data as Pick<Profile, 'id' | 'name' | 'email' | 'position'> | null

  // 결재자 프로필 조회
  const approverIds = approvers.map(a => a.approver_id)
  const { data: approverProfilesRaw } = approverIds.length > 0
    ? await supabase.from('profiles').select('id, name, email, position').in('id', approverIds)
    : { data: [] }

  const profileMap = new Map(
    ((approverProfilesRaw ?? []) as Pick<Profile, 'id' | 'name' | 'email' | 'position'>[])
      .map(p => [p.id, p])
  )

  const approversWithProfiles = approvers.map(a => ({
    ...a,
    profile: profileMap.get(a.approver_id) ?? { name: '알 수 없음', email: '', position: null },
  }))

  // 내 차례인지 확인
  const mine = approvers.find(a => a.approver_id === profile.id && a.status === 'pending')
  const isMyTurn =
    mine !== undefined &&
    approvers.filter(a => a.order_num < mine.order_num).every(a => a.status === 'approved')

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/approvals" className="text-[#514b81] hover:text-[#7b68ee] transition-colors mt-1 shrink-0">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <span className="text-xs text-[#514b81]">{TEMPLATE_MAP[doc.template_type] ?? doc.template_type}</span>
          <h1 className="text-xl font-bold text-[#090c1d] mt-0.5 break-words">{doc.title}</h1>
        </div>
      </div>

      {/* Meta */}
      <div className="bg-white rounded-xl border border-[#ece9ff] p-5">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[#514b81] text-xs mb-0.5">기안자</p>
            <p className="font-medium text-[#090c1d]">{author?.name ?? '-'}</p>
          </div>
          <div>
            <p className="text-[#514b81] text-xs mb-0.5">기안일시</p>
            <p className="font-medium text-[#090c1d]">
              {doc.submitted_at
                ? new Date(doc.submitted_at).toLocaleString('ko-KR', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })
                : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl border border-[#ece9ff] p-6">
        <h2 className="text-sm font-semibold text-[#090c1d] mb-4">내용</h2>
        <div className="text-sm text-[#292d34] whitespace-pre-wrap leading-relaxed">{doc.content}</div>
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="bg-white rounded-xl border border-[#ece9ff] p-5">
          <h2 className="text-sm font-semibold text-[#090c1d] mb-3">첨부파일</h2>
          <div className="space-y-2">
            {attachments.map(att => (
              <div
                key={att.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f5f4ff] text-sm text-[#514b81]"
              >
                <Paperclip className="size-4 text-[#7b68ee] shrink-0" />
                <span className="flex-1 truncate">{att.file_name}</span>
                {att.file_size != null && (
                  <span className="text-xs text-[#b0acd6] shrink-0">{(att.file_size / 1024).toFixed(0)}KB</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approval flow */}
      <div className="bg-white rounded-xl border border-[#ece9ff] p-5">
        <h2 className="text-sm font-semibold text-[#090c1d] mb-4">결재선</h2>
        <ApprovalFlow approvers={approversWithProfiles} />
      </div>

      {/* Approve / Reject actions */}
      {isMyTurn && doc.status === 'pending' && (
        <div className="bg-white rounded-xl border border-[#ece9ff] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[#090c1d]">결재 처리</h2>
          <ApproveActions documentId={doc.id} />
        </div>
      )}
    </div>
  )
}
