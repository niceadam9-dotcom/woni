'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { THEME_COOKIE } from '@/lib/theme'

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // 테마 쿠키 삭제 (소방계획서_29 S1-4) — 공용 PC에서 다음 사람에게 내 테마가 남지 않게
  const jar = await cookies()
  jar.delete(THEME_COOKIE)
  redirect('/login')
}
