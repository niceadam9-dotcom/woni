import { redirect } from 'next/navigation'

/** 건물 등록 페이지 폐기 (탭개편 설계 §6) — 고객 상세 > 건물·시설 탭의 인라인 패널로 이동 */
export default async function BuildingNewPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>
}) {
  const { customer_id } = await searchParams
  if (customer_id) redirect(`/customers/${customer_id}?tab=buildings&new=1`)
  redirect('/customers')
}
