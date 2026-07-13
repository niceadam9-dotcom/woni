'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { buildOverview, injectReport, type OverviewData } from '@/lib/report-generator'
import { convertXlsxToPdf } from '@/lib/pdf'

const TEMPLATE_PATH = 'templates/operational_v2026.xlsx'   // 개요 허브 + 설비 점검표 37시트 결합 (P34-5)

type ReportBuild = { error?: string; bytes?: Uint8Array; baseName?: string; missing?: string[]; customerId?: string; snap?: unknown[] }

/** 작동점검 보고서 바이트 생성 (공통 헬퍼) — 개요+설비 점검표면+현황면 주입까지. */
async function buildOperationalReportBytes(inspectionId: string): Promise<ReportBuild> {
  const admin = createAdminClient()

  const { data: inspRaw } = await admin.from('inspections')
    .select('id, customer_id, contact_id, assigned_employee_id, inspection_start_date, year')
    .eq('id', inspectionId).single()
  if (!inspRaw) return { error: '점검을 찾을 수 없습니다.' }
  const insp = inspRaw as { id: string; customer_id: string; contact_id: string | null; assigned_employee_id: string | null; inspection_start_date: string; year: number }

  const [custRes, bldRes, mainRes, auxRes, stepsRes, contactRes] = await Promise.all([
    admin.from('customers').select('customer_name, address, fire_station').eq('id', insp.customer_id).single(),
    admin.from('buildings').select('id, purpose, total_area, building_area, floors_above, floors_below, height_m, unit_count, structure, roof, use_approval_date')
      .eq('customer_id', insp.customer_id).eq('is_active', true).order('building_name'),
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
  const buildings = (bldRes.data ?? []) as Array<{
    id: string; purpose: string | null; total_area: number | null; building_area: number | null
    floors_above: number | null; floors_below: number | null; height_m: number | null; unit_count: number | null
    structure: string | null; roof: string | null; use_approval_date: string | null
  }>
  const bld = buildings[0] ?? null
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
    buildingCount: buildings.length || 1, address: cust?.address ?? null,
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
  const buildingInfos = buildings.map(b => ({
    total_area: b.total_area, building_area: b.building_area,
    floors_above: b.floors_above, floors_below: b.floors_below,
    height_m: b.height_m, unit_count: b.unit_count, structure: b.structure, roof: b.roof,
  }))
  const { bytes } = injectReport(await tpl.arrayBuffer(), cells, responses, installedFacilities, buildingInfos)

  const baseName = `${cust?.customer_name ?? 'report'}_작동점검보고서_${today}`
  return { bytes, baseName, missing, customerId: insp.customer_id, snap: snap ?? [] }
}

/** 작동점검 보고서 xlsx 생성 (P32-3) → Storage + 이력. 엑셀 열면 수식으로 갑지 등 자동완성. */
export async function generateOperationalReportAction(
  inspectionId: string
): Promise<{ error?: string; url?: string; fileName?: string; missing?: string[] }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()
  const b = await buildOperationalReportBytes(inspectionId)
  if (b.error || !b.bytes) return { error: b.error ?? '보고서 생성에 실패했습니다.', missing: b.missing }

  const stamp = Date.now()
  const fileName = `${b.baseName}.xlsx`
  const path = `${b.customerId}/${inspectionId}/op_${stamp}.xlsx`
  const { error: upErr } = await admin.storage.from('reports')
    .upload(path, Buffer.from(b.bytes), { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false })
  if (upErr) return { error: `저장 실패: ${upErr.message}`, missing: b.missing }

  await admin.from('generated_reports').insert({
    inspection_id: inspectionId, report_kind: '작동', template_version: '작동_v2026',
    file_name: fileName, xlsx_path: path, facilities_snapshot: b.snap ?? [], generated_by: profile.id,
  } as Record<string, unknown>)

  const { data: signed } = await admin.storage.from('reports').createSignedUrl(path, 300)
  revalidatePath(`/inspections/${inspectionId}`)
  return { url: signed?.signedUrl, fileName, missing: b.missing }
}

/** 작동점검 보고서 PDF 생성 (P32-4) — xlsx→Gotenberg 변환 → base64 반환(브라우저 blob 자동인쇄용) */
export async function printOperationalReportAction(
  inspectionId: string
): Promise<{ error?: string; pdfBase64?: string; fileName?: string; missing?: string[] }> {
  await requirePermission('inspection_register')
  const b = await buildOperationalReportBytes(inspectionId)
  if (b.error || !b.bytes) return { error: b.error ?? '보고서 생성에 실패했습니다.', missing: b.missing }
  try {
    const pdf = await convertXlsxToPdf(b.bytes, `${b.baseName}.xlsx`)
    return { pdfBase64: Buffer.from(pdf).toString('base64'), fileName: `${b.baseName}.pdf`, missing: b.missing }
  } catch (e) {
    return { error: `PDF 변환 실패: ${(e as Error).message}`, missing: b.missing }
  }
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
