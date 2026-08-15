import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ClipboardList } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InspectionParticipantsClient } from '@/components/inspections/inspection-participants-client'
import { InspectionMultidayClient } from '@/components/inspections/inspection-multiday-client'
import { ReportGenerateClient } from '@/components/inspections/report-generate-client'
import { InspectionSheetClient } from '@/components/inspections/inspection-sheet-client'
import { InspectionDeleteClient } from '@/components/inspections/inspection-delete-client'
import { InspectionDefectsClient } from '@/components/inspections/inspection-defects-client'
import { InspectionInfoPopover } from '@/components/inspections/inspection-info-popover'
import { PumpTestPanel } from '@/components/inspections/pump-test-panel'
import { PUMP_TEST_SHEETS } from '@/lib/pump-test'
import { listPumpTestsAction } from '@/app/(dashboard)/inspections/pump-test-actions'
import { ExteriorMonthProvider } from '@/components/inspections/exterior-month'
import { syncInspectionSteps, loadStepEvidence } from '@/lib/inspection-step-sync'
import { InspectionReport9Client, type Report9CheckRow } from '@/components/inspections/inspection-report9-client'
import { type TimelineData } from '@/components/inspections/inspection-timeline-client'
import { InspectionWorkbench } from '@/components/inspections/inspection-workbench'
import { stepDocs } from '@/lib/doc-requirements'
import { CONTRACT_FILE_RE, findArchivedCertInspections, isCertFileName } from '@/lib/doc-status'
import { sheetScope } from '@/lib/sheet-scope'
import { buildSheetOverviews, type SheetProgress } from '@/lib/sheet-overview'
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

