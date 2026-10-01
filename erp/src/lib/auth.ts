import 'server-only'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Profile, UserRole } from '@/types'
import { can, type PermissionKey } from '@/lib/permissions'
import { HOME_PATH } from '@/lib/routes'

const PROFILE_COLS = 'id, employee_id, name, email, role, department_id, position, hire_date, is_active, is_system, failed_logins, locked_until'

/** 세션 사용자 — 호출부가 쓰는 것은 `id`(와 settings의 `email`)뿐이라 토큰 클레임으로 충분하다.
 *  Auth 서버의 User 객체(user_metadata 등)가 필요해지면 그 자리에서 `supabase.auth.getUser()`를 부를 것. */
export type SessionUser = { id: string; email: string | null }

// cache()는 동일 요청 내에서 중복 호출을 한 번으로 합칩니다
// (layout + page 모두 getProfile을 호출해도 DB 쿼리는 1회)
//
// getClaims — proxy.ts와 같은 이유로 **로컬 서명 검증**이다. 종전 getUser는 요청마다 Auth 서버에
// 170ms를 왕복했고, proxy가 이미 같은 왕복을 한 뒤라 모든 화면·액션이 그 비용을 두 번 치렀다.
// 비대칭 키(ES256)라 네트워크 없이 검증되고, 대칭 키 프로젝트라면 getClaims가 스스로 getUser로 물러난다.
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const c = data?.claims
  if (!c?.sub) return null
  return { id: c.sub, email: typeof c.email === 'string' ? c.email : null }
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
  if (!roles.includes(profile.role as UserRole)) redirect(HOME_PATH)
  return profile
}

/** PERMISSIONS 키 기반 권한 체크 — 권한 변경 시 permissions.ts만 수정 */
export async function requirePermission(key: PermissionKey) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role as UserRole, key)) redirect(HOME_PATH)
  return profile
}

export { can, type PermissionKey }
