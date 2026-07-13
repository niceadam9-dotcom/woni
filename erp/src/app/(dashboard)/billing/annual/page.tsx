import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { AnnualCollectionClient, type CollectionRow, type StationRow } from '@/components/billing/annual-collection-client'
import type { UserRole } from '@/types'

/** 안전관리 대장 (doc02 §4-7, P6-1) — 월별 수금 현황판 + 사업자/자동이체/기관 탭 */
export default async function AnnualCollectionPage({
  searchParams,
}: { searchParams: Promise<{ year?: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!['manager', 'admin'].includes(profile.role as UserRole)) redirect('/dashboard')

  const sp = await searchParams
  const year = /^\d{4}$/.test(sp.year ?? '') ? sp.year! : String(new Date().getFullYear())

  const admin = createAdminClient()
  const [custRes, billRes, bpRes, apRes, stationRes] = await Promise.all([
    admin.from('customers')
      .select('id, customer_name, inspection_type, region_si, region_myeon, fire_station, monthly_fee_taxed, fee_taxed')
      .eq('is_active', true).order('customer_name'),
    admin.from('bills')
      .select('customer_id, billing_month, total_amount, paid_amount, fee_type')
      .like('billing_month', `${year}.%`),
    admin.from('billing_profiles').select('customer_id, business_no, company_name, tax_email'),
    admin.from('billing_autopay').select('customer_id, bank_name, account_holder, account_no_last4, withdraw_day'),
    admin.from('region_fire_stations').select('region, fire_station, region_si').order('region'),
  ])

  type Bill = { customer_id: string; billing_month: string; total_amount: number; paid_amount: number; fee_type: string }
  const bills = (billRes.data ?? []) as Bill[]
  const billed: Record<string, number[]> = {}   // customer_id → [12] 청구액
  const paid: Record<string, number[]> = {}      // customer_id → [12] 입금액
  for (const b of bills) {
    const mi = parseInt(b.billing_month.split('.')[1], 10) - 1
    if (mi < 0 || mi > 11) continue
    ;(billed[b.customer_id] ??= Array(12).fill(0))[mi] += b.total_amount
    ;(paid[b.customer_id] ??= Array(12).fill(0))[mi] += b.paid_amount
  }

  const bpMap = new Map(((bpRes.data ?? []) as Array<{ customer_id: string; business_no: string | null; company_name: string | null; tax_email: string | null }>).map(r => [r.customer_id, r]))
  const apMap = new Map(((apRes.data ?? []) as Array<{ customer_id: string; bank_name: string | null; account_holder: string | null; account_no_last4: string | null; withdraw_day: number | null }>).map(r => [r.customer_id, r]))

  const rows: CollectionRow[] = ((custRes.data ?? []) as Array<{
    id: string; customer_name: string; inspection_type: string
    region_si: string | null; region_myeon: string | null; fire_station: string | null
    monthly_fee_taxed: number | null; fee_taxed: number | null
  }>).map(c => {
    const bp = bpMap.get(c.id)
    const ap = apMap.get(c.id)
    const feeKind = c.inspection_type === '일반관리' ? '건별' : '정액'
    return {
      id: c.id, name: c.customer_name, type: c.inspection_type, feeKind,
      region: c.region_myeon || c.region_si || '', fireStation: c.fire_station ?? '',
      fee: feeKind === '정액' ? (c.monthly_fee_taxed ?? 0) : (c.fee_taxed ?? 0),
      billed: billed[c.id] ?? Array(12).fill(0),
      paid: paid[c.id] ?? Array(12).fill(0),
      bizNo: bp?.business_no ?? '', bizName: bp?.company_name ?? '', taxEmail: bp?.tax_email ?? '',
      bank: ap?.bank_name ?? '', holder: ap?.account_holder ?? '', last4: ap?.account_no_last4 ?? '',
      withdrawDay: ap?.withdraw_day ?? null,
    }
  })

  const stations: StationRow[] = ((stationRes.data ?? []) as Array<{ region: string; fire_station: string | null; region_si: string | null }>)
    .map(s => ({ region: s.region, fireStation: s.fire_station ?? '', regionSi: s.region_si ?? '' }))

  return <AnnualCollectionClient year={year} rows={rows} stations={stations} />
}
