'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'
import { buildFirePlanHtml, buildDataSheetHtml, FACILITY_FORM, type FirePlanGenData } from '@/lib/fire-plan-template'
import { toStandardCodes } from '@/lib/facility-codes'
import { convertHtmlToPdf } from '@/lib/pdf'

const BUCKET = 'fire-plans'
const MAX_SIZE = 30 * 1024 * 1024 // 30MB

/** 소방계획서 업로드 — 인쇄용 PDF(표준양식) 필수 + 한글 원본(HWP) 선택 (doc02 §8) */
export async function uploadFirePlanAction(
  customerId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const year = parseInt(String(formData.get('year') ?? ''), 10)
  if (isNaN(year) || year < 2000 || year > 2100) return { error: '연도를 확인해주세요.' }

  const pdf = formData.get('pdf') as File | null
  if (!pdf || pdf.size === 0) return { error: '인쇄용 PDF 파일을 선택해주세요. (소방계획서 표준양식)' }
  if (!pdf.name.toLowerCase().endsWith('.pdf')) return { error: '인쇄용 파일은 PDF 형식이어야 합니다.' }
  if (pdf.size > MAX_SIZE) return { error: 'PDF 파일은 30MB 이하여야 합니다.' }

  const hwp = formData.get('hwp') as File | null
  const hasHwp = !!hwp && hwp.size > 0
  if (hasHwp) {
    const lower = hwp.name.toLowerCase()
    if (!lower.endsWith('.hwp') && !lower.endsWith('.hwpx')) return { error: '원본 파일은 HWP/HWPX 형식이어야 합니다.' }
    if (hwp.size > MAX_SIZE) return { error: 'HWP 파일은 30MB 이하여야 합니다.' }
  }

  const { data: cust } = await admin
    .from('customers').select('customer_name').eq('id', customerId).single()
  if (!cust) return { error: '고객을 찾을 수 없습니다.' }

  const stamp = Date.now()
  const pdfPath = `${customerId}/${year}/${stamp}.pdf`
  const { error: pdfErr } = await admin.storage.from(BUCKET)
    .upload(pdfPath, Buffer.from(await pdf.arrayBuffer()), { contentType: 'application/pdf', upsert: false })
  if (pdfErr) return { error: `PDF 업로드 실패: ${pdfErr.message}` }

  let hwpPath: string | null = null
  if (hasHwp) {
    hwpPath = `${customerId}/${year}/${stamp}.${hwp.name.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp'}`
    const { error: hwpErr } = await admin.storage.from(BUCKET)
      .upload(hwpPath, Buffer.from(await hwp.arrayBuffer()), { contentType: 'application/octet-stream', upsert: false })
    if (hwpErr) {
      await admin.storage.from(BUCKET).remove([pdfPath]) // PDF만 남는 반쪽 업로드 방지
      return { error: `HWP 업로드 실패: ${hwpErr.message}` }
    }
  }

  const title = String(formData.get('title') ?? '').trim() || `${year}년 소방계획서`
  const note = String(formData.get('note') ?? '').trim() || null

  const { error: insErr } = await admin.from('fire_plans').insert({
    customer_id: customerId,
    year,
    title,
    pdf_name: pdf.name,
    pdf_path: pdfPath,
    hwp_name: hasHwp ? hwp.name : null,
    hwp_path: hwpPath,
    note,
    uploaded_by: profile.id,
  } as Record<string, unknown>)
  if (insErr) {
    await admin.storage.from(BUCKET).remove([pdfPath, ...(hwpPath ? [hwpPath] : [])])
    return { error: `저장 실패: ${insErr.message}` }
  }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'fire_plan_uploaded',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: { year, title, pdf_name: pdf.name, hwp_name: hasHwp ? hwp.name : null },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${customerId}`)
  return {}
}

export async function deleteFirePlanAction(planId: string): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { data: plan } = await admin
    .from('fire_plans')
    .select('customer_id, year, title, pdf_path, hwp_path, html_path, odt_path')
    .eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const p = plan as { customer_id: string; year: number; title: string | null; pdf_path: string | null; hwp_path: string | null; html_path: string | null; odt_path: string | null }

  await admin.storage.from(BUCKET).remove([
    ...(p.pdf_path ? [p.pdf_path] : []),
    ...(p.hwp_path ? [p.hwp_path] : []),
    ...(p.html_path ? [p.html_path] : []),
    ...(p.odt_path ? [p.odt_path] : []),
    // 표준양식 생성분의 폼 데이터(.form.json)도 함께 정리 — 없으면 무시됨
    ...(p.pdf_path?.includes('generated_') ? [p.pdf_path.replace(/\.pdf$/, '.form.json')] : []),
  ])
  const { error } = await admin.from('fire_plans').delete().eq('id', planId)
  if (error) return { error: '삭제에 실패했습니다.' }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'fire_plan_deleted',
    entity_type: 'customer',
    entity_id: p.customer_id,
    metadata: { year: p.year, title: p.title },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${p.customer_id}`)
  return {}
}

