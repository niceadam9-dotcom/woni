import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/** 고객 → 그 고객의 **가장 최근 점검 상세**로 넘기는 징검다리 (2026-08-18 사용자 확정).
 *
 *  왜 라우트인가: [최근 본 고객] 칩은 브라우저 localStorage에만 있어서 서버가 목록을 모른다.
 *  페이지를 그릴 때 고객→점검 링크를 미리 만들 수 없으므로, 누른 뒤 서버가 푼다.
 *  버튼+서버액션이 아니라 라우트로 두는 이유는 **평범한 링크를 유지**하기 위해서다(새 탭 열기).
 *
 *  규칙(사용자 확정): 대상 = 무조건 가장 최근 1건 / 점검이 없으면 고객 상세로 보낸다.
 *  '가장 최근'의 축은 점검 시작일 — 연도·차수는 정기와 자체점검이 의미가 달라 섞으면 어긋난다. */
export default async function InspectionByCustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>
}) {
  const { customerId } = await params
  const profile = await getProfile()
  if (!profile) redirect('/login')

  // 잘못된 경로는 고객 목록으로 — 여기서 404를 띄우면 사용자가 할 수 있는 게 없다
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) redirect('/customers')

  const admin = createAdminClient()
  const { data } = await admin
    .from('inspections')
    .select('id')
    .eq('customer_id', customerId)
    .order('inspection_start_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const inspectionId = (data as { id: string } | null)?.id
  redirect(inspectionId ? `/inspections/${inspectionId}` : `/customers/${customerId}`)
}
