/** 로그인 뒤 돌아갈 경로 검증 — `?next=` (C4 2단계 웹, 2026-10-03)
 *
 *  QR 라벨을 폰 기본 카메라로 찍으면 `/t/{code}`가 열리는데, 비로그인이면 proxy가 /login으로 보내고
 *  종전 로그인은 늘 HOME_PATH로 가서 **찍은 코드를 잃었다**. proxy가 `/t` 경로에만 `next`를 붙이고,
 *  로그인 액션이 이 함수를 통과한 값만 따른다.
 *  열린 리다이렉트를 막는다: 같은 사이트 절대 경로만(`/`로 시작, `//`·`/\`·스킴·제어문자 없음), /login 자신은 제외. */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return null
  if (v.length > 512 || /[\u0000-\u001f\\]/.test(v)) return null
  if (v === '/login' || v.startsWith('/login?') || v.startsWith('/login/')) return null
  return v
}

/** proxy가 `next`를 붙이는 경로 — 지금은 QR 리졸버(`/t`, `/t/…`, `/t?q=`)만. 넓히면 로그인 리다이렉트를 단언하는 검사들이 영향받는다 */
export const NEXT_ON_LOGIN = (pathname: string) => pathname === '/t' || pathname.startsWith('/t/')
