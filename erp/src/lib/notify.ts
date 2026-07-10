import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/** 수신 설정 카테고리 (제안.md 2단계) — 결재 요청·휴가 신청 "도착" 알림은 업무 필수라 설정 대상이 아님 */
export type NotifyCategory = 'approval_result' | 'leave_result' | 'assignment' | 'deadline'

export const NOTIFY_CATEGORY_LABEL: Record<NotifyCategory, string> = {
  approval_result: '결재 결과 (승인·반려)',
  leave_result: '휴가 결과 (승인·반려)',
  assignment: '담당 배정 (고객·점검·인수인계)',
  deadline: '점검 마감 임박',
}

type NotificationRow = {
  title: string
  message: string
  type: string
  reference_id?: string | null
  reference_type?: string | null
}

/** 수신 설정 확인 — false로 명시된 카테고리만 발송 생략 (미설정 키 = 수신) */
export async function allowsNotification(
  admin: Admin,
  userId: string,
  category: NotifyCategory
): Promise<boolean> {
  const { data } = await admin
    .from('profiles').select('notification_prefs').eq('id', userId).single()
  const prefs = ((data as { notification_prefs: Record<string, boolean> | null } | null)
    ?.notification_prefs ?? {}) as Record<string, boolean>
  return prefs[category] !== false
}

/** 수신 설정 검사 후 인앱 알림 발송 — 필수 알림(결재 요청·휴가 신청 도착)은 이 헬퍼 없이 직접 insert */
export async function notifyIfEnabled(
  admin: Admin,
  recipientId: string,
  category: NotifyCategory,
  notification: NotificationRow
): Promise<{ skipped: boolean }> {
  if (!(await allowsNotification(admin, recipientId, category))) return { skipped: true }
  await admin.from('notifications').insert({
    recipient_id: recipientId,
    ...notification,
  } as Record<string, unknown>)
  return { skipped: false }
}

/** 다수 수신자 중 해당 카테고리를 켠 사람만 반환 (크론 일괄 발송용) */
export async function filterNotifiableRecipients(
  admin: Admin,
  userIds: string[],
  category: NotifyCategory
): Promise<Set<string>> {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return new Set()
  const { data } = await admin
    .from('profiles').select('id, notification_prefs').in('id', unique)
  return new Set(
    ((data ?? []) as Array<{ id: string; notification_prefs: Record<string, boolean> | null }>)
      .filter(p => (p.notification_prefs ?? {})[category] !== false)
      .map(p => p.id)
  )
}
