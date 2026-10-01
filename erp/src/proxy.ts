import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { HOME_PATH } from '@/lib/routes'

// /api/cron: 세션 없이 호출되는 Vercel Cron 경로 — 라우트 자체의 CRON_SECRET Bearer 검증으로 보호
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/cron']

/** 폐지된 화면의 옛 주소 → 새 화면 (즐겨찾기·기존 링크가 404가 되지 않게).
 *
 *  🎯 2026-10-01 — 종전엔 각 경로에 `redirect()`만 하는 page.tsx가 있었다. `(dashboard)/loading.tsx`
 *  (스트리밍)가 생기자 그 페이지들이 **셸을 먼저 보낸 뒤** 리다이렉트를 흘려보내게 됐고, Next의 Router가
 *  그 경로에서 「Rendered more hooks than during the previous render」를 던졌다(실측 — 리다이렉트는
 *  되지만 오류가 뜬다). 렌더 전에 여기서 307로 보내면 레이아웃 조회(뱃지 등)도 안 돈다.
 *  ⚠ 새 폐지 화면이 생기면 page.tsx를 두지 말고 **여기에 한 줄** 추가할 것.
 *  (`/dashboard#submissions`의 해시는 Location 헤더에 실려 브라우저가 그대로 따라간다.) */
const LEGACY_REDIRECTS: Record<string, string> = {
  '/action-plans': '/inspections',                     // 이행계획 → 점검 업무(작업대 ⑤)
  '/action-plans/status': '/dashboard#submissions',    // 이행 현황 → 대시보드 제출 현황
  '/buildings': '/customers',                          // 건물 → 고객 관리(건물 탭)
  '/fire-plans/generate': '/customers',                // 소방계획서 생성 → 고객 관리(소방계획서 탭)
  '/inspection-ledger': '/customers/ledger',           // 점검 대장 → 고객 관리 대장(소방계획서_21 R8-3)
  '/inspection-plans': '/inspections/calendar',        // 점검 계획 → 점검 달력
  '/inspection-plans/monitor': '/inspections/sms',     // 점검현황 모니터링 폐지(소방계획서_24 Q-8/S6) → 문자 발송 이력
  '/inspection-reports/status': '/dashboard#submissions', // 보고서 제출 현황 → 대시보드 제출 현황
}
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

  // 폐지된 옛 주소 — 렌더 전에 보낸다(위 LEGACY_REDIRECTS 주석)
  const legacy = LEGACY_REDIRECTS[pathname.replace(/\/+$/, '') || pathname]
  if (legacy) return NextResponse.redirect(new URL(legacy, request.url), 307)

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

  // getClaims — 토큰 서명을 **로컬에서** 검증한다(이 프로젝트는 ES256 비대칭 키, JWKS는 프로세스에 캐시).
  // 종전 getUser는 요청마다 Supabase Auth 서버에 왕복했다(실측 170ms) — 화면 이동뿐 아니라
  // 서버 액션 POST마다 붙는 비용이었다. getClaims는 첫 요청의 JWKS 1회 뒤로 1ms(실측).
  // 만료가 임박한 토큰은 getUser와 똑같이 먼저 갱신한다(쿠키 setAll 경유).
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims.sub

  // Unauthenticated — redirect to login
  if (!userId) {
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
      .eq('id', userId)
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
