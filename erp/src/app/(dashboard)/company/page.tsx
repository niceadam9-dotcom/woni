import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CompanyFormClient } from '@/components/company/company-form-client'
import { COMPANY_PROFILE_ORDER } from '@/lib/company-profile'

export default async function CompanyPage() {
  await requireRole(['admin'])

  const admin = createAdminClient()
  // ⚠ 정렬 고정 — 이 테이블엔 실제로 2행이 있다. 화면이 A행을 보여주고 저장은 B행에 들어가면
  //   "저장했는데 그대로"가 된다(getCompanyProfile·upsertCompanyAction과 같은 축을 쓴다)
  const { data: company } = await admin.from('company_profile')
    .select('*').order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle()

  type CompanyRow = {
    company_name: string; business_number: string | null; representative: string | null
    management_reg_no: string | null
    phone: string | null; fax: string | null; email: string | null; address: string | null
    industry: string | null; established_date: string | null; logo_url: string | null
    official_sender_name: string | null; official_rep_title: string | null
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Building2 className="size-6 text-brand" />
        <div>
          <h1 className="text-xl font-bold text-ink">본사 정보</h1>
          <p className="text-sm text-ink-sub mt-0.5">회사 기본 정보를 등록·관리합니다</p>
        </div>
      </div>

      <CompanyFormClient existing={company as CompanyRow | undefined ?? undefined} />
    </div>
  )
}
