import type { createAdminClient } from '@/lib/supabase/admin'
import type { InspectionType } from '@/types'
import { rowPlanType, rowInspectionType, type SubType } from '@/lib/inspection-round'
import { recalcIsInitialForCustomer } from '@/lib/inspection-initial'

type Admin = ReturnType<typeof createAdminClient>

/** 시작·완료된 자체점검 행의 종류(종합/작동)를 **현재 고객 축**으로 재동기화 (2026-09-02).
 *
 *  왜 필요한가: 사용승인일·점검유형이 바뀌면 미시작 계획 항목은 재배치·동기화되지만
 *  **이미 시작된 점검 행은 보호되어 옛 종류로 남았다**. 그 결과 같은 1차가
 *  "완료된 작동" + "미시작 종합" 두 벌로 갈라지고, 엑셀·별지 4·9호가 낡은 종류를 인쇄했다
 *  (서림사 실사고 — 사용자 원칙: "종합/작동/최초는 ERP가 사용승인일 기준으로 기입한다").
 *
 *  규칙은 lib/inspection-round의 단일 원천을 그대로 쓴다: 행의 종류는 (고객 sub_type, 차수)의
 *  함수다 — 종합 대상의 1차=종합·2차=작동, 작동 대상은 전부 작동.
 *
 *  ⚠ **올해 이후 행만** 동기화한다. 과거 연도 완료분은 역사다 — 당시 고객이 정말 작동
 *  대상이었다면 그 기록이 진실이고, 소급 변경은 이미 제출한 문서와 어긋난다.
 *  ⚠ 행과 연결된 계획 항목(inspection_id 매칭)도 함께 맞춘다 — 한쪽만 고치면 달력·계획
 *  화면과 문서가 서로 다른 종류를 말한다.
 *  ⚠ 종류가 바뀌면 최초점검 판정(종합에만 성립)도 달라진다 — recalcIsInitial을 뒤에 태운다. */
export async function syncStartedRowSubTypes(
  admin: Admin,
  customerId: string,
): Promise<{ updated: number }> {
  const { data: custRaw } = await admin.from('customers')
    .select('inspection_type, inspection_sub_type').eq('id', customerId).maybeSingle()
  const cust = custRaw as { inspection_type: InspectionType | null; inspection_sub_type: string | null } | null
  const sub: SubType | null = cust?.inspection_sub_type === '종합' ? '종합'
    : cust?.inspection_sub_type === '작동' ? '작동' : null
  if (!cust?.inspection_type || !sub) return { updated: 0 }   // 축 미상이면 덮지 않는다

  const curYear = new Date(Date.now() + 9 * 3600_000).getFullYear()
  const { data } = await admin.from('inspections')
    .select('id, year, sequence_num, plan_type, inspection_type')
    .eq('customer_id', customerId)
    .like('plan_type', 'special_%')
    .gte('year', curYear)
  const rows = (data ?? []) as Array<{
    id: string; year: number; sequence_num: number; plan_type: string; inspection_type: string | null
  }>

  let updated = 0
  for (const r of rows) {
    const wantPlan = rowPlanType(sub, r.sequence_num)
    const wantInsp = rowInspectionType(cust.inspection_type, sub, r.sequence_num)
    if (r.plan_type === wantPlan && r.inspection_type === wantInsp) continue
    const { error } = await admin.from('inspections')
      .update({ plan_type: wantPlan, inspection_type: wantInsp } as Record<string, unknown>)
      .eq('id', r.id)
    if (error) continue
    updated++
    // 연결된 계획 항목 동기화 — 시작된 항목은 _syncInspectionTypeToPlanItems(미확정 전용)가 안 건드린다
    await admin.from('inspection_plan_items')
      .update({ plan_type: wantPlan, inspection_type: wantInsp } as Record<string, unknown>)
      .eq('inspection_id', r.id)
  }
  if (updated > 0) await recalcIsInitialForCustomer(admin, customerId)
  return { updated }
}
