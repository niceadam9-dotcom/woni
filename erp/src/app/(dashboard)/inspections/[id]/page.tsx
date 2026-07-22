import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ClipboardList, User, Calendar, Building2, AlertCircle } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InspectionDetailClient } from '@/components/inspections/inspection-detail-client'
import { InspectionParticipantsClient } from '@/components/inspections/inspection-participants-client'
import { InspectionMultidayClient } from '@/components/inspections/inspection-multiday-client'
import { ReportGenerateClient } from '@/components/inspections/report-generate-client'
import { InspectionSheetClient } from '@/components/inspections/inspection-sheet-client'
import { InspectionReportsClient } from '@/components/inspections/inspection-reports-client'
import { InspectionDefectsClient } from '@/components/inspections/inspection-defects-client'
import { InspectionVoiceDefectClient } from '@/components/inspections/inspection-voice-defect-client'
import { InspectionVoiceSheetClient } from '@/components/inspections/inspection-voice-sheet-client'
import { InspectionReport9Client, type Report9CheckRow } from '@/components/inspections/inspection-report9-client'
import type { Report9Job, Report9File } from '@/app/(dashboard)/inspections/report9-actions'
import { computeQuickReadiness } from '@/lib/doc-requirements'
import type { Inspection, InspectionStep, InspectionStatus, InspectionType, UserRole } from '@/types'
import { inspectionTypeLabel } from '@/types'
import type { ReportType } from '@/app/(dashboard)/inspections/report-constants'

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

function InfoChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-[#b0acd6]">{icon}</span>
      <span className="text-xs text-[#514b81]">{label}</span>
      <span className="font-medium text-[#090c1d]">{value}</span>
    </div>
  )
}

