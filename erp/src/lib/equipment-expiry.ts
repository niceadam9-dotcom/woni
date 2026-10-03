/** 설비 대장 만료 집계 — 주간 브리핑 한 줄 · 고객 목록/상세 배지 (통합계획 C3 2단계, 2026-10-03)
 *
 *  판정은 lib/equipment-lifespan.expiryState 한 벌(화면 대장 패널과 같은 함수) — 여기서 다시 세지 않는다.
 *  알림은 새 크론·notifications 타입 없이(비교진단 대장 절): 브리핑 1줄 + 고객 배지 두 곳.
 *  조회는 「연수 판정이 있는 사용 중 행」만 — 규칙 none이면서 연장값도 없는 행(가스용기·펌프 등)은 애초에 안 읽는다. */
import type { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { expiryState, type LifespanRule } from '@/lib/equipment-lifespan'

type Admin = ReturnType<typeof createAdminClient>

export const BRIEFING_SOON_DAYS = 90

export type CustomerExpiry = { expired: number; soon: number }
type Row = { customer_id: string; qty: number; manufactured_on: string | null; lifespan_rule: LifespanRule; extension_until: string | null }

/** 고객별 {경과 대수, soonDays 안 만료 대수} — 0/0인 고객은 넣지 않는다. customerIds를 주면 그 고객만 */
export async function expiryByCustomer(admin: Admin, todayISO: string, opts: { soonDays?: number; customerIds?: readonly string[] } = {}): Promise<{ byCustomer: Map<string, CustomerExpiry>; error?: string }> {
  const soonDays = opts.soonDays ?? BRIEFING_SOON_DAYS
  if (opts.customerIds && opts.customerIds.length === 0) return { byCustomer: new Map() }
  const { rows, error } = await fetchAllRows<Row>((from, to) => {
    let q = admin.from('equipment_assets').select('customer_id, qty, manufactured_on, lifespan_rule, extension_until')
      .eq('status', 'in_use').or('lifespan_rule.neq.none,extension_until.not.is.null')
    if (opts.customerIds) q = q.in('customer_id', opts.customerIds as string[])
    return q.order('id').range(from, to)
  })
  const byCustomer = new Map<string, CustomerExpiry>()
  if (error) return { byCustomer, error }
  for (const r of rows) {
    const s = expiryState(r, todayISO, soonDays)
    if (s !== 'expired' && s !== 'soon') continue
    const cur = byCustomer.get(r.customer_id) ?? { expired: 0, soon: 0 }
    if (s === 'expired') cur.expired += r.qty; else cur.soon += r.qty
    byCustomer.set(r.customer_id, cur)
  }
  return { byCustomer }
}

/** 브리핑 한 줄 재료 — 합계와 상위 고객(이름 포함) */
export async function findEquipmentExpiring(admin: Admin, todayISO: string, soonDays = BRIEFING_SOON_DAYS): Promise<{
  soonQty: number; expiredQty: number; customers: Array<{ customer_name: string } & CustomerExpiry>; error?: string
}> {
  const { byCustomer, error } = await expiryByCustomer(admin, todayISO, { soonDays })
  if (error) return { soonQty: 0, expiredQty: 0, customers: [], error }
  let soonQty = 0, expiredQty = 0
  for (const v of byCustomer.values()) { soonQty += v.soon; expiredQty += v.expired }
  const ids = [...byCustomer.keys()]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data } = await admin.from('customers').select('id, customer_name').in('id', ids.slice(0, 150))
    for (const c of (data ?? []) as Array<{ id: string; customer_name: string }>) names.set(c.id, c.customer_name)
  }
  const customers = ids.map(id => ({ customer_name: names.get(id) ?? '고객', ...byCustomer.get(id)! }))
    .sort((a, b) => (b.expired + b.soon) - (a.expired + a.soon))
  return { soonQty, expiredQty, customers }
}

/** 배지 문구 — 경과가 있으면 「만료 n」(빨강), 없고 임박만 있으면 「만료 임박 n」(주황), 둘 다 0이면 null */
export function expiryBadge(e: CustomerExpiry | undefined): { label: string; tone: 'red' | 'amber'; title: string } | null {
  if (!e) return null
  if (e.expired > 0) return { label: `만료 ${e.expired}`, tone: 'red', title: `설비 대장: 내용연수 경과 ${e.expired}대${e.soon ? ` · ${BRIEFING_SOON_DAYS}일 내 만료 ${e.soon}대` : ''}` }
  if (e.soon > 0) return { label: `만료 임박 ${e.soon}`, tone: 'amber', title: `설비 대장: ${BRIEFING_SOON_DAYS}일 내 내용연수 만료 ${e.soon}대` }
  return null
}
