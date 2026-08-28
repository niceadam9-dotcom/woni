import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/** 개인별 화면 테마 (소방계획서_29 S1)
 *
 *  정본은 profiles.theme(마이그레이션 151), 쿠키는 첫 페인트용 캐시다.
 *  루트 레이아웃의 인라인 스크립트가 이 쿠키를 읽어 <html>에 .dark를 붙이므로
 *  **httpOnly가 아니다** — 값이 'light'|'dark' 뿐이라 담긴 비밀이 없다.
 *
 *  ⚠ 배포 순서 자유 규약(151 머리주석): theme 컬럼은 PROFILE_COLS에 넣지 않는다.
 *  읽기는 반드시 이 파일의 관용 조회(readProfileTheme)로 — 컬럼 미적용 DB에서
 *  조용한 실패가 로그인 전멸로 번지는 것을 막는다(feedback_supabase_check_error). */

export const THEME_COOKIE = 'erp-theme'
export type Theme = 'light' | 'dark'

export const THEME_COOKIE_OPTIONS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax' as const,
  httpOnly: false,   // 인라인 스크립트(document.cookie)가 읽어야 한다 — 의도적
}

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark'
}

/** profiles.theme 관용 조회 — 컬럼 미적용(151 전)·행 없음·오류 전부 null.
 *  null이면 호출부는 '기본값 light, 쿠키 안 만짐'으로 행동한다. */
export async function readProfileTheme(userId: string): Promise<Theme | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('profiles').select('theme').eq('id', userId).maybeSingle()
  if (error) return null
  const t = (data as { theme?: unknown } | null)?.theme
  return isTheme(t) ? t : null
}
