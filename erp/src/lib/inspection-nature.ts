import type { InspectionType, PlanType } from '@/types'

/** 점검 성격 배지 — 유형(작동/종합/일반관리) + plan_type 축(자체/정기/일반)을 한 배지로 결합.
 *  판정 기준(소방계획서_6 W-4): plan_type null·special_* = 자체점검(6단계), monthly = 정기(월간·1단계), event = 일반.
 *  같은 "작동"이라도 자체(보라)/정기(회색)로 색이 갈려 목록에서 즉시 구별된다.
 *  라벨 예: 작동(자체) / 작동(정기) / 종합(자체) / 종합(정기) / 일반 */
export function inspectionNatureBadge(
  inspectionType: InspectionType,
  planType: PlanType | null,
): { label: string; className: string } {
  if (planType === 'event') {
    return { label: '일반', className: 'bg-sky-50 text-sky-600' }
  }
  const typeLabel = inspectionType === '일반관리' ? '일반관리' : inspectionType // 작동/종합
  const isSelf = planType == null || planType.startsWith('special_')
  if (isSelf) {
    return { label: `${typeLabel}(자체)`, className: 'bg-[#f5f4ff] text-[#7b68ee]' }
  }
  return { label: `${typeLabel}(정기)`, className: 'bg-gray-100 text-gray-600' } // monthly
}
