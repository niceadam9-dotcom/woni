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
      .select('id, defect_code, defect_name, defect_detail, photo_url, after_photo_url, action_taken, action_completed_at, severity, created_at')
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
    admin.from('inspection_sheets').select('id, sheet_code, sheet_name').eq('version', 'v2025').order('sheet_code'),
    admin.from('inspection_sheet_responses').select('item_code, result, memo').eq('inspection_id', id),
  ])

  const sheets = (sheetsRes.data ?? []) as Array<{ id: string; sheet_code: string; sheet_name: string }>
  const respRows = (responsesRes.data ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo: string | null }>
  const responses: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }> = {}
  const respondedCounts: Record<string, number> = {}
  for (const r of respRows) {
    responses[r.item_code] = { result: r.result, memo: r.memo }
    const num = String(parseInt(r.item_code.split('-')[0], 10))
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
