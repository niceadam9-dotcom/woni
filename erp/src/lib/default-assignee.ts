/**
 * 기본 담당자 — 「일반관리」 고객이 **미배정으로 남는 것**을 막는 규칙 (2026-09-15 사용자 확정).
 *
 * 의존이 0이라 서버·클라이언트·검사가 모두 이 한 곳을 부른다. 규칙을 두 곳에 적으면
 * 「등록 화면은 채웠는데 일괄 적용은 안 채운다」 같은 어긋남이 생긴다.
 *
 * ## 왜 「일반관리」만인가
 * 1회성 점검이라 담당을 정하는 절차 자체가 없다. 스테이징 실측(2026-09-15): 활성 304명 중
 * 미배정 36명인데 그중 「일반관리」는 2명뿐이고 나머지 34명은 작동/종합이며 **전원 영업권
 * (양평군) 밖**이다(홍천군 22·군부대 다수). 원인이 둘이라 축을 섞지 않는다 —
 * 영업권 밖은 지역별 배정 화면이 다루는 **별건**이다.
 * 「일반관리」 5명 중 3명은 이미 대표에게 배정돼 있어 **관행이 이미 그러하다**.
 *
 * ## 채우기만 하면 문제를 숨기는 것이 된다
 * 지금 빨간 「미배정」이 "담당이 정해지지 않았다"를 알리는 **유일한 신호**다. 그대로 채우면
 * 그 신호가 사라진다. 그래서 `assigned_source`로 **사람이 고른 것**과 **기본값으로 채운 것**을
 * 가르고, 화면이 「(기본)」을 붙인다 — 나중에 정식 배정으로 바꿀 대상을 찾는 유일한 축이다.
 */

/** 담당 배정의 출처. NULL(미배정·출처 미상)은 타입 밖에 둔다 — 호출부가 `null`을 그대로 넘긴다. */
export type AssignSource = 'manual' | 'default'

/** 이 고객을 기본 담당자로 채워야 하는가 — 등록·수정·일괄 적용이 **같은 이 판정**을 쓴다.
 *
 *  🚨 경계가 셋이고 하나라도 무너지면 법정 문서의 담당이 거짓이 된다:
 *   ① 기본 담당자가 설정되지 않았으면 **아무 일도 하지 않는다**(종전 동작: 미배정 그대로).
 *      설정이 비었는데 누군가를 골라 넣으면 그건 지어내는 것이다.
 *   ② **이미 배정된 고객은 건드리지 않는다.** 사람이 고른 값을 기본값이 덮으면 되돌릴 수 없다.
 *   ③ 「일반관리」가 아니면 채우지 않는다 — 작동/종합의 미배정은 사유가 다르다(영업권 밖).
 */
export function shouldFillDefaultAssignee(
  customer: { inspection_type?: string | null; assigned_employee_id?: string | null },
  defaultAssigneeId: string | null | undefined,
): boolean {
  if (!defaultAssigneeId) return false                       // ①
  if (customer.assigned_employee_id) return false            // ②
  return customer.inspection_type === '일반관리'              // ③
}

/** 화면에 보일 담당 이름 — 「(기본)」은 **출처가 default일 때만** 붙는다.
 *
 *  ⚠ 문구가 「(일반)」이 아닌 이유: 화면에서 「일반」은 이미 **점검유형 라벨**이다
 *    (`types/index.ts` — `'일반관리' → '일반'`). 담당 옆에 「(일반)」이 붙으면 유형을 말하는지
 *    배정 출처를 말하는지 읽는 사람이 가를 수 없다. 「(기본)」은 뜻이 하나다.
 *  ⚠ `source`가 null이면 그냥 이름만 — 옛 행(출처 미상)이 없던 표식을 얻지 않는다.
 *    안전한 방향으로 퇴화한다(모르면 표시하지 않는다). */
export function assigneeLabel(
  name: string | null | undefined,
  source: string | null | undefined,
): string {
  if (!name) return '미배정'
  return source === 'default' ? `${name} (기본)` : name
}

/** 일괄 적용 대상 — 목록에서 **미리보기 수**와 **실제 적용 집합**이 같은 함수에서 나온다.
 *  화면이 "2명에게 적용됩니다"라 말하고 3명을 바꾸는 일이 없도록, 세는 쪽과 쓰는 쪽을 가르지 않는다. */
export function defaultAssigneeTargets<T extends { inspection_type?: string | null; assigned_employee_id?: string | null }>(
  customers: readonly T[],
  defaultAssigneeId: string | null | undefined,
): T[] {
  return customers.filter(c => shouldFillDefaultAssignee(c, defaultAssigneeId))
}