/** 제출추적 저장 (FP-2) — 관할 소방서 제출일·관할서 */
export async function updateFirePlanSubmissionAction(
  planId: string, input: { submittedAt: string | null; fireStation: string }
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: plan } = await admin.from('fire_plans').select('customer_id').eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const { error } = await admin.from('fire_plans')
    .update({ submitted_at: input.submittedAt || null, fire_station: input.fireStation.trim() || null } as Record<string, unknown>)
    .eq('id', planId)
  if (error) return { error: `제출정보 저장 실패: ${error.message}` }
  revalidatePath(`/customers/${(plan as { customer_id: string }).customer_id}`)
  return {}
}

/** 부속자료(지도·사진) 업로드 (FP-2) */
export async function uploadFirePlanAttachmentAction(formData: FormData): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const planId = String(formData.get('planId') ?? '')
  const kind = String(formData.get('kind') ?? '기타')
  const file = formData.get('file') as File | null
  if (!planId || !file || file.size === 0) return { error: '파일을 선택해주세요.' }
  if (file.size > MAX_SIZE) return { error: '파일은 30MB 이하여야 합니다.' }

  const { data: plan } = await admin.from('fire_plans').select('customer_id').eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }

  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `att/${planId}/${Date.now()}.${ext}`
  const { error: upErr } = await admin.storage.from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return { error: `업로드 실패: ${upErr.message}` }

  const { error: insErr } = await admin.from('fire_plan_attachments').insert({
    fire_plan_id: planId, kind: ['지도', '사진', '기타'].includes(kind) ? kind : '기타',
    file_name: file.name, file_path: path, uploaded_by: profile.id,
  } as Record<string, unknown>)
  if (insErr) { await admin.storage.from(BUCKET).remove([path]); return { error: `저장 실패: ${insErr.message}` } }
  revalidatePath(`/customers/${(plan as { customer_id: string }).customer_id}`)
  return {}
}

export async function deleteFirePlanAttachmentAction(attId: string): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: att } = await admin.from('fire_plan_attachments')
    .select('file_path, fire_plan_id, fire_plans(customer_id)').eq('id', attId).single()
  if (!att) return { error: '부속자료를 찾을 수 없습니다.' }
  const a = att as { file_path: string; fire_plans: { customer_id: string } | { customer_id: string }[] | null }
  await admin.storage.from(BUCKET).remove([a.file_path])
  const { error } = await admin.from('fire_plan_attachments').delete().eq('id', attId)
  if (error) return { error: '삭제에 실패했습니다.' }
  const cust = Array.isArray(a.fire_plans) ? a.fire_plans[0] : a.fire_plans
  if (cust) revalidatePath(`/customers/${cust.customer_id}`)
  return {}
}

