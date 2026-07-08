import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckSquare, FileText } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

const TEMPLATE_MAP: Record<string, string> = {
  general: '일반 기안서',
  business_trip: '출장 신청서',
  purchase_request: '구매 요청서',
  expense_report: '비용 정산서',
}

export default async function ApprovalsPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  // 이중 방어: proxy(구 미들웨어) role 체크와 별개로 페이지 자체에서도 차단
  if (!['manager', 'admin'].includes(profile.role)) redirect('/dashboard')

  const supabase = await createClient()

  const { data: myApprovalsRaw } = await supabase
    .from('document_approvers')
    .select('document_id, order_num')
    .eq('approver_id', profile.id)
    .eq('status', 'pending')

  const myApprovals = (myApprovalsRaw ?? []) as Array<{ document_id: string; order_num: number }>

  if (myApprovals.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">결재함</h1>
          <p className="text-sm text-[#514b81] mt-1">결재 요청된 문서 목록</p>
        </div>
        <div className="bg-white rounded-xl border border-[#c8c4d0] py-16 text-center">
          <CheckSquare className="size-10 text-[#c4bff5] mx-auto mb-3" />
          <p className="text-sm text-[#514b81]">결재 대기 중인 문서가 없습니다</p>
        </div>
      </div>
    )
  }

  const docIds = myApprovals.map(a => a.document_id)
  const { data: allApproversRaw } = await supabase
    .from('document_approvers')
    .select('document_id, order_num, status')
    .in('document_id', docIds)

  const allApprovers = (allApproversRaw ?? []) as Array<{
    document_id: string; order_num: number; status: string
  }>

  const activeDocIds = myApprovals
    .filter(mine => {
      const prev = allApprovers.filter(
        a => a.document_id === mine.document_id && a.order_num < mine.order_num
      )
      return prev.every(a => a.status === 'approved')
    })
    .map(a => a.document_id)

  type DocRow = { id: string; title: string; template_type: string; submitted_at: string | null; author_id: string }

  let docs: Array<DocRow & { author_name?: string }> = []

  if (activeDocIds.length > 0) {
    const { data: docsRaw } = await supabase
      .from('documents')
      .select('id, title, template_type, submitted_at, author_id')
      .in('id', activeDocIds)
      .eq('status', 'pending')

    const rawDocs = (docsRaw ?? []) as DocRow[]

    const authorIds = [...new Set(rawDocs.map(d => d.author_id))]
    const { data: authorsRaw } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', authorIds)

    const authorMap = new Map(
      ((authorsRaw ?? []) as Array<{ id: string; name: string }>).map(a => [a.id, a.name])
    )

    docs = rawDocs.map(d => ({ ...d, author_name: authorMap.get(d.author_id) }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">결재함</h1>
        <p className="text-sm text-[#514b81] mt-1">결재 요청된 문서 목록</p>
      </div>

      {docs.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#c8c4d0] py-16 text-center">
          <CheckSquare className="size-10 text-[#c4bff5] mx-auto mb-3" />
          <p className="text-sm text-[#514b81]">결재 대기 중인 문서가 없습니다</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
          <div className="divide-y divide-[#c8c4d0]">
            {docs.map(doc => (
              <Link
                key={doc.id}
                href={`/approvals/${doc.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-[#f8f9fa] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="size-4 text-[#7b68ee] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#090c1d] truncate">{doc.title}</p>
                    <p className="text-xs text-[#514b81] mt-0.5">
                      {doc.author_name ?? '알 수 없음'}
                      {' · '}
                      {TEMPLATE_MAP[doc.template_type] ?? doc.template_type}
                      {doc.submitted_at && ` · ${new Date(doc.submitted_at).toLocaleDateString('ko-KR')}`}
                    </p>
                  </div>
                </div>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[#f5f4ff] text-[#7b68ee] shrink-0 ml-4">
                  결재 요청
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
