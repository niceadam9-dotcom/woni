'use server'

import { revalidatePath } from 'next/cache'
import JSZip from 'jszip'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { getCompanyProfile } from '@/lib/company-profile'
import { isGoogleConfigured, gmailSendWithAttachment } from '@/lib/google'
import { CERT_FILE_RE, CONTRACT_FILE_RE, CERT_PAPER_ACTION, findArchivedCertInspections } from '@/lib/doc-status'
import { syncInspectionSteps } from '@/lib/inspection-step-sync'
import { extractStoragePath } from '@/lib/defect-photos'
import { renderMessage } from '@/lib/message-template'
import { OWNER_REPORT_OFFLINE_ACTION, STEP_FORCE_COMPLETE_ACTION, STEP_FORCE_UNDO_ACTION } from '@/lib/inspection-step-status'

/** 문서 타임라인 액션 (소방계획서_4.md §9-9 / P7)
 *  업로드 슬롯 3종(②배치확인서·⑤계약서 — 전후 사진은 불량내역 슬롯 재사용), ③ 관계인 보고 발송,
 *  ④⑥ 제출 패키지(ZIP)·제출일 기록. 파일 보관 = fire-plans/{cust}/inspections/{insp}/ (§9-6f 규약) */

const BUCKET = 'fire-plans'

const SLOT_PREFIX: Record<string, string> = { cert: 'cert', contract: 'contract' }
const FILE_EXTS: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  hwp: 'application/octet-stream', hwpx: 'application/octet-stream', zip: 'application/zip',
}

async function inspectionPrefix(inspectionId: string): Promise<{ prefix?: string; customerId?: string; error?: string }> {
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const customerId = (insp as { customer_id: string }).customer_id
  return { prefix: `${customerId}/inspections/${inspectionId}`, customerId }
}

/** ⑥ 배치신고 도우미 (소방계획서_5 R7) — 협회 점검인력 배치신고에 필요한 값을 신고 순서 텍스트로 구성.
 *  대상물·소재지·점검기간·점검인력(성명/자격/자격번호)·점검업체. 빈 값은 앰버 + 입력처 딥링크로 안내. */
export type PlacementField = { label: string; value: string; missing: boolean; href?: string; hrefLabel?: string }

export async function getPlacementInfoAction(inspectionId: string): Promise<{
  fields?: PlacementField[]; text?: string; error?: string
}> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('id, customer_id, inspection_start_date, inspection_end_date')
    .eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const i = insp as { customer_id: string; inspection_start_date: string | null; inspection_end_date: string | null }

  const [custRes, partRes, company] = await Promise.all([
    admin.from('customers').select('customer_name, address').eq('id', i.customer_id).single(),
    admin.from('inspection_participants')
      .select('role, sort_order, employee:profiles(name, license_grade, license_no)')
      .eq('inspection_id', inspectionId).order('role', { ascending: true }).order('sort_order', { ascending: true }),
    getCompanyProfile(),
  ])
  const cust = custRes.data as { customer_name: string; address: string | null } | null
  type PartRow = { role: string; employee: { name: string | null; license_grade: string | null; license_no: string | null } | null }
  const parts = ((partRes.data ?? []) as unknown as PartRow[])
    // 주된 먼저 (한글 '주된' < '보조' 정렬이 역이므로 명시 정렬)
    .sort((a, b) => (a.role === '주된' ? -1 : 1) - (b.role === '주된' ? -1 : 1))

  const custHref = `/customers/${i.customer_id}`
  const period = i.inspection_start_date
    ? `${i.inspection_start_date}${i.inspection_end_date && i.inspection_end_date !== i.inspection_start_date ? ` ~ ${i.inspection_end_date}` : ''}`
    : ''
  const personnelText = parts.length > 0
    ? parts.map(p => {
        const e = p.employee
        const bits = [e?.name ?? '(성명 미입력)', e?.license_grade ?? '(자격 미입력)', e?.license_no ?? '(자격번호 미입력)']
        return ` - (${p.role}) ${bits.join(' / ')}`
      }).join('\n')
    : ''
  const companyText = company
    ? `${company.company_name}${company.representative ? ` (대표 ${company.representative}` : ''}${company.business_number ? `, 사업자 ${company.business_number}` : ''}${company.phone ? `, 연락처 ${company.phone}` : ''}${company.representative || company.business_number || company.phone ? ')' : ''}`
    : ''

  const fields: PlacementField[] = [
    { label: '대상물명', value: cust?.customer_name ?? '', missing: !cust?.customer_name, href: custHref, hrefLabel: '고객 정보' },
    { label: '소재지', value: cust?.address ?? '', missing: !cust?.address, href: custHref, hrefLabel: '고객 정보' },
    { label: '점검기간', value: period, missing: !period, href: `/inspections/${inspectionId}`, hrefLabel: '점검 상세' },
    { label: '점검인력', value: personnelText.trim(), missing: parts.length === 0 || parts.some(p => !p.employee?.license_no), href: `/inspections/${inspectionId}`, hrefLabel: '점검 인력' },
    { label: '점검업체', value: companyText, missing: !company?.company_name, href: '/admin', hrefLabel: '회사 정보' },
  ]

  const text = [
    '[점검인력 배치신고 정보]',
    `대상물명: ${cust?.customer_name ?? ''}`,
    `소재지: ${cust?.address ?? ''}`,
    `점검기간: ${period}`,
    '점검인력:',
    personnelText || ' - (미입력)',
    `점검업체: ${companyText}`,
  ].join('\n')

  return { fields, text }
}

