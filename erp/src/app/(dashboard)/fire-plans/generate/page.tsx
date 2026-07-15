import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { FirePlanGenerateRequestClient } from '@/components/fire-plans/generate-request-client'
import { getFirePlanGenStatusAction } from './actions'

export const dynamic = 'force-dynamic'

/** 소방계획서 HWP 생성 — 고객명 입력 → Windows 워커(한글 SDK)가 생성해 보관함에 등록 (전 직원) */
export default async function FirePlanGeneratePage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const status = await getFirePlanGenStatusAction()
  return <FirePlanGenerateRequestClient initialStatus={status} />
}
