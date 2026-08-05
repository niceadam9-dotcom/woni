import { redirect } from 'next/navigation'

/** 구 보고서 센터 — 소방계획서_8 Phase B(H-6·D-8)로 해체.
 *  고객별 문서 현황·별지 생성 → 고객관리 > 소방계획서 트리(별지 서식) 흡수,
 *  제출 현황판 → 대시보드 위젯, 연차 발행·일괄 생성 → 배치 발행(/inspection-plans/batch).
 *  구 딥링크는 새 위치로 매핑 리다이렉트. docs-actions.ts는 트리·위젯이 계속 사용(존치). */
export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ form?: string; cust?: string }>
}) {
  const { form, cust } = await searchParams
  if (cust) redirect(`/customers/${cust}?tab=plan&form=annex`)
  if (form === 'submissions') redirect('/dashboard#submissions')
  if (form === 'annual' || form === 'fire_plan') redirect('/inspection-plans/batch')
  redirect('/dashboard')
}