// InfoChip은 기본정보 카드와 함께 InspectionInfoPopover로 이관됐다 (C1 R5-5)

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
  let steps = (stepsRes.data ?? []) as InspectionStep[]

  // §9-9a: 자체점검 여부 — plan_type 축 단독 판정 (special_*·null=자체점검 / monthly·레거시 event=정기·일반).
  // 관리유형 무관 — 일반관리 자체점검도 소방시설등점검표·별지 9호 대상 (소방계획서_6 W-4)
  const inspPlanType = ((inspection as unknown as Record<string, unknown>).plan_type as string | null) ?? null
  // 판정은 sheet-scope.ts 단일 소스 — 여기선 종류(작동/종합) 폴백이 불필요해 isSpecial·version만 꺼낸다
  const { isSpecial, version: sheetVersion } = sheetScope(inspPlanType)

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
    // 정기·일반 = 외관점검표 시트(EXT, 별지 6호 v2022 — §9-8d·§9-9a) / 특별 = 소방시설등점검표(STD v2025)
    admin.from('inspection_sheets').select('id, sheet_code, sheet_name')
      .eq('version', sheetVersion).order('sheet_code'),
    admin.from('inspection_sheet_responses').select('item_code, result, memo').eq('inspection_id', id),
  ])

  const sheets = (sheetsRes.data ?? []) as Array<{ id: string; sheet_code: string; sheet_name: string }>
  const respRows = (responsesRes.data ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo: string | null }>
  const responses: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }> = {}
  for (const r of respRows) responses[r.item_code] = { result: r.result, memo: r.memo }
  const xCount = respRows.filter(r => r.result === 'X').length

  // 펌프성능시험(법정 별지 4호 "※ 펌프성능시험" 표) — 이 점검 건에 포함된 설비 중 표가 붙는 것만.
  // STD-02 같은 sheet_code 앞자리가 item_code 앞자리(=설비 번호)와 같은 축이다.
  const pumpSheetNos = sheets
    .map(s => Number((s.sheet_code.match(/^STD-(\d+)$/)?.[1] ?? '')))
    .filter(n => (PUMP_TEST_SHEETS as readonly number[]).includes(n))
    .sort((a, b) => a - b)
  const pumpRows = pumpSheetNos.length > 0 ? (await listPumpTestsAction(id)).rows : []

  // 시트별 진행률 — sheet_id 조인 집계(sheet-overview.ts). 종전 item_code 접두 파싱은
  // 분모·O/X/N 집계를 못 구하고 MU 시트 다수를 한 버킷으로 뭉개서 폐기했다.
  // 회차별 작성·조회 트리와 같은 소스라 두 화면의 진행률이 어긋날 수 없다.
  // withGroups: 머더 카드 보드(소방계획서_23 S5-7)가 중분류 버킷을 쓴다 — 점검 상세만 true
  const { overviews } = await buildSheetOverviews(admin, [id], { id: profile.id, role: profile.role as UserRole }, { withGroups: true })
  const sheetProgress: Record<string, SheetProgress> = Object.fromEntries(
    (overviews[id]?.sheets ?? []).map(p => [p.sheetId, p]))

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

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]  // KST 기준 — D-day는 doc-status.ts todayKst()와 동일 기산

  // R4-7 누락 방어(소방계획서_21 B-4) — 증거 동기화 호출 지점이 한 곳만 빠져도 두 갈래가 되살아난다(R-2).
  // 상세 진입 시 계산 증거와 저장 status를 맞춘다. **불일치일 때만 쓰기**(syncInspectionSteps 내부에서
  // 바뀐 행만 갱신)라 조회 부하가 늘지 않고, 과거 데이터도 열람하는 순간 스스로 정합해진다.
  const { changed: stepsChanged } = await syncInspectionSteps(admin, id, profile.id)
  if (stepsChanged > 0) {
    // 위 Promise.all에서 이미 읽은 steps가 낡았다 — 바뀐 경우에만 다시 읽는다(평시 왕복 0회)
    const { data: fresh } = await admin.from('inspection_steps')
      .select('*').eq('inspection_id', id).order('step_num')
    steps = (fresh ?? []) as InspectionStep[]
  }
  // 독립 검증 D3: 화면 ✓도 서버와 **같은 증거·같은 판정 함수**를 써야 한다 —
  // 종전엔 타임라인이 리터럴로 다시 계산해 오프라인 보고·사유 완료가 화면에 반영되지 않았다.
  const stepEvidence = await loadStepEvidence(admin, id)
  // 전체 진행률 카드는 C1(R5-1)에서 제거했다 — 타임라인 헤더가 같은 값을 보여주고,
  // 그 카드가 읽던 inspection_steps는 월간 건에서 분모가 6으로 고정돼 100%에 닿지 못했다(R4-8에서 교정 예정)

  // ── 문서 타임라인 (§9-9 / P7) — 특별점검 ①~④(불량 시 ⑤⑥) / 정기·일반 ①(외관점검표) ──
  let report9Checks: Report9CheckRow[] | null = null
  let report9Job: Report9Job | null = null
  let report9Files: Report9File[] = []
  let exteriorChecks: Report9CheckRow[] | null = null
  let timelineData: TimelineData | null = null
  if (!isSpecial && customer) {
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

    // C1(소방계획서_21 R5-2): 월간 외관점검 건도 타임라인으로 — 종전 2열 체크리스트(InspectionDetailClient)를
    // 없애고 단계 표현을 한 곳으로 모은다. stepDocs가 ① 하나만 반환하므로 보고 절차 칸(②~⑥)은 렌더되지 않는다.
    timelineData = {
      steps: stepDocs({ isSpecial: false }),
      isGeneral: true,
      responded: respRows.length,
      certFile: null,
      contractFile: null,
      delivery: null,
      submit9: { due: null, dday: null, submittedAt: null },
      submit11: { due: null, dday: null, submittedAt: null },
      evidence: stepEvidence ?? undefined,   // D3: 화면도 서버와 같은 판정 함수를 쓴다
      defects: { total: defects.length, planned: 0, done: 0, photoPairs: 0 },
      prereqs: [],
      consentOk: false,
      inspectionSteps: steps,
      defectRows: [],
      reports: [],
    }
  }
  if (isSpecial && customer) {
    const [custFullRes, bldRes9, brigadeRes9, jobRes9, filesRes9, deliveryRes] = await Promise.all([
      admin.from('customers')
        .select('address, use_approval_date, manager_selected_at, building_grade, insurance_joined, op_hours_weekday, headcount_worker, headcount_resident, headcount_max, email_delivery_consent, report_email')
        .eq('id', inspection.customer_id).single(),
      admin.from('buildings').select('purpose, total_area, building_area, floors_above, floors_below, height, households, building_count, permit_date, parking_summary, elevator_count, emergency_elevator_count, receiver_location, main_structure, roof_structure')
        .eq('customer_id', inspection.customer_id).eq('is_active', true)
        .order('created_at', { ascending: true }).limit(1).maybeSingle(),
      admin.from('fire_brigade_members').select('id').eq('customer_id', inspection.customer_id).limit(1),
      admin.from('fire_plan_gen_jobs')
        .select('id, status, missing, error, created_at')
        .eq('inspection_id', id).eq('report_type', 'report9')
        .order('created_at', { ascending: false }).limit(1),
      admin.storage.from('fire-plans').list(`${inspection.customer_id}/inspections/${id}`, { limit: 100, sortBy: { column: 'name', order: 'desc' } }),
      admin.from('report_deliveries').select('recipient_email, sent_at')
        .eq('inspection_id', id).eq('doc_kind', 'report9_owner')
        .order('sent_at', { ascending: false }).limit(1),
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
    const storagePrefix = `${inspection.customer_id}/inspections/${id}`
    const allObjects = (filesRes9.data ?? [])
    report9Files = allObjects
      .filter(o => /^report(9|10|11)_/.test(o.name))
      .map(o => ({ name: o.name, path: `${storagePrefix}/${o.name}`, createdAt: o.created_at ?? null }))

    // 타임라인 데이터 (§9-9) — 기한: ④ 점검 종료+15일 / ⑥ 이행기간 종료일(max action_end)
    const certObj = allObjects.find(o => isCertFileName(o.name)) ?? null
    const contractObj = allObjects.find(o => CONTRACT_FILE_RE.test(o.name)) ?? null
    const deliveryRow = (deliveryRes.data?.[0] ?? null) as { recipient_email: string; sent_at: string } | null
    const iRec = inspection as unknown as Record<string, unknown>
    const endDate = (iRec.inspection_end_date as string | null) ?? (iRec.inspection_start_date as string | null)
    const addDays = (base: string, days: number) => {
      const d = new Date(base); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]
    }
    const ddayOf = (due: string | null) => due
      ? Math.round((new Date(due).getTime() - new Date(today).getTime()) / 86400000) : null
    const due9 = endDate ? addDays(endDate, 15) : null
    const actionEnds = defects.map(d => d.action_end).filter(Boolean).sort() as string[]
    const due11 = actionEnds.length > 0 ? actionEnds[actionEnds.length - 1] : null
    const photoPairs = defects.filter(d => d.photo_url && d.after_photo_url).length
    timelineData = {
      steps: stepDocs({ isSpecial: true }), // D-4: ①~⑥ 상시 — ⑤⑥ 해당없음 흐림은 클라이언트가 defects로 판정
      isGeneral: false,
      responded: respRows.length,
      certFile: certObj ? { name: certObj.name, path: `${storagePrefix}/${certObj.name}` } : null,
      // 종이 보관 후 정리된 회차는 '업로드 필요'가 아니다 (소방계획서_18 D-7 ⚠)
      certArchived: !certObj && (await findArchivedCertInspections(admin, [id])).has(id),
      contractFile: contractObj ? { name: contractObj.name, path: `${storagePrefix}/${contractObj.name}` } : null,
      delivery: deliveryRow ? { sentTo: deliveryRow.recipient_email, sentAt: deliveryRow.sent_at } : null,
      submit9: {
        due: due9, submittedAt: (iRec.report9_submitted_at as string | null) ?? null,
        dday: (iRec.report9_submitted_at as string | null) ? null : ddayOf(due9),
      },
      evidence: stepEvidence ?? undefined,   // D3: 화면도 서버와 같은 판정 함수를 쓴다
      // R5-8: ④가 기한의 기산 근거를 그 자리에서 보이고 고칠 수 있도록 기간을 함께 넘긴다
      period: {
        start: (iRec.inspection_start_date as string | null) ?? null,
        end: (iRec.inspection_end_date as string | null) ?? null,
        days: (iRec.inspection_days as number | null) ?? 1,
      },
      submit11: {
        due: due11, submittedAt: (iRec.report11_submitted_at as string | null) ?? null,
        dday: (iRec.report11_submitted_at as string | null) ? null : ddayOf(due11),
      },
      defects: {
        total: defects.length,
        planned: defects.filter(d => d.action_plan || d.action_start).length,
        done: defects.filter(d => d.action_completed_at).length,
        photoPairs,
      },
      prereqs: report9Checks,
      consentOk: consent === true && !!cf.report_email,
      // §4-E H-28: 여정 스텝퍼 통합 — inspection_steps 마감·완료 흡수, ⑤ 전/후 갤러리, 제출 보고서 파일
      inspectionSteps: steps,
      defectRows: defects.map(d => ({
        id: d.id, defect_name: d.defect_name, severity: d.severity,
        photo_url: d.photo_url, after_photo_url: d.after_photo_url,
        action_taken: d.action_taken, action_completed_at: d.action_completed_at,
      })),
      reports,
    }
  }

  return (
    /* R6-9 뷰포트 고정 — 페이지는 스크롤하지 않고 각 칸이 스크롤한다.
       좁은 화면(lg 미만)에서는 고정을 풀고 평소대로 세로로 흐른다(R6-10). */
    <div className="flex flex-col gap-3 lg:h-full lg:overflow-hidden">
      {/* 헤더 — 기본정보는 접이식으로 내렸다 (C1 R5-5 / D-1) */}
      <div className="relative flex shrink-0 items-center gap-3">
        <Link href="/inspections" className="text-[#514b81] hover:text-[#7b68ee] transition-colors">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-4 text-[#7b68ee] shrink-0" />
            <h1 className="text-xl font-bold text-[#090c1d] truncate">
              {customer?.customer_name ?? '—'}
            </h1>
            <span className="text-sm text-[#514b81] shrink-0">{inspection.year}년 {inspection.sequence_num}차</span>
            <span className="text-xs text-[#b0acd6] shrink-0 truncate">
              {employee ? `담당 ${employee.name}` : '담당 미배정'} · {inspection.inspection_start_date}
            </span>
          </div>
        </div>
        <InspectionInfoPopover info={{
          customerName: customer?.customer_name ?? '—',
          employee: employee ? `${employee.name}${employee.position ? ` (${employee.position})` : ''}` : '미배정',
          startDate: inspection.inspection_start_date,
          contactRole: contact?.role ?? null,
          contactName: contact?.name ?? null,
          contactPhone: contact?.phone ?? null,
          address: customer?.address ?? null,
          notes: inspection.notes ?? null,
        }} />
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${TYPE_COLORS[inspection.inspection_type]}`}>
          {inspectionTypeLabel(inspection.inspection_type)}
        </span>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_COLORS[inspection.status as InspectionStatus]}`}>
          {STATUS_LABELS[inspection.status as InspectionStatus]}
        </span>
      </div>

      {/* C1(소방계획서_21 R5): 13블록 → 헤더 + 타임라인 하나.
          제거: 전체 진행률 카드(R5-1, 타임라인 헤더가 대체) · 6단계 2열 체크리스트(R5-2, 타임라인이 흡수)
          이동: 다일기간·점검표 → ① / 참여자 → ② / 불량내역 → ⑤ (월간 외관점검 건은 단계가 ① 하나라 전부 ①로)
          C2(R6): 세로 아코디언 → 가로 스텝바 + 3칸 작업대. 슬롯 계약은 그대로라 여기서는 컴포넌트만 바뀐다 */}
      {timelineData && (
        <InspectionWorkbench
          inspectionId={id}
          canManage={canEdit}
          canComplete={canComplete}
          today={today}
          data={timelineData}
          initialJob={report9Job}
          initialFiles={report9Files}
          customerName={customer?.customer_name}
          customerId={inspection.customer_id}
          defectRows={defects}
          slots={{
            multiday: (
              <InspectionMultidayClient
                inspectionId={id}
                startDate={inspection.inspection_start_date}
                endDate={(inspection as { inspection_end_date?: string | null }).inspection_end_date ?? null}
                days={(inspection as { inspection_days?: number }).inspection_days ?? 1}
                canManage={canEdit}
              />
            ),
            sheet: (
              /* EX-4(소방계획서_19, 125): 외관점검표 '점검 월'의 단일 원천.
                 소방계획서_21 R3에서 음성 점검표(V-1)를 제거해 지금 소비자는 점검표 카드 하나뿐이지만,
                 provider는 유지한다 — 월 축 저장 규약(month별 UNIQUE 분화)이 여기에 묶여 있어
                 지역 상태로 되돌리면 EX-4 회귀 위험이 있다 */
              <ExteriorMonthProvider isExterior={inspPlanType === 'monthly' || inspPlanType === 'event'}>
                <InspectionSheetClient
                  inspectionId={id}
                  inspectionType={customer?.inspection_type ?? ''}
                  planType={inspPlanType}
                  sheets={sheets}
                  responses={responses}
                  progress={sheetProgress}
                  xCount={xCount}
                  canManage={canEdit}
                  ledgerSubCodes={overviews[id]?.ledgerSubCodes ?? []}
                />
              </ExteriorMonthProvider>
            ),
            /* 펌프성능시험 실측치 — 점검표 바로 아래. 법정 별지 4호 표의 원천이고,
               이 자리가 생겨야 37시트 엑셀을 지울 수 있다(R5-6 선행, R5-7 대조 결과) */
            pumpTest: pumpSheetNos.length > 0 ? (
              <PumpTestPanel inspectionId={id} sheetNos={pumpSheetNos} initial={pumpRows} canEdit={canEdit} />
            ) : null,
            // 외관점검표 (§9-8d) — 월간 외관점검 건 전용, 별지 9호 준비 UI 재사용
            exterior: exteriorChecks ? (
              <InspectionReport9Client
                inspectionId={id}
                canManage={canEdit}
                checks={exteriorChecks}
                initialJob={report9Job}
                initialFiles={report9Files}
                defectsInfo={{ total: 0, planned: 0, done: 0 }}
                variant="exterior"
                customerName={customer?.customer_name}
              />
            ) : null,
            participants: (
              <InspectionParticipantsClient
                inspectionId={id}
                mainEmployee={employee ? { name: employee.name, license_no: employee.license_no } : null}
                aux={auxParticipants}
                employees={allEmployees}
                canManage={canEdit}
              />
            ),
            defects: (
              <>
                {/* 타임라인 ⑤ 전·후 사진 슬롯 앵커 — 기존 #defects 딥링크 유지 */}
                <div id="defects" />
                <InspectionDefectsClient
                  inspectionId={id}
                  initialDefects={defects}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  hasActionPlan={hasActionPlan}
                />
              </>
            ),
          }}
        />
      )}

      {/* 상시 쓰지 않는 도구는 접어 둔다 — 펼치면 작업대가 그만큼 줄어들 뿐 페이지는 스크롤하지 않는다(R6-9) */}
      <details className="shrink-0 rounded-xl border border-[#e0ddf5] bg-white">
        <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-[#847ba8] hover:text-[#7b68ee]">
          기타 도구{genHistory.length > 0 ? ' — 과거 엑셀 점검표' : ''}{canDelete ? ' · 점검 삭제' : ''}
        </summary>
        <div className="max-h-[40vh] space-y-3 overflow-y-auto border-t border-[#f3f1fc] p-3">
          {/* 소방시설등점검표(엑셀) — **생성 폐지**(소방계획서_21 R5-6 / 소방계획서_7 D-9, 2026-08-13).
              별지 4호 PDF가 대체하고, R5-7 대조로 유실 0을 확인한 뒤 걷어냈다.
              과거 생성물 다운로드만 남는다(이력이 없으면 컴포넌트가 스스로 렌더하지 않는다) */}
          <ReportGenerateClient history={genHistory} />

          {/* 점검 삭제 — 단계 완료·보고서는 작업대가 흡수했고 삭제만 별도로 남는다 */}
          {canDelete && <InspectionDeleteClient inspectionId={id} />}
        </div>
      </details>
    </div>
  )
}