/** ②배치확인서 / ⑤공사 계약서 업로드 — 타임라인 행 슬롯 (별도 화면 없음).
 *  업로드 이력은 activity_logs(timeline_upload)로 남겨 보고서 센터 '최근 문서'(R5)가 통합 조회 */
export async function uploadTimelineFileAction(
  inspectionId: string, slot: 'cert' | 'contract', formData: FormData,
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!SLOT_PREFIX[slot]) return { error: '지원하지 않는 슬롯입니다.' }
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { error: '파일을 선택해주세요.' }
  if (file.size > 20 * 1024 * 1024) return { error: '파일은 20MB 이하여야 합니다.' }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (!FILE_EXTS[ext]) return { error: 'PDF/JPG/PNG/HWP 파일만 업로드할 수 있습니다.' }

  const { prefix, customerId, error } = await inspectionPrefix(inspectionId)
  if (error) return { error }
  const admin = createAdminClient()
  const path = `${prefix}/${SLOT_PREFIX[slot]}_${Date.now()}.${ext}`
  const { error: upErr } = await admin.storage.from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: FILE_EXTS[ext], upsert: false })
  if (upErr) return { error: `업로드 실패: ${upErr.message}` }
  const { data: cust } = await admin.from('customers').select('customer_name').eq('id', customerId!).single()
  await admin.from('activity_logs').insert({
    actor_id: profile.id, action: 'timeline_upload', entity_type: 'inspection', entity_id: inspectionId,
    metadata: { slot, customerId, customerName: (cust as { customer_name: string } | null)?.customer_name ?? '—', fileName: file.name },
  } as Record<string, unknown>)
  // R4-6: ② 배치확인서 업로드가 곧 근거 — 파일이 생기면 단계가 스스로 완료된다
  if (slot === 'cert') await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return {}
}

/** ②⑤ 업로드 슬롯 파일 삭제 — 잘못 올린 파일을 화면에서 되돌린다.
 *
 *  종전에는 업로드만 있고 삭제가 없어, 다른 고객 파일을 잘못 올리면 화면에서 되돌릴 방법이 없었다.
 *  ②는 파일이 곧 완료 근거라 잘못된 파일 하나로 단계가 완료로 굳는다 — 지우면 다시 미완료가 되도록
 *  삭제 후에도 동기화를 부른다(업로드 경로와 대칭).
 *  슬롯 규약(cert_/contract_)에 맞는 파일만 지운다 — 생성물(report9_ 등)은 이 경로로 못 지운다. */
export async function deleteTimelineFileAction(
  inspectionId: string, slot: 'cert' | 'contract',
): Promise<{ error?: string; deleted?: number }> {
  const profile = await requirePermission('inspection_register')
  const re = slot === 'cert' ? CERT_FILE_RE : slot === 'contract' ? CONTRACT_FILE_RE : null
  if (!re) return { error: '지원하지 않는 슬롯입니다.' }

  const { prefix, customerId, error } = await inspectionPrefix(inspectionId)
  if (error) return { error }
  const admin = createAdminClient()
  const { data: objects } = await admin.storage.from(BUCKET).list(prefix!, { limit: 100 })
  const targets = (objects ?? []).filter(o => re.test(o.name)).map(o => `${prefix}/${o.name}`)
  if (targets.length === 0) return { error: '삭제할 파일이 없습니다.' }

  const { error: rmErr } = await admin.storage.from(BUCKET).remove(targets)
  if (rmErr) return { error: `삭제 실패: ${rmErr.message}` }

  await admin.from('activity_logs').insert({
    actor_id: profile.id, action: 'timeline_delete', entity_type: 'inspection', entity_id: inspectionId,
    metadata: { slot, customerId, files: targets.map(t => t.split('/').pop()) },
  } as Record<string, unknown>)
  // 근거가 사라졌으므로 다시 판정한다 — 지웠는데 완료로 남아 있으면 업로드 경로와 어긋난다
  if (slot === 'cert') await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return { deleted: targets.length }
}

