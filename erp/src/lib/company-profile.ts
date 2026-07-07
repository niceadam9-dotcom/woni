import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'

export type CompanyProfile = {
  company_name: string
  representative: string | null
  business_number: string | null
  phone: string | null
  email: string | null
  address: string | null
  logo_url: string | null
  mark_url: string | null
  default_region_si: string | null
  default_region_myeon: string | null
}

/** 회사 프로필(단일 행) 조회 — 기본 지역·로고 등. 없으면 null */
export const getCompanyProfile = cache(async (): Promise<CompanyProfile | null> => {
  const admin = createAdminClient()
  const { data } = await admin
    .from('company_profile')
    .select('company_name, representative, business_number, phone, email, address, logo_url, mark_url, default_region_si, default_region_myeon')
    .limit(1)
    .maybeSingle()
  return (data as CompanyProfile | null) ?? null
})
