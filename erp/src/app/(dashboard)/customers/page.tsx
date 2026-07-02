import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, Plus, Search } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BulkExtractRegionsClient } from '@/components/customers/bulk-extract-regions-client'
import { RegionEditClient } from '@/components/customers/region-edit-client'
import { CustomerRegionFilterClient } from '@/components/customers/customer-region-filter-client'
import type { InspectionType, UserRole } from '@/types'

const TYPE_COLORS: Record<InspectionType, string> = {
  '종합': 'bg-[#f5f4ff] text-[#7b68ee]',
  '최초': 'bg-blue-50 text-blue-600',
  '기타': 'bg-gray-100 text-gray-600',
}

const TYPE_ANNUAL: Record<InspectionType, string> = {
  '종합': '연 2회',
  '최초': '연 1회',
  '기타': '연 1회',
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; active?: string; region_si?: string; region_myeon?: string; region_ri?: string; page?: string; per_page?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const q = params.q ?? ''
  const typeFilter = params.type ?? ''
  const activeFilter = params.active ?? 'active'
  // region_si 미지정 시 양평군 기본값
  const regionFilter = params.region_si !== undefined ? params.region_si : '양평군'
  const regionMyeonFilter = params.region_myeon ?? ''
  const regionRiFilter = params.region_ri ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const pageSize = Math.max(0, parseInt(params.per_page ?? '25', 10))  // 0 = 전체

  const admin = createAdminClient()

  const from = pageSize > 0 ? (page - 1) * pageSize : 0
  const to = pageSize > 0 ? from + pageSize - 1 : 99999

  type CustomerRow = {
    id: string; customer_code: string; customer_name: string; contract_date: string
    use_approval_date: string | null; inspection_type: InspectionType; address: string | null
    region_si: string | null; region_myeon: string | null; region_ri: string | null
    is_active: boolean; assigned_employee_id: string | null; created_at: string
  }

  // region 컬럼 존재 여부 확인 (018_region 마이그레이션 적용 여부)
  const { error: regionColErr } = await admin.from('customers').select('region_si').limit(1)
  const hasRegionCols = !regionColErr

  const baseCols = 'id, customer_code, customer_name, contract_date, use_approval_date, inspection_type, address, is_active, assigned_employee_id, created_at'
  const selectCols = hasRegionCols ? `${baseCols}, region_si, region_myeon, region_ri` : baseCols

  let custQuery = admin
    .from('customers')
    .select(selectCols, { count: 'exact' })
    .order('created_at', { ascending: false })

  if (q) custQuery = custQuery.or(`customer_name.ilike.%${q}%,customer_code.ilike.%${q}%,address.ilike.%${q}%`)
  if (typeFilter) custQuery = custQuery.eq('inspection_type', typeFilter)
  if (activeFilter === 'active') custQuery = custQuery.eq('is_active', true)
  if (activeFilter === 'inactive') custQuery = custQuery.eq('is_active', false)
  if (hasRegionCols) {
    if (regionFilter) custQuery = custQuery.eq('region_si', regionFilter)
    if (regionMyeonFilter) custQuery = custQuery.eq('region_myeon', regionMyeonFilter)
    if (regionRiFilter) custQuery = custQuery.eq('region_ri', regionRiFilter)
  }

  const [customersRes, profilesRes, regionDataRes] = await Promise.all([
    custQuery.range(from, to),
    admin.from('profiles').select('id, name').eq('is_active', true).order('name'),
    hasRegionCols
      ? admin.from('customers').select('region_si, region_myeon, region_ri').not('region_si', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  const customers = (customersRes.data ?? []) as unknown as CustomerRow[]
  const totalCount = customersRes.count ?? 0
  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalCount / pageSize)
  const employees = (profilesRes.data ?? []) as Array<{ id: string; name: string }>
  const empMap = new Map(employees.map(e => [e.id, e.name]))

  type RegionEntry = { region_si: string | null; region_myeon: string | null; region_ri: string | null }
  const regionData = hasRegionCols ? ((regionDataRes.data ?? []) as RegionEntry[]) : []

  // 주소는 있지만 지역 미입력 건수 (일괄 추출 버튼 표시용)
  const missingRegionCount = hasRegionCols
    ? await admin
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .not('address', 'is', null)
        .is('region_si', null)
        .then(r => r.count ?? 0)
    : 0

  const canCreate = (profile.role as UserRole) !== 'employee'

  function buildPageUrl(p: number) {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (typeFilter) sp.set('type', typeFilter)
    if (activeFilter !== 'active') sp.set('active', activeFilter)
    if (regionFilter) sp.set('region_si', regionFilter)
    if (regionMyeonFilter) sp.set('region_myeon', regionMyeonFilter)
    if (regionRiFilter) sp.set('region_ri', regionRiFilter)
    if (pageSize !== 25) sp.set('per_page', String(pageSize))
    if (p > 1) sp.set('page', String(p))
    const qs = sp.toString()
    return `/customers${qs ? `?${qs}` : ''}`
  }

  const isFiltered = !!(q || typeFilter || activeFilter !== 'active' || regionFilter !== '양평군' || regionMyeonFilter || regionRiFilter)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">고객 관리</h1>
            <p className="text-sm text-[#514b81] mt-0.5">소방 점검 계약 고객을 관리합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && missingRegionCount > 0 && (
            <BulkExtractRegionsClient missingCount={missingRegionCount} />
          )}
          {canCreate && (
            <Link
              href="/customers/new"
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
            >
              <Plus className="size-4" />
              고객 등록
            </Link>
          )}
        </div>
      </div>

      {/* 검색/필터 */}
      <form method="GET" action="/customers" className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
          <input
            name="q"
            defaultValue={q}
            placeholder="고객명·코드·주소 검색"
            className="h-9 pl-8 pr-3 rounded-lg border border-[#e5e3f8] bg-white text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-52"
          />
        </div>
        <select
          name="type"
          defaultValue={typeFilter}
          className="h-9 rounded-lg border border-[#e5e3f8] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 점검유형</option>
          <option value="종합">종합</option>
          <option value="최초">최초</option>
          <option value="기타">기타</option>
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
        <CustomerRegionFilterClient
          regionData={regionData}
          currentSi={regionFilter}
          currentMyeon={regionMyeonFilter}
          currentRi={regionRiFilter}
        />
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
        {isFiltered && (
          <a
            href="/customers"
            className="h-9 px-3 rounded-lg border border-[#e8e8e8] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center"
          >
            초기화
          </a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {totalCount}개사</span>
      </form>

      {/* 목록 테이블 */}
      <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px,rgba(18,43,165,0.04)_0px_6px_6px_-3px,rgba(18,43,165,0.04)_0px_12px_12px_-6px] overflow-hidden">
        {customers.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">
            검색된 고객이 없습니다
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e8e8e8] bg-[#f8f9fa]">
                  {['고객코드', '고객명', '지역', '점검유형', '연간횟수', '계약일', '사용승인일', '담당직원', '상태', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8e8e8]">
                {customers.map(c => (
                  <tr key={c.id} className="hover:bg-[#f8f9fa] transition-colors">
                    <td className="px-4 py-3 text-xs text-[#514b81] font-mono">{c.customer_code}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#090c1d]">{c.customer_name}</p>
                      {c.address && <p className="text-xs text-[#b0acd6] mt-0.5 truncate max-w-[180px]">{c.address}</p>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {hasRegionCols && canCreate ? (
                        <RegionEditClient
                          customerId={c.id}
                          customerName={c.customer_name}
                          address={c.address}
                          region_si={c.region_si}
                          region_myeon={c.region_myeon}
                          region_ri={c.region_ri}
                        />
                      ) : (
                        <span className="text-xs text-[#514b81]">
                          {[c.region_si, c.region_myeon].filter(Boolean).join(' ') || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[c.inspection_type]}`}>
                        {c.inspection_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {TYPE_ANNUAL[c.inspection_type]}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#292d34]">
                      {c.contract_date}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {c.use_approval_date ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      {c.assigned_employee_id ? (
                        <span className="text-xs font-medium text-[#090c1d]">
                          {empMap.get(c.assigned_employee_id) ?? '-'}
                        </span>
                      ) : (
                        <span className="text-xs text-red-500 font-medium">미배정</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/customers/${c.id}`}
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
