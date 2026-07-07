'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getProfile } from '@/lib/auth'

export type VoucherLine = {
  account_code_id: string
  debit_amount: number
  credit_amount: number
  description?: string | null
}

export async function createVoucherAction(input: {
  voucherDate: string
  voucherType: string
  description: string
  lines: VoucherLine[]
}): Promise<{ error?: string }> {
  await requirePermission('voucher_manage')
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }

  const totalDebit  = input.lines.reduce((s, l) => s + l.debit_amount, 0)
  const totalCredit = input.lines.reduce((s, l) => s + l.credit_amount, 0)
  if (Math.round(totalDebit) !== Math.round(totalCredit)) {
    return { error: '차변 합계와 대변 합계가 일치하지 않습니다.' }
  }

  const admin = createAdminClient()

  // 전표번호 자동생성: VU-YYYYMMDD-NNN
  const datePrefix = input.voucherDate.replace(/-/g, '')
  const { count } = await admin
    .from('vouchers')
    .select('id', { count: 'exact', head: true })
    .like('voucher_number', `VU-${datePrefix}-%`)
  const seq = String((count ?? 0) + 1).padStart(3, '0')
  const voucherNumber = `VU-${datePrefix}-${seq}`

  const { data: voucher, error: vErr } = await admin
    .from('vouchers')
    .insert({
      voucher_number: voucherNumber,
      voucher_date:   input.voucherDate,
      voucher_type:   input.voucherType,
      description:    input.description,
      total_amount:   totalDebit,
      status:         '작성중',
      created_by:     profile.id,
    })
    .select('id')
    .single()

  if (vErr || !voucher) return { error: '전표 등록에 실패했습니다.' }

  const { error: lErr } = await admin
    .from('voucher_lines')
    .insert(input.lines.map(l => ({
      voucher_id:      voucher.id,
      account_code_id: l.account_code_id,
      debit_amount:    l.debit_amount,
      credit_amount:   l.credit_amount,
      description:     l.description ?? null,
    })))

  if (lErr) return { error: '전표 명세 등록에 실패했습니다.' }

  revalidatePath('/accounting/vouchers')
  return {}
}

export async function approveVoucherAction(id: string): Promise<{ error?: string }> {
  await requirePermission('voucher_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('vouchers')
    .update({ status: '승인' })
    .eq('id', id)

  if (error) return { error: '승인에 실패했습니다.' }
  revalidatePath('/accounting/vouchers')
  revalidatePath('/accounting/income-statement')
  revalidatePath('/accounting/balance-sheet')
  return {}
}

export async function cancelVoucherAction(id: string): Promise<{ error?: string }> {
  await requirePermission('voucher_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('vouchers')
    .update({ status: '취소' })
    .eq('id', id)

  if (error) return { error: '취소에 실패했습니다.' }
  revalidatePath('/accounting/vouchers')
  return {}
}
