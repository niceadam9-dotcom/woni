import { redirect, notFound } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/** 건물 상세 페이지 폐기 (탭개편 설계 §6) — 소속 고객 상세 > 건물·시설 탭으로 리다이렉트 (북마크 보호) */
export default async function BuildingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const { data } = await admin.from('buildings').select('customer_id').eq('id', id).maybeSingle()
  if (!data) notFound()
  redirect(`/customers/${(data as { customer_id: string }).customer_id}?tab=buildings&b=${id}`)
}
