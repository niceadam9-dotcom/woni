import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth']
const ADMIN_PATHS = ['/admin']
const MANAGER_PATHS = ['/approvals']

export async function middleware(request: NextRequest) {
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
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
    }

    if (MANAGER_PATHS.some((p) => pathname.startsWith(p))) {
      if (!['manager', 'admin'].includes(profile?.role ?? '')) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