/** ② 배치확인서 — **종이 보관** 사실 기록 (제안1)
 *
 *  협회 발급본을 종이로만 받아 파일철에 보관하는 경우가 실무의 기본값인데, 그 사실을 적을 자리가
 *  없어 [사유 완료](예외 경로)로 때워야 했다. 종이는 예외가 아니라 증거다 — ③의 방문·유선 보고와
 *  같은 취급으로 마커를 남긴다. 마이그레이션 없이 activity_logs(append-only)에 기록한다.
 *
 *  ⚠ 나중에 스캔본을 올리면 파일이 더 강한 증거라 그대로 완료가 유지된다(둘 다 done[2]=true). */
export async function recordCertPaperAction(
  inspectionId: string, input: { date: string; location: string; memo?: string },
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: '수령일 형식을 확인해주세요.' }
  const location = input.location.trim()
  if (!location) return { error: '보관 위치를 입력해주세요 (예: 사무실 캐비닛 A, 고객 비치).' }
  if (location.length > 60) return { error: '보관 위치는 60자 이내로 입력해주세요.' }
  const admin = createAdminClient()
  await admin.from('activity_logs').insert({
    actor_id: profile.id, action: CERT_PAPER_ACTION,
    entity_type: 'inspection', entity_id: inspectionId,
    metadata: { date: input.date, location, memo: (input.memo ?? '').trim().slice(0, 300) },
  } as Record<string, unknown>)
  await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return {}
}

