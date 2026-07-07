import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MessageCircle, Plus, Search } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const STATUS_LABELS: Record<string, string> = {
  pending: '접수대기',
  in_progress: '처리중',
  resolved: '처리완료',
  cancelled: '취소',
}
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700',
  in_progress: 'bg-blue-50 text-blue-700',
  resolved: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
}
const TYPE_LABELS: Record<string, string> = {
  as_request: 'AS 요청',
  schedule: '일정 조율',
  quote: '견적 문의',
  other: '기타',
}

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const q = params.q ?? ''
  const statusFilter = params.status ?? ''
  const typeFilter = params.type ?? ''

  const admin = createAdminClient()

  const { data: inquiries } = await admin
    .from('inquiries')
    .select(`
      *,
      customers:customer_id (id, customer_name, customer_code),
      creator:created_by (name)
    `)
    .order('created_at', { ascending: false })

  type InquiryRow = {
    id: string
    title: string
    inquiry_type: string
    status: string
    contact_name: string | null
    contact_phone: string | null
    created_at: string
    resolved_at: string | null
    customers: { id: string; customer_name: string; customer_code: string } | null
    creator: { name: string } | null
  }

  let rows = (inquiries ?? []) as InquiryRow[]

  if (q) {
    const lq = q.toLowerCase()
    rows = rows.filter(r =>
      r.title.toLowerCase().includes(lq) ||
      (r.customers?.customer_name ?? '').toLowerCase().includes(lq) ||
      (r.contact_name ?? '').toLowerCase().includes(lq)
    )
  }
  if (statusFilter) rows = rows.filter(r => r.status === statusFilter)
  if (typeFilter) rows = rows.filter(r => r.inquiry_type === typeFilter)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageCircle className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">문의요청 관리</h1>
            <p className="text-sm text-[#514b81] mt-0.5">고객 AS·일정·견적 문의를 접수·처리합니다</p>
          </div>
        </div>
        <Link
          href="/inquiries/new"
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
        >
          <Plus className="size-4" />
          문의 등록
        </Link>
      </div>

      {/* 필터 */}
      <form method="GET" action="/inquiries" className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
          <input
            name="q"
            defaultValue={q}
            placeholder="제목·고객명·담당자 검색"
            className="h-9 pl-8 pr-3 rounded-lg border border-[#d0ccf5] bg-white text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-52"
          />
        </div>
        <select
          name="type"
          defaultValue={typeFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 유형</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={statusFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
        >
          검색
        </button>
        {(q || statusFilter || typeFilter) && (
          <a
            href="/inquiries"
            className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center"
          >
            초기화
          </a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {rows.length}건</span>
      </form>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">문의요청이 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa]">
                  {['유형', '제목', '고객사', '담당 연락처', '등록자', '접수일', '상태', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c8c4d0]">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-[#f8f9fa] transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">
                        {TYPE_LABELS[r.inquiry_type] ?? r.inquiry_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-[#090c1d] max-w-[200px] truncate">{r.title}</td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {r.customers?.customer_name ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {r.contact_name && <p>{r.contact_name}</p>}
                      {r.contact_phone && <p className="text-[#b0acd6]">{r.contact_phone}</p>}
                      {!r.contact_name && !r.contact_phone && '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {r.creator?.name ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#292d34]">
                      {r.created_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/inquiries/${r.id}`}
                        className="text-xs text-[#7b68ee] hover:underline font-medium"
                      >
                        상세보기
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
