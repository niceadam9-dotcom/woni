import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, UserCheck, MapPin, Calendar, Tag, AlertCircle, ClipboardList, Building2, Plus, History } from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { AssignEmployeeClient } from '@/components/customers/assign-employee-client'
import { EditContactsClient } from '@/components/customers/edit-contacts-client'
import { EditInspectionTypeClient } from '@/components/customers/edit-inspection-type-client'
import { EditCustomerInfoClient } from '@/components/customers/edit-customer-info-client'
import type { Customer, CustomerContact, Inspection, InspectionStatus, InspectionType, UserRole } from '@/types'

type ActivityLog = {
  id: string
  action: string
  actor_id: string | null
  metadata: {
    changes?: Array<{ field: string; field_label: string; old_value: string | null; new_value: string | null }>
  } | null
  created_at: string
}

const TYPE_COLORS: Record<InspectionType, string> = {
  '종합':   'bg-[#f5f4ff] text-[#7b68ee]',
  '작동':   'bg-blue-50 text-blue-600',
  '일반관리': 'bg-gray-100 text-gray-600',
}

const STATUS_LABELS: Record<InspectionStatus, string> = {
  scheduled: '예정',
  in_progress: '진행중',
  completed: '완료',
  overdue: '기한초과',
}

const STATUS_COLORS: Record<InspectionStatus, string> = {
  scheduled: 'bg-blue-50 text-blue-600',
  in_progress: 'bg-[#f5f4ff] text-[#7b68ee]',
  completed: 'bg-green-50 text-green-700',
  overdue: 'bg-red-50 text-red-600',
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-[#e0ddf5] last:border-0">
      <span className="text-xs text-[#514b81] w-24 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-[#090c1d] flex-1">{value ?? '-'}</span>
    </div>
  )
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  const [customerRes, contactsRes, employeesRes, inspectionsRes, buildingsRes, activityLogsRes] = await Promise.all([
    admin.from('customers').select('*').eq('id', id).single(),
    admin.from('customer_contacts').select('*').eq('customer_id', id).order('role'),
    admin.from('profiles').select('id, name, position').eq('is_active', true).order('name'),
    admin.from('inspections')
      .select('id, year, sequence_num, inspection_type, inspection_start_date, status, assigned_employee_id')
      .eq('customer_id', id)
      .order('year', { ascending: false })
      .order('sequence_num'),
    admin.from('buildings')
      .select('id, building_name, address, total_area, floors_above, floors_below, purpose, year_built, is_active')
      .eq('customer_id', id)
      .order('building_name'),
    admin.from('activity_logs')
      .select('id, action, actor_id, metadata, created_at')
      .eq('entity_type', 'customer')
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (!customerRes.data) notFound()

  const customer = customerRes.data as Customer
  const contacts = (contactsRes.data ?? []) as CustomerContact[]
  const employees = (employeesRes.data ?? []) as Array<{ id: string; name: string; position: string | null }>
  const buildings = (buildingsRes.data ?? []) as Array<{
    id: string; building_name: string; address: string | null
    total_area: number | null; floors_above: number | null; floors_below: number | null
    purpose: string | null; year_built: number | null; is_active: boolean
  }>
  const inspections = (inspectionsRes.data ?? []) as Array<
    Pick<Inspection, 'id' | 'year' | 'sequence_num' | 'inspection_type' | 'inspection_start_date' | 'status' | 'assigned_employee_id'>
  >
  const activityLogs = (activityLogsRes.data ?? []) as ActivityLog[]

  // 변경 이력 표시 화이트리스트 — 필수 고객관리 사항만 (기록 자체는 전부 보존, 전체는 관리자>활동로그)
  const ESSENTIAL_FIELDS = new Set(['assigned_employee_id', 'inspection_type', 'use_approval_date', 'contract_date', 'is_active'])
  const ACTION_LABELS: Record<string, string> = {
    customer_created: '고객 등록',
    general_inspection_registered: '일반관리 점검 등록',
  }
  const essentialLogs = activityLogs
    .map(log => ({
      log,
      actionLabel: ACTION_LABELS[log.action],
      changes: (log.metadata?.changes ?? []).filter(c => ESSENTIAL_FIELDS.has(c.field)),
    }))
    .filter(x => x.actionLabel || x.changes.length > 0)

  // 점검별 단계 진행 카운트
  const stepCounts: Record<string, { total: number; completed: number }> = {}
  if (inspections.length > 0) {
    const { data: steps } = await admin
      .from('inspection_steps')
      .select('inspection_id, status')
      .in('inspection_id', inspections.map(i => i.id))

    for (const s of steps ?? []) {
      const r = s as { inspection_id: string; status: string }
      if (!stepCounts[r.inspection_id]) stepCounts[r.inspection_id] = { total: 0, completed: 0 }
      stepCounts[r.inspection_id].total++
      if (r.status === 'completed') stepCounts[r.inspection_id].completed++
    }
  }

  const assignedEmployee = customer.assigned_employee_id
    ? employees.find(e => e.id === customer.assigned_employee_id)
    : null

  // B안: 고객 정보 수정은 전 직원, 담당 배정만 매니저 이상
  const canManage = can(profile.role as UserRole, 'customer_manage')
  const canAssign = can(profile.role as UserRole, 'customer_assign')

  return (
    <div className="space-y-6 max-w-3xl">
      {/* 뒤로가기 + 헤더 */}
      <div className="flex items-center gap-3">
        <Link href="/customers" className="text-[#514b81] hover:text-[#7b68ee] transition-colors">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#090c1d]">{customer.customer_name}</h1>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${TYPE_COLORS[customer.inspection_type]}`}>
          {customer.inspection_type}
        </span>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${customer.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {customer.is_active ? '활성' : '비활성'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* 담당직원 배정 카드 */}
        <div className={`col-span-3 bg-white rounded-xl border shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5 ${!customer.assigned_employee_id ? 'border-red-200' : 'border-[#c8c4d0]'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`size-9 rounded-lg flex items-center justify-center ${customer.assigned_employee_id ? 'bg-[#f5f4ff]' : 'bg-red-50'}`}>
                <UserCheck className={`size-4 ${customer.assigned_employee_id ? 'text-[#7b68ee]' : 'text-red-400'}`} />
              </div>
              <div>
                <p className="text-xs text-[#514b81] font-medium">담당직원</p>
                {assignedEmployee ? (
                  <p className="text-sm font-semibold text-[#090c1d] mt-0.5">
                    {assignedEmployee.name}
                    {assignedEmployee.position && (
                      <span className="text-xs text-[#b0acd6] font-normal ml-1.5">({assignedEmployee.position})</span>
                    )}
                  </p>
                ) : (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <AlertCircle className="size-3.5 text-red-400" />
                    <p className="text-sm font-semibold text-red-500">미배정</p>
                  </div>
                )}
              </div>
            </div>
            {canAssign && (
              <AssignEmployeeClient
                customerId={customer.id}
                customerName={customer.customer_name}
                currentEmployeeId={customer.assigned_employee_id}
                employees={employees}
              />
            )}
          </div>
        </div>

        {/* 고객 기본정보 */}
        <div className="col-span-2 bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#090c1d]">기본정보</h2>
          </div>
          <InfoRow
            label="점검유형"
            value={
              <span className="flex items-center">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[customer.inspection_type]}`}>
                  {customer.inspection_type}
                </span>
                {canManage && (
                  <EditInspectionTypeClient
                    customerId={customer.id}
                    currentType={customer.inspection_type}
                  />
                )}
              </span>
            }
          />
          {canManage ? (
            <div className="pt-2">
              <EditCustomerInfoClient customer={customer} />
            </div>
          ) : (
            <>
              <InfoRow
                label="계약일"
                value={
                  <span className="flex items-center gap-1.5">
                    <Calendar className="size-3.5 text-[#b0acd6]" />
                    {customer.contract_date}
                  </span>
                }
              />
              <InfoRow
                label="사용승인일"
                value={
                  customer.use_approval_date ? (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="size-3.5 text-[#b0acd6]" />
                      {customer.use_approval_date}
                    </span>
                  ) : null
                }
              />
              <InfoRow
                label="주소"
                value={
                  customer.address ? (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 text-[#b0acd6] shrink-0 mt-0.5" />
                      {customer.address}
                    </span>
                  ) : null
                }
              />
              <InfoRow label="비고" value={customer.notes} />
            </>
          )}
        </div>

        {/* 연간 점검 횟수 */}
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5 flex flex-col justify-center items-center gap-2">
          <Tag className="size-5 text-[#7b68ee]" />
          <p className="text-xs text-[#514b81]">연간 점검 횟수</p>
          <p className="text-2xl font-bold text-[#090c1d]">
            {customer.inspection_type === '종합' ? '2' : '1'}
            <span className="text-sm font-normal text-[#514b81] ml-0.5">회</span>
          </p>
          <p className="text-xs text-[#b0acd6]">{customer.inspection_type === '종합' ? '(1차·2차)' : ''}</p>
        </div>
      </div>

      {/* 관계인 정보 (수정 가능) */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <h2 className="text-sm font-semibold text-[#090c1d] mb-4">관계인 정보</h2>
        <EditContactsClient
          customerId={customer.id}
          contacts={contacts}
          canManage={canManage}
        />
      </div>

      {/* 건물 목록 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">건물 목록</h2>
          <span className="text-xs text-[#b0acd6] ml-auto">{buildings.length}개</span>
          {canManage && (
            <Link
              href={`/buildings/new?customer_id=${customer.id}`}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors"
            >
              <Plus className="size-3" />
              건물 등록
            </Link>
          )}
        </div>

        {buildings.length === 0 ? (
          <p className="text-sm text-[#514b81] py-6 text-center">등록된 건물이 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e0ddf5]">
                  <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">건물명</th>
                  <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">주소</th>
                  <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">용도</th>
                  <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">연면적</th>
                  <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">층수</th>
                  <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">준공</th>
                  <th className="text-left text-xs font-medium text-[#514b81] pb-2">상태</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {buildings.map(b => (
                  <tr key={b.id} className="border-b border-[#f8f9fa] last:border-0 hover:bg-[#fafafa] transition-colors">
                    <td className="py-3 pr-4 font-medium text-[#090c1d]">{b.building_name}</td>
                    <td className="py-3 pr-4 text-xs text-[#514b81] max-w-[140px] truncate">{b.address ?? '-'}</td>
                    <td className="py-3 pr-4">
                      {b.purpose ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">{b.purpose}</span>
                      ) : (
                        <span className="text-xs text-[#b0acd6]">-</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-[#514b81]">
                      {b.total_area != null ? `${b.total_area.toLocaleString()}㎡` : '-'}
                    </td>
                    <td className="py-3 pr-4 text-xs text-[#514b81]">
                      {b.floors_above != null
                        ? `지상 ${b.floors_above}층${b.floors_below ? ` / 지하 ${b.floors_below}층` : ''}`
                        : '-'}
                    </td>
                    <td className="py-3 pr-4 text-xs text-[#514b81]">{b.year_built ?? '-'}</td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${b.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {b.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="py-3">
                      <Link href={`/buildings/${b.id}`} className="text-xs text-[#7b68ee] hover:underline font-medium">
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

      {/* 점검 이력 + 변경 이력 통합 타임라인 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <div className="flex items-center gap-2 mb-4">
          <ClipboardList className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">점검 이력</h2>
          <span className="text-xs text-[#b0acd6] ml-auto">{inspections.length}건 점검 · {essentialLogs.length}건 변경</span>
        </div>

        {inspections.length === 0 && essentialLogs.length === 0 ? (
          <p className="text-sm text-[#514b81] py-6 text-center">등록된 이력이 없습니다</p>
        ) : (
          <div className="space-y-1">
            {/* 점검 이력 테이블 */}
            {inspections.length > 0 && (
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e0ddf5]">
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">연도/차수</th>
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">유형</th>
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">시작일</th>
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">담당자</th>
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">진행</th>
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspections.map(insp => {
                      const emp = employees.find(e => e.id === insp.assigned_employee_id)
                      const steps = stepCounts[insp.id] ?? { total: 0, completed: 0 }
                      return (
                        <tr key={insp.id} className="border-b border-[#f8f9fa] last:border-0 hover:bg-[#fafafa] transition-colors">
                          <td className="py-3 pr-4">
                            <Link href={`/inspections/${insp.id}`} className="font-medium text-[#090c1d] hover:text-[#7b68ee]">
                              {insp.year}년 {insp.sequence_num}차
                            </Link>
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[insp.inspection_type]}`}>
                              {insp.inspection_type}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-[#514b81]">{insp.inspection_start_date}</td>
                          <td className="py-3 pr-4 text-[#514b81]">
                            {emp?.name ?? <span className="text-[#b0acd6]">미배정</span>}
                          </td>
                          <td className="py-3 pr-4">
                            {steps.total > 0 ? (
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 bg-[#e0ddf5] rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-[#7b68ee] rounded-full"
                                    style={{ width: `${(steps.completed / steps.total) * 100}%` }}
                                  />
                                </div>
                                <span className="text-xs text-[#514b81]">{steps.completed}/{steps.total}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-[#b0acd6]">—</span>
                            )}
                          </td>
                          <td className="py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[insp.status as InspectionStatus]}`}>
                              {STATUS_LABELS[insp.status as InspectionStatus]}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 변경 이력 — 필수 고객관리 사항만 (담당직원·점검유형·사용승인일·계약일·활성상태·등록) */}
            {essentialLogs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3 pt-2 border-t border-[#e0ddf5]">
                  <History className="size-3.5 text-[#b0acd6]" />
                  <span className="text-xs font-medium text-[#514b81]">변경 이력</span>
                </div>
                <div className="space-y-2">
                  {essentialLogs.map(({ log, actionLabel, changes }) => {
                    const actor = employees.find(e => e.id === log.actor_id)
                    const dateStr = new Date(log.created_at).toLocaleString('ko-KR', {
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })
                    return (
                      <div key={log.id} className="flex gap-3 py-2 border-b border-[#f8f9fa] last:border-0">
                        <div className="size-6 rounded-full bg-[#f5f4ff] flex items-center justify-center shrink-0 mt-0.5">
                          <History className="size-3 text-[#7b68ee]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-[#090c1d]">
                              {actor?.name ?? '시스템'}
                            </span>
                            <span className="text-xs text-[#b0acd6]">{dateStr}</span>
                          </div>
                          <div className="space-y-0.5">
                            {changes.map((c, i) => (
                              <div key={i} className="text-xs text-[#514b81]">
                                <span className="font-medium text-[#090c1d]">{c.field_label}</span>
                                {' '}
                                <span className="text-[#b0acd6] line-through">{c.old_value ?? '없음'}</span>
                                {' → '}
                                <span className="text-[#7b68ee]">{c.new_value ?? '없음'}</span>
                              </div>
                            ))}
                            {changes.length === 0 && actionLabel && (
                              <span className="text-xs text-[#7b68ee] font-medium">{actionLabel}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
