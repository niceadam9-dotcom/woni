'use server'

/** 점검표 → 1.4 대장 **따라잡기** 쓰기 액션 — 소방계획서_49 §9 (2026-09-11)
 *
 *  판정은 `lib/facility-autocheck`의 순수 함수가 한다. 여기는 **그 답을 DB에 옮기기만** 한다.
 *
 *  🚨 `saveFacilitiesAction`을 절대 재사용하지 않는다. 이유가 둘이고 둘 다 치명적이다:
 *   ① 그 액션은 `facilities_verified_at`을 **함께 찍는다**(`facilities-actions.ts:61`).
 *      그 값은 「**사람이** 설비 현황을 확인했다」는 뜻이고, 1.4 미확인 경고가 그걸로 판정한다.
 *      시스템이 자동으로 찍으면 경고가 스스로 꺼져 **관문이 조용히 죽는다**(§9-4).
 *   ② 그 액션은 `delete → insert` **replace 방식**이라(`:42`·`:45`), 한 행을 켜려고 부르면
 *      그 건물의 설비·비고가 통째로 지워졌다 다시 들어간다(K-5의 소실 리스크를 그대로 탄다).
 *  → 그래서 **행 단위 upsert 전용 좁은 액션**이다. `installed`만 쓰고 확인일은 건드리지 않는다.
 *
 *  ⚠ 권한은 `inspection_register`다(§9-7 미결정 3 = 허용). 점검표 입력자가 대장을 바꾸는 셈이지만,
 *    이건 **시스템 행위**이고 `detail.auto`로 출처가 남아 되돌릴 수 있다(§9-5).
 */

import { requirePermission } from '@/lib/auth'
import { runAutoCheck } from './facility-autocheck-core'
import type { AutoCheckResult } from '@/lib/facility-autocheck'

/* 🚨 이 파일은 `'use server'`다 — **타입을 포함해 async 함수 외의 것을 내보내지 않는다.**
   타입 재수출이 런타임에 값으로 방출돼 화면이 500으로 죽은 전례가 있다(2026-09-10).
   `AutoCheckResult`는 `lib/facility-autocheck`에 둔다. */

/** 점검표 응답을 근거로 1.4 대장을 따라잡는다. 저장 액션이 호출한다(§9-7 미결정 2 = 저장 시 즉시).
 *
 *  ⚠ 실패해도 **점검표 저장을 깨뜨리지 않는다** — 호출부가 best-effort로 감싼다.
 *    대장 따라잡기가 안 됐다고 사용자의 점검 입력이 날아가면 안 된다. */
export async function autoCheckFacilitiesFromSheetAction(
  inspectionId: string,
): Promise<AutoCheckResult> {
  await requirePermission('inspection_register')
  return runAutoCheck(inspectionId, { write: true })
}

/** 지금 상태만 읽는다 — **아무것도 쓰지 않는다**. 화면이 「어느 것입니까?」를 계속 띄우기 위해서다.
 *
 *  🚨 모호한 갈래는 저장 응답에만 실어 보내면 **새로고침 한 번에 사라진다**. 그러면 사용자는
 *  「스프링클러인지 화재조기진압용인지 못 정했다」는 사실조차 모른 채 [확인했습니다]를 눌러
 *  **빈 대장을 확인 처리**하게 된다 — 이 축에 남아 있던 마지막 구멍이었다.
 *  판정은 쓰기 경로와 **같은 함수**를 탄다(사본 금지 — 보이는 것과 켜지는 것이 갈리면 안 된다). */
export async function getFacilityAutoCheckStateAction(
  inspectionId: string,
): Promise<AutoCheckResult> {
  await requirePermission('inspection_register')
  return runAutoCheck(inspectionId, { write: false })
}

/** 사람이 고른 한 설비를 대장에 켠다 — 「어느 것입니까?」의 답.
 *
 *  ⚠ **후보 목록 안에 있는 코드만** 받는다. `'use server'`는 공개 엔드포인트라 인자를 믿지 않는다 —
 *    아무 코드나 켤 수 있으면 이 화면이 대장 전체를 쓰는 창구가 된다.
 *  ⚠ 여기서도 `facilities_verified_at`은 건드리지 않는다(§9-4). 고르는 것은 설치 사실이고,
 *    「대장 전체를 확인했다」는 별개의 행위다. */
export async function resolveAmbiguousFacilityAction(
  inspectionId: string, facilityCode: string,
): Promise<{ error?: string; added?: string }> {
  await requirePermission('inspection_register')
  const state = await runAutoCheck(inspectionId, { write: false })
  const allowed = new Set(state.ambiguous.flatMap(a => a.candidates))
  if (!allowed.has(facilityCode)) return { error: '지금 고를 수 있는 설비가 아닙니다.' }
  const done = await runAutoCheck(inspectionId, { write: true, only: [facilityCode] })
  if (done.skipped) return { error: done.skipped }
  return { added: done.added[0] }
}

/* 판정·쓰기 본체 `runAutoCheck`는 facility-autocheck-core.ts로 이동(C1, 2026-10-04) —
   모바일 라우트(/api/mobile/sheet-save)와 같은 함수 한 벌을 타기 위해서다.
   이 파일은 쿠키 인증(requirePermission) 관문만 남는다. */
