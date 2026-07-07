import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CompanyFormClient } from '@/components/company/company-form-client'

export default async function CompanyPage() {
  await requireRole(['admin'])

  const admin = createAdminClient()
  const { data: company } = await admin.from('company_info').select('*').limit(1).single()

  type CompanyRow = {
    company_name: string; business_number: string | null; representative: string | null
    phone: string | null; fax: string | null; email: string | null; address: string | null
    industry: string | null; established_date: string | null; logo_url: string | null
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Building2 className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">본사 정보</h1>
          <p className="text-sm text-[#514b81] mt-0.5">회사 기본 정보를 등록·관리합니다</p>
        </div>
      </div>

      <CompanyFormClient existing={company as CompanyRow | undefined ?? undefined} />
    </div>
  )
}