/** ③ 관계인 보고 — 최신 별지 9호 생성물을 송달 동의 이메일로 발송 + 발송 이력(보고 증빙) */
export async function sendOwnerReportAction(inspectionId: string): Promise<{ error?: string; sentTo?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!isGoogleConfigured()) return { error: 'Google 연동이 설정되지 않았습니다 (GOOGLE_* env).' }
  const admin = createAdminClient()

  const { data: insp } = await admin.from('inspections')
    .select('customer_id, customer:customers(customer_name, email_delivery_consent, report_email)')
    .eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const i = insp as unknown as { customer_id: string; customer: { customer_name: string; email_delivery_consent: boolean | null; report_email: string | null } | null }
  if (i.customer?.email_delivery_consent !== true) return { error: '전자우편 송달 동의가 없습니다 — 고객 소방계획서 탭에서 동의·이메일을 먼저 입력해주세요.' }
  if (!i.customer.report_email) return { error: '송달 이메일이 없습니다.' }

  // 최신 별지 9호 생성물 (PDF 우선, 없으면 HWP)
  const prefix = `${i.customer_id}/inspections/${inspectionId}`
  const { data: objects } = await admin.storage.from(BUCKET).list(prefix, { limit: 60, sortBy: { column: 'name', order: 'desc' } })
  const files = (objects ?? []).map(o => o.name).filter(n => /^report9_\d+\.(pdf|hwp)$/.test(n))
  const pick = files.find(n => n.endsWith('.pdf')) ?? files[0]
  if (!pick) return { error: '발송할 별지 9호 생성물이 없습니다 — ④ 단계에서 먼저 생성해주세요.' }
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(`${prefix}/${pick}`)
  if (dlErr || !blob) return { error: '생성물 다운로드에 실패했습니다.' }

  const customerName = i.customer.customer_name
  const ext = pick.endsWith('.pdf') ? 'pdf' : 'hwp'

  // R7-8: 제목·본문·첨부 파일명을 message_templates에서 렌더한다(130 미적용이면 현행 문구로 폴백).
  // 종전에는 상호가 제목·본문에 리터럴로 박혀 있어 상호 변경 시 재배포가 필요했다.
  const { data: inspMeta } = await admin.from('inspections')
    .select('year, sequence_num, inspection_start_date').eq('id', inspectionId).single()
  const im = (inspMeta ?? {}) as { year?: number; sequence_num?: number; inspection_start_date?: string }
  const rendered = await renderMessage(admin, 'owner_report', {
    고객명: customerName,
    연도: String(im.year ?? ''),
    차수: String(im.sequence_num ?? ''),
    점검일: im.inspection_start_date ?? '',
  })
  const filename = `${rendered.attachmentName || `${customerName}_자체점검결과보고서`}.${ext}`
  const subject = rendered.subject
  try {
    const { messageId } = await gmailSendWithAttachment({
      to: i.customer.report_email,
      subject,
      bodyText: rendered.body,
      attachment: { filename, mime: ext === 'pdf' ? 'application/pdf' : 'application/octet-stream', data: new Uint8Array(await blob.arrayBuffer()) },
    })
    const { data: deliv } = await admin.from('report_deliveries').insert({
      inspection_id: inspectionId, customer_id: i.customer_id, doc_kind: 'report9_owner',
      recipient_email: i.customer.report_email, subject, file_name: filename,
      message_id: messageId, sent_by: profile.id,
    } as Record<string, unknown>).select('id').single()
    // R7-7: 발송 시점에 **렌더된 본문**을 남긴다 — 템플릿이 나중에 바뀌어도 당시 내용을 복원할 수 있게.
    // 130 미적용 DB에는 body 컬럼이 없다. 본문 이력 때문에 발송이 실패해선 안 되므로 별도 UPDATE로 분리한다.
    // 다만 **조용히 삼키지는 않는다**(독립 검증 지적) — 컬럼 부재가 아닌 다른 이유로 실패하면
    // 증빙이 빠진 사실을 알 방법이 없어진다. 서버 로그에 남겨 추적 가능하게 한다.
    if (deliv) {
      const { error: bodyErr } = await admin.from('report_deliveries')
        .update({ body: rendered.body } as Record<string, unknown>)
        .eq('id', (deliv as { id: string }).id)
      if (bodyErr) {
        console.error('[sendOwnerReport] 발송 본문 이력 저장 실패(발송은 완료됨):', bodyErr.message)
      }
    }
    // R4-6: ③ 발송 이력이 곧 근거
    await syncInspectionSteps(admin, inspectionId, profile.id)
    revalidatePath(`/inspections/${inspectionId}`)
    revalidatePath('/inspections')
    return { sentTo: i.customer.report_email }
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('403') || msg.toLowerCase().includes('insufficient')) {
      return { error: '메일 발송 권한이 없습니다 — Google OAuth를 gmail.send 스코프로 재발급해야 합니다 (scripts/google-oauth-setup.mjs 재실행 후 GOOGLE_REFRESH_TOKEN 교체).' }
    }
    return { error: `발송 실패: ${msg.slice(0, 200)}` }
  }
}

/** ④⑥ 제출일 기록·정정 — 기한 D-day·알림 소멸 조건 (§9-6f 제출추적).
 *  R4-6: 제출일이 ④⑥의 근거이므로 기록·삭제 후 단계 동기화를 부른다. date=null이면 정정(지움) —
 *  **되돌림에 예외가 없다**(제출일을 지웠으면 그 단계는 미완료로 돌아간다, R4-4). */
export async function recordSubmissionAction(
  inspectionId: string, kind: 'report9' | 'report11', date: string | null,
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '제출일 형식을 확인해주세요.' }
  const admin = createAdminClient()
  const col = kind === 'report9' ? 'report9_submitted_at' : 'report11_submitted_at'
  const { error } = await admin.from('inspections').update({ [col]: date }).eq('id', inspectionId)
  if (error) return { error: `저장 실패: ${error.message}` }
  await admin.from('activity_logs').insert({
    actor_id: profile.id, action: date ? 'report_submitted' : 'report_submission_cleared',
    entity_type: 'inspection', entity_id: inspectionId,
    metadata: { kind, date },
  } as Record<string, unknown>)
  await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return {}
}

/** ③ 관계인 보고 — 방문·전화 등 **오프라인 보고 근거** 기록 (R4-2 / B-2)
 *
 *  종전엔 이메일 발송 이력만 근거라, 방문·전화로 보고한 경우 근거가 없어 [단계 완료] 버튼으로 때웠다.
 *  그 버튼은 실제로 하지 않은 일도 완료로 만들 수 있어 소방서 제출 이력이 부정확해진다(D34-2).
 *  마이그레이션 없이 activity_logs 마커로 남긴다 — 소방계획서_18이 배치확인서 종이보관에 쓴 방식과 동일하고,
 *  activity_logs는 append-only(001)라 2년 증빙 재구성의 단서로도 남는다. */
