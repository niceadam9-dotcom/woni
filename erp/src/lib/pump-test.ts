/** 펌프성능시험 — 법정 별지 4호서식 "※ 펌프성능시험(펌프 명판 및 설계치 참조)" 표
 *  (소방시설 자체점검사항 등에 관한 고시 별지 제4호서식)
 *
 *  이 표는 우리가 만든 것이 아니라 서식에 원래 있는 것이다. 37시트 엑셀은 이걸 구현했고
 *  우리 별지 4호 구현이 빠뜨렸다(소방계획서_21 R5-7 대조에서 확인) — 그래서 엑셀을 지우면
 *  실측치 기록처가 사라졌다. 판정 규칙은 서식 우측 '적정 여부' 3개 문장 그대로다.
 *
 *  DB 조회 없는 순수 함수로 둔다 — 프로브가 전 조합을 DB 없이 단언할 수 있어야 한다. */

/** 표가 붙는 설비 (item_code 앞자리 = sheet_no). 법정 서식 기준 **8개**.
 *  ⚠ 최초 구현은 6개(5·13 누락)였다. 고시 원문에서 '펌프성능시험' 9회 출현의 직전 항목코드로
 *  귀속을 확정했다 — 2-H-031→2 · 3-L-002→3 · 5-M-001→5 · 6-L-001→6 · 7-I-031→7
 *  · 8-L-041→8 · 13-G-041→13 (그리고 '4쪽 중 4쪽' 면→4). 근거: scripts/_probe-pump-table-context.mjs.
 *  숫자를 고칠 일이 있으면 원문을 다시 세라 — 구현자 6개·판정자 7개로 두 번 틀린 자리다. */
export const PUMP_TEST_SHEETS = [2, 3, 4, 5, 6, 7, 8, 13] as const
export type PumpTestSheetNo = (typeof PUMP_TEST_SHEETS)[number]

export const PUMP_SHEET_LABELS: Record<number, string> = {
  2: '옥내소화전설비', 3: '스프링클러설비', 4: '간이스프링클러설비',
  5: '화재조기진압용 스프링클러설비',
  6: '물분무소화설비', 7: '미분무소화설비', 8: '포소화설비',
  13: '옥외소화전설비',
}

export const PUMP_KINDS = ['주', '예비'] as const
export type PumpKind = (typeof PUMP_KINDS)[number]

export type PumpTestRow = {
  sheetNo: number
  pumpKind: PumpKind
  shutoffFlow: number | null
  shutoffPress: number | null
  ratedFlow: number | null
  ratedPress: number | null
  overFlow: number | null
  overPress: number | null
  setStartPress: number | null
  setStopPress: number | null
  /** 자동 판정을 덮어쓴 값 — 비어 있으면 자동값을 쓴다 */
  judge1: 'O' | 'X' | null
  judge2: 'O' | 'X' | null
  judge3: 'O' | 'X' | null
  note: string | null
}

export function emptyPumpRow(sheetNo: number, pumpKind: PumpKind): PumpTestRow {
  return {
    sheetNo, pumpKind,
    shutoffFlow: null, shutoffPress: null, ratedFlow: null, ratedPress: null,
    overFlow: null, overPress: null, setStartPress: null, setStopPress: null,
    judge1: null, judge2: null, judge3: null, note: null,
  }
}

/** 서식 우측 '적정 여부' 3개 문장 — 문서·UI가 같은 문구를 쓴다 */
export const PUMP_JUDGE_LABELS = [
  '1. 체절운전 시 토출압은 정격토출압의 140% 이하일 것',
  '2. 정격운전 시 토출량과 토출압이 규정치 이상일 것',
  '3. 정격토출량의 150%에서 토출압이 정격토출압의 65% 이상일 것',
] as const

export type PumpJudgement = {
  /** 자동 판정 — 계산할 수 없으면 null(단정하지 않는다) */
  auto: [ 'O' | 'X' | null, 'O' | 'X' | null, 'O' | 'X' | null ]
  /** 수동 보정이 있으면 그것, 없으면 자동값 — 문서에 찍히는 최종값 */
  final: [ 'O' | 'X' | null, 'O' | 'X' | null, 'O' | 'X' | null ]
  /** 자동 계산이 불가능한 이유 (UI 안내용) */
  reasons: [string | null, string | null, string | null]
}

/** 판정 계산.
 *  ①③은 정격토출압 대비 비율이라 실측치만으로 계산된다.
 *  ②의 '규정치'는 펌프 명판·설계치라서 우리 데이터에 없다 — 자동 판정하지 않고 사람이 넣는다.
 *  없는 근거로 O를 찍으면 점검을 했다는 기록만 남고 실제로는 판정이 없는 것이 된다. */
export function judgePumpTest(r: PumpTestRow): PumpJudgement {
  const auto: PumpJudgement['auto'] = [null, null, null]
  const reasons: PumpJudgement['reasons'] = [null, null, null]

  if (r.ratedPress == null || r.shutoffPress == null) {
    reasons[0] = '정격운전 토출압과 체절운전 토출압이 있어야 계산됩니다'
  } else {
    auto[0] = r.shutoffPress <= r.ratedPress * 1.4 ? 'O' : 'X'
  }

  reasons[1] = '규정치(펌프 명판·설계치)는 시스템에 없습니다 — 직접 판정해 주세요'

  if (r.ratedPress == null || r.overPress == null) {
    reasons[2] = '정격운전 토출압과 150% 운전 토출압이 있어야 계산됩니다'
  } else {
    auto[2] = r.overPress >= r.ratedPress * 0.65 ? 'O' : 'X'
  }

  return {
    auto,
    final: [r.judge1 ?? auto[0], r.judge2 ?? auto[1], r.judge3 ?? auto[2]],
    reasons,
  }
}

/** 한 행에 값이 하나라도 있는가 — 빈 행은 저장하지도, 문서에 그리지도 않는다 */
export function pumpRowHasValue(r: PumpTestRow): boolean {
  return [r.shutoffFlow, r.shutoffPress, r.ratedFlow, r.ratedPress, r.overFlow, r.overPress,
    r.setStartPress, r.setStopPress].some(v => v != null)
    || !!(r.judge1 || r.judge2 || r.judge3 || r.note?.trim())
}

/** 문서 출력용 숫자 — null은 빈 칸(0으로 찍으면 '측정했는데 0'과 구분되지 않는다) */
export function pumpNum(v: number | null | undefined): string {
  return v == null ? '' : String(v)
}
