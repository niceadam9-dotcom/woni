'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Profile } from '@/types'

const MAX_FAILED_LOGINS = 5
const LOCK_DURATION_MINUTES = 30

type LoginState = { error: string } | undefined

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: '이메일과 비밀번호를 입력해주세요.' }
  }

  const supabase = await createClient()
  const admin = createAdminClient()

  // 계정 잠금 여부 확인
  const { data: profileRaw } = await admin
    .from('profiles')
    .select('id, failed_logins, locked_until, is_active')
    .eq('email', email)
    .single()

  const profile = profileRaw as Pick<Profile, 'id' | 'failed_logins' | 'locked_until' | 'is_active'> | null

  if (profile) {
    if (!profile.is_active) {
      return { error: '비활성화된 계정입니다. 관리자에게 문의하세요.' }
    }
    if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
      const remaining = Math.ceil(
        (new Date(profile.locked_until).getTime() - Date.now()) / 60000
      )
      return { error: `계정이 잠겨 있습니다. ${remaining}분 후 다시 시도하세요.` }
    }
  }

  // Supabase Auth 로그인
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for') ?? headersList.get('x-real-ip') ?? 'unknown'

  if (error || !data.user) {
    if (profile) {
      const newFailed = (profile.failed_logins ?? 0) + 1
      const updates: Record<string, unknown> = { failed_logins: newFailed }

      if (newFailed >= MAX_FAILED_LOGINS) {
        updates.locked_until = new Date(
          Date.now() + LOCK_DURATION_MINUTES * 60 * 1000
        ).toISOString()
      }

      await admin.from('profiles').update(updates).eq('id', profile.id)
      await admin.from('activity_logs').insert({
        actor_id: profile.id,
        action: 'login_failed',
        entity_type: 'auth',
        metadata: { failed_count: newFailed, ip },
        ip_address: ip,
      })

      if (newFailed >= MAX_FAILED_LOGINS) {
        return {
          error: `비밀번호를 ${MAX_FAILED_LOGINS}회 잘못 입력하여 계정이 잠겼습니다. ${LOCK_DURATION_MINUTES}분 후 다시 시도하세요.`,
        }
      }
      return {
        error: `이메일 또는 비밀번호가 올바르지 않습니다. (${newFailed}/${MAX_FAILED_LOGINS}회)`,
      }
    }
    return { error: '이메일 또는 비밀번호가 올바르지 않습니다.' }
  }

  // 로그인 성공
  if (profile) {
    await admin
      .from('profiles')
      .update({ failed_logins: 0, locked_until: null })
      .eq('id', profile.id)

    await admin.from('activity_logs').insert({
      actor_id: profile.id,
      action: 'login_success',
      entity_type: 'auth',
      metadata: { ip },
      ip_address: ip,
    })
  }

  redirect('/dashboard')
}
