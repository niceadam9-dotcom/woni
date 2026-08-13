import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/** 단계 완료 시 알림 소멸 (소방계획서_21 R7-10 / #3·#4 D-3)
 *
 *  **삭제하지 않고 읽음 처리한다.** 알림은 "언제 알렸는지"의 이력이라 지우면 추적을 잃는다.
 *  사용자가 말한 "소멸"은 종 배지에서 사라지는 것이고 읽음 처리로 충족된다.
 *
 *  대상은 그 점검을 참조하는 **미읽음 기한 알림**뿐이다 — 담당 배정(inspection_assigned)처럼
 *  단계 완료와 무관한 종류까지 지우면 사용자가 못 본 알림이 조용히 사라진다.
 *
 *  종전에는 timeline-actions.ts 주석이 recordSubmissionAction을 "알림 소멸 조건"이라 설명했지만
 *  실제 함수는 컬럼 갱신과 로그만 했다 — 주석은 의도였고 구현이 아니었다(F-12).
 *
 *  실패해도 삼킨다: 알림 정리 때문에 단계 동기화가 되돌아가면 안 된다.
 *
 *  ⚠ 타입 값은 **추측하지 말 것.** 초판은 실재하지 않는 이름('action_deadline' 등)을 적어
 *  단 한 건도 소멸시키지 못했다(독립 검증 지적). 아래 목록은 마이그레이션 109의
 *  `notifications.type` CHECK 제약과 발신부(크론)를 대조해 뽑은 값이다.
 *  타입을 늘릴 때는 109 CHECK → 발신 크론 → 이 목록 순으로 함께 고친다. */
const DEADLINE_TYPES = [
  'inspection_step_due',      // api/cron/inspection-deadline-notify — 단계 마감 D-n
  'inspection_step_overdue',  // 〃 기한 초과
  'report_submit_due',        // api/cron/defect-action-notify — 별지 9호 보고기한 D-7·D-3·당일
  'report_submit_overdue',    // 109 CHECK에 정의된 짝 (발신부는 아직 없음)
  'defect_action_due',        // 불량 조치 기한
  'defect_action_overdue',
]
// 소멸시키지 않는 것: inspection_assigned(담당 배정) · inspection_completed(완료 통지) ·
// weekly_doc_briefing(주간 브리핑) — 단계 완료와 무관하다

export async function dismissInspectionDeadlineNotifications(
  admin: Admin, inspectionId: string,
): Promise<{ dismissed: number }> {
  try {
    const { data } = await admin.from('notifications')
      .update({ is_read: true } as Record<string, unknown>)
      .eq('reference_type', 'inspection')
      .eq('reference_id', inspectionId)
      .eq('is_read', false)
      .in('type', DEADLINE_TYPES)
      .select('id')
    return { dismissed: (data ?? []).length }
  } catch {
    return { dismissed: 0 }
  }
}
