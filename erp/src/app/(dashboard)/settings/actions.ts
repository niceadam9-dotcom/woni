'use server'

import { cookies } from 'next/headers'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createVerifierClient } from '@supabase/supabase-js'
import type { NotifyCategory } from '@/lib/notify'
import { THEME_COOKIE, THEME_COOKIE_OPTIONS, isTheme } from '@/lib/theme'

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

/** 개인 화면 테마 저장 (소방계획서_29 S1-3) — 정본 profiles.theme + 쿠키(첫 페인트 캐시) 동시 기록.
 *  DB가 실패하면(151 미적용 등) 쿠키도 안 만진다 — 정본과 캐시가 갈라지면 기기마다 다른 화면이 된다. */
export async function updateThemeAction(theme: string): Promise<{ error?: string }> {
  if (!isTheme(theme)) return { error: '허용되지 않는 테마 값입니다.' }
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ theme } as Record<string, unknown>)
    .eq('id', user.id)
  if (error) return { error: '테마 저장에 실패했습니다.' }

  const jar = await cookies()
  jar.set(THEME_COOKIE, theme, THEME_COOKIE_OPTIONS)
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
