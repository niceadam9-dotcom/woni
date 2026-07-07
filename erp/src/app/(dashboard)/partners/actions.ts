'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth'

export type PartnerType = 'supplier' | 'subcontractor' | 'client' | 'other'

export type CreatePartnerInput = {
  partner_name: string
  partner_type: PartnerType
  business_number?: string
  representative?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
}

export async function createPartnerAction(
  input: CreatePartnerInput
): Promise<{ error?: string; partnerId?: string }> {
  const profile = await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('partners')
    .insert({
      partner_name: input.partner_name,
      partner_type: input.partner_type,
      business_number: input.business_number || null,
      representative: input.representative || null,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
      notes: input.notes || null,
      created_by: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/partners')
  return { partnerId: (data as { id: string }).id }
}

export async function updatePartnerAction(input: CreatePartnerInput & { id: string; is_active: boolean }): Promise<{ error?: string }> {
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('partners')
    .update({
      partner_name: input.partner_name,
      partner_type: input.partner_type,
      business_number: input.business_number || null,
      representative: input.representative || null,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
      notes: input.notes || null,
      is_active: input.is_active,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', input.id)

  if (error) return { error: error.message }
  revalidatePath('/partners')
  revalidatePath(`/partners/${input.id}`)
  return {}
}
