/** 보수 견적 유효기간 처리 — 주간 브리핑 크론이 쓴다 (불량 → 매출 해결방안 절, 2026-10-02)
 *
 *  · 만료 전환: 유효기간이 오늘보다 앞선 「작성중·발송」 견적 → 「만료」. 승인·수주·취소는 건드리지 않는다
 *    (승인된 견적은 유효기간이 지나도 계약 진행 중일 수 있다).
 *  · 만료 임박: 오늘~N일 안에 유효기간이 끝나는 「작성중·발송」 견적 — 브리핑 한 줄과 목록.
 *  크론 밖(시험)에서도 부를 수 있게 조회 범위를 고객으로 좁히는 선택 인자를 둔다. */
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>
const OPEN = ['작성중', '발송']

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function expireStaleQuotes(admin: Admin, todayISO: string, opts: { customerId?: string } = {}): Promise<{ expired: number; error?: string }> {
  let q = admin.from('quotes').update({ status: '만료' }).in('status', OPEN).lt('valid_until', todayISO)
  if (opts.customerId) q = q.eq('customer_id', opts.customerId)
  const { data, error } = await q.select('id')
  if (error) return { expired: 0, error: error.message }
  return { expired: (data ?? []).length }
}

export type ExpiringQuote = { quote_number: string; valid_until: string; status: string; customer_name: string }

export async function findQuotesExpiringSoon(admin: Admin, todayISO: string, days = 7, opts: { customerId?: string } = {}): Promise<{ quotes: ExpiringQuote[]; error?: string }> {
  let q = admin.from('quotes').select('quote_number, valid_until, status, customer:customers(customer_name)')
    .in('status', OPEN).gte('valid_until', todayISO).lte('valid_until', addDaysISO(todayISO, days))
  if (opts.customerId) q = q.eq('customer_id', opts.customerId)
  const { data, error } = await q.order('valid_until')
  if (error) return { quotes: [], error: error.message }
  return {
    quotes: ((data ?? []) as unknown as Array<{ quote_number: string; valid_until: string; status: string; customer: { customer_name: string } | null }>)
      .map(r => ({ quote_number: r.quote_number, valid_until: r.valid_until, status: r.status, customer_name: r.customer?.customer_name ?? '고객' })),
  }
}
