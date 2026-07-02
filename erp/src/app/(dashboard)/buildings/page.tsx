import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Building2, Plus, Search } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/types'

export default async function BuildingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; active?: string; customer?: string; page?: string; per_page?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const q = params.q ?? ''
  const activeFilter = params.active ?? 'active'
  const customerFilter = params.customer ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const pageSize = Math.max(0, parseInt(params.per_page ?? '25', 10))  // 0 = 전체

  const admin = createAdminClient()

  const [buildingsRes, customersRes] = await Promise.all([
    admin
      .from('buildings')
      .select(`
        *,
        customers:customer_id (id, customer_name, customer_code)
      `)
      .order('created_at', { ascending: false }),
    admin
      .from('customers')
      .select('id, customer_name, customer_code')
      .eq('is_active', true)
      .order('customer_name'),
  ])

  type BuildingRow = {
    id: string
    building_name: string
    address: string | null
    total_area: number | null
    floors_above: number | null
    floors_below: number | null
    purpose: string | null
    year_built: number | null
    is_active: boolean
    created_at: string
    customers: { id: string; customer_name: string; customer_code: string } | null
  }

  let buildings = (buildingsRes.data ?? []) as BuildingRow[]
  const customers = (customersRes.data ?? []) as Array<{ id: string; customer_name: string; customer_code: string }>

  if (q) {
    const lq = q.toLowerCase()
    buildings = buildings.filter(b =>
      b.building_name.toLowerCase().includes(lq) ||
      (b.address ?? '').toLowerCase().includes(lq) ||
      (b.purpose ?? '').toLowerCase().includes(lq) ||
      (b.customers?.customer_name ?? '').toLowerCase().includes(lq)
    )
  }
  if (customerFilter) buildings = buildings.filter(b => b.customers?.id === customerFilter)
  if (activeFilter === 'active') buildings = buildings.filter(b => b.is_active)
  if (activeFilter === 'inactive') buildings = buildings.filter(b => !b.is_active)

  const totalCount = buildings.length
  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalCount / pageSize)
  const displayBuildings = pageSize === 0 ? buildings : buildings.slice((page - 1) * pageSize, page * pageSize)

  function buildPageUrl(p: number) {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (activeFilter !== 'active') sp.set('active', activeFilter)
    if (customerFilter) sp.set('customer', customerFilter)
    if (pageSize !== 25) sp.set('per_page', String(pageSize))
    if (p > 1) sp.set('page', String(p))
    const qs = sp.toString()
    return `/buildings${qs ? `?${qs}` : ''}`
  }

  const canCreate = (profile.role as UserRole) !== 'employee'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">건물 관리</h1>
            <p className="text-sm text-[#514b81] mt-0.5">소방점검 대상 건물 정보를 관리합니다</p>
          </div>
        </div>
        {canCreate && (
          <Link
            href="/buildings/new"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
          >
            <Plus className="size-4" />
            건물 등록
          </Link>
        )}
      </div>

      {/* 검색/필터 */}
      <form method="GET" action="/buildings" className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
          <input
            name="q"
            defaultValue={q}
            placeholder="건물명·주소·용도·고객명 검색"
            className="h-9 pl-8 pr-3 rounded-lg border border-[#e5e3f8] bg-white text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-56"
          />
        </div>
        <select
          name="customer"
          defaultValue={customerFilter}
          className="h-9 rounded-lg border border-[#e5e3f8] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 고객사</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.customer_name}</option>
          ))}
        </select>
        <select
          name="active"
          defaultValue={activeFilter}
          className="h-9 rounded-lg border border-[#e5e3f8] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="all">전체 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
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
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
        >
          검색
        </button>
        {(q || customerFilter || activeFilter !== 'active') && (
          <a
            href="/buildings"
            className="h-9 px-3 rounded-lg border border-[#e8e8e8] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center"
          >
            초기화
          </a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {totalCount}개 건물</span>
      </form>

      {/* 목록 테이블 */}
      <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px,rgba(18,43,165,0.04)_0px_6px_6px_-3px,rgba(18,43,165,0.04)_0px_12px_12px_-6px] overflow-hidden">
        {buildings.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">
            등록된 건물이 없습니다
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e8e8e8] bg-[#f8f9fa]">
                  {['건물명', '고객사', '주소', '용도', '연면적', '층수', '준공연도', '상태', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8e8e8]">
                {displayBuildings.map(b => (
                  <tr key={b.id} className="hover:bg-[#f8f9fa] transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#090c1d]">{b.building_name}</p>
                    </td>
                    <td className="px-4 py-3">
                      {b.customers ? (
                        <div>
                          <p className="text-xs font-medium text-[#090c1d]">{b.customers.customer_name}</p>
                          <p className="text-xs text-[#b0acd6] font-mono">{b.customers.customer_code}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-[#b0acd6]">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81] max-w-[160px] truncate">
                      {b.address ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      {b.purpose ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">
                          {b.purpose}
                        </span>
                      ) : (
                        <span className="text-xs text-[#b0acd6]">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {b.total_area != null ? `${b.total_area.toLocaleString()}㎡` : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {b.floors_above != null
                        ? `지상 ${b.floors_above}층${b.floors_below ? ` / 지하 ${b.floors_below}층` : ''}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {b.year_built ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${b.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {b.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/buildings/${b.id}`}
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

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          {page > 1 && (
            <a href={buildPageUrl(page - 1)}
              className="h-8 px-3 rounded-lg border border-[#e5e3f8] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
              이전
            </a>
          )}
          <span className="text-sm text-[#514b81]">{page} / {totalPages}</span>
          {page < totalPages && (
            <a href={buildPageUrl(page + 1)}
              className="h-8 px-3 rounded-lg border border-[#e5e3f8] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
              다음
            </a>
          )}
        </div>
      )}
    </div>
  )
}