/** 연차발행 (FP-2) — 현재 계획서를 다음 연도로 복제(파일 복사, 개정차수 1로 리셋) */
export async function issueNextYearPlanAction(planId: string): Promise<{ error?: string; year?: number }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: plan } = await admin.from('fire_plans')
    .select('customer_id, year, title, pdf_name, pdf_path, hwp_name, hwp_path, pdf_status').eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const p = plan as { customer_id: string; year: number; title: string | null; pdf_name: string | null; pdf_path: string | null; hwp_name: string | null; hwp_path: string | null; pdf_status: string }
  if (!p.pdf_path || p.pdf_status !== 'ready') return { error: 'PDF 변환이 완료된 뒤 연차발행할 수 있습니다.' }
  const newYear = p.year + 1

  const stamp = Date.now()
  const newPdfPath = `${p.customer_id}/${newYear}/${stamp}.pdf`
  const { error: cpErr } = await admin.storage.from(BUCKET).copy(p.pdf_path, newPdfPath)
  if (cpErr) return { error: `파일 복사 실패: ${cpErr.message}` }
  let newHwpPath: string | null = null
  if (p.hwp_path) {
    newHwpPath = `${p.customer_id}/${newYear}/${stamp}.${p.hwp_path.endsWith('hwpx') ? 'hwpx' : 'hwp'}`
    await admin.storage.from(BUCKET).copy(p.hwp_path, newHwpPath).catch(() => { newHwpPath = null })
  }

  const { error: insErr } = await admin.from('fire_plans').insert({
    customer_id: p.customer_id, year: newYear, title: `${newYear}년 소방계획서`,
    pdf_name: p.pdf_name, pdf_path: newPdfPath, hwp_name: p.hwp_name, hwp_path: newHwpPath,
    revision: 1, note: `${p.year}년 계획서에서 연차발행`, uploaded_by: profile.id,
  } as Record<string, unknown>)
  if (insErr) { await admin.storage.from(BUCKET).remove([newPdfPath, ...(newHwpPath ? [newHwpPath] : [])]); return { error: `발행 실패: ${insErr.message}` } }
  revalidatePath(`/customers/${p.customer_id}`)
  return { year: newYear }
}