export async function recordOwnerReportOfflineAction(
  inspectionId: string, input: { date: string; method: string; memo?: string },
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: '보고일 형식을 확인해주세요.' }
  const method = input.method.trim()
  if (!method) return { error: '보고 방법을 입력해주세요 (예: 방문 설명, 유선 통보).' }
  if (method.length > 40) return { error: '보고 방법은 40자 이내로 입력해주세요.' }
  const admin = createAdminClient()
  await admin.from('activity_logs').insert({
    actor_id: profile.id, action: OWNER_REPORT_OFFLINE_ACTION,
    entity_type: 'inspection', entity_id: inspectionId,
    metadata: { date: input.date, method, memo: (input.memo ?? '').trim().slice(0, 300) },
  } as Record<string, unknown>)
  await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return {}
}

/** 그 밖의 예외를 사람이 확정 — **사유 필수** (R4-3 / B-2)
 *
 *  근거 없는 완료를 없애는 대신, 정말 예외가 필요한 경우를 위해 남겨둔 경로다.
 *  사유가 곧 증거이므로 사유 없이는 완료할 수 없다. 마커가 남아 동기화는 계속 단일 기록자로 유지된다. */
export async function forceCompleteStepAction(
  inspectionId: string, stepNum: number, reason: string,
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > 6) return { error: '단계 번호를 확인해주세요.' }
  const trimmed = reason.trim()
  if (trimmed.length < 5) return { error: '완료 사유를 5자 이상 입력해주세요 — 사유가 곧 증빙입니다.' }
  if (trimmed.length > 300) return { error: '사유는 300자 이내로 입력해주세요.' }
  const admin = createAdminClient()
  await admin.from('activity_logs').insert({
    actor_id: profile.id, action: STEP_FORCE_COMPLETE_ACTION,
    entity_type: 'inspection', entity_id: inspectionId,
    metadata: { step_num: stepNum, reason: trimmed },
  } as Record<string, unknown>)
  await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return {}
}

/** 강제 완료 **철회** (독립 검증 D1)
 *
 *  activity_logs는 append-only(트리거 040)라 마커를 지울 수 없다 — 반대 마커를 덧붙여 무효화한다.
 *  철회하면 그 단계는 다시 증거만으로 판정되므로, 증거가 없으면 미완료로 돌아간다.
 *  철회도 기록이라 '누가 언제 되돌렸는지'가 남는다(강제 완료가 영구 고정되던 결함의 해소). */
export async function undoForceCompleteStepAction(
  inspectionId: string, stepNum: number, reason: string,
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > 6) return { error: '단계 번호를 확인해주세요.' }
  const trimmed = reason.trim()
  if (trimmed.length < 5) return { error: '철회 사유를 5자 이상 입력해주세요 — 철회도 기록으로 남습니다.' }
  if (trimmed.length > 300) return { error: '사유는 300자 이내로 입력해주세요.' }
  const admin = createAdminClient()
  await admin.from('activity_logs').insert({
    actor_id: profile.id, action: STEP_FORCE_UNDO_ACTION,
    entity_type: 'inspection', entity_id: inspectionId,
    metadata: { step_num: stepNum, reason: trimmed },
  } as Record<string, unknown>)
  await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return {}
}

