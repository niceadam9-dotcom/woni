import type { createAdminClient } from '@/lib/supabase/admin'
import { isInitialByLaw, planTypeSub, type SubType } from '@/lib/inspection-round'

type Admin = ReturnType<typeof createAdminClient>

export type RecalcResult = {
  updated: number
  /** 건너뛴 이유 — null이면 정상 수행 */
  skipped: 'no-source-column' | 'no-inspections' | null
}

/** 사용승인일이 바뀐 뒤 그 고객의 **최초점검 판정을 다시 계산**한다.
 *
 *  왜 필요한가: `is_initial`은 점검 **생성 시점**에 한 번 정해지고 그 뒤 아무도 안 고친다
 *  (쓰기가 생성 2곳 + 수동 재지정 1곳뿐이었다). 그래서 사용승인일을 **나중에 입력**하면
 *  그 전에 만든 점검은 `false`로 굳어 실제로 60일 이내여도 별지 9호에 영영
 *  `[  ]최초점검`으로 나가고, 날짜를 **고쳐서** 60일 창을 벗어나도 `[√]`가 남는다.
 *
 *  ⚠ **`is_initial_source` 컬럼이 없으면 아무것도 하지 않는다.** 그 컬럼이 있어야 사람이 손으로
 *  지정한 값(`manual`)과 자동 판정(`auto`)을 가를 수 있다. 구별 못 하는 채로 다시 계산하면
 *  **사용자의 수정을 조용히 덮는다** — 안 고치는 것보다 나쁘다. 마이그레이션 155 전에는
 *  건너뛰고 그 사실을 호출부에 돌려준다(호출부가 사용자에게 알린다).
 *
 *  ⚠ 되돌림도 한다(true→false). 한쪽 방향만 고치면 날짜 정정이 절반만 반영된다. */
export async function recalcIsInitialForCustomer(
  admin: Admin,
  customerId: string,
): Promise<RecalcResult> {
  const { data: custRaw } = await admin
    .from('customers').select('use_approval_date').eq('id', customerId).maybeSingle()
  const approval = (custRaw as { use_approval_date: string | null } | null)?.use_approval_date ?? null

  // 출처 컬럼을 **select에 넣어** 존재 여부를 판정한다 — 없으면 여기서 error가 나고, 그게 신호다.
  const { data, error } = await admin.from('inspections')
    .select('id, inspection_type, plan_type, inspection_start_date, is_initial, is_initial_source')
    .eq('customer_id', customerId)
  if (error) return { updated: 0, skipped: 'no-source-column' }

  const rows = (data ?? []) as Array<{
    id: string; inspection_type: string | null; plan_type: string | null
    inspection_start_date: string | null; is_initial: boolean | null; is_initial_source: string | null
  }>
  if (rows.length === 0) return { updated: 0, skipped: 'no-inspections' }

  let updated = 0
  for (const r of rows) {
    if (r.is_initial_source === 'manual') continue          // 사람이 정한 값은 건드리지 않는다
    // 점검 종류 축은 plan_type이 정본이다(inspection_type은 일반관리에서 관리유형을 나른다).
    const sub: SubType | null = planTypeSub(r.plan_type)
      ?? (r.inspection_type === '종합' ? '종합' : r.inspection_type === '작동' ? '작동' : null)
    if (!sub) continue                                      // 정기·event는 별지 9호 대상이 아니다
    const want = isInitialByLaw(approval, r.inspection_start_date, sub)
    if (want === !!r.is_initial) continue
    const { error: upErr } = await admin.from('inspections')
      .update({ is_initial: want } as Record<string, unknown>).eq('id', r.id)
    if (!upErr) updated++
  }
  return { updated, skipped: null }
}
