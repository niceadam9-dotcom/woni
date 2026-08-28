import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MessageCircle, Plus, Search } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { TableScroll, STICKY_THEAD } from '@/components/ui/table-scroll'
import { formatTel } from '@/lib/format-contact'

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
          <MessageCircle className="size-6 text-brand" />
          <div>
            <h1 className="text-xl font-bold text-ink">문의요청 관리</h1>
            <p className="text-sm text-ink-sub mt-0.5">고객 AS·일정·견적 문의를 접수·처리합니다</p>
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint" />
          <input
            name="q"
            defaultValue={q}
            placeholder="제목·고객명·담당자 검색"
            className="h-9 pl-8 pr-3 rounded-lg border border-brand-line bg-surface text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition w-52"
          />
        </div>
        <select
          name="type"
          defaultValue={typeFilter}
          className="h-9 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand transition"
        >
          <option value="">전체 유형</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={statusFilter}
          className="h-9 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand transition"
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
            className="h-9 px-3 rounded-lg border border-line text-sm text-ink-sub hover:bg-paper transition-colors flex items-center"
          >
            초기화
          </a>
        )}
        <span className="text-xs text-ink-sub ml-auto">총 {rows.length}건</span>
      </form>

      {/* 목록 */}
      <div className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-ink-sub">문의요청이 없습니다</div>
        ) : (
          <TableScroll offset={300}>
            <table className="w-full text-sm">
              <thead className={STICKY_THEAD}>
                <tr className="border-b border-line bg-paper">
                  {['유형', '제목', '고객사', '담당 연락처', '등록자', '접수일', '상태', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-ink-sub whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-paper transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-tint text-brand">
                        {TYPE_LABELS[r.inquiry_type] ?? r.inquiry_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink max-w-[200px] truncate">{r.title}</td>
                    <td className="px-4 py-3 text-xs text-ink-sub">
                      {r.customers?.customer_name ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-sub">
                      {r.contact_name && <p>{r.contact_name}</p>}
                      {r.contact_phone && <p className="text-ink-faint">{formatTel(r.contact_phone)}</p>}
                      {!r.contact_name && !r.contact_phone && '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-sub">
                      {r.creator?.name ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-strong">
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
                        className="text-xs text-brand hover:underline font-medium"
                      >
                        상세보기
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>
    </div>
  )
}
