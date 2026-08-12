'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { listCleanupTargets, runArchiveCleanup } from '@/lib/archive-cleanup'
import type { CleanupPreview, CleanupResult } from '@/lib/archive-cleanup'

/** 보관함 [과거본 정리] (소방계획서_18 S2) — 인증·권한 확인과 캐시 무효화만 담당한다.
 *  대상 판정과 삭제 순서는 lib/archive-cleanup.ts에 있다: 그래야 Storage 실패를 주입한
 *  프로브로 "파일을 다 지우지 못하면 행을 지우지 않는다"는 불변식을 실제로 검증할 수 있다.
 *  ('use server' 파일의 export는 곧 공개 엔드포인트라, 인증 없는 내부 함수를 여기 두면 안 된다) */

// ⚠ 'use server' 파일은 타입도 re-export 하면 안 된다 — 서버 액션 로더가 모든 export를 액션 참조로
//    바꾸는데 타입은 런타임에 존재하지 않아 "CleanupPreview is not defined"로 모듈 평가가 통째로 깨진다
//    (이 파일을 모듈 그래프에 포함하는 고객 상세 페이지 전체가 404가 됐다, 2026-08-12).
//    소비자는 타입을 원천인 @/lib/archive-cleanup에서 직접 import 한다.

export async function listCleanupTargetsAction(customerId: string): Promise<{ data?: CleanupPreview; error?: string }> {
  await requirePermission('customer_manage')
  return { data: await listCleanupTargets(createAdminClient(), customerId) }
}

export async function cleanupArchiveAction(
  customerId: string,
  /** 종이 보관(인쇄) 완료 확인 + 대상 지문 — D-6의 게이트라 서버도 함께 강제한다.
   *  클라이언트 체크박스만으로 두면 액션 직접 호출로 복구 불가 삭제가 그냥 실행된다. */
  confirm?: { printed?: boolean; signature?: string },
): Promise<{ data?: CleanupResult; error?: string }> {
  const profile = await requirePermission('customer_manage')
  const res = await runArchiveCleanup(createAdminClient(), customerId, profile.id, confirm ?? {})
  if (res.data) revalidatePath(`/customers/${customerId}`)
  return res
}
