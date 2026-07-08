import { getCompanyProfile } from '@/lib/company-profile'
import { LoginForm } from './login-form'

// 회사 프로필(업체명·로고)은 관리자 > 회사 정보에서 수정 시 자동 반영
export default async function LoginPage() {
  const profile = await getCompanyProfile()

  return (
    <LoginForm
      companyName={profile?.company_name ?? 'ERP 시스템'}
      logoUrl={profile?.logo_url ?? null}
    />
  )
}
