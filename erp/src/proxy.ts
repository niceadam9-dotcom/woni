import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { HOME_PATH } from '@/lib/routes'

// /api/cron: 세션 없이 호출되는 Vercel Cron 경로 — 라우트 자체의 CRON_SECRET Bearer 검증으로 보호
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/cron']
const ADMIN_PATHS = ['/admin']
const MANAGER_PATHS = ['/approvals']

// Next.js 16: middleware.ts는 deprecated로 실행되지 않아 proxy.ts로 마이그레이션 (2026-07-08 — 미실행 상태로
// employee가 /approvals에 진입 가능하던 버그의 원인). 런타임은 nodejs 고정 (edge 미지원).
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public paths — pass through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Unauthenticated — redirect to login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Role-based access control
  if (
    ADMIN_PATHS.some((p) => pathname.startsWith(p)) ||
    MANAGER_PATHS.some((p) => pathname.startsWith(p))
  ) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
      if (profile?.role !== 'admin') {
        return NextResponse.redirect(new URL(HOME_PATH, request.url))
      }
    }

    if (MANAGER_PATHS.some((p) => pathname.startsWith(p))) {
      if (!['manager', 'admin'].includes(profile?.role ?? '')) {
        return NextResponse.redirect(new URL(HOME_PATH, request.url))
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    // ⚠ fonts/ 와 woff2를 반드시 제외한다 (소방계획서_35 S1, 2026-08-29 실측 결함).
    //   셀프호스팅 한글폰트(public/fonts/pretendard)는 브라우저가 **CORS 모드**로 받는다
    //   — 폰트는 crossorigin 없이는 @font-face에 쓸 수 없고, crossorigin이 붙으면
    //   **쿠키가 실리지 않는다**. 그래서 이 게이트를 통과할 세션이 원리적으로 없고,
    //   전부 /login으로 리다이렉트돼 한글이 영영 맑은 고딕으로 남는다.
    //   ⚠ 그 리다이렉트는 fetch가 따라가 **HTTP 200 + HTML**로 보인다 —
    //   상태코드만 보는 검사는 초록이다(assert-web-korean-font.mjs가 본문 매직을 보는 이유).
    //   부수 효과로 92조각마다 Supabase auth.getUser() 왕복이 붙던 것도 사라진다.
    '/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf)$).*)',
  ],
}
