'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole, getSessionUser } from '@/lib/auth'

export type InquiryType = 'as_request' | 'schedule' | 'quote' | 'other'
export type InquiryStatus = 'pending' | 'in_progress' | 'resolved' | 'cancelled'

export type CreateInquiryInput = {
  customer_id: string
  inquiry_type: InquiryType
  title: string
  content: string
  contact_name?: string
  contact_phone?: string
  zipcode?: string
  address?: string
  region_si?: string
  region_myeon?: string
  region_ri?: string
}

export async function createInquiryAction(
  input: CreateInquiryInput
): Promise<{ error?: string; inquiryId?: string }> {
  const profile = await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('inquiries')
    .insert({
      customer_id:   input.customer_id,
      inquiry_type:  input.inquiry_type,
      title:         input.title,
      content:       input.content,
      contact_name:  input.contact_name  || null,
      contact_phone: input.contact_phone || null,
      zipcode:       input.zipcode       || null,
      address:       input.address       || null,
      region_si:     input.region_si     || null,
      region_myeon:  input.region_myeon  || null,
      region_ri:     input.region_ri     || null,
      status:        'pending',
      created_by:    profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/inquiries')
  return { inquiryId: (data as { id: string }).id }
}

export type UpdateInquiryStatusInput = {
  id: string
  status: InquiryStatus
  resolution_notes?: string
}

export async function updateInquiryStatusAction(
  input: UpdateInquiryStatusInput
): Promise<{ error?: string }> {
  const profile = await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const updateData: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  }
  if (input.resolution_notes !== undefined) {
    updateData.resolution_notes = input.resolution_notes || null
  }
  if (input.status === 'resolved') {
    updateData.resolved_at = new Date().toISOString()
    updateData.resolved_by = profile.id
  }

  const { error } = await admin
    .from('inquiries')
    .update(updateData)
    .eq('id', input.id)

  if (error) return { error: error.message }

  revalidatePath('/inquiries')
  revalidatePath(`/inquiries/${input.id}`)
  return {}
}

export type UpdateInquiryInput = {
  id: string
  title: string
  content: string
  inquiry_type: InquiryType
  contact_name?: string
  contact_phone?: string
}

export async function updateInquiryAction(
  input: UpdateInquiryInput
): Promise<{ error?: string }> {
  await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('inquiries')
    .update({
      title: input.title,
      content: input.content,
      inquiry_type: input.inquiry_type,
      contact_name: input.contact_name || null,
      contact_phone: input.contact_phone || null,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', input.id)

  if (error) return { error: error.message }

  revalidatePath('/inquiries')
  revalidatePath(`/inquiries/${input.id}`)
  return {}
}
