import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// 활성 고객(종합/작동)의 월정액을 매월 1건씩 자동 청구 — 멱등(같은 달 중복 생성 안 함)
// Cron: 매월 1일 호출 권장. 수동 테스트: GET /api/cron/generate-monthly-bills?month=2026.07
// Authorization: Bearer {CRON_SECRET} 헤더 필수
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  // 컨테이너 TZ가 UTC라 KST 기준 연·월 추출 (+9h 시프트)
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = kstNow.getUTCFullYear()
  const m = kstNow.getUTCMonth() + 1

  const paramMonth = req.nextUrl.searchParams.get('month')
  const billingMonth = paramMonth && /^\d{4}\.\d{2}$/.test(paramMonth)
    ? paramMonth
    : `${y}.${String(m).padStart(2, '0')}`
  const billDate = `${kstNow.getUTCFullYear()}-${String(kstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(kstNow.getUTCDate()).padStart(2, '0')}`

  // 청구 생성자 — 시스템 계정 우선, 없으면 활성 관리자
  let createdBy: string | null = null
  const { data: sysProfile } = await admin
    .from('profiles').select('id').eq('is_system', true).limit(1)
  if (sysProfile?.length) createdBy = (sysProfile[0] as { id: string }).id
  else {
    const { data: adminProfile } = await admin
      .from('profiles').select('id').eq('role', 'admin').eq('is_active', true).limit(1)
    if (adminProfile?.length) createdBy = (adminProfile[0] as { id: string }).id
  }
  if (!createdBy) return NextResponse.json({ error: '청구 생성자 프로필을 찾을 수 없습니다.' }, { status: 500 })

  const { data: custs, error: custErr } = await admin.from('customers')
    .select('id, inspection_type, monthly_fee_untaxed, monthly_fee_taxed')
    .eq('is_active', true).in('inspection_type', ['종합', '작동'])
  if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 })
  const rows = (custs ?? []) as Array<{
    id: string; monthly_fee_untaxed: number | null; monthly_fee_taxed: number | null
  }>

  const { data: existing } = await admin.from('bills')
    .select('customer_id').eq('billing_month', billingMonth).eq('fee_type', '정액')
  const have = new Set(((existing ?? []) as Array<{ customer_id: string }>).map(e => e.customer_id))

  let created = 0, skipped = 0
  const toInsert: Record<string, unknown>[] = []
  for (const c of rows) {
    const supply = c.monthly_fee_untaxed ?? 0
    const total = c.monthly_fee_taxed ?? 0
    if ((supply <= 0 && total <= 0) || have.has(c.id)) { skipped++; continue }
    const tax = total > supply ? total - supply : Math.round(supply * 0.1)
    toInsert.push({
      customer_id: c.id, inspection_plan_item_id: null,
      billing_month: billingMonth, bill_type: '월정액', bill_date: billDate,
      supply_value: supply, tax_value: tax, total_amount: total > 0 ? total : supply + tax,
      paid_amount: 0, fee_type: '정액', created_by: createdBy,
    })
    created++
  }
  if (toInsert.length) {
    const { error } = await admin.from('bills').insert(toInsert)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, billingMonth, created, skipped, timestamp: now.toISOString() })
}
