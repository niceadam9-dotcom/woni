import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'

export type CompanyProfile = {
  company_name: string
  representative: string | null
  business_number: string | null
  phone: string | null
  /** 팩스 — 결과보고서 표지·공문 레터헤드가 인쇄(소방계획서_22 P-8). 테이블엔 있었는데 select에서 빠져 있었다 */
  fax: string | null
  email: string | null
  address: string | null
  logo_url: string | null
  mark_url: string | null
  default_region_si: string | null
  default_region_myeon: string | null
}

/** 회사 프로필 조회 — 기본 지역·로고 등. 없으면 null
 *
 *  ⚠ '단일 행'을 전제하지만 실제로는 **여러 행이 있을 수 있다**(스테이징 실측: 2행, 2026-08-18).
 *  ORDER BY 없이 `.limit(1)`만 쓰면 Postgres가 매번 같은 행을 준다는 보장이 없어,
 *  읽는 곳과 쓰는 곳이 서로 다른 행을 잡는다 — 실제로 사전 안내 시점(sms_lead_rules)을
 *  저장했는데 배너가 옛 값을 읽는 증상으로 드러났다(소방계획서_24 구현 중 발견).
 *  정렬을 고정해 **모든 읽기·쓰기가 같은 행**을 보게 한다. 행 정리는 별도 과제. */
export const COMPANY_PROFILE_ORDER = 'id'

export const getCompanyProfile = cache(async (): Promise<CompanyProfile | null> => {
  const admin = createAdminClient()
  const { data } = await admin
    .from('company_profile')
    .select('company_name, representative, business_number, phone, fax, email, address, logo_url, mark_url, default_region_si, default_region_myeon')
    .order(COMPANY_PROFILE_ORDER, { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as CompanyProfile | null) ?? null
})
