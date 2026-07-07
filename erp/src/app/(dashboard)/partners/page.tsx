import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Handshake, Plus, Search } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const TYPE_LABELS: Record<string, string> = {
  supplier: '공급업체', subcontractor: '협력업체', client: '고객사', other: '기타',
}
const TYPE_COLORS: Record<string, string> = {
  supplier: 'bg-blue-50 text-blue-700',
  subcontractor: 'bg-[#f5f4ff] text-[#7b68ee]',
  client: 'bg-green-50 text-green-700',
  other: 'bg-gray-100 text-gray-600',
}

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; active?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const q = params.q ?? ''
  const typeFilter = params.type ?? ''
  const activeFilter = params.active ?? 'active'

  const admin = createAdminClient()
  const { data: partners } = await admin
    .from('partners')
    .select('*')
    .order('partner_name')

  type PartnerRow = {
    id: string; partner_name: string; partner_type: string
    business_number: string | null; representative: string | null
    phone: string | null; email: string | null; address: string | null
    is_active: boolean; created_at: string
  }

  let rows = (partners ?? []) as PartnerRow[]
  if (q) {
    const lq = q.toLowerCase()
    rows = rows.filter(r =>
      r.partner_name.toLowerCase().includes(lq) ||
      (r.representative ?? '').toLowerCase().includes(lq) ||
      (r.business_number ?? '').includes(q)
    )
  }
  if (typeFilter) rows = rows.filter(r => r.partner_type === typeFilter)
  if (activeFilter === 'active') rows = rows.filter(r => r.is_active)
  if (activeFilter === 'inactive') rows = rows.filter(r => !r.is_active)

  const canCreate = profile.role === 'manager' || profile.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Handshake className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">거래처 관리</h1>
            <p className="text-sm text-[#514b81] mt-0.5">공급업체·협력업체 거래처를 관리합니다</p>
          </div>
        </div>
        {canCreate && (
          <Link
            href="/partners/new"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
          >
            <Plus className="size-4" />거래처 등록
          </Link>
        )}
      </div>

      <form method="GET" action="/partners" className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
          <input name="q" defaultValue={q} placeholder="업체명·대표자·사업자번호"
            className="h-9 pl-8 pr-3 rounded-lg border border-[#d0ccf5] bg-white text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-52" />
        </div>
        <select name="type" defaultValue={typeFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition">
          <option value="">전체 유형</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="active" defaultValue={activeFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition">
          <option value="all">전체 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>
        <button type="submit" className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">검색</button>
        {(q || typeFilter || activeFilter !== 'active') && (
          <a href="/partners" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">초기화</a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {rows.length}개사</span>
      </form>

      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">등록된 거래처가 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa]">
                  {['업체명', '유형', '사업자번호', '대표자', '연락처', '주소', '상태', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c8c4d0]">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-[#f8f9fa] transition-colors">
                    <td className="px-4 py-3 font-medium text-[#090c1d]">{r.partner_name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[r.partner_type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {TYPE_LABELS[r.partner_type] ?? r.partner_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-[#514b81]">{r.business_number ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">{r.representative ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">{r.phone ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-[#514b81] max-w-[140px] truncate">{r.address ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/partners/${r.id}`} className="text-xs text-[#7b68ee] hover:underline font-medium">상세보기</Link>
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
