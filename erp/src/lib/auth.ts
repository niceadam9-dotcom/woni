import 'server-only'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Profile, UserRole } from '@/types'
import { can, type PermissionKey } from '@/lib/permissions'

const PROFILE_COLS = 'id, employee_id, name, email, role, department_id, position, hire_date, is_active, failed_logins, locked_until'

// cache()는 동일 요청 내에서 중복 호출을 한 번으로 합칩니다
// (layout + page 모두 getProfile을 호출해도 DB 쿼리는 1회)
export const getUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

export const getSessionUser = getUser

// 프로필은 30초간 Next.js 데이터 캐시에 보관 → 동시 접속 50명이 탐색해도 DB 쿼리 최소화
async function fetchProfile(userId: string): Promise<Profile | null> {
  return unstable_cache(
    async () => {
      const admin = createAdminClient()
      const { data } = await admin
        .from('profiles')
        .select(PROFILE_COLS)
        .eq('id', userId)
        .single()
      return data as Profile | null
    },
    ['profile', userId],
    { revalidate: 30, tags: [`profile-${userId}`] }
  )()
}

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser()
  if (!user) return null
  return fetchProfile(user.id)
})

export async function requireAuth() {
  const user = await getUser()
  if (!user) redirect('/login')
  return user
}

export async function requireRole(roles: UserRole[]) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!roles.includes(profile.role as UserRole)) redirect('/dashboard')
  return profile
}

/** PERMISSIONS 키 기반 권한 체크 — 권한 변경 시 permissions.ts만 수정 */
export async function requirePermission(key: PermissionKey) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role as UserRole, key)) redirect('/dashboard')
  return profile
}

export { can, type PermissionKey }
