/** 소방계획서 그림의 **종류와 우선순위** — 엑셀·PDF가 **함께 읽는 단일 원천** (2026-09-14)
 *
 *  왜 별도 모듈인가: 같은 자리를 두 표면이 각자 정하면 한쪽만 고쳐 **두 산출물이 다른 그림을
 *  인쇄한다**(이 저장소에서 여러 번 겪었다 — 서식 1.3 관할소방서·별지10호 일자가 그랬다).
 *  의존이 0이라 서버·클라이언트 어디서든 import 할 수 있다.
 *
 *  🚨 **서식 1.3 「건축물 위치」 상자는 위치도(약도)가 아니라 표지 건물 사진이다.**
 *    사용자 확정(2026-09-14): 그 칸에 들어갈 것은 네이버 약도가 아니라 **표지와 같은 위성
 *    항공사진**이다. 같은 날 진입 경로도 바탕을 표지 사진으로 바꾼 결정과 한 축이다.
 *    약도를 **폴백으로 남기는** 이유는 표지 사진이 아직 없는 고객의 문서가 갑자기 백지가
 *    되지 않게 하기 위해서다(사용자 확정) — 표지가 있으면 약도는 인쇄되지 않는다.
 */

/** 서식 1.3 「건축물 위치」 상자가 받는 종류 — **앞에 적힌 것이 우선**이다 */
export const LOCATION_BOX_KINDS = ['cover', 'map'] as const

/** 고지·화면 문구에 쓰는 이름 — `kind` 원문(`cover`)이 사용자에게 그대로 나가지 않게 한다 */
const KIND_LABEL: Record<string, string> = {
  cover: '표지 건물 사진',
  map: '위치도(약도)',
  route: '소방차 진입 경로도',
  entry: '진입장소·주변 소방시설 사진',
  evacmap: '층별 평면도',
  evacuation: '피난안내도',
  building: '건물 전경',
  etc: '그 밖의 사진',
}
export const imageKindLabel = (kind: string): string => KIND_LABEL[kind] ?? kind

/**
 * 우선순위 목록에서 **실제로 인쇄될 종류**를 고른다. 하나도 없으면 `null`.
 *
 * 판정을 부르는 쪽에 맡기지 않고 이 함수 하나로 모으는 것이 요점이다 —
 * `has`만 각 표면이 제 방식으로 답하면(엑셀은 `byKind`, PDF는 `imgsOf`) 규칙은 한 벌이 된다.
 */
export function pickFirstKind<K extends string>(
  kinds: readonly K[], has: (kind: K) => boolean,
): K | null {
  return kinds.find(k => has(k)) ?? null
}
