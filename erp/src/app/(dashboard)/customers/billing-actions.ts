'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { encryptAccount, decryptAccount } from '@/lib/crypto'

export type BillingProfileInput = {
  business_no: string; company_name: string; rep_name: string
  address: string; business_type: string; business_item: string
  tax_email: string; note: string
}

/** 사업자정보 저장 (P4-1) — 고객 1:1 upsert */
export async function saveBillingProfileAction(
  customerId: string, input: BillingProfileInput
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const clean = (v: string) => v.trim() || null
  const { error } = await admin.from('billing_profiles').upsert({
    customer_id: customerId,
    business_no: clean(input.business_no),
    company_name: clean(input.company_name),
    rep_name: clean(input.rep_name),
    address: clean(input.address),
    business_type: clean(input.business_type),
    business_item: clean(input.business_item),
    tax_email: clean(input.tax_email),
    note: clean(input.note),
    created_by: profile.id,
    updated_at: new Date().toISOString(),
  } as Record<string, unknown>, { onConflict: 'customer_id' })
  if (error) return { error: `사업자정보 저장 실패: ${error.message}` }
  revalidatePath(`/customers/${customerId}`)
  return {}
}

export type AutopayInput = {
  bank_name: string; account_holder: string; account_no: string
  withdraw_day: string; note: string
}

/** 자동이체 저장 (P4-2) — 계좌번호 AES-256-GCM 암호화, 수정 로그 기록 */
export async function saveAutopayAction(
  customerId: string, input: AutopayInput
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const clean = (v: string) => v.trim() || null

  const acct = input.account_no.replace(/[\s-]/g, '')
  let account_no_enc: string | null = null
  let account_no_last4: string | null = null
  if (acct) {
    try { account_no_enc = encryptAccount(acct) }
    catch (e) { return { error: `계좌 암호화 실패: ${(e as Error).message}` } }
    account_no_last4 = acct.slice(-4)
  }

  const day = parseInt(input.withdraw_day, 10)
  const { error } = await admin.from('billing_autopay').upsert({
    customer_id: customerId,
    bank_name: clean(input.bank_name),
    account_holder: clean(input.account_holder),
    ...(acct ? { account_no_enc, account_no_last4 } : {}),
    withdraw_day: Number.isFinite(day) && day >= 1 && day <= 31 ? day : null,
    note: clean(input.note),
    created_by: profile.id,
    updated_at: new Date().toISOString(),
  } as Record<string, unknown>, { onConflict: 'customer_id' })
  if (error) return { error: `자동이체 저장 실패: ${error.message}` }

  await admin.from('account_access_log').insert({
    customer_id: customerId, accessed_by: profile.id, action: 'edit',
  } as Record<string, unknown>)

  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 계좌번호 평문 열람 (P4-2) — 열람 로그 기록 후 복호화 반환 */
export async function revealAccountAction(
  customerId: string
): Promise<{ error?: string; account_no?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data } = await admin.from('billing_autopay')
    .select('account_no_enc').eq('customer_id', customerId).maybeSingle()
  const enc = (data as { account_no_enc: string | null } | null)?.account_no_enc
  if (!enc) return { error: '등록된 계좌가 없습니다.' }

  let account_no: string
  try { account_no = decryptAccount(enc) }
  catch (e) { return { error: `복호화 실패: ${(e as Error).message}` } }

  await admin.from('account_access_log').insert({
    customer_id: customerId, accessed_by: profile.id, action: 'view',
  } as Record<string, unknown>)

  return { account_no }
}
