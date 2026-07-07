import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, FileText } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { Document } from '@/types'

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft:    { label: '임시저장', className: 'bg-gray-50 text-gray-500' },
  pending:  { label: '결재 중',   className: 'bg-blue-50 text-blue-600' },
  approved: { label: '승인완료', className: 'bg-green-50 text-green-700' },
  rejected: { label: '반려',     className: 'bg-red-50 text-red-600' },
  recalled: { label: '회수됨',   className: 'bg-orange-50 text-orange-600' },
}

const TEMPLATE_MAP: Record<string, string> = {
  general: '일반 기안서',
  business_trip: '출장 신청서',
  purchase_request: '구매 요청서',
  expense_report: '비용 정산서',
}

export default async function DocumentsPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const { data: docsRaw } = await supabase
    .from('documents')
    .select('id, title, template_type, status, submitted_at, updated_at')
    .eq('author_id', profile.id)
    .order('updated_at', { ascending: false })

  const docs = (docsRaw ?? []) as Array<
    Pick<Document, 'id' | 'title' | 'template_type' | 'status' | 'submitted_at' | 'updated_at'>
  >

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">문서함</h1>
          <p className="text-sm text-[#514b81] mt-1">내가 기안한 문서 목록</p>
        </div>
        <Link
          href="/documents/new"
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
        >
          <Plus className="size-4" />
          기안서 작성
        </Link>
      </div>

      {docs.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#c8c4d0] py-16 text-center">
          <FileText className="size-10 text-[#c4bff5] mx-auto mb-3" />
          <p className="text-sm text-[#514b81]">작성한 기안서가 없습니다</p>
          <Link href="/documents/new" className="mt-3 inline-block text-sm text-[#7b68ee] hover:underline">
            기안서 작성하기
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
          <div className="divide-y divide-[#c8c4d0]">
            {docs.map(doc => {
              const s = STATUS_MAP[doc.status] ?? { label: doc.status, className: '' }
              return (
                <Link
                  key={doc.id}
                  href={`/documents/${doc.id}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-[#f8f9fa] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="size-4 text-[#7b68ee] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#090c1d] truncate">{doc.title}</p>
                      <p className="text-xs text-[#514b81] mt-0.5">
                        {TEMPLATE_MAP[doc.template_type] ?? doc.template_type}
                        {' · '}
                        {new Date(doc.updated_at).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ml-4 ${s.className}`}>
                    {s.label}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