/** 표준양식 생성 폼 기본값 — 고객·건물·시설·관계인·회사 데이터 자동 채움 (doc02 §8 A안) */
export async function getFirePlanGenDefaultsAction(
  customerId: string,
): Promise<{ error?: string; data?: FirePlanGenData }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  const [custRes, contactRes, bldRes, companyRes, formRes] = await Promise.all([
    admin.from('customers')
      .select('customer_name, address, use_approval_date, fire_station, inspection_type, plan_anchor_date, contract_date, building_grade, manager_selected_at')
      .eq('id', customerId).single(),
    admin.from('customer_contacts').select('role, name, phone').eq('customer_id', customerId),
    admin.from('buildings')
      .select('id, purpose, total_area, floors_above, floors_below, height, receiver_location, main_structure, roof_structure')
      .eq('customer_id', customerId).eq('is_active', true)
      .order('created_at', { ascending: true }),
    admin.from('company_profile').select('company_name, address, phone').limit(1).maybeSingle(),
    admin.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle(),
  ])
  const cust = custRes.data as {
    customer_name: string; address: string | null; use_approval_date: string | null
    fire_station: string | null; inspection_type: string; plan_anchor_date: string | null; contract_date: string | null
    building_grade: string | null; manager_selected_at: string | null
  } | null
  if (!cust) return { error: '고객을 찾을 수 없습니다.' }

  const contacts = (contactRes.data ?? []) as Array<{ role: string; name: string; phone: string | null }>
  const owner = contacts.find(c => c.role === '대표') ?? contacts[0]
  const buildings = (bldRes.data ?? []) as Array<{
    id: string; purpose: string | null; total_area: number | null; floors_above: number | null; floors_below: number | null
    height: number | string | null; receiver_location: string | null; main_structure: string | null; roof_structure: string | null
  }>
  const b = buildings[0]
  const company = companyRes.data as { company_name: string; address: string | null; phone: string | null } | null
  // 개정이력 입력(096 fire_plan_forms.sections.revision) — 있으면 작성일·개정내용 기본값으로 사용
  const revision = ((formRes.data as { sections?: { revision?: { revisionDate?: string; revisionNote?: string } } } | null)
    ?.sections?.revision) ?? null

  // 설치 시설 → 서식 1.4 항목 — 표준 코드(100) 정확 일치, 레거시 잔존분은 toStandardCodes로 정규화
  let facilities: string[] = []
  if (buildings.length > 0) {
    const { data: facRaw } = await admin.from('fire_facilities')
      .select('facility_code, installed')
      .in('building_id', buildings.map(x => x.id))
      .eq('installed', true)
    const codes = toStandardCodes(((facRaw ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code))
    const allItems = new Set(FACILITY_FORM.flatMap(g => g.items))
    facilities = codes.filter(c => allItems.has(c))
  }

  // 자체점검 시기 — 점검계획일 기준: 종합 고객은 종합=기준월·작동=+6개월, 작동 고객은 작동=기준월
  const year = new Date().getFullYear()
  const anchorMonth = cust.plan_anchor_date ? new Date(cust.plan_anchor_date).getMonth() + 1 : null
  const plus6 = anchorMonth ? ((anchorMonth - 1 + 6) % 12) + 1 : null
  const isComprehensive = cust.inspection_type === '종합'
  const operationMonth = anchorMonth ? `${year}년 ${isComprehensive ? plus6 : anchorMonth}월` : ''
  const comprehensiveMonth = isComprehensive && anchorMonth ? `${year}년 ${anchorMonth}월` : ''

  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const floors = b ? `지하 ${b.floors_below ?? 0}층 / 지상 ${b.floors_above ?? 0}층` : ''

  return {
    data: {
      year,
      revisionDate: revision?.revisionDate || kstToday,
      revisionNote: revision?.revisionNote || `${year}년 소방계획서 작성`,
      buildingName: cust.customer_name,
      address: cust.address ?? '',
      // 고객·건물 데이터 연동 (2026-07-21, 소방계획서_2.md 요구 3·4·5 — 종전 하드코딩 제거)
      grade: cust.building_grade ?? '',
      purpose: b?.purpose ?? '',
      useApprovalDate: cust.use_approval_date ?? '',
      totalArea: b?.total_area != null ? String(b.total_area) : '',
      buildingArea: '',
      floors,
      height: b?.height != null && String(b.height).trim() !== '' ? String(b.height) : '',
      structure: b?.main_structure ?? '',
      roof: b?.roof_structure ?? '',
      receiverLocation: b?.receiver_location ?? '',
      ownerName: owner?.name ?? '',
      ownerPhone: owner?.phone ?? '',
      managerName: owner?.name ?? '',
      managerPhone: owner?.phone ?? '',
      managerSelectedAt: cust.manager_selected_at ?? '',
      fireStation: cust.fire_station ?? '',
      stationDistance: '',
      stationEta: '',
      facilities,
      companyName: company?.company_name ?? '',
      companyAddress: company?.address ?? '',
      companyPhone: company?.phone ?? '',
      contractStart: cust.contract_date ?? '',
      inspectionCycle: '매월 1회',
      operationMonth,
      comprehensiveMonth,
      trainingMonth: 11,
      brigade: [
        { team: '자위소방대장', name: '', duty: '관리구역 상황통제', phone: '' },
        { team: '부대장', name: '', duty: '대장 부재시 수행', phone: '' },
        { team: '비상연락', name: '', duty: '119신고 및 상황전파', phone: '' },
        { team: '초기소화', name: '', duty: '소화기 이용 초기소화', phone: '' },
        { team: '피난유도', name: '', duty: '피난층 또는 옥상으로 피난유도', phone: '' },
      ],
      evacRoutes: [{ floor: '전층', route: '각 출입구 앞 직통계단 이용', guide: '', equip: '' }],
      assembly: '1층 주차장',
      evacNote: '피난유도자 지시에 따라 최단 경로로 피난 실시, 피난 늦은 인원은 옥상 대피',
      zones: [{
        zone: '전층', name: b?.purpose ?? '', area: b?.total_area != null ? String(b.total_area) : '',
        weekday: '', holiday: '', managerCo: '', contact: owner?.phone ?? '',
      }],
      // 원본 양식 예시 프리셋 (보일러실·주방·전기실)
      hazards: [
        { place: '보일러실', location: '', factors: ['전기적 요인', '가스누출(폭발)'] },
        { place: '주방', location: '', factors: ['부주의', '가스누출(폭발)'] },
        { place: '전기실', location: '', factors: ['전기적 요인'] },
      ],
      photos: [],
    },
  }
}

