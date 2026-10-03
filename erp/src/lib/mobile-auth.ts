import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** 모바일 앱 → `/api/mobile/*` 인증 (2026-10-03)
 *
 *  앱은 쿠키가 없고 `Authorization: Bearer <Supabase access token>`으로 부른다(mobile/lib/api.ts).
 *  종전엔 proxy.ts가 쿠키 세션만 봐서 이 요청을 전부 /login으로 307 보냈다 — 운영 실측(2026-10-03):
 *  모바일 AI 불량 분류가 한 번도 라우트에 닿지 못했다. 그래서 proxy는 `/api/mobile/`을 통과시키고
 *  **라우트가 이 함수로 직접 검사**한다. 통과만 열고 검사를 빠뜨리면 AI 호출을 누구나 쓰게 된다.
 *
 *  엣지 함수 `_shared/edge.ts requireUser`와 같은 판정(getUser로 토큰 검증)에 더해, 재직 중(profiles.is_active)인
 *  사용자만 받는다 — 퇴사자의 남은 토큰으로 AI 비용을 쓰지 못하게. */
export async function requireMobileUser(req: NextRequest): Promise<{ userId: string } | { response: NextResponse }> {
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return { response: NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: { user }, error } = await admin.auth.getUser(header.slice('Bearer '.length).trim())
  if (error || !user) return { response: NextResponse.json({ error: '인증에 실패했습니다.' }, { status: 401 }) }
  const { data: profile } = await admin.from('profiles').select('is_active').eq('id', user.id).maybeSingle()
  if (!profile || (profile as { is_active: boolean | null }).is_active === false) {
    return { response: NextResponse.json({ error: '사용할 수 없는 계정입니다.' }, { status: 403 }) }
  }
  return { userId: user.id }
}