/** ④⑥ 제출 패키지 — 관련 문서 일괄 ZIP (base64 반환, 클라이언트 다운로드) */
export async function downloadPackageAction(
  inspectionId: string, kind: 'report9' | 'report11',
): Promise<{ error?: string; base64?: string; fileName?: string; included?: string[]; skipped?: string[] }> {
  await requirePermission('inspection_register')
  const { prefix, customerId, error } = await inspectionPrefix(inspectionId)
  if (error || !prefix) return { error }
  const admin = createAdminClient()

  const { data: cust } = await admin.from('customers').select('customer_name').eq('id', customerId!).single()
  const customerName = ((cust as { customer_name: string } | null)?.customer_name ?? '고객').replace(/[\\/:*?"<>|]/g, '_')

  const { data: objects } = await admin.storage.from(BUCKET).list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } })
  const names = (objects ?? []).map(o => o.name)
  const latest = (re: RegExp) => names.filter(n => re.test(n))[0] as string | undefined

  // ④ 9호+점검표(생성물 없음 시 생략)+배치확인서+10호 / ⑥ 11호+전후사진(불량내역)+계약서 (§9-9e)
  const wanted: Array<{ label: string; name?: string }> = kind === 'report9'
    ? [
      { label: '별지 9호(PDF)', name: latest(/^report9_\d+\.pdf$/) ?? latest(/^report9_\d+\.hwp$/) },
      { label: '별지 10호', name: latest(/^report10_\d+\.pdf$/) ?? latest(/^report10_\d+\.hwp$/) },
      { label: '배치확인서', name: latest(CERT_FILE_RE) },
    ]
    : [
      { label: '별지 11호', name: latest(/^report11_\d+\.pdf$/) ?? latest(/^report11_\d+\.hwp$/) },
      { label: '공사 계약서', name: latest(CONTRACT_FILE_RE) },
      { label: '배치확인서', name: latest(CERT_FILE_RE) },
    ]

  // 종이 보관 후 정리된 회차(소방계획서_18 D-7)의 배치확인서는 '누락'이 아니라 '종이 보관' —
  // 현황판이 보유로 보여주는데 여기서 누락이라 하면 제출 담당자가 어느 쪽을 믿을지 알 수 없다.
  const certArchived = (await findArchivedCertInspections(admin, [inspectionId])).has(inspectionId)
  const paperOnly: string[] = []

  const zip = new JSZip()
  const included: string[] = []
  const skipped: string[] = []
  for (const w of wanted) {
    if (!w.name && w.label === '배치확인서' && certArchived) { paperOnly.push(w.label); continue }
    if (!w.name) { skipped.push(w.label); continue }
    const { data: blob } = await admin.storage.from(BUCKET).download(`${prefix}/${w.name}`)
    if (!blob) { skipped.push(w.label); continue }
    zip.file(w.name, await blob.arrayBuffer())
    included.push(w.label)
  }
  // ⑥ 첨부 — 불량 전·후 사진 자동 재사용 (§9-9e: 신규 업로드 0)
  if (kind === 'report11') {
    const { data: defects } = await admin.from('inspection_defects')
      .select('defect_name, photo_url, after_photo_url').eq('inspection_id', inspectionId)
    let n = 0
    for (const d of (defects ?? []) as Array<{ defect_name: string; photo_url: string | null; after_photo_url: string | null }>) {
      for (const [tag, p] of [['전', d.photo_url], ['후', d.after_photo_url]] as Array<[string, string | null]>) {
        // ⚠ 종전엔 저장된 public URL을 fetch했다 — 버킷이 비공개라 항상 실패했고, 실패는 조용히
        // 건너뛰므로 **증빙 사진이 0장인 채로 제출 패키지가 만들어졌다**. 버킷에서 직접 내려받는다.
        const path = extractStoragePath(p)
        if (!path) continue
        try {
          const { data: img } = await admin.storage.from('inspection-defects').download(path)
          if (!img) continue
          n += 1
          const ext = (path.split('.').pop() ?? 'jpg').split('?')[0]
          zip.file(`사진/${String(n).padStart(2, '0')}_${d.defect_name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)}_${tag}.${ext}`, await img.arrayBuffer())
        } catch { /* 사진 1장 실패는 건너뜀 (안내.txt에 누락 표기) */ }
      }
    }
    if (n > 0) included.push(`전·후 사진 ${n}장`)
    else skipped.push('전·후 사진')
  }
  if (included.length === 0) return { error: '패키지에 담을 문서가 없습니다 — 먼저 생성·업로드해주세요.' }

  zip.file('안내.txt', [
    `${customerName} — ${kind === 'report9' ? '자체점검 결과 보고(별지 9호) 제출 패키지' : '이행완료 보고(별지 11호) 제출 패키지'}`,
    `포함: ${included.join(', ')}`,
    ...(paperOnly.length ? [`종이 보관본 첨부 필요(ERP 사본 정리됨): ${paperOnly.join(', ')}`] : []),
    ...(skipped.length ? [`누락(직접 확인 필요): ${skipped.join(', ')}`] : []),
    '전산망(소방민원센터) 제출 후 타임라인에 제출일을 기록해주세요.',
  ].join('\n'))
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return {
    base64: buf.toString('base64'),
    fileName: `${customerName}_${kind === 'report9' ? '별지9호_제출패키지' : '별지11호_제출패키지'}.zip`,
    included, skipped,
  }
}
