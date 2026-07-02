import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

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

export default async function AdminDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; per_page?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  const params = await searchParams
  const q = params.q ?? ''
  const statusFilter = params.status ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const pageSize = Math.max(0, parseInt(params.per_page ?? '25', 10))  // 0 = 전체

  const admin = createAdminClient()

  const from = pageSize > 0 ? (page - 1) * pageSize : 0
  const to = pageSize > 0 ? page * pageSize - 1 : 99999

  let query = admin
    .from('documents')
    .select('id, title, template_type, status, submitted_at, created_at, author_id', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(from, to)

  if (statusFilter) query = query.eq('status', statusFilter) as typeof query

  const { data: docsRaw, count } = await query

  type DocRow = {
    id: string; title: string; template_type: string
    status: string; submitted_at: string | null; created_at: string; author_id: string
  }

  let docs = (docsRaw ?? []) as DocRow[]

  if (q) {
    const lq = q.toLowerCase()
    docs = docs.filter(d => d.title.toLowerCase().includes(lq))
  }

  const authorIds = [...new Set(docs.map(d => d.author_id))]
  const authorMap = new Map<string, string>()
  if (authorIds.length > 0) {
    const { data: authRaw } = await admin.from('profiles').select('id, name').in('id', authorIds)
    ;((authRaw ?? []) as Array<{ id: string; name: string }>).forEach(p => authorMap.set(p.id, p.name))
  }

  const totalPages = pageSize === 0 ? 1 : Math.ceil((count ?? 0) / pageSize)

  function buildUrl(p: number) {
    const qs = new URLSearchParams()
    if (q) qs.set('q', q)
    if (statusFilter) qs.set('status', statusFilter)
    if (pageSize !== 25) qs.set('per_page', String(pageSize))
    if (p > 1) qs.set('page', String(p))
    return `/admin/documents${qs.size ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">전체 기안서 현황</h1>
          <p className="text-sm text-[#514b81] mt-0.5">모든 기안서를 조회하고 검색합니다</p>
        </div>
      </div>

      {/* 필터 */}
      <form method="GET" action="/admin/documents" className="flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="제목 검색"
          className="h-9 rounded-lg border border-[#e5e3f8] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-52"
        />
        <select
          name="status"
          defaultValue={statusFilter}
          className="h-9 rounded-lg border border-[#e5e3f8] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS_MAP).map(([v, { label }]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <select
          name="per_page"
          defaultValue={String(pageSize)}
          className="h-9 rounded-lg border border-[#e5e3f8] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="25">25건</option>
          <option value="50">50건</option>
          <option value="0">전체</option>
        </select>
        <button type="submit" className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">
          검색
        </button>
        {(q || statusFilter) && (
          <a href="/admin/documents" className="h-9 px-3 rounded-lg border border-[#e8e8e8] text-sm text-[#514b81] hover:bg-[#f8f9fa] flex items-center">
            초기화
          </a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {count ?? 0}건</span>
      </form>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px,rgba(18,43,165,0.04)_0px_6px_6px_-3px,rgba(18,43,165,0.04)_0px_12px_12px_-6px] overflow-hidden">
        {docs.length === 0 ? (
          <div className="py-16 text-center">
            <FileText className="size-10 text-[#c4bff5] mx-auto mb-3" />
            <p className="text-sm text-[#514b81]">기안서가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e8e8e8] bg-[#f8f9fa]">
                  {['제목', '양식', '기안자', '상태', '상신일'].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#514b81]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8e8e8]">
                {docs.map(doc => {
                  const s = STATUS_MAP[doc.status] ?? { label: doc.status, className: '' }
                  return (
                    <tr key={doc.id} className="hover:bg-[#f8f9fa] transition-colors">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/documents/${doc.id}`}
                          className="font-medium text-[#090c1d] hover:text-[#7b68ee] hover:underline truncate max-w-xs block"
                        >
                          {doc.title}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[#514b81] whitespace-nowrap">
                        {TEMPLATE_MAP[doc.template_type] ?? doc.template_type}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[#292d34]">
                        {authorMap.get(doc.author_id) ?? '알 수 없음'}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${s.className}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[#514b81] whitespace-nowrap">
                        {doc.submitted_at
                          ? new Date(doc.submitted_at).toLocaleDateString('ko-KR')
                          : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 && (
            <a href={buildUrl(page - 1)} className="h-8 px-3 rounded-lg border border-[#e8e8e8] text-sm text-[#514b81] hover:bg-[#f8f9fa] flex items-center">
              이전
            </a>
          )}
          <span className="text-sm text-[#514b81] px-2">{page} / {totalPages}</span>
          {page < totalPages && (
            <a href={buildUrl(page + 1)} className="h-8 px-3 rounded-lg border border-[#e8e8e8] text-sm text-[#514b81] hover:bg-[#f8f9fa] flex items-center">
              다음
            </a>
          )}
        </div>
      )}
    </div>
  )
}
