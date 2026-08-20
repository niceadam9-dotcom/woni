/** 1.11.4 훈련·교육 실시 결과 기록부 판정 (별지 28호, 2년 보관)
 *
 *  별지 9호 2쪽 «교육훈련» 칸의 **유일한 자동 판정 원천**이다. 서식 1.11 입력 화면(plan-form111)과
 *  별지 9호 조립(report9-actions)이 이 한 곳을 공유한다 — 화면은 "전년도 기록 있음"이라 표시하는데
 *  서식은 공란인 어긋남이 구조적으로 생기지 않게 하기 위함.
 *
 *  C: 종전 판정은 `at.slice(0, 4) === '2025'` 였다. at은 자유 텍스트 입력이라
 *     '25.6.10' · ' 2025-06-10'(앞 공백) · '6월 10일'이 전부 조용히 탈락했다(기록은 있는데 서식 공란).
 *  D: 행에 실적 **연도(year)를 명시 보관**한다. 연도가 보관돼 있으면 at 표기와 무관하게 자동 체크된다.
 *     구 데이터(year 미보유)는 at에서 파생 — 기존 기록도 그대로 판정된다.
 */

export type TrainingRecordLike = {
  at?: string
  /** D: 실적 연도('YYYY') — 명시 보관분이 1순위. 미보유(구 데이터)면 at에서 파생 */
  year?: string
  kind?: string
}

/** 행의 실적 연도('YYYY', 판정 불가면 ''). year 우선, 없으면 at 문자열에서 추출 */
export function trainingRecordYear(r: TrainingRecordLike): string {
  const y = String(r.year ?? '').trim()
  if (/^(19|20)\d{2}$/.test(y)) return y
  const at = String(r.at ?? '').trim()
  const full = at.match(/(19|20)\d{2}/)          // 2025-06-10 · 2025.6.10 · 2025년 6월 10일
  if (full) return full[0]
  const short = at.match(/^(\d{2})[.\-/]/)       // 25.6.10 · 25-06-10 (2000년대만)
  return short ? `20${short[1]}` : ''
}

/** 해당 연도 실적 유무 — 구분(교육/훈련)별. kind='교육·훈련' 행은 양쪽 모두 인정 */
export function trainingDoneIn(
  records: TrainingRecordLike[] | null | undefined,
  year: number | string,
): { edu: boolean; drill: boolean; count: number } {
  const target = String(year)
  const rows = (records ?? []).filter(r => trainingRecordYear(r) === target)
  return {
    edu: rows.some(r => String(r.kind ?? '').includes('교육')),
    drill: rows.some(r => String(r.kind ?? '').includes('훈련')),
    count: rows.length,
  }
}
