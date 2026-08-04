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
  // sub_type 우선 추출 — special_종합/special_작동이면 일반관리도 종합(자체)/작동(자체)로 정확 표기 (소방계획서_8 D-9)
  const sub = planType?.startsWith('special_') ? planType.slice('special_'.length) : null
  const typeLabel = sub === '종합' || sub === '작동' ? sub
    : inspectionType === '일반관리' ? '일반관리' : inspectionType // 작동/종합
  const isSelf = planType == null || planType.startsWith('special_')
  if (isSelf) {
    return { label: `${typeLabel}(자체)`, className: 'bg-[#f5f4ff] text-[#7b68ee]' }
  }
  return { label: `${typeLabel}(정기)`, className: 'bg-gray-100 text-gray-600' } // monthly
}
