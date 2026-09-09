/** 같은 고객 안의 **건물 이름 중복** 판정 — 단일 원천.
 *
 *  왜 필요한가(2026-09-09 실사고): 건물 등록에는 중복 검사가 없었다. 주소 중복 경고는 있지만
 *  **다른 고객과 겹칠 때만** 뜨고, 같은 고객의 다른 동은 정상으로 본다(A동·B동이 실제로 있으니까).
 *  그 사이로 **이름까지 똑같은 「규현빌라」가 두 번 등록**됐고, 화면·문서는 대표동 하나만 보여
 *  주므로 나중에 등록한 동에 입력한 값이 **사라진 것처럼** 보였다.
 *
 *  ⚠ 그렇다고 막으면 안 된다 — 같은 주소에 여러 동이 서는 것은 정상이다. 그래서 **차단이 아니라
 *    확인**이고, 판정 축은 주소가 아니라 **이름**이다(다동이면 「○○ A동」처럼 이름이 갈린다).
 *
 *  ⭐ 비교는 **공백을 접어서** 한다 — 「규현빌라」와 「규현 빌라」는 사람에게 같은 건물이다.
 *    대소문자도 접는다(영문 이름 대비). 그 이상은 하지 않는다: 「규현빌라2」는 다른 이름으로 둔다
 *    (숫자를 지우면 A동·B동을 구별하려는 사용자의 의도를 우리가 뭉갠다).
 */

/** 이름 비교용 정규화 — 공백 제거 + 소문자. 표시용으로 쓰지 말 것(원문이 정본) */
export function normalizeBuildingName(name: string | null | undefined): string {
  return String(name ?? '').replace(/\s+/g, '').toLowerCase()
}

export type NamedBuilding = { id: string; building_name: string | null; is_active?: boolean | null }

/**
 * 같은 이름의 기존 건물을 찾는다 — 없으면 null.
 *
 * @param excludeId 수정 중인 자기 자신(수정 저장이 자기 이름에 걸리면 안 된다)
 * ⚠ **비활성 건물도 본다.** 비활성은 목록에 남아 있어 사용자 눈에는 여전히 「있는 건물」이고,
 *   같은 이름을 또 만들면 되살릴 때 구별이 안 된다.
 */
export function findSameNameBuilding<T extends NamedBuilding>(
  buildings: readonly T[],
  name: string,
  excludeId?: string | null,
): T | null {
  const key = normalizeBuildingName(name)
  if (!key) return null
  return buildings.find(b => b.id !== excludeId && normalizeBuildingName(b.building_name) === key) ?? null
}
