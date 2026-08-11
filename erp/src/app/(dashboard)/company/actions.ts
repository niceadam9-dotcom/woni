'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { formatBizNo, formatTel } from '@/lib/format-contact'

export type UpsertCompanyInput = {
  company_name: string
  business_number?: string
  /** 소방시설관리업 등록번호 — 사업자등록번호와 별개 (123, 별지4호 2쪽 '(제  -  호)' 원천) */
  management_reg_no?: string
  representative?: string
  phone?: string
  fax?: string
  email?: string
  address?: string
  industry?: string
  established_date?: string
  logo_url?: string
}

export async function upsertCompanyAction(input: UpsertCompanyInput): Promise<{ error?: string }> {
  await requirePermission('company_manage')
  const admin = createAdminClient()

  // 사업자번호·전화·팩스는 저장 시점에도 정규화 — 폼을 거치지 않는 호출도 항상 하이픈 형식으로 정착
  input = {
    ...input,
    business_number: input.business_number ? formatBizNo(input.business_number) : input.business_number,
    phone: input.phone ? formatTel(input.phone) : input.phone,
    fax: input.fax ? formatTel(input.fax) : input.fax,
  }

  const { data: existing } = await admin.from('company_profile').select('id').limit(1).single()

  if (existing) {
    const { error } = await admin
      .from('company_profile')
      .update({
        company_name: input.company_name,
        business_number: input.business_number || null,
        management_reg_no: input.management_reg_no || null,
        representative: input.representative || null,
        phone: input.phone || null,
        fax: input.fax || null,
        email: input.email || null,
        address: input.address || null,
        industry: input.industry || null,
        established_date: input.established_date || null,
        logo_url: input.logo_url || null,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin
      .from('company_profile')
      .insert({
        company_name: input.company_name,
        business_number: input.business_number || null,
        management_reg_no: input.management_reg_no || null,
        representative: input.representative || null,
        phone: input.phone || null,
        fax: input.fax || null,
        email: input.email || null,
        address: input.address || null,
        industry: input.industry || null,
        established_date: input.established_date || null,
        logo_url: input.logo_url || null,
      } as Record<string, unknown>)
    if (error) return { error: error.message }
  }

  revalidatePath('/company')
  return {}
}
