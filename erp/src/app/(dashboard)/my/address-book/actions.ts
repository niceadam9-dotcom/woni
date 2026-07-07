'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth'

export type CreateContactInput = {
  name: string
  company?: string
  department?: string
  position?: string
  phone?: string
  mobile?: string
  email?: string
  address?: string
  notes?: string
  group_name?: string
}

export async function createContactAction(input: CreateContactInput): Promise<{ error?: string; contactId?: string }> {
  const profile = await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('address_contacts')
    .insert({
      owner_id: profile.id,
      name: input.name,
      company: input.company || null,
      department: input.department || null,
      position: input.position || null,
      phone: input.phone || null,
      mobile: input.mobile || null,
      email: input.email || null,
      address: input.address || null,
      notes: input.notes || null,
      group_name: input.group_name || null,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/my/address-book')
  return { contactId: (data as { id: string }).id }
}

export async function updateContactAction(id: string, input: Partial<CreateContactInput>): Promise<{ error?: string }> {
  await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('address_contacts')
    .update({
      ...input,
      company: input.company || null,
      department: input.department || null,
      position: input.position || null,
      phone: input.phone || null,
      mobile: input.mobile || null,
      email: input.email || null,
      address: input.address || null,
      notes: input.notes || null,
      group_name: input.group_name || null,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/my/address-book')
  return {}
}

export async function deleteContactAction(id: string): Promise<{ error?: string }> {
  await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin.from('address_contacts').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/my/address-book')
  return {}
}
