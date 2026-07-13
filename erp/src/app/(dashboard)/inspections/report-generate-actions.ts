'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { buildOverview, injectReport, type OverviewData } from '@/lib/report-generator'

const TEMPLATE_PATH = 'templates/operational_v2026.xlsx'   // 개요 허브 + 설비 점검표 37시트 결합 (P34-5)

/** 작동점검 보고서 생성 (P32-3) — 개요 주입 → 엑셀 생성 → Storage + 이력.
 *  엑셀을 열면 수식으로 갑지·정보·위임장 등이 자동 완성됨(§3-0). PDF 자동인쇄는 Gotenberg 도입 후(P32-1/4). */
export async function generateOperationalReportAction(
  inspectionId: string
): Promise<{ error?: string; url?: string; fileName?: string; missing?: string[] }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const { data: inspRaw } = await admin.from('inspections')
    .select('id, customer_id, contact_id, assigned_employee_id, inspection_start_date, year')
    .eq('id', inspectionId).single()
  if (!inspRaw) return { error: '점검을 찾을 수 없습니다.' }
  const insp = inspRaw as { id: string; customer_id: string; contact_id: string | null; assigned_employee_id: string | null; inspection_start_date: string; year: number }

  const [custRes, bldRes, mainRes, auxRes, stepsRes, contactRes] = await Promise.all([
    admin.from('customers').select('customer_name, address, fire_station').eq('id', insp.customer_id).single(),
    admin.from('buildings').select('id, purpose, total_area, floors_above, floors_below, use_approval_date')
      .eq('customer_id', insp.customer_id).eq('is_active', true).order('building_name').limit(1).maybeSingle(),
    insp.assigned_employee_id
      ? admin.from('profiles').select('name, license_no').eq('id', insp.assigned_employee_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('inspection_participants').select('profiles:employee_id (name, license_no)').eq('inspection_id', inspectionId).eq('role', '보조').order('sort_order'),
    admin.from('inspection_steps').select('step_num, due_date').eq('inspection_id', inspectionId).in('step_num', [5, 6]),
    insp.contact_id
      ? admin.from('customer_contacts').select('name, position, phone, birth_date').eq('id', insp.contact_id).maybeSingle()
      : admin.from('customer_contacts').select('name, position, phone, birth_date').eq('customer_id', insp.customer_id).eq('role', '대표').maybeSingle(),
  ])

  const cust = custRes.data as { customer_name: string; address: string | null; fire_station: string | null } | null
  const bld = bldRes.data as { id: string; purpose: string | null; total_area: number | null; floors_above: number | null; floors_below: number | null; use_approval_date: string | null } | null
  const main = mainRes.data as { name: string; license_no: string | null } | null
  const aux = ((auxRes.data ?? []) as unknown as Array<{ profiles: { name: string; license_no: string | null } | null }>)
    .map(a => ({ name: a.profiles?.name ?? '', license_no: a.profiles?.license_no ?? null })).filter(a => a.name)
  const steps = (stepsRes.data ?? []) as Array<{ step_num: number; due_date: string | null }>
  const contact = contactRes.data as { name: string; position: string | null; phone: string | null; birth_date: string | null } | null

  const today = new Date().toISOString().slice(0, 10)
  const data: OverviewData = {
    mainInspector: main, auxInspectors: aux, year: insp.year, docDate: today,
    inspectionDate: insp.inspection_start_date,
    contact, fireStation: cust?.fire_station ?? null,
    customerName: cust?.customer_name ?? '', purpose: bld?.purpose ?? null,
    buildingCount: 1, address: cust?.address ?? null,
    totalArea: bld?.total_area ?? null, floorsAbove: bld?.floors_above ?? null, floorsBelow: bld?.floors_below ?? null,
    useApprovalDate: bld?.use_approval_date ?? null,
    step5Date: steps.find(s => s.step_num === 5)?.due_date ?? null,
    step6Date: steps.find(s => s.step_num === 6)?.due_date ?? null,
  }

  const { cells, missing } = buildOverview(data)

  // 점검표 응답 로드 (설비별 점검표면 O/X 주입용, P34-5)
  const { data: respRows } = await admin.from('inspection_sheet_responses')
    .select('item_code, result').eq('inspection_id', inspectionId)
  const responses: Record<string, 'O' | 'X' | 'N'> = {}
  for (const r of (respRows ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N' }>)
    responses[r.item_code] = r.result

  // 소방시설 현황 로드 (현황면 체크박스 주입 + 스냅샷, P33-3)
  const { data: snap } = bld
    ? await admin.from('fire_facilities').select('facility_code, installed, detail').eq('building_id', bld.id)
    : { data: [] }
  const installedFacilities = ((snap ?? []) as Array<{ facility_code: string; installed: boolean }>)
    .filter(f => f.installed).map(f => f.facility_code)

  // 템플릿 로드 → 개요 + 설비 점검표면 + 현황면 주입
  const { data: tpl, error: tplErr } = await admin.storage.from('reports').download(TEMPLATE_PATH)
  if (tplErr || !tpl) return { error: '보고서 템플릿을 불러오지 못했습니다. 템플릿 업로드를 확인하세요.', missing }
  const { bytes } = injectReport(await tpl.arrayBuffer(), cells, responses, installedFacilities)

  const stamp = Date.now()
  const fileName = `${cust?.customer_name ?? 'report'}_작동점검보고서_${today}.xlsx`
  const path = `${insp.customer_id}/${inspectionId}/op_${stamp}.xlsx`
  const { error: upErr } = await admin.storage.from('reports')
    .upload(path, Buffer.from(bytes), { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false })
  if (upErr) return { error: `저장 실패: ${upErr.message}`, missing }

  await admin.from('generated_reports').insert({
    inspection_id: inspectionId, report_kind: '작동', template_version: '작동_v2026',
    file_name: fileName, xlsx_path: path, facilities_snapshot: snap ?? [], generated_by: profile.id,
  } as Record<string, unknown>)

  const { data: signed } = await admin.storage.from('reports').createSignedUrl(path, 300)
  revalidatePath(`/inspections/${inspectionId}`)
  return { url: signed?.signedUrl, fileName, missing }
}

/** 생성 이력 파일 재다운로드 URL */
export async function getGeneratedReportUrlAction(reportId: string): Promise<{ error?: string; url?: string; fileName?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data } = await admin.from('generated_reports').select('xlsx_path, file_name').eq('id', reportId).single()
  if (!data) return { error: '파일을 찾을 수 없습니다.' }
  const r = data as { xlsx_path: string; file_name: string }
  const { data: signed, error } = await admin.storage.from('reports').createSignedUrl(r.xlsx_path, 300)
  if (error || !signed) return { error: 'URL 생성 실패' }
  return { url: signed.signedUrl, fileName: r.file_name }
}
