'use server'

import { revalidatePath } from 'next/cache'
import JSZip from 'jszip'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { isGoogleConfigured, gmailSendWithAttachment } from '@/lib/google'

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
  revalidatePath(`/inspections/${inspectionId}`)
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
  const filename = `${customerName}_자체점검결과보고서.${ext}`
  const subject = `[승진소방ENG] ${customerName} 소방시설 자체점검 결과 보고`
  try {
    const { messageId } = await gmailSendWithAttachment({
      to: i.customer.report_email,
      subject,
      bodyText: [
        `${customerName} 관계인님께`,
        '',
        '소방시설 자체점검 결과 보고서(별지 제9호서식)를 송부드립니다.',
        '본 메일은 전자우편 송달 동의에 따라 발송되었습니다 (소방시설 설치 및 관리에 관한 법률 시행규칙).',
        '',
        '승진소방ENG 드림',
      ].join('\n'),
      attachment: { filename, mime: ext === 'pdf' ? 'application/pdf' : 'application/octet-stream', data: new Uint8Array(await blob.arrayBuffer()) },
    })
    await admin.from('report_deliveries').insert({
      inspection_id: inspectionId, customer_id: i.customer_id, doc_kind: 'report9_owner',
      recipient_email: i.customer.report_email, subject, file_name: filename,
      message_id: messageId, sent_by: profile.id,
    } as Record<string, unknown>)
    revalidatePath(`/inspections/${inspectionId}`)
    return { sentTo: i.customer.report_email }
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('403') || msg.toLowerCase().includes('insufficient')) {
      return { error: '메일 발송 권한이 없습니다 — Google OAuth를 gmail.send 스코프로 재발급해야 합니다 (scripts/google-oauth-setup.mjs 재실행 후 GOOGLE_REFRESH_TOKEN 교체).' }
    }
    return { error: `발송 실패: ${msg.slice(0, 200)}` }
  }
}

/** ④⑥ 제출일 기록 — 기한 D-day·알림 소멸 조건 (§9-6f 제출추적) */
export async function recordSubmissionAction(
  inspectionId: string, kind: 'report9' | 'report11', date: string,
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '제출일 형식을 확인해주세요.' }
  const admin = createAdminClient()
  const col = kind === 'report9' ? 'report9_submitted_at' : 'report11_submitted_at'
  const { error } = await admin.from('inspections').update({ [col]: date }).eq('id', inspectionId)
  if (error) return { error: `저장 실패: ${error.message}` }
  await admin.from('activity_logs').insert({
    actor_id: profile.id, action: 'report_submitted', entity_type: 'inspection', entity_id: inspectionId,
    metadata: { kind, date },
  } as Record<string, unknown>)
  revalidatePath(`/inspections/${inspectionId}`)
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
      { label: '배치확인서', name: latest(/^cert_\d+\./) },
    ]
    : [
      { label: '별지 11호', name: latest(/^report11_\d+\.pdf$/) ?? latest(/^report11_\d+\.hwp$/) },
      { label: '공사 계약서', name: latest(/^contract_\d+\./) },
      { label: '배치확인서', name: latest(/^cert_\d+\./) },
    ]

  const zip = new JSZip()
  const included: string[] = []
  const skipped: string[] = []
  for (const w of wanted) {
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
        if (!p) continue
        try {
          // photo_url = inspection-defects 버킷 public URL — 직접 fetch
          const res = await fetch(p)
          if (!res.ok) continue
          n += 1
          const ext = (p.split('.').pop() ?? 'jpg').split('?')[0]
          zip.file(`사진/${String(n).padStart(2, '0')}_${d.defect_name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)}_${tag}.${ext}`, await res.arrayBuffer())
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
