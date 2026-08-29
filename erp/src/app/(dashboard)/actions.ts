'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { THEME_COOKIE } from '@/lib/theme'
import { FS_COOKIE } from '@/lib/font-scale'

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // 테마·글자배율 쿠키 삭제 (소방계획서_29 S1-4 · _35 S4-5)
  // — 공용 PC에서 다음 사람에게 내 화면 설정이 남지 않게
  const jar = await cookies()
  jar.delete(THEME_COOKIE)
  jar.delete(FS_COOKIE)
  redirect('/login')
}
