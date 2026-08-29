import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/** 개인별 소방계획서 화면 글자 배율 (소방계획서_35 S4)
 *
 *  정본은 profiles.form_font_scale(마이그레이션 154), 쿠키는 첫 페인트용 캐시다.
 *  루트 레이아웃의 인라인 스크립트가 이 쿠키를 읽어 <html data-fs>를 붙이므로
 *  **httpOnly가 아니다** — 값이 'md'|'lg'|'xl' 뿐이라 담긴 비밀이 없다.
 *
 *  ⚠ 배포 순서 자유 규약(154 머리주석): form_font_scale은 PROFILE_COLS에 넣지 않는다.
 *  읽기는 반드시 이 파일의 관용 조회(readProfileFontScale)로 — 컬럼 미적용 DB에서
 *  조용한 실패가 로그인 전멸로 번지는 것을 막는다(feedback_supabase_check_error).
 *  lib/theme.ts와 같은 구조다. */

export const FS_COOKIE = 'erp-fs'
export type FontScale = 'md' | 'lg' | 'xl'

export const FS_COOKIE_OPTIONS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax' as const,
  httpOnly: false,   // 인라인 스크립트(document.cookie)가 읽어야 한다 — 의도적
}

/** 배율 실값 — globals.css의 html[data-fs="…"] 규칙과 **같은 값이어야 한다**.
 *  (CSS가 정본이고 이건 표시·검사용 사본이다. 어긋나면 test-font-scale이 잡는다) */
export const FS_RATIO: Record<FontScale, number> = { md: 1, lg: 1.15, xl: 1.3 }

export function isFontScale(v: unknown): v is FontScale {
  return v === 'md' || v === 'lg' || v === 'xl'
}

/** profiles.form_font_scale 관용 조회 — 컬럼 미적용(154 전)·행 없음·오류 전부 null.
 *  null이면 호출부는 '기본값 md, 쿠키 안 만짐'으로 행동한다. */
export async function readProfileFontScale(userId: string): Promise<FontScale | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('profiles').select('form_font_scale').eq('id', userId).maybeSingle()
  if (error) return null
  const v = (data as { form_font_scale?: unknown } | null)?.form_font_scale
  return isFontScale(v) ? v : null
}
