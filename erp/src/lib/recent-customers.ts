/** 최근 본 고객 (사용자별) — 브라우저 localStorage 저장.
 *
 *  왜 DB가 아닌가: 조회 기록은 사용자 편의값이라 유실돼도 업무에 영향이 없고, 고객 상세를 열
 *  때마다 쓰기가 생기는 비용이 이득보다 크다. 같은 이유로 이 프로젝트는 불량 메모 최근 5개·
 *  최근 사용 읍/면도 localStorage에 둔다. 기기 간 공유가 안 되는 것은 감수한 트레이드오프다.
 *
 *  왜 목록 정렬을 바꾸지 않는가: 기본 정렬(등록순)에 조회 순서를 섞으면 고객을 열었다 돌아올
 *  때마다 순서가 바뀌어 보던 위치를 잃고, 페이지 경계와 상세 [◀ 이전|다음 ▶] 순서까지 흔들린다.
 *  그래서 목록은 그대로 두고 위에 스트립으로만 얹는다.
 *
 *  ⚠ 로그인 계정별로 분리 저장한다 — 한 PC를 여러 직원이 쓰는 현장이라 섞이면 안 된다. */

export type RecentCustomer = { id: string; name: string; at: number }

const MAX = 8
const key = (userId: string) => `recentCustomers:${userId}`

/** 저장된 목록 (최근 순). 파싱 실패·구형식은 조용히 빈 목록 — 편의 기능이 화면을 깨선 안 된다 */
export function readRecentCustomers(userId: string): RecentCustomer[] {
  if (typeof window === 'undefined' || !userId) return []
  try {
    const raw = window.localStorage.getItem(key(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r): r is RecentCustomer =>
        !!r && typeof r === 'object'
        && typeof (r as RecentCustomer).id === 'string'
        && typeof (r as RecentCustomer).name === 'string')
      .slice(0, MAX)
  } catch {
    return []
  }
}

/** 방문 기록 — 같은 고객은 중복 없이 맨 앞으로 올린다(이름이 바뀌었으면 새 이름으로 갱신) */
export function pushRecentCustomer(userId: string, cust: { id: string; name: string }): void {
  if (typeof window === 'undefined' || !userId || !cust.id) return
  try {
    const next = [
      { id: cust.id, name: cust.name, at: Date.now() },
      ...readRecentCustomers(userId).filter(r => r.id !== cust.id),
    ].slice(0, MAX)
    window.localStorage.setItem(key(userId), JSON.stringify(next))
  } catch {
    /* 저장 공간 부족·프라이빗 모드 — 기록을 못 남겨도 기능은 계속된다 */
  }
}
