/** 「YYYY년 M월」 — 연월 표기의 단일 원천.
 *
 *  이 형식은 화면(`components/ui/fields.tsx`의 `MonthField`)이 **쓰고**, 소방계획서 PDF·엑셀이
 *  **읽는다**. 종전엔 읽는 쪽이 없어 규칙이 `fields.tsx` 안에만 있었는데, 엑셀 서식 1.10.1이
 *  이 값을 `년`·`월` 자구가 박힌 칸에 **쪼개 넣어야** 해서 파싱이 필요해졌다. 두 번째 정규식을
 *  만들지 않고 규칙을 여기로 올린다.
 *
 *  ⚠ 의존이 없다(`purpose-label.ts`와 같은 갈래) — 엑셀 격자(manifest)를 물면 그 축이 밀릴 때
 *    PDF 경로까지 500이 된다(`fire-plan-xlsx-values.ts` §표기 주석 참조).
 */

export type PlanMonth = { year: string; month: string }

/** ⚠ 앞뒤를 고정하지 않는다 — `MonthField`가 달력 칩을 채울 때 쓰던 규칙 그대로다.
 *  느슨한 대신, 읽는 쪽은 `planMonthParts`의 왕복 대조로 손실을 막는다. */
const PLAN_MONTH_RE = /(\d{4})년\s*(\d{1,2})월/

export function parsePlanMonth(v: string | null | undefined): PlanMonth | null {
  const m = PLAN_MONTH_RE.exec(v ?? '')
  return m ? { year: m[1], month: String(Number(m[2])) } : null
}

/** 저장 표기 — `MonthField`가 쓰는 그 형식(앞자리 0 없음) */
export function formatPlanMonth(year: string | number, month: string | number): string {
  return `${year}년 ${Number(month)}월`
}

/**
 * 값을 `년`·`월` 두 조각으로 쪼갠다 — **왕복이 원문과 글자 그대로 같을 때만**.
 *
 * 🚨 이 왕복 대조가 핵심이다. 위 정규식은 느슨해서 `2026년 7월경` 에서도 `{2026, 7}`을 뽑는데,
 *   그 조각만 서식 칸에 넣으면 `경`이 **조용히 사라진다**. 원문과 다르면 `null`을 돌려
 *   호출부가 원문을 통째로 인쇄하게 한다 — 자구를 지키자고 값을 잃지 않는다.
 *
 * ⭐ 실데이터 실측(2026-09-14): `sections.inspection`의 연월 4종 전부가 엄격 형식이었고
 *   불일치 0건이다. 즉 이 폴백은 평소엔 돌지 않는다 — 레거시 자유 텍스트를 위한 안전망이다.
 */
export function planMonthParts(v: string | null | undefined): PlanMonth | null {
  const s = (v ?? '').trim()
  if (!s) return null
  const p = parsePlanMonth(s)
  if (!p) return null
  return formatPlanMonth(p.year, p.month) === s ? p : null
}
