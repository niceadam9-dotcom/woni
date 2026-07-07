'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

export type UpsertCompanyInput = {
  company_name: string
  business_number?: string
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

  const { data: existing } = await admin.from('company_info').select('id').limit(1).single()

  if (existing) {
    const { error } = await admin
      .from('company_info')
      .update({
        company_name: input.company_name,
        business_number: input.business_number || null,
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
      .from('company_info')
      .insert({
        company_name: input.company_name,
        business_number: input.business_number || null,
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
