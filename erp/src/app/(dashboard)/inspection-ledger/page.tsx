import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { LedgerClient, type LedgerRow } from '@/components/inspection-ledger/ledger-client'
import type { UserRole } from '@/types'

/** 점검 대장 (소방점검리스트, doc02 §4-6) — 연간 점검 실적·계약 대장 */
export default async function InspectionLedgerPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const [custRes, contactRes, bldRes] = await Promise.all([
    admin.from('customers')
      .select('id, customer_name, inspection_type, plan_anchor_date, region_si, region_myeon, use_approval_date, fire_station, monthly_fee_taxed, fee_taxed')
      .eq('is_active', true).order('plan_anchor_date', { nullsFirst: false }),
    admin.from('customer_contacts').select('customer_id, name, phone').eq('role', '대표'),
    admin.from('buildings').select('customer_id, total_area').eq('is_active', true),
  ])

  const contactMap = new Map<string, { name: string; phone: string | null }>()
  for (const c of (contactRes.data ?? []) as Array<{ customer_id: string; name: string; phone: string | null }>)
    if (!contactMap.has(c.customer_id)) contactMap.set(c.customer_id, { name: c.name, phone: c.phone })
  const areaMap = new Map<string, number>()
  for (const b of (bldRes.data ?? []) as Array<{ customer_id: string; total_area: number | null }>)
    if (b.total_area != null && !areaMap.has(b.customer_id)) areaMap.set(b.customer_id, b.total_area)

  const rows: LedgerRow[] = ((custRes.data ?? []) as Array<{
    id: string; customer_name: string; inspection_type: string; plan_anchor_date: string | null
    region_si: string | null; region_myeon: string | null; use_approval_date: string | null
    fire_station: string | null; monthly_fee_taxed: number | null; fee_taxed: number | null
  }>).map(c => ({
    id: c.id,
    name: c.customer_name,
    type: c.inspection_type,
    planDate: c.plan_anchor_date,
    region: c.region_myeon || c.region_si || '',
    area: areaMap.get(c.id) ?? null,
    useApproval: c.use_approval_date,
    contact: contactMap.get(c.id)?.name ?? '',
    phone: contactMap.get(c.id)?.phone ?? '',
    fireStation: c.fire_station ?? '',
    fee: c.inspection_type === '일반관리' ? c.fee_taxed : c.monthly_fee_taxed,
    feeKind: c.inspection_type === '일반관리' ? '건별' : '월정액',
  }))

  return <LedgerClient rows={rows} canManage={['manager', 'admin'].includes(profile.role as UserRole)} />
}
