/** 방화구획 종류 — 화면(1.5)·PDF·엑셀의 **단일 원천**.
 *
 *  네 갈래다: 면적별 · 층별 · 면적별·층별 · 해당없음.
 *
 *  ⭐ '면적별·층별'은 **새 상자가 아니다.** 법정 서식 1.5.1은 `□ 면적별`과 `□ 층별`을 따로 두고
 *    둘을 함께 체크하는 것이 '둘 다'의 표기다. 그래서 산출물 축은 키를 그대로 찍지 않고
 *    `compartmentHasArea/Floor`로 상자 축으로 편다 — 키를 늘려도 양식의 상자는 둘뿐이다.
 *
 *  ⚠ `''`(미입력)과 `'none'`(해당없음)은 **다르다**. 앞은 아직 아무 상자도 체크하지 않은
 *    상태이고, 뒤는 '해당 없음'이라고 답한 상태다. 유·무 칸이 그 둘을 갈라 인쇄한다.
 */
export const COMPARTMENT_KINDS = [
  { key: 'area', label: '면적별' },
  { key: 'floor', label: '층별' },
  { key: 'area_floor', label: '면적별·층별' },
  { key: 'none', label: '해당없음' },
] as const

export type CompartmentKind = (typeof COMPARTMENT_KINDS)[number]['key']
export type CompartmentValue = CompartmentKind | ''

export const compartmentHasArea = (c: CompartmentValue | undefined | null): boolean =>
  c === 'area' || c === 'area_floor'

export const compartmentHasFloor = (c: CompartmentValue | undefined | null): boolean =>
  c === 'floor' || c === 'area_floor'

/** 서식 1.5.1의 '해당유무' 칸 — 미입력이면 `null`(유도 무도 체크하지 않는다) */
export const compartmentApplies = (c: CompartmentValue | undefined | null): boolean | null =>
  !c ? null : c !== 'none'

/** 화면·요약용 한 줄 표기. 미입력이면 빈 문자열 */
export const compartmentLabel = (c: CompartmentValue | undefined | null): string =>
  COMPARTMENT_KINDS.find(k => k.key === c)?.label ?? ''
