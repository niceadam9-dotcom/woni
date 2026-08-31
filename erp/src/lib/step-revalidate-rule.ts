/** revalidate 여부를 정하는 **순수 술어** (소방계획서_36 S2-2 수용 기준 ⓐ)
 *
 *  왜 별도 모듈인가: `step-revalidate.ts`는 `next/cache`를 import하므로 Next 런타임 밖에서
 *  불러올 수 없다 — 즉 그 안에 규칙이 들어 있으면 **규칙을 단독으로 단언할 수가 없다**.
 *  독립 판정이 "S2-2의 수용 기준(참일 때만 2회, 거짓이면 0회)을 단언하는 검사가 없다"고
 *  지적한 자리가 이것이다. 규칙만 여기로 빼서 무서버로 검증한다.
 *
 *  규약 — 무효화는 다음 둘 중 하나일 때만 돈다:
 *    ① 단계 상태가 실제로 바뀌었다(stepsChanged)
 *    ② 이 액션이 단계 말고 **다른 서버 렌더 prop도 바꾼다**(alsoChanged)
 *  둘 다 아니면 **한 번도 부르지 않는다** — 화면 신선도를 클라이언트가 전부 책임지는
 *  경로에서만 성립하는 조건이다(F-1).
 */
export function shouldRevalidate(stepsChanged: boolean, alsoChanged?: boolean): boolean {
  return stepsChanged || !!alsoChanged
}

/** sync 결과 → stepsChanged. `changed`는 갱신된 행 수, `justCompleted`는 점검 전체 완료 전이. */
export function stepsChangedFrom(sync: { changed: number; justCompleted?: boolean }): boolean {
  return sync.changed > 0 || !!sync.justCompleted
}
