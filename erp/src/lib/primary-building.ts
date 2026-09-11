/** 「어느 동이 문서에 실리는가」 — **단일 원천**.
 *
 *  종전 규칙은 코드 여섯 군데에 각자 적힌 `is_active=true` + `created_at` 오름차순 + `limit(1)`,
 *  즉 **최고참 1동**이었다. 규칙 자체는 같았지만 어디에도 이름이 없어서
 *   · 사용자는 어느 동이 인쇄되는지 알 수 없었고(화면에 표시가 없다)
 *   · 대표를 바꿀 방법이 없었으며(등록 순서를 되돌릴 수 없다)
 *   · **같은 개념을 다른 축으로 읽는 코드가 섞여 있었다** — 설비는 전 동, 건축물 정보는 1동
 *     (2026-09-08 실측: `sheet-overview`·워크북 라우트는 전 동, `report9-assemble`은 1동).
 *
 *  그래서 규칙에 이름을 준다. 마이그레이션 160의 `buildings.is_primary`가 정본이고,
 *  **없거나 아무도 지정되지 않았으면 종전 규칙(최고참)으로 떨어진다** — 그래서 이 파일은
 *  160 적용 전에도, 신규 등록 직후에도 답을 낸다(무응답이 없다).
 *
 *  ⚠ 조회하는 쪽은 `select('*')`를 쓸 것. `is_primary`를 명시하면 160 적용 전 DB에서 42703으로
 *    터지고, `.order('is_primary')`도 마찬가지다 — 정렬은 여기 JS가 한다.
 */

/** 정렬·판정에 필요한 최소 모양 — 실제 행은 이보다 넓다(구조적 타이핑으로 그대로 들어온다) */
export type BuildingLike = {
  id: string
  is_active?: boolean | null
  is_primary?: boolean | null
  created_at?: string | null
}

/** 별지 9호 「다수동일때」 서식이 담는 동 수 — 대표동 1 + 2·3·4동 블록 3개 */
export const FORM9_MAX_BUILDINGS = 4

/**
 * 인쇄 순서로 정렬한 활성 동 — [0]이 대표동이다.
 *
 * 규칙: `is_primary`가 참인 동이 먼저, 그다음 `created_at` 오름차순(종전 규칙), 마지막으로 `id`.
 * `id` 티브레이커가 있는 이유: `created_at`이 같은 두 동(대장 자동 등록 등)에서 순서가 흔들리면
 * **실행할 때마다 다른 동이 인쇄된다**. 문서는 그런 식으로 흔들리면 안 된다.
 */
export function sortBuildingsForPrint<T extends BuildingLike>(rows: readonly T[]): T[] {
  return rows
    .filter(b => b.is_active !== false)   // undefined = 이미 활성만 조회한 것
    .slice()
    .sort((x, y) => {
      const px = x.is_primary === true ? 0 : 1
      const py = y.is_primary === true ? 0 : 1
      if (px !== py) return px - py
      const cx = x.created_at ?? '', cy = y.created_at ?? ''
      if (cx !== cy) return cx < cy ? -1 : 1
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
    })
}

/** 대표동 — 없으면 null(건물 미등록). 종전 `bldRes.data?.[0]`을 그대로 대체한다 */
export function primaryBuilding<T extends BuildingLike>(rows: readonly T[]): T | null {
  return sortBuildingsForPrint(rows)[0] ?? null
}

/** 대표동을 뺀 나머지 — 별지 9호 「다수동일때」 2·3·4동 블록에 실린다 */
export function otherBuildings<T extends BuildingLike>(rows: readonly T[]): T[] {
  return sortBuildingsForPrint(rows).slice(1)
}
