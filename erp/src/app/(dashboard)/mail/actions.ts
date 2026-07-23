'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser, getProfile } from '@/lib/auth'
import { isGoogleConfigured, gmailGetAttachment, gmailSendMail, gmailGetReplyMeta } from '@/lib/google'

/** 메일 첨부 다운로드 — 전 직원 (회사 메일은 읽기 전용 공개) */
export async function downloadMailAttachmentAction(
  messageId: string,
  attachmentId: string,
  fileName: string,
): Promise<{ error?: string; base64?: string; fileName?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  if (!isGoogleConfigured()) return { error: 'Google 연동이 설정되지 않았습니다.' }
  try {
    const bytes = await gmailGetAttachment(messageId, attachmentId)
    if (bytes.length > 25 * 1024 * 1024) return { error: '25MB 초과 첨부는 Gmail에서 직접 받아주세요.' }
    return { base64: Buffer.from(bytes).toString('base64'), fileName }
  } catch (e) {
    return { error: `첨부 다운로드 실패: ${(e as Error).message}` }
  }
}

/** ── 메일 발송 (2026-07-23) — 공용 계정(sjfirekorea) 발신, 작성 직원은 mail_send_logs(107)로 추적.
 *  권한: 전 직원(조회와 동일), 자동 서명에 작성자 표기. 첨부 합계 20MB 한도. ── */

const MAX_TOTAL = 20 * 1024 * 1024
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseEmails(raw: string): { list: string[]; bad: string[] } {
  const list = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
  return { list, bad: list.filter(e => !EMAIL_RE.test(e)) }
}

export async function sendMailAction(formData: FormData): Promise<{ error?: string; messageId?: string }> {
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }
  if (!isGoogleConfigured()) return { error: 'Google 연동이 설정되지 않았습니다.' }
  const admin = createAdminClient()

  const { list: to, bad: badTo } = parseEmails(String(formData.get('to') ?? ''))
  const { list: cc, bad: badCc } = parseEmails(String(formData.get('cc') ?? ''))
  const subject = String(formData.get('subject') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  const replyToId = String(formData.get('replyToId') ?? '').trim() || null

  if (to.length === 0) return { error: '받는 사람을 입력해주세요.' }
  if (badTo.length || badCc.length) return { error: `이메일 형식 오류: ${[...badTo, ...badCc].join(', ')}` }
  if (!subject) return { error: '제목을 입력해주세요.' }
  if (!body) return { error: '본문을 입력해주세요.' }

  const attachments: Array<{ filename: string; mime: string; data: Uint8Array }> = []
  let total = 0
  for (const f of formData.getAll('files')) {
    const file = f as File
    if (!file || !file.size) continue
    total += file.size
    if (total > MAX_TOTAL) return { error: '첨부 합계는 20MB 이하여야 합니다.' }
    attachments.push({
      filename: file.name, mime: file.type || 'application/octet-stream',
      data: new Uint8Array(await file.arrayBuffer()),
    })
  }

  // 답장 — 원본 스레드 유지 (원본 조회 실패 시 새 스레드로 발송, fail-soft)
  let reply: { threadId: string; messageIdHeader: string | null } | undefined
  if (replyToId) {
    try {
      const meta = await gmailGetReplyMeta(replyToId)
      reply = { threadId: meta.threadId, messageIdHeader: meta.messageIdHeader }
    } catch { /* fail-soft */ }
  }

  // 공용 계정 발신 — 작성 직원 서명 자동 부착 (거버넌스)
  const bodyWithSign = `${body}\n\n---\n승진소방ENG ${profile.name} 드림\n(본 메일은 회사 공용 계정에서 발송되었습니다)`

  try {
    const { messageId } = await gmailSendMail({ to, cc: cc.length ? cc : undefined, subject, bodyText: bodyWithSign, attachments, reply })
    await admin.from('mail_send_logs').insert({
      sender_id: profile.id, recipients: to.join(', '), cc: cc.join(', ') || null,
      subject, message_id: messageId, reply_to_gmail: replyToId, attachment_count: attachments.length,
    } as Record<string, unknown>)
    return { messageId }
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('403') || msg.toLowerCase().includes('insufficient')) {
      return { error: '발송 권한이 없습니다 — Google OAuth를 gmail.send 스코프로 재발급해주세요.' }
    }
    return { error: `발송 실패: ${msg.slice(0, 200)}` }
  }
}
