/** 복귀 주소(`?from=`) 검증 — **내부 경로만** 받는다. 순수·무의존.
 *
 *  🚨 검증 없이 링크·`router.push`에 넘기면 `//evil.com`이 프로토콜 상대 URL로 해석돼 외부로
 *    튕긴다(오픈 리다이렉트). `/`로 시작하되 `//`·`/\`는 아닐 것 — 이 두 조건이 그 문을 닫는다.
 *  걸러지면 빈 문자열 — 호출부는 종전 동선(목록 등)으로 간다. */
export function safeReturnHref(from: string | null | undefined): string {
  const f = from ?? ''
  return /^\/(?![/\\])/.test(f) ? f : ''
}
