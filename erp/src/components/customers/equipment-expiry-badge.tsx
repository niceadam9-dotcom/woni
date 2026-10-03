/** 고객 상세 머리 — 설비 대장 만료 배지 (통합계획 C3 2단계, 2026-10-03)
 *  서버 컴포넌트. 부모가 <Suspense fallback={null}>로 감싼다 — 상세 서버 물결을 기다리게 하지 않는다.
 *  판정은 lib/equipment-expiry(목록 배지·주간 브리핑과 같은 함수). 0/0이면 아무것도 그리지 않는다. */
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { expiryByCustomer, expiryBadge } from '@/lib/equipment-expiry'
import { todayKst } from '@/lib/customer-rounds'

export async function EquipmentExpiryBadge({ customerId }: { customerId: string }) {
  const today = todayKst()
  const { byCustomer, error } = await expiryByCustomer(createAdminClient(), today, { customerIds: [customerId] })
  if (error) return null
  const eb = expiryBadge(byCustomer.get(customerId))
  if (!eb) return null
  return (
    <Link href={`/customers/${customerId}?tab=facilities&form=1.4`} title={eb.title} data-testid="customer-equip-expiry"
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-form-xs font-medium ${eb.tone === 'red' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
      설비 {eb.label}
    </Link>
  )
}
