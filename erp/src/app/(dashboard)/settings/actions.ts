'use server'

import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createVerifierClient } from '@supabase/supabase-js'
import type { NotifyCategory } from '@/lib/notify'

const PREF_KEYS: NotifyCategory[] = ['approval_result', 'leave_result', 'assignment', 'deadline']

/** 알림 수신 설정 저장 (제안.md 2단계) — false인 카테고리만 발송 생략 */
export async function updateNotificationPrefsAction(
  prefs: Record<string, boolean>
): Promise<{ error?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }

  // 허용된 키만 저장 (임의 키 주입 방지)
  const clean: Record<string, boolean> = {}
  for (const key of PREF_KEYS) {
    if (typeof prefs[key] === 'boolean') clean[key] = prefs[key]
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ notification_prefs: clean } as Record<string, unknown>)
    .eq('id', user.id)
  if (error) return { error: '알림 설정 저장에 실패했습니다.' }
  return {}
}

/** 본인 비밀번호 변경 — 현재 비밀번호 재검증 후 변경 (제안.md 1단계-2) */
export async function changePasswordAction(
  currentPassword: string,
  newPassword: string
): Promise<{ error?: string }> {
  const user = await getSessionUser()
  if (!user?.email) return { error: '인증이 필요합니다.' }
  if (newPassword.length < 6) return { error: '새 비밀번호는 6자 이상이어야 합니다.' }
  if (currentPassword === newPassword) return { error: '현재 비밀번호와 다른 비밀번호를 입력해주세요.' }

  // 현재 비밀번호 확인 — 세션에 영향을 주지 않는 일회용 클라이언트로 재인증
  const verifier = createVerifierClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { error: verifyErr } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })
  if (verifyErr) return { error: '현재 비밀번호가 올바르지 않습니다.' }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword })
  if (error) return { error: '비밀번호 변경에 실패했습니다.' }
  return {}
}
