/** 건물 패널이 **열린 채로 시작하는가** — 조회 경로의 단일 규칙 (2026-09-10 사용자 지적)
 *
 *  사용자 신고: 「건축허가일·주차장이 [+ 건물 등록]을 누르지 않으면 조회가 안 된다」.
 *
 *  🚨 뿌리는 둘이었다.
 *   ① **그 칸들은 조회 화면에 아예 없다.** 목록 표는 7열(건물명·주소·용도·연면적·층수·준공·상태)
 *     뿐이고, 건축허가일·주차장·세대수·건축면적·높이·구조·승강기는 **수정 폼 안에만** 있다.
 *     즉 폼이 유일한 조회 창구인데, 그 사실이 어디에도 안 적혀 있었다.
 *   ② `53a39b8`(2026-09-09)이 폼을 접었다 — 「규현빌라」 2중 등록 실사고를 막으려는 옳은 변경이었다.
 *     그런데 **그 폼이 조회 창구이기도 하다**는 것이 그때 고려되지 않아, 사고를 막으면서 조회가
 *     함께 사라졌다. (변경 자체는 되돌리지 않는다 — 사고는 실재했다.)
 *
 *  ⚠ **[+ 건물 등록]은 조회의 문이 아니다.** 그 버튼은 빈 `'new'` 폼을 열고, 거기서 저장하면
 *    `createBuildingAction`으로 **또 한 동이 생긴다**. 기존 값을 보는 문은 **목록 행 클릭**이다.
 *
 *  ⚠ **`canManage`로 막지 않는다.** 이건 조회이지 편집이 아니다 — 폼 안 입력칸은 각자
 *    `disabled={!canManage}`라 권한 없는 사용자는 값을 **보기만** 한다. 여기에 권한 조건을 걸면
 *    읽기 전용 사용자만 건축허가일을 영영 못 보게 된다(사용자가 신고한 그 상태 그대로).
 */

/** 패널을 열고 시작할 대상 — `'new'`(빈 등록 폼) · 건물 id(그 동의 상세) · `null`(닫힘).
 *
 *  우선순위 (위에서부터):
 *   1. `initialNew` — URL이 명시적으로 등록을 요구했다(딥링크).
 *   2. `initialOpenId` — URL이 특정 동을 지목했다. **실재하는 동일 때만** 연다.
 *   3. 건물 0개 + 등록 권한 → `'new'`. 그때는 등록 말고 할 일이 없다.
 *   4. **건물이 정확히 1개 → 그 동을 펼친다.** 실고객 대부분이 1동이라 이 한 줄이 조회를 되살린다.
 *      한 동뿐이면 「어느 걸 볼지」 고를 일이 없으므로 자동으로 여는 것이 모호하지 않다.
 *   5. 그 외(2동 이상) → `null`. 어느 동을 펼칠지 시스템이 정하면 안 된다 — 사용자가 행을 고른다.
 *
 *  ⚠ 4는 **중복 등록 사고를 되살리지 않는다.** 그때 문제는 빈 `'new'` 폼이 늘 열려 있어 수정하려던
 *    입력이 새 등록이 된 것이었다. 여기서 여는 것은 **기존 동의 수정 폼**이라 저장이
 *    `updateBuildingAction`으로 간다 — 새 행이 생길 경로가 없다.
 *  ⚠ 비활성 동도 센다. 「보이는 동이 하나뿐인가」가 아니라 「목록에 행이 하나뿐인가」가 기준이다 —
 *    표가 그리는 것과 같은 배열을 같은 방식으로 세어야 화면과 어긋나지 않는다. */
export function initialBuildingPanelTarget(opts: {
  initialNew?: boolean
  initialOpenId?: string | null
  /** 표에 그려지는 그 배열 그대로 */
  buildings: ReadonlyArray<{ id: string }>
  canManage: boolean
}): string | null {
  const { initialNew, initialOpenId, buildings, canManage } = opts
  if (initialNew) return 'new'
  if (initialOpenId && buildings.some(b => b.id === initialOpenId)) return initialOpenId
  if (buildings.length === 0) return canManage ? 'new' : null
  if (buildings.length === 1) return buildings[0].id
  return null
}

/** 목록 표를 **감출 것인가** (2026-09-11 사용자: "두번 보일 필요는 없어").
 *
 *  위 자동 펼침을 넣자 1동 고객 화면에 같은 건물명이 **목록 행과 폼에 위아래로 두 번** 나왔다.
 *  행 하나와 그 행의 상세는 같은 한 건이므로, 표는 「고를 것이 있을 때」만 쓸모가 있다.
 *
 *  ⚠ 감추는 것은 **표(tbody)뿐이고 머리줄은 남는다** — 「건물 목록 · N개 · [+ 건물 등록]」의
 *    그 버튼이 2번째 동을 추가하는 유일한 문이다. 표째로 감추면 문이 함께 사라져,
 *    이번에 고친 결함(문이 조건에 가려 영원히 숨는 것)이 모양만 바꿔 되살아난다.
 *  ⚠ `editing === 'new'`면 **감추지 않는다**. 등록 폼으로 넘어갔을 때 기존 동이 목록에서
 *    사라지면 「내 건물이 없어졌나」가 된다 — 감추기는 되돌릴 수 있어야 한다.
 *  ⚠ 2동 이상은 감추지 않는다 — 그때 표는 **어느 동을 볼지 고르는 자리**라 중복이 아니다. */
export function shouldHideBuildingTable(opts: {
  /** 표에 그려지는 그 배열 그대로 */
  buildings: ReadonlyArray<{ id: string }>
  /** 현재 펼쳐진 대상 — `'new'` · 건물 id · `null`(닫힘) */
  editing: string | null
}): boolean {
  const { buildings, editing } = opts
  return buildings.length === 1 && editing === buildings[0].id
}
