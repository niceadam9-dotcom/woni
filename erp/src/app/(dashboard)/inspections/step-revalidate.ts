/** 단계 동기화 + 캐시 무효화의 **단일 창구** (소방계획서_36 D-2 · S2-1)
 *
 *  ⚠ 이 파일에는 `'use server'`를 **넣지 않는다.** 여기 두는 이유가 그것이다 —
 *  `lib/inspection-step-sync.ts`에 합치면 `--conditions=react-server`로 Next 런타임 **밖에서**
 *  도는 스크립트들이 그 모듈을 타고 `next/cache`를 끌어들여 터진다. 반대로 `'use server'`를
 *  붙이면 export가 전부 공개 엔드포인트가 된다(소방계획서_18 교훈). 평범한 모듈이 정답이다.
 *
 *  ── 왜 '가드 9곳 복붙'이 아니라 헬퍼인가 (F-1)
 *  점검표 저장(saveSheetResponses)이 revalidate를 건너뛸 수 있었던 전제는 "단계가 안 바뀌었다"가
 *  아니라 **"이 액션이 바꾼 것을 클라이언트가 스스로 책임진다"**였다(sheet-actions.ts 주석).
 *  나머지 호출부는 단계 외에 **서버 렌더 props도 함께 바꾼다** — 파일칩·evidence.delivery·
 *  철회 버튼 노출축 등. 그래서 같은 가드를 복붙하면 8곳이 조용히 깨진다.
 *  → 판단을 옵션으로 **명시**하게 만들고, 각 호출부가 "무엇이 바뀌는지" 한 줄로 남긴다.
 */
import { revalidatePath } from 'next/cache'
import { syncInspectionSteps } from '@/lib/inspection-step-sync'

/** lib 쪽 Admin 타입을 그대로 따라간다 — 여기서 다시 선언하면 두 정의가 갈라진다 */
type Admin = Parameters<typeof syncInspectionSteps>[0]

/** 상세·목록 **두 경로**를 함께 무효화한다.
 *  목록을 빼면 점검 목록의 진행률만 조용히 낡는다(실제로 그런 자리가 있었다 — S2-6).
 *
 *  ⚠ 2026-08-30 — "현재 보고 있는 상세를 무효화하면 RSC 페이로드가 액션 응답에 실려
 *  화면 반영이 늦어진다"는 가설로 detail 스킵 옵션을 넣어 봤으나 **실측상 이득 0**이라
 *  되돌렸다(F-15). ⑥ 제출일 경로의 지연은 여기가 아니라 ⑥ 칸 자체의 재렌더 비용이다. */
export function revalidateInspection(inspectionId: string): void {
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
}

/**
 *  단계를 동기화하고, **필요할 때만** 상세·목록을 무효화한다.
 *
 *  @param opts.alsoChanged
 *    `true`  = 단계가 안 바뀌어도 **항상** 무효화한다.
 *              이 액션이 단계 말고 **다른 서버 렌더 prop도 바꿀 때** 쓴다(파일칩·발송 이력 등).
 *              종전의 무조건 `revalidatePath` 2줄과 **동작이 완전히 같다**.
 *    생략/`false` = 단계가 실제로 바뀐 저장에만 무효화한다.
 *              **화면 신선도를 클라이언트가 전부 책임지는 경로에서만** 쓸 수 있다.
 *
 *  이름이 헷갈릴 수 있어 못박는다 — `alsoChanged: true`는 "바뀐 것도 포함"이 아니라
 *  **"안 바뀌어도 무효화(=종전 무조건 동작 유지)"**라는 뜻이다.
 */
export async function syncStepsAndRevalidate(
  admin: Admin,
  inspectionId: string,
  actorId: string | null,
  opts: { alsoChanged?: boolean } = {},
): Promise<{ stepsChanged: boolean }> {
  const sync = await syncInspectionSteps(admin, inspectionId, actorId)
  const stepsChanged = sync.changed > 0 || !!sync.justCompleted
  if (stepsChanged || opts.alsoChanged) revalidateInspection(inspectionId)
  return { stepsChanged }
}