const IMAGE_EXTS: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** 표준양식 삽입용 사진 업로드 — fire-plans 버킷 gen-assets 경로 (마이그레이션 없음) */
export async function uploadFirePlanGenImageAction(
  customerId: string,
  formData: FormData,
): Promise<{ error?: string; path?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { error: '이미지 파일을 선택해주세요.' }
  if (file.size > 10 * 1024 * 1024) return { error: '이미지는 10MB 이하여야 합니다.' }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const mime = IMAGE_EXTS[ext]
  if (!mime) return { error: 'JPG/PNG/WEBP 이미지만 업로드할 수 있습니다.' }

  const path = `${customerId}/gen-assets/${Date.now()}.${ext}`
  const { error } = await admin.storage.from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: false })
  if (error) return { error: `업로드 실패: ${error.message}` }
  return { path }
}

/** 표준양식 삽입용 사진 삭제 (폼에서 제거 시) — gen-assets 경로만 허용 */
export async function deleteFirePlanGenImageAction(
  customerId: string,
  path: string,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  if (!path.startsWith(`${customerId}/gen-assets/`)) return { error: '잘못된 경로입니다.' }
  const admin = createAdminClient()
  await admin.storage.from(BUCKET).remove([path])
  return {}
}

/** 계획서 데이터 시트 PDF — 한컴독스(한글) 수동 편집 시 참조용 1장 요약 (doc02 §8 ④안) */
export async function downloadFirePlanDataSheetAction(
  customerId: string,
): Promise<{ error?: string; base64?: string; fileName?: string }> {
  const res = await getFirePlanGenDefaultsAction(customerId)
  if (res.error || !res.data) return { error: res.error ?? '데이터를 불러오지 못했습니다.' }
  try {
    const pdf = await convertHtmlToPdf(buildDataSheetHtml(res.data))
    return {
      base64: Buffer.from(pdf).toString('base64'),
      fileName: `${res.data.buildingName}_계획서데이터시트_${res.data.year}.pdf`,
    }
  } catch (e) {
    return { error: `PDF 생성 실패: ${(e as Error).message}` }
  }
}

/** 표준양식 생성 — HTML 템플릿 → Gotenberg PDF → 보관함 저장. 폼 입력은 .form.json으로 함께 보관(재편집용) */
export async function generateFirePlanAction(
  customerId: string,
  data: FirePlanGenData,
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  if (!data.year || data.year < 2000 || data.year > 2100) return { error: '연도를 확인해주세요.' }
  if (!data.buildingName.trim()) return { error: '대상물 명칭을 입력해주세요.' }

  // 삽입 사진: 스토리지에서 읽어 Gotenberg 멀티파트 파일로 첨부 (파일명 img{i}.{ext})
  const assets: Array<{ name: string; data: Uint8Array; mime: string }> = []
  const images: Array<{ file: string; kind: string; caption: string }> = []
  for (const [i, photo] of (data.photos ?? []).entries()) {
    const { data: file, error } = await admin.storage.from(BUCKET).download(photo.path)
    if (error || !file) return { error: `사진을 불러오지 못했습니다: ${photo.caption || photo.path}` }
    const ext = (photo.path.split('.').pop() ?? 'jpg').toLowerCase()
    const name = `img${i}.${ext}`
    assets.push({ name, data: new Uint8Array(await file.arrayBuffer()), mime: IMAGE_EXTS[ext] ?? 'image/jpeg' })
    images.push({ file: name, kind: photo.kind, caption: photo.caption })
  }

  let pdf: Uint8Array
  try {
    pdf = await convertHtmlToPdf(buildFirePlanHtml(data, images), assets)
  } catch (e) {
    return { error: `PDF 생성 실패: ${(e as Error).message}` }
  }

  const stamp = Date.now()
  const pdfPath = `${customerId}/${data.year}/generated_${stamp}.pdf`
  const jsonPath = `${customerId}/${data.year}/generated_${stamp}.form.json`
  const pdfName = `${data.year}년 소방계획서(표준양식).pdf`

  const { error: pdfErr } = await admin.storage.from(BUCKET)
    .upload(pdfPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false })
  if (pdfErr) return { error: `PDF 저장 실패: ${pdfErr.message}` }
  const { error: jsonErr } = await admin.storage.from(BUCKET)
    .upload(jsonPath, Buffer.from(JSON.stringify(data), 'utf8'), { contentType: 'application/json', upsert: false })
  if (jsonErr) {
    await admin.storage.from(BUCKET).remove([pdfPath])
    return { error: `양식 데이터 저장 실패: ${jsonErr.message}` }
  }

  // 같은 연도 기존 건수 +1 = 개정 차수
  const { count } = await admin.from('fire_plans')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId).eq('year', data.year)
  const revision = (count ?? 0) + 1

  const { error: insErr } = await admin.from('fire_plans').insert({
    customer_id: customerId,
    year: data.year,
    title: `${data.year}년 소방계획서`,
    pdf_name: pdfName,
    pdf_path: pdfPath,
    revision,
    revision_note: revision > 1 ? data.revisionNote : null,
    note: '표준양식 자동 생성',
    uploaded_by: profile.id,
  } as Record<string, unknown>)
  if (insErr) {
    await admin.storage.from(BUCKET).remove([pdfPath, jsonPath])
    return { error: `저장 실패: ${insErr.message}` }
  }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'fire_plan_generated',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: { year: data.year, revision },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 생성된 계획서의 폼 데이터 로드 — [편집·재생성]용 */
