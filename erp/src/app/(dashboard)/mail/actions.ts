'use server'

import { getSessionUser } from '@/lib/auth'
import { isGoogleConfigured, gmailGetAttachment } from '@/lib/google'

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
