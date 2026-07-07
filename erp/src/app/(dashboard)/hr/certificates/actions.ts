'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole, getProfile } from '@/lib/auth'

export type CertificateType = 'employment' | 'career' | 'salary' | 'leave'

export const CERT_TYPE_LABELS: Record<CertificateType, string> = {
  employment: '재직증명서',
  career: '경력증명서',
  salary: '급여확인서',
  leave: '휴직증명서',
}

export type IssueCertificateInput = {
  employee_id: string
  cert_type: CertificateType
  purpose?: string
  notes?: string
}

export async function issueCertificateAction(input: IssueCertificateInput): Promise<{ error?: string; certId?: string }> {
  const profile = await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('certificates')
    .insert({
      employee_id: input.employee_id,
      cert_type: input.cert_type,
      purpose: input.purpose || null,
      notes: input.notes || null,
      issued_by: profile.id,
      issued_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/hr/certificates')
  return { certId: (data as { id: string }).id }
}

export async function deleteCertificateAction(id: string): Promise<{ error?: string }> {
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin.from('certificates').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/hr/certificates')
  return {}
}