export async function getFirePlanFormAction(
  planId: string,
): Promise<{ error?: string; data?: FirePlanGenData }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: plan } = await admin.from('fire_plans').select('pdf_path').eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const pdfPath = (plan as { pdf_path: string }).pdf_path
  if (!pdfPath.includes('generated_')) return { error: '업로드된 계획서는 재편집할 수 없습니다.' }
  const { data: file, error } = await admin.storage.from(BUCKET)
    .download(pdfPath.replace(/\.pdf$/, '.form.json'))
  if (error || !file) return { error: '양식 데이터를 찾을 수 없습니다.' }
  try {
    // 구버전 form.json(서식 1.2·사진 도입 전) 정규화 — 누락 필드만 기본값 보충
    const parsed = JSON.parse(await file.text()) as Partial<FirePlanGenData>
    return { data: { zones: [], hazards: [], photos: [], ...parsed } as FirePlanGenData }
  } catch {
    return { error: '양식 데이터 형식이 올바르지 않습니다.' }
  }
}

/** 다운로드/인쇄/미리보기용 서명 URL (5분 유효) — html = HWP 생성분 웹 미리보기(레이아웃 참고) */
export async function getFirePlanFileUrlAction(
  planId: string,
  kind: 'pdf' | 'hwp' | 'html'
): Promise<{ error?: string; url?: string; fileName?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  const { data: plan } = await admin
    .from('fire_plans')
    .select('pdf_path, pdf_name, hwp_path, hwp_name, html_path')
    .eq('id', planId).single()
  if (!plan) return { error: '소방계획서를 찾을 수 없습니다.' }
  const p = plan as { pdf_path: string | null; pdf_name: string | null; hwp_path: string | null; hwp_name: string | null; html_path: string | null }

  const path = kind === 'pdf' ? p.pdf_path : kind === 'hwp' ? p.hwp_path : p.html_path
  const name = kind === 'pdf' ? p.pdf_name : kind === 'hwp' ? p.hwp_name : '미리보기.html'
  if (!path) {
    return {
      error: kind === 'pdf' ? 'PDF가 아직 준비되지 않았습니다. (변환 중)'
        : kind === 'hwp' ? 'HWP 원본이 등록되지 않았습니다.'
        : '웹 미리보기가 없는 계획서입니다. (HWP 자동 생성분만 제공)',
    }
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data?.signedUrl) return { error: 'URL 생성에 실패했습니다.' }
  return { url: data.signedUrl, fileName: name ?? undefined }
}
