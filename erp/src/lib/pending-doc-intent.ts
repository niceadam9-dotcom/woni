/** 「발행하려다 점검표 입력하러 간」 의도 표식 — 화면 이동을 건너 살아남는 one-shot 쪽지.
 *
 *  왜 있나(2026-09-21 사용자 요청): 회차 카드의 [엑셀]·[전체 인쇄]는 설치 설비에 미입력이 있으면
 *  발행 대신 팝업을 띄우고 점검표 화면으로 **전체 이동**한다(plan-annex-round-card 발행 가드).
 *  그 순간 「엑셀을 받으려던 것」이라는 사실이 통째로 사라져, 입력을 마치고 돌아와도 사용자가
 *  같은 버튼을 **다시** 눌러야 했다. 이동 직전에 이 쪽지를 적고, 돌아온 카드가 소비한다.
 *
 *  ⚠ **one-shot이다 — 읽는 즉시 지운다.** 남겨 두면 새로고침·다음 방문마다 유령 발행이 된다.
 *  ⚠ TTL도 같은 이유다. 이동해 놓고 딴 일을 하다 한참 뒤에 돌아왔다면 그건 이미 다른 용무다.
 *  ⚠ id가 다르면 **지우지 않는다** — 남의 회차 쪽지를 대신 버리면 그 회차가 의도를 잃는다.
 *  ⚠ localStorage가 아니라 sessionStorage다. 탭을 넘어 따라가면 엉뚱한 탭이 제멋대로 발행한다.
 *  ⚠ 저장소 접근은 전부 try로 감싼다 — 사생활 모드·용량 초과로 던지면 화면이 죽는다.
 *    표식을 못 쓰면 **종전 동작(사용자가 다시 누르기)으로 떨어질 뿐**이라 조용히 삼켜도 된다.
 *
 *  판정(`isExpired`)을 저장소와 갈라 둔 이유: 저장소 없이도 단위검사가 가능해야 한다.
 */

export type PendingDocKind = 'xlsx' | 'bundle'
export type PendingDoc = { inspectionId: string; kind: PendingDocKind; at: number }

export const PENDING_DOC_KEY = 'erp.pendingDoc'
/** 10분 — 점검표 한 시트를 채우고 돌아오기에 넉넉하고, 「딴 일 하다 왔다」와는 갈린다 */
export const PENDING_DOC_TTL_MS = 10 * 60_000

/** 저장소의 최소 모양 — 검사에서 가짜 저장소를 끼울 수 있게 Storage 전체를 요구하지 않는다 */
export type PendingDocStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** SSR에서는 null — 'use client' 컴포넌트라도 모듈은 서버에서 평가된다 */
function defaultStore(): PendingDocStore | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** 미래 시각(시계 되감김)도 만료로 친다 — 되감긴 쪽지는 TTL이 영영 안 끝난다 */
export function isExpired(d: PendingDoc, now: number): boolean {
  const age = now - d.at
  return age < 0 || age >= PENDING_DOC_TTL_MS
}

/** 부서진 쪽지는 던지지 않고 null — 저장소에 뭐가 들었든 화면은 살아야 한다 */
export function parsePendingDoc(raw: string): PendingDoc | null {
  let o: unknown
  try {
    o = JSON.parse(raw)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  const { inspectionId, kind, at } = o as Record<string, unknown>
  if (typeof inspectionId !== 'string' || inspectionId === '') return null
  if (kind !== 'xlsx' && kind !== 'bundle') return null
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  return { inspectionId, kind, at }
}

/** 이동 직전에 적는다 — `location.assign` **앞**이어야 한다(뒤는 실행되지 않는다) */
export function writePendingDoc(
  inspectionId: string, kind: PendingDocKind, now: number,
  store: PendingDocStore | null = defaultStore(),
): void {
  if (!store || !inspectionId) return
  const d: PendingDoc = { inspectionId, kind, at: now }
  try {
    store.setItem(PENDING_DOC_KEY, JSON.stringify(d))
  } catch {
    /* 사생활 모드·용량 초과 — 표식 없이 종전 동작으로 떨어진다 */
  }
}

/** 돌아온 화면이 소비한다. 반환 즉시 저장소에서 사라진다(one-shot).
 *  `null`의 뜻은 셋 중 하나다: 쪽지 없음 · 만료 · **다른 회차 것**. 셋 다 「지금 발행하지 않는다」. */
export function takePendingDoc(
  inspectionId: string, now: number,
  store: PendingDocStore | null = defaultStore(),
): PendingDocKind | null {
  if (!store || !inspectionId) return null

  let raw: string | null
  try {
    raw = store.getItem(PENDING_DOC_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  const d = parsePendingDoc(raw)
  // 부서진 쪽지·만료된 쪽지는 치운다 — 남겨 두면 매 방문 파싱만 반복한다
  if (!d || isExpired(d, now)) {
    try { store.removeItem(PENDING_DOC_KEY) } catch { /* 지우기 실패는 다음 방문에 다시 시도된다 */ }
    return null
  }
  // ⚠ 남의 회차 쪽지다 — **지우지 않고** 그대로 둔다(그 회차가 돌아와 소비해야 한다)
  if (d.inspectionId !== inspectionId) return null

  try { store.removeItem(PENDING_DOC_KEY) } catch { /* 못 지우면 TTL이 두 번째 방어선이다 */ }
  return d.kind
}
