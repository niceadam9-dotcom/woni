import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, Plus, Building2, FileText, ChevronRight } from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ToggleActiveClient } from '@/components/customers/toggle-active-client'
import { DeleteCustomerClient } from '@/components/customers/delete-customer-client'
import { CustomerSearchBox } from '@/components/customers/customer-search-box'
import { InlineCustomerFieldClient } from '@/components/customers/inline-customer-field-client'
import { ClickableRow } from '@/components/customers/clickable-row'
import { TableScroll, STICKY_THEAD } from '@/components/ui/table-scroll'
import { fetchCustomerList, parseListFilter } from '@/lib/customer-list'
import type { InspectionType, UserRole } from '@/types'

// 법정 특별점검 횟수 — 점검유형 파생 라벨 (§6-B: 별도 컬럼 대신 유형 옆 병기)
const TYPE_ANNUAL: Record<InspectionType, string> = {
  '종합':   '연 2회',
  '작동':   '연 1회',
  '일반관리': '1회',
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; active?: string; inc?: string; cols?: string; page?: string; per_page?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const filter = parseListFilter(params)
  const fullCols = params.cols === 'full'
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const pageSize = Math.max(0, parseInt(params.per_page ?? '50', 10))  // 0 = 전체

  const admin = createAdminClient()
  const [allCustomers, profilesRes] = await Promise.all([
    fetchCustomerList(admin, filter),
    admin.from('profiles').select('id, name').eq('is_active', true).eq('is_system', false).order('name'),
  ])

  const totalCount = allCustomers.length
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalCount / pageSize))
  const customers = pageSize === 0 ? allCustomers : allCustomers.slice((page - 1) * pageSize, page * pageSize)
  const employees = (profilesRes.data ?? []) as Array<{ id: string; name: string }>
  const empMap = new Map(employees.map(e => [e.id, e.name]))

  // B안: 등록·수정은 전 직원, 담당 배정·삭제는 매니저 이상
  const canCreate = can(profile.role as UserRole, 'customer_manage')
  const canAssign = can(profile.role as UserRole, 'customer_assign')
  const canDelete = can(profile.role as UserRole, 'customer_delete')

  // 목록 필터 컨텍스트 (lq) — 상세 [◀ 이전|다음 ▶]가 같은 필터·정렬로 이동 (§6-C-3)
  const lqSp = new URLSearchParams()
  if (filter.q) lqSp.set('q', filter.q)
  if (filter.type) lqSp.set('type', filter.type)
  if (filter.active && filter.active !== 'active') lqSp.set('active', filter.active)
  if (filter.inc) lqSp.set('inc', filter.inc)
  const lq = lqSp.toString()
  const detailHref = (id: string, tab?: string) => {
    const sp = new URLSearchParams()
    if (tab) sp.set('tab', tab)
    if (lq) sp.set('lq', lq)
    const qs = sp.toString()
    return `/customers/${id}${qs ? `?${qs}` : ''}`
  }

  function buildUrl(overrides: Record<string, string | undefined>) {
    const sp = new URLSearchParams()
    const merged = { q: filter.q, type: filter.type, active: filter.active !== 'active' ? filter.active : '', inc: filter.inc, cols: fullCols ? 'full' : '', per_page: pageSize !== 50 ? String(pageSize) : '', ...overrides }
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v)
    const qs = sp.toString()
    return `/customers${qs ? `?${qs}` : ''}`
  }

  const isFiltered = !!(filter.q || filter.type || filter.active !== 'active' || filter.inc)

  const baseHeaders = ['고객명', '점검유형']
  const fullHeaders = fullCols ? ['계약일', '사용승인일'] : []
  const headers = [...baseHeaders, ...fullHeaders, '점검계획일', '담당직원', '상태', '']

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">고객 관리</h1>
            <p className="text-sm text-[#514b81] mt-0.5">소방 점검 계약 고객을 관리합니다 — 행을 클릭하면 상세로 이동</p>
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
        <CustomerSearchBox defaultValue={filter.q ?? ''} />
        <select name="type" defaultValue={filter.type}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition">
          <option value="">전체 점검유형</option>
          <option value="종합">종합</option>
          <option value="작동">작동</option>
          <option value="일반관리">일반</option>
        </select>
        <select name="active" defaultValue={filter.active}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition">
          <option value="all">전체 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>
        {/* 입력 미완료 필터 (§6-C-3·§6-D-5) — 상세 [다음 ▶] 컨베이어와 결합 */}
        <select name="inc" defaultValue={filter.inc}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition">
          <option value="">입력상태 전체</option>
          <option value="any">입력 미완료</option>
          <option value="plan">계획서 미완료</option>
        </select>
        <select name="per_page" defaultValue={String(pageSize)}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition">
          <option value="25">25건</option>
          <option value="50">50건</option>
          <option value="0">전체</option>
        </select>
        {fullCols && <input type="hidden" name="cols" value="full" />}
        <button type="submit"
          className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">
          검색
        </button>
        {isFiltered && (
          <Link href="/customers"
            className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
            초기화
          </Link>
        )}
        {/* §6-B-A: 계약일·사용승인일은 기본 숨김 — 전체 컬럼 토글 */}
        <Link href={buildUrl({ cols: fullCols ? '' : 'full' })}
          className="h-9 px-3 rounded-lg border border-[#d0ccf5] text-sm text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors flex items-center">
          {fullCols ? '기본 컬럼' : '전체 컬럼'}
        </Link>
        <span className="text-xs text-[#514b81] ml-auto">총 {totalCount}개사</span>
      </form>

      {/* 목록 테이블 — 기본 6컬럼 (§6-B-A) */}
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
                  {headers.map(h => (
                    <th key={h || '_actions'} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c8c4d0]">
                {customers.map(c => {
                  const bld = c.buildings.find(b => b.is_active)
                  const bldIncomplete = c.incompleteAreas.includes('건물')
                  const planIncomplete = c.planDone < c.planTotal
                  return (
                    <ClickableRow key={c.id} href={detailHref(c.id)}
                      className="hover:bg-[#f8f9fa] transition-colors cursor-pointer">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 group">
                          {/* §6-B-B2: 이름 클릭 = 상세, 편집은 연필 아이콘 */}
                          <Link href={detailHref(c.id)} className="font-medium text-[#090c1d] hover:text-[#7b68ee]">
                            {c.customer_name}
                          </Link>
                          {canCreate && (
                            <InlineCustomerFieldClient customerId={c.id} field="customer_name" value={c.customer_name}
                              displayVariant="pencil-only" />
                          )}
                        </div>
                        {c.address && <p className="text-xs text-[#b0acd6] mt-0.5 truncate max-w-[180px]">{c.address}</p>}
                        {bld ? (
                          <p className="text-[10px] text-[#7b68ee] mt-0.5 truncate max-w-[180px]">
                            🏢 {[bld.purpose, bld.total_area != null && `${bld.total_area}㎡`,
                              bld.floors_above != null && `지상${bld.floors_above}층`,
                            ].filter(Boolean).join(' · ') || bld.building_name}
                          </p>
                        ) : c.address ? (
                          <p className="text-[10px] text-amber-500 mt-0.5">건물 정보 없음</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {canCreate ? (
                            <InlineCustomerFieldClient customerId={c.id} field="inspection_type" value={c.inspection_type}
                              displayVariant="type-badge" />
                          ) : (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">{c.inspection_type}</span>
                          )}
                          <span className="text-[10px] text-[#b0acd6] whitespace-nowrap">{TYPE_ANNUAL[c.inspection_type]}</span>
                        </div>
                      </td>
                      {fullCols && (
                        <td className="px-4 py-3 text-xs text-[#292d34]">
                          {canCreate ? (
                            <InlineCustomerFieldClient customerId={c.id} field="contract_date" value={c.contract_date} />
                          ) : (c.contract_date ?? '-')}
                        </td>
                      )}
                      {fullCols && (
                        <td className="px-4 py-3 text-xs text-[#514b81]">
                          {canCreate ? (
                            <InlineCustomerFieldClient customerId={c.id} field="use_approval_date" value={c.use_approval_date} />
                          ) : (c.use_approval_date ?? '-')}
                        </td>
                      )}
                      <td className="px-4 py-3 text-xs text-[#514b81]">
                        {canCreate ? (
                          <InlineCustomerFieldClient customerId={c.id} field="plan_anchor_date" value={c.plan_anchor_date} emptyLabel="미입력" />
                        ) : (c.plan_anchor_date ?? '-')}
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
                        {/* §6-B-B3: 탭 딥링크 바로가기 — 🏢 건물·시설 / 📄 소방계획서(준비율) / › 상세 */}
                        <div className="flex items-center gap-1.5">
                          <Link href={detailHref(c.id, 'buildings')} title="건물·시설 탭"
                            className={`relative p-1 rounded hover:bg-[#f5f4ff] ${bldIncomplete ? 'text-amber-500' : 'text-[#b0acd6] hover:text-[#7b68ee]'}`}>
                            <Building2 className="size-3.5" />
                            {bldIncomplete && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500" />}
                          </Link>
                          <Link href={detailHref(c.id, 'plan')} title={`소방계획서 탭 (준비율 ${c.planDone}/${c.planTotal})`}
                            className={`relative p-1 rounded hover:bg-[#f5f4ff] ${planIncomplete ? 'text-amber-500' : 'text-[#b0acd6] hover:text-[#7b68ee]'}`}>
                            <FileText className="size-3.5" />
                            {planIncomplete && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500" />}
                          </Link>
                          <Link href={detailHref(c.id)} title="상세보기"
                            className="p-1 rounded text-[#7b68ee] hover:bg-[#f5f4ff]">
                            <ChevronRight className="size-4" />
                          </Link>
                          {canDelete && (
                            <DeleteCustomerClient customerId={c.id} customerName={c.customer_name} />
                          )}
                        </div>
                      </td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          {page > 1 && (
            <Link href={buildUrl({ page: String(page - 1) })}
              className="h-8 px-3 rounded-lg border border-[#d0ccf5] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
              이전
            </Link>
          )}
          <span className="text-sm text-[#514b81]">{page} / {totalPages}</span>
          {page < totalPages && (
            <Link href={buildUrl({ page: String(page + 1) })}
              className="h-8 px-3 rounded-lg border border-[#d0ccf5] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
              다음
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
