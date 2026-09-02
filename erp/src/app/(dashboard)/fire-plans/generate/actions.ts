'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

/** 구 소방계획서 생성 진입 — 보관함 폐지(2026-09-02 사용자 확정)로 발행 액션이 소멸했다.
 *  requestFirePlanHwpAction(서버 동기 생성 → fire_plans 등록)은 삭제 — ERP는 계획서 파일을
 *  저장하지 않고, 조회·인쇄는 즉석 생성이 담당한다(/customers/[id]/fire-plan/pdf).
 *  남은 것은 공통문구 가져오기 대화상자가 쓰는 고객 검색뿐이다. */

export async function searchCustomersForPlanAction(q: string): Promise<{
  customers: Array<{ id: string; name: string; type: string; purpose: string | null }>
}> {
  await requirePermission('customer_manage')
  if (!q.trim()) return { customers: [] }
  const admin = createAdminClient()
  const { data } = await admin.from('customers')
    .select('id, customer_name, inspection_type, buildings(purpose, is_active)')
    .eq('is_active', true)
    .ilike('customer_name', `%${q.trim()}%`)
    .order('customer_name')
    .limit(10)
  return {
    customers: ((data ?? []) as Array<{
      id: string; customer_name: string; inspection_type: string
      buildings: Array<{ purpose: string | null; is_active: boolean }> | null
    }>).map(c => ({
      id: c.id,
      name: c.customer_name,
      type: c.inspection_type,
      purpose: (c.buildings ?? []).find(b => b.is_active)?.purpose ?? null,
    })),
  }
}

// getFirePlanReadinessAction 삭제(2026-08-19) — 배치 발행 폐지로 유일한 소비자(generate-request-client)가
// 사라졌다. 'use server' export는 그 자체로 공개 엔드포인트라 쓰지 않는 것은 남기지 않는다.
// 준비율 계산 자체는 lib/fire-plan-readiness.ts에 그대로 있고 고객 상세·프로브가 계속 쓴다.

// requestFirePlanHwpAction 삭제(2026-09-02 보관함 폐지) — 소비자였던 [개정 발행](고객 탭)과
// Ctrl+K '생성 요청' 명령이 함께 사라졌다. fire_plan_gen_jobs의 소방계획서 잡도 더는 쌓이지 않는다
// (별지 4·9·10·11호 잡은 report9-actions 쪽 축이라 무관).

/* ── P-1 연차 일괄 발행 마법사 삭제 (2026-08-19 사용자 확정) ──
 *  getAnnualTargetsAction·bulkAnnualIssueAction·AnnualTargets를 걷어냈다.
 *
 *  왜: 전 고객 일괄 발행의 전제가 무너져 있었다 — 실측(2026-08-19) 활성 고객 313명 중
 *  계획서 입력이 완비된 고객이 **0명**이라 일괄 발행은 빈칸투성이 문서 313건을 만들 뿐이었다.
 *  실사용도 없었다(소방계획서 생성 잡 총 8건·3일, 최근 2건은 실패).
 *  고객 상세의 [연차] 버튼(issueNextYearPlanAction)도 2026-09-02 보관함 폐지로 함께 소멸 —
 *  미래 연도 행이 화면을 어지럽히던 원인이었다(서림사 2027년 2행 실사고).
 *  잘못 눌러 빈 문서를 대량 생성할 위험이 이득보다 컸다. */

// getFirePlanPresetsAction·saveFirePlanPresetAction 삭제(2026-08-19) — 공통 수기 프리셋 폐지.
// 유형별 문구는 '계획서 공통문구'(plan_text_library)의 대안 항목이 담당한다.
// _presets/*.json은 더 이상 읽지 않는다(스토리지 파일은 남아 있어도 무해 — 아무도 참조하지 않음).

// getFirePlanGenStatusAction·GenStatus 삭제(2026-08-19) — 큐 현황판은 배치 발행 화면 전용이었다.
// 소비자(batch page·generate-request-client)가 함께 사라져 더는 읽히지 않는다.
// 생성 자체는 서버 동기(H-13, requestFirePlanHwpAction)라 큐를 들여다볼 화면이 필요 없고,
// 고객 상세는 잡이 아니라 결과(보관함 행)를 본다. 잡 행은 완료 기록용으로 계속 남는다.