export default async function InspectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  const [inspRes, stepsRes] = await Promise.all([
    admin.from('inspections').select('*').eq('id', id).single(),
    admin.from('inspection_steps').select('*').eq('inspection_id', id).order('step_num'),
  ])

  if (!inspRes.data) notFound()

  const inspection = inspRes.data as Inspection
  const steps = (stepsRes.data ?? []) as InspectionStep[]

  // 고객, 관계인, 담당직원, 보고서 병렬 조회
  const [customerRes, contactRes, employeeRes, reportsRes, defectsRes, actionPlanRes, participantsRes, allEmpRes, genReportsRes, sheetsRes, responsesRes] = await Promise.all([
    admin.from('customers').select('id, customer_name, customer_code, inspection_type, address').eq('id', inspection.customer_id).single(),
    inspection.contact_id
      ? admin.from('customer_contacts').select('id, role, name, phone, email').eq('id', inspection.contact_id).single()
      : Promise.resolve({ data: null }),
    admin.from('profiles').select('id, name, position, license_no').eq('id', inspection.assigned_employee_id).single(),
    admin.from('inspection_reports')
      .select('id, report_type, file_name, file_size, submitted_at, submitted_by')
      .eq('inspection_id', id)
      .order('submitted_at'),
    admin.from('inspection_defects')
      .select('id, defect_code, defect_name, defect_detail, photo_url, after_photo_url, action_taken, action_completed_at, action_plan, action_start, action_end, severity, created_at')
      .eq('inspection_id', id)
      .order('created_at'),
    admin.from('action_plans').select('id').eq('inspection_id', id).single(),
    admin.from('inspection_participants')
      .select('id, employee_id, role, sort_order, profiles:employee_id (name, license_no)')
      .eq('inspection_id', id).eq('role', '보조').order('sort_order'),
    admin.from('profiles').select('id, name, position, license_no')
      .eq('is_active', true).eq('is_system', false).order('name'),
    admin.from('generated_reports')
      .select('id, report_kind, file_name, generated_at, generated_by')
      .eq('inspection_id', id).order('generated_at', { ascending: false }),
    // 일반관리 = 외관점검표 시트(EXT, 별지 6호 v2022 — §9-8d) / 그 외 = 소방시설등점검표(STD v2025)
    admin.from('inspection_sheets').select('id, sheet_code, sheet_name')
      .eq('version', inspection.inspection_type === '일반관리' ? 'v2022' : 'v2025').order('sheet_code'),
    admin.from('inspection_sheet_responses').select('item_code, result, memo').eq('inspection_id', id),
  ])

  const sheets = (sheetsRes.data ?? []) as Array<{ id: string; sheet_code: string; sheet_name: string }>
  const respRows = (responsesRes.data ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo: string | null }>
  const responses: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }> = {}
  const respondedCounts: Record<string, number> = {}
  for (const r of respRows) {
    responses[r.item_code] = { result: r.result, memo: r.memo }
    // 설비번호 키: STD '1-A-001' → '1' / 외관 'X1-01' → 'X1' / 안전시설등 'MU-001' → 'MU'
    const first = r.item_code.split('-')[0]
    const num = /^\d/.test(first) ? String(parseInt(first, 10)) : first
    respondedCounts[num] = (respondedCounts[num] ?? 0) + 1
  }
  const xCount = respRows.filter(r => r.result === 'X').length

  const auxParticipants = ((participantsRes.data ?? []) as unknown as Array<{
    id: string; employee_id: string | null
    profiles: { name: string; license_no: string | null } | null
  }>).map(p => ({
    id: p.id, employee_id: p.employee_id,
    name: p.profiles?.name ?? '(삭제된 직원)', license_no: p.profiles?.license_no ?? null,
  }))
  const allEmployees = (allEmpRes.data ?? []) as Array<{ id: string; name: string; position: string | null; license_no: string | null }>
  const empNameMap = new Map(allEmployees.map(e => [e.id, e.name]))
  const genHistory = ((genReportsRes.data ?? []) as Array<{ id: string; report_kind: string; file_name: string; generated_at: string; generated_by: string | null }>)
    .map(g => ({ id: g.id, report_kind: g.report_kind, file_name: g.file_name, generated_at: g.generated_at, by_name: g.generated_by ? (empNameMap.get(g.generated_by) ?? null) : null }))

  const customer = customerRes.data as { id: string; customer_name: string; customer_code: string; inspection_type: InspectionType; address: string | null } | null
  const contact = contactRes.data as { id: string; role: string; name: string; phone: string | null; email: string | null } | null
  const employee = employeeRes.data as { id: string; name: string; position: string | null; license_no: string | null } | null

  type DefectRow = {
    id: string; defect_code: string | null; defect_name: string
    defect_detail: string | null; photo_url: string | null
    after_photo_url: string | null; action_taken: string | null; action_completed_at: string | null
    action_plan: string | null; action_start: string | null; action_end: string | null
    severity: '경미' | '보통' | '중대'; created_at: string
  }
  const defects = (defectsRes.data ?? []) as DefectRow[]
  const hasActionPlan = !!actionPlanRes.data

  type ReportRow = {
    id: string; report_type: string; file_name: string; file_size: number | null
    submitted_at: string | null; submitted_by: string | null
  }
  const rawReports = (reportsRes.data ?? []) as ReportRow[]

  // 제출자 이름 조회
  const submitterIds = [...new Set(rawReports.map(r => r.submitted_by).filter(Boolean))] as string[]
  const submitterMap = new Map<string, string>()
  if (submitterIds.length > 0) {
    const { data: submitters } = await admin.from('profiles').select('id, name').in('id', submitterIds)
    for (const s of (submitters ?? []) as Array<{ id: string; name: string }>) {
      submitterMap.set(s.id, s.name)
    }
  }

  const reports = rawReports.map(r => ({
    ...r,
    report_type: r.report_type as ReportType,
    submitted_by_name: r.submitted_by ? (submitterMap.get(r.submitted_by) ?? null) : null,
  }))

  const userRole = profile.role as UserRole
  const isAssigned = inspection.assigned_employee_id === profile.id
  const canComplete = isAssigned || userRole === 'manager' || userRole === 'admin'
  const canDelete = userRole === 'manager' || userRole === 'admin'
  const canEdit = isAssigned || userRole === 'manager' || userRole === 'admin'

  const today = new Date().toISOString().split('T')[0]
  const completedCount = steps.filter(s => s.status === 'completed').length
  const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0

  // ── 실시결과 보고서(별지 9호) 준비 섹션 (P3 §9-6⑦) — 일반관리는 외관점검표(§9-8d) ──
  let report9Checks: Report9CheckRow[] | null = null
  let report9Job: Report9Job | null = null
  let report9Files: Report9File[] = []
  let exteriorChecks: Report9CheckRow[] | null = null
  if (inspection.inspection_type === '일반관리' && customer) {
    const [ownerRes, jobResExt, filesResExt] = await Promise.all([
      admin.from('customer_contacts').select('id').eq('customer_id', inspection.customer_id).limit(1),
      admin.from('fire_plan_gen_jobs')
        .select('id, status, missing, error, created_at')
        .eq('inspection_id', id).eq('report_type', 'exterior')
        .order('created_at', { ascending: false }).limit(1),
      admin.storage.from('fire-plans').list(`${inspection.customer_id}/inspections/${id}`, { limit: 50, sortBy: { column: 'name', order: 'desc' } }),
    ])
    exteriorChecks = [
      {
        label: '① 외관점검 응답', ok: respRows.length > 0,
        detail: respRows.length > 0
          ? `응답 ${respRows.length}건 · 불량 ${xCount}건 (해당 월 결과란 자동 병합)`
          : '응답 없음 — 위 점검표(별지 6호 시트)를 입력해주세요',
      },
      {
        label: '② 점검자 배정', ok: !!employee,
        detail: employee ? `점검자 ${employee.name} (표지 해당 월 행 기재)` : '담당 미배정 — 점검자란 공란 출력',
      },
      {
        label: '③ 관계인 등록', ok: (ownerRes.data ?? []).length > 0,
        detail: (ownerRes.data ?? []).length > 0 ? '소방안전관리자란에 대표 관계인 기재' : '관계인 미등록 — 관리자란 공란 출력',
        href: `/customers/${inspection.customer_id}`, hrefLabel: '고객 관리 →',
      },
    ]
    report9Job = (jobResExt.data?.[0] as Report9Job | undefined) ?? null
    report9Files = (filesResExt.data ?? [])
      .filter(o => /^exterior_/.test(o.name))
      .map(o => ({ name: o.name, path: `${inspection.customer_id}/inspections/${id}/${o.name}`, createdAt: o.created_at ?? null }))
  }
  if (inspection.inspection_type !== '일반관리' && customer) {
    const [custFullRes, bldRes9, brigadeRes9, jobRes9, filesRes9] = await Promise.all([
      admin.from('customers')
        .select('address, use_approval_date, manager_selected_at, building_grade, insurance_joined, op_hours_weekday, headcount_worker, headcount_resident, headcount_max, email_delivery_consent')
        .eq('id', inspection.customer_id).single(),
      admin.from('buildings').select('purpose, total_area, building_area, floors_above, floors_below, height, households, building_count, permit_date, parking_summary, elevator_count, emergency_elevator_count, receiver_location, main_structure, roof_structure')
        .eq('customer_id', inspection.customer_id).eq('is_active', true)
        .order('created_at', { ascending: true }).limit(1).maybeSingle(),
      admin.from('fire_brigade_members').select('id').eq('customer_id', inspection.customer_id).limit(1),
      admin.from('fire_plan_gen_jobs')
        .select('id, status, missing, error, created_at')
        .eq('inspection_id', id).eq('report_type', 'report9')
        .order('created_at', { ascending: false }).limit(1),
      admin.storage.from('fire-plans').list(`${inspection.customer_id}/inspections/${id}`, { limit: 50, sortBy: { column: 'name', order: 'desc' } }),
    ])
    const cf = (custFullRes.data ?? {}) as Record<string, unknown>
    const b9 = (bldRes9.data ?? null) as Record<string, unknown> | null
    const quick = computeQuickReadiness({ inspection_type: customer.inspection_type }, {
      address: !!cf.address, purpose: !!b9?.purpose, useApprovalDate: !!cf.use_approval_date,
      permitDate: b9?.permit_date != null, totalArea: b9?.total_area != null, buildingArea: b9?.building_area != null,
      floors: b9?.floors_above != null || b9?.floors_below != null, height: b9?.height != null,
      households: b9?.households != null, buildingCount: b9?.building_count != null,
      elevator: b9?.elevator_count != null || b9?.emergency_elevator_count != null, parking: b9?.parking_summary != null,
      receiverLocation: !!b9?.receiver_location, structure: !!b9?.main_structure, roof: !!b9?.roof_structure,
      managerSelectedAt: !!cf.manager_selected_at, grade: !!cf.building_grade,
      insurance: cf.insurance_joined !== null && cf.insurance_joined !== undefined, opHours: !!cf.op_hours_weekday,
      headcount: cf.headcount_worker != null || cf.headcount_resident != null || cf.headcount_max != null,
      brigade: (brigadeRes9.data ?? []).length > 0,
      emailConsent: cf.email_delivery_consent !== null && cf.email_delivery_consent !== undefined,
    })
    const missingLicense = [
      ...(employee && !employee.license_no ? [employee.name] : []),
      ...auxParticipants.filter(a => !a.license_no).map(a => a.name),
    ]
    const consent = cf.email_delivery_consent as boolean | null | undefined
    report9Checks = [
      {
        label: '① 대상물 공통정보', ok: quick.done >= quick.total,
        detail: `${quick.done}/${quick.total} 입력${quick.missing.length > 0 ? ` — 누락: ${quick.missing.slice(0, 4).join('·')}${quick.missing.length > 4 ? ` 외 ${quick.missing.length - 4}` : ''}` : ''}`,
        href: `/customers/${inspection.customer_id}?tab=plan`, hrefLabel: '고객 탭에서 입력 →',
      },
      {
        label: '② 점검 인력', ok: !!employee && missingLicense.length === 0,
        detail: !employee ? '담당(주된 점검인력) 미배정'
          : missingLicense.length > 0 ? `자격번호 미입력: ${missingLicense.join('·')}` : `주된 1명 + 보조 ${auxParticipants.length}명`,
        href: '/employees', hrefLabel: '직원 관리 →',
      },
      {
        label: '③ 점검표 응답', ok: respRows.length > 0,
        detail: respRows.length > 0 ? `응답 ${respRows.length}건 · 불량 ${xCount}건 (3쪽 양호/불량 자동 롤업)` : '응답 없음 — 점검표를 입력해주세요',
      },
      {
        label: '④ 송달 동의', ok: consent !== null && consent !== undefined,
        detail: consent === true ? '동의' : consent === false ? '미동의' : '미확인',
        href: `/customers/${inspection.customer_id}?tab=plan`, hrefLabel: '고객 탭에서 입력 →',
      },
    ]
    report9Job = (jobRes9.data?.[0] as Report9Job | undefined) ?? null
    report9Files = (filesRes9.data ?? [])
      .filter(o => /^report(9|10|11)_/.test(o.name))
      .map(o => ({ name: o.name, path: `${inspection.customer_id}/inspections/${id}/${o.name}`, createdAt: o.created_at ?? null }))
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <Link href="/inspections" className="text-[#514b81] hover:text-[#7b68ee] transition-colors">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-4 text-[#7b68ee]" />
            <h1 className="text-xl font-bold text-[#090c1d]">
              {customer?.customer_name ?? '—'}
            </h1>
            <span className="text-sm text-[#514b81]">{inspection.year}년 {inspection.sequence_num}차</span>
          </div>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${TYPE_COLORS[inspection.inspection_type]}`}>
          {inspectionTypeLabel(inspection.inspection_type)}
        </span>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[inspection.status as InspectionStatus]}`}>
          {STATUS_LABELS[inspection.status as InspectionStatus]}
        </span>
      </div>

      {/* 기본정보 카드 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <div className="grid grid-cols-2 gap-3">
          <InfoChip
            icon={<Building2 className="size-3.5" />}
            label="고객"
            value={customer?.customer_name ?? '—'}
          />
          <InfoChip
            icon={<User className="size-3.5" />}
            label="담당자"
            value={employee ? `${employee.name}${employee.position ? ` (${employee.position})` : ''}` : '미배정'}
          />
          <InfoChip
            icon={<Calendar className="size-3.5" />}
            label="시작일"
            value={inspection.inspection_start_date}
          />
          {contact && (
            <InfoChip
              icon={<User className="size-3.5" />}
              label={`관계인 (${contact.role})`}
              value={`${contact.name}${contact.phone ? ` · ${contact.phone}` : ''}`}
            />
          )}
          {customer?.address && (
            <div className="col-span-2 flex items-start gap-2 text-sm">
              <span className="text-xs text-[#514b81] shrink-0 mt-0.5">주소</span>
              <span className="text-xs text-[#514b81]">{customer.address}</span>
            </div>
          )}
          {inspection.notes && (
            <div className="col-span-2 flex items-start gap-2 text-sm">
              <span className="text-xs text-[#514b81] shrink-0 mt-0.5">비고</span>
              <span className="text-xs text-[#514b81]">{inspection.notes}</span>
            </div>
          )}
        </div>
      </div>

      {/* 다일 점검 기간 (P32-9) */}
      <InspectionMultidayClient
        inspectionId={id}
        startDate={inspection.inspection_start_date}
        endDate={(inspection as { inspection_end_date?: string | null }).inspection_end_date ?? null}
        days={(inspection as { inspection_days?: number }).inspection_days ?? 1}
        canManage={canEdit}
      />

      {/* 진행률 바 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-[#090c1d]">전체 진행률</p>
          <span className="text-sm font-bold text-[#7b68ee]">{completedCount}/{steps.length} 단계</span>
        </div>
        <div className="w-full h-2.5 bg-[#e0ddf5] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? 'bg-green-500' : 'bg-[#7b68ee]'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-xs text-[#514b81]">시작</span>
          <span className="text-xs font-medium text-[#7b68ee]">{progressPct}%</span>
          <span className="text-xs text-[#514b81]">완료</span>
        </div>
      </div>

      {/* 6단계 체크리스트 + 보고서관리 — 2열 나란히 */}
      <div className="grid grid-cols-2 gap-5 items-start">
        <InspectionDetailClient
          steps={steps}
          inspectionId={id}
          canComplete={canComplete}
          canDelete={canDelete}
          today={today}
        />
        <InspectionReportsClient
          inspectionId={id}
          reports={reports}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      </div>

      {/* 점검 참여자 (주된/보조) — 보고서 개요 */}
      <InspectionParticipantsClient
        inspectionId={id}
        mainEmployee={employee ? { name: employee.name, license_no: employee.license_no } : null}
        aux={auxParticipants}
        employees={allEmployees}
        canManage={canEdit}
      />

      {/* 점검표 입력 (P34) */}
      <InspectionSheetClient
        inspectionId={id}
        inspectionType={customer?.inspection_type ?? ''}
        sheets={sheets}
        responses={responses}
        respondedCounts={respondedCounts}
        xCount={xCount}
        canManage={canEdit}
      />

      {/* 음성 점검표 입력 V-1 (§9-4) — 전사 → AI 구조화 → 확인 후 점검표 반영 */}
      <InspectionVoiceSheetClient inspectionId={id} canManage={canEdit} />

      {/* 외관점검표 (§9-8d) — 일반관리 점검 전용, 별지 9호 준비 UI 재사용 */}
      {exteriorChecks && (
        <InspectionReport9Client
          inspectionId={id}
          canManage={canEdit}
          checks={exteriorChecks}
          initialJob={report9Job}
          initialFiles={report9Files}
          defectsInfo={{ total: 0, planned: 0, done: 0 }}
          variant="exterior"
        />
      )}

      {/* 실시결과 보고서 별지 9호 (P3 §9-6⑦) — 일반관리 점검은 미표시(§9-8) */}
      {report9Checks && (
        <InspectionReport9Client
          inspectionId={id}
          canManage={canEdit}
          checks={report9Checks}
          initialJob={report9Job}
          initialFiles={report9Files}
          defectsInfo={{
            total: defects.length,
            planned: defects.filter(d => d.action_plan || d.action_start).length,
            done: defects.filter(d => d.action_completed_at).length,
          }}
        />
      )}

      {/* 작동점검 보고서 생성 (P32) */}
      <ReportGenerateClient inspectionId={id} history={genHistory} canManage={canEdit} />

      {/* 음성 불량 기록 (VN-1) — 말로 보고 → AI 정리 → 불량 추가 */}
      <InspectionVoiceDefectClient inspectionId={id} canManage={canEdit} />

      {/* 불량내역 — 전체 너비 */}
      <InspectionDefectsClient
        inspectionId={id}
        initialDefects={defects}
        canEdit={canEdit}
        canDelete={canDelete}
        hasActionPlan={hasActionPlan}
      />
    </div>
  )
}
