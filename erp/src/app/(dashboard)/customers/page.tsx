import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, Plus } from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ToggleActiveClient } from '@/components/customers/toggle-active-client'
import { DeleteCustomerClient } from '@/components/customers/delete-customer-client'
import { GeneralInspectionRegisterClient } from '@/components/customers/general-inspection-register-client'
import { CustomerSearchBox } from '@/components/customers/customer-search-box'
import { InlineCustomerFieldClient } from '@/components/customers/inline-customer-field-client'
import { TableScroll, STICKY_THEAD } from '@/components/ui/table-scroll'
import type { InspectionType, UserRole } from '@/types'
import { inspectionTypeLabel } from '@/types'

const TYPE_COLORS: Record<InspectionType, string> = {
  '종합':   'bg-[#f5f4ff] text-[#7b68ee]',
  '작동':   'bg-blue-50 text-blue-600',
  '일반관리': 'bg-gray-100 text-gray-600',
}

const TYPE_ANNUAL: Record<InspectionType, string> = {
  '종합':   '연 2회',
  '작동':   '연 1회',
  '일반관리': '연 1회',
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
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const pageSize = Math.max(0, parseInt(params.per_page ?? '50', 10))  // 0 = 전체, 기본 50 (헤더 고정 스크롤과 조합)

  const admin = createAdminClient()

  const from = pageSize > 0 ? (page - 1) * pageSize : 0
  const to = pageSize > 0 ? from + pageSize - 1 : 99999

  type BuildingSummary = {
    id: string; building_name: string
    total_area: number | null; floors_above: number | null; floors_below: number | null
    purpose: string | null
  }
  type CustomerRow = {
    id: string; customer_code: string; customer_name: string; contract_date: string
    use_approval_date: string | null; inspection_type: InspectionType; address: string | null
    region_si: string | null; region_myeon: string | null; region_ri: string | null
    is_active: boolean; assigned_employee_id: string | null; created_at: string
    buildings: BuildingSummary[]
  }

  const selectCols = `id, customer_code, customer_name, contract_date, use_approval_date,
    inspection_type, address, is_active, assigned_employee_id, created_at,
    region_si, region_myeon, region_ri,
    buildings(id, building_name, total_area, floors_above, floors_below, purpose)`

  let custQuery = admin
    .from('customers')
    .select(selectCols, { count: 'exact' })
    .order('created_at', { ascending: false })

  // 통합 검색 (V10 §6 스마트 감지): 건물명·주소·읍면·리 + 담당자 이름 (고객코드는 UI 숨김 정책으로 제외)
  if (q) {
    const { data: matchedEmps } = await admin
      .from('profiles').select('id').ilike('name', `%${q}%`)
    const empIds = ((matchedEmps ?? []) as { id: string }[]).map(e => e.id)
    const ors = [
      `customer_name.ilike.%${q}%`,
      `address.ilike.%${q}%`,
      `region_myeon.ilike.%${q}%`,
      `region_ri.ilike.%${q}%`,
    ]
    if (empIds.length > 0) ors.push(`assigned_employee_id.in.(${empIds.join(',')})`)
    custQuery = custQuery.or(ors.join(','))
  }
  if (typeFilter) custQuery = custQuery.eq('inspection_type', typeFilter)
  if (activeFilter === 'active')   custQuery = custQuery.eq('is_active', true)
  if (activeFilter === 'inactive') custQuery = custQuery.eq('is_active', false)
  // 지역 필터/컬럼/칩은 UI에서 전부 제거 (2026-07-07 결정) — region 데이터는 지역별담당배정용으로만 유지

  const [customersRes, profilesRes] = await Promise.all([
    custQuery.range(from, to),
    admin.from('profiles').select('id, name').eq('is_active', true).eq('is_system', false).order('name'),
  ])

  const customers = (customersRes.data ?? []) as unknown as CustomerRow[]
  const totalCount = customersRes.count ?? 0
  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalCount / pageSize)
  const employees = (profilesRes.data ?? []) as Array<{ id: string; name: string }>
  const empMap = new Map(employees.map(e => [e.id, e.name]))

  // B안: 등록·수정은 전 직원, 담당 배정·삭제는 매니저 이상
  const canCreate = can(profile.role as UserRole, 'customer_manage')
  const canAssign = can(profile.role as UserRole, 'customer_assign')
  const canDelete = can(profile.role as UserRole, 'customer_delete')

  function buildPageUrl(p: number) {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (typeFilter) sp.set('type', typeFilter)
    if (activeFilter !== 'active') sp.set('active', activeFilter)
    if (pageSize !== 50) sp.set('per_page', String(pageSize))
    if (p > 1) sp.set('page', String(p))
    const qs = sp.toString()
    return `/customers${qs ? `?${qs}` : ''}`
  }

  const isFiltered = !!(q || typeFilter || activeFilter !== 'active')

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
        <CustomerSearchBox defaultValue={q} />
        <select
          name="type"
          defaultValue={typeFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 점검유형</option>
          <option value="종합">종합</option>
          <option value="작동">작동</option>
          <option value="일반관리">일반</option>
        </select>
        <select
          name="active"
          defaultValue={activeFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="all">전체 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>
        <select
          name="per_page"
          defaultValue={String(pageSize)}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
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
            className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center"
          >
            초기화
          </a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {totalCount}개사</span>
      </form>

      {/* 목록 테이블 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {customers.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">
            검색된 고객이 없습니다
          </div>
        ) : (
          <TableScroll offset={300}>
            <table className="w-full text-sm">
              <thead className={STICKY_THEAD}>
                <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa]">
                  {['고객명', '점검유형', '연간횟수', '계약일', '사용승인일', '담당직원', '상태', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c8c4d0]">
                {customers.map(c => (
                  <tr key={c.id} className="hover:bg-[#f8f9fa] transition-colors">
                    <td className="px-4 py-3">
                      {canCreate ? (
                        <InlineCustomerFieldClient customerId={c.id} field="customer_name" value={c.customer_name}
                          displayVariant="name" />
                      ) : (
                        <p className="font-medium text-[#090c1d]">{c.customer_name}</p>
                      )}
                      {c.address && <p className="text-xs text-[#b0acd6] mt-0.5 truncate max-w-[180px]">{c.address}</p>}
                      {c.buildings && c.buildings.length > 0 ? (
                        <p className="text-[10px] text-[#7b68ee] mt-0.5 truncate max-w-[180px]">
                          🏢 {[
                            c.buildings[0].purpose,
                            c.buildings[0].total_area != null && `${c.buildings[0].total_area}㎡`,
                            c.buildings[0].floors_above != null && `지상${c.buildings[0].floors_above}층`,
                          ].filter(Boolean).join(' · ') || c.buildings[0].building_name}
                        </p>
                      ) : c.address ? (
                        <p className="text-[10px] text-amber-500 mt-0.5">건물 정보 없음</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {canCreate ? (
                        <InlineCustomerFieldClient customerId={c.id} field="inspection_type" value={c.inspection_type}
                          displayVariant="type-badge" />
                      ) : (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[c.inspection_type]}`}>{inspectionTypeLabel(c.inspection_type)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {TYPE_ANNUAL[c.inspection_type]}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#292d34]">
                      {canCreate ? (
                        <InlineCustomerFieldClient customerId={c.id} field="contract_date" value={c.contract_date} />
                      ) : c.contract_date}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {canCreate ? (
                        <InlineCustomerFieldClient customerId={c.id} field="use_approval_date" value={c.use_approval_date} />
                      ) : (c.use_approval_date ?? '-')}
                    </td>
                    <td className="px-4 py-3">
                      {canAssign ? (
                        <InlineCustomerFieldClient
                          customerId={c.id}
                          field="assigned_employee_id"
                          value={c.assigned_employee_id}
                          employees={employees}
                          displayVariant="employee"
                          displayValue={c.assigned_employee_id ? (empMap.get(c.assigned_employee_id) ?? '-') : undefined}
                        />
                      ) : c.assigned_employee_id ? (
                        <span className="text-xs font-medium text-[#090c1d]">{empMap.get(c.assigned_employee_id) ?? '-'}</span>
                      ) : (
                        <span className="text-xs text-red-500 font-medium">미배정</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canCreate ? (
                        <ToggleActiveClient customerId={c.id} isActive={c.is_active} />
                      ) : (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {c.is_active ? '활성' : '비활성'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/customers/${c.id}`}
                          className="text-xs text-[#7b68ee] hover:underline font-medium"
                        >
                          상세보기
                        </Link>
                        {canCreate && c.inspection_type === '일반관리' && (
                          <GeneralInspectionRegisterClient
                            customerId={c.id}
                            customerName={c.customer_name}
                            employees={employees}
                            defaultEmployeeId={c.assigned_employee_id}
                          />
                        )}
                        {canDelete && (
                          <DeleteCustomerClient customerId={c.id} customerName={c.customer_name} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          {page > 1 && (
            <a href={buildPageUrl(page - 1)}
              className="h-8 px-3 rounded-lg border border-[#d0ccf5] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
              이전
            </a>
          )}
          <span className="text-sm text-[#514b81]">{page} / {totalPages}</span>
          {page < totalPages && (
            <a href={buildPageUrl(page + 1)}
              className="h-8 px-3 rounded-lg border border-[#d0ccf5] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
              다음
            </a>
          )}
        </div>
      )}
    </div>
  )
}
