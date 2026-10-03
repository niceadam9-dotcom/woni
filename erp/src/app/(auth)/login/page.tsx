import { getCompanyProfile } from '@/lib/company-profile'
import { LoginForm } from './login-form'
import { safeNextPath } from '@/lib/safe-next'

// 회사 프로필(업체명·로고)은 관리자 > 회사 정보에서 수정 시 자동 반영
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const profile = await getCompanyProfile()
  // QR 스캔(/t) → 로그인 → 그 코드로 복귀(proxy가 next를 붙인다). 화면은 검증된 값만 폼에 싣는다
  const sp = await searchParams
  const next = safeNextPath(Array.isArray(sp.next) ? sp.next[0] : sp.next)

  return (
    <LoginForm
      companyName={profile?.company_name ?? 'ERP 시스템'}
      logoUrl={profile?.logo_url ?? null}
      next={next}
    />
  )
}
