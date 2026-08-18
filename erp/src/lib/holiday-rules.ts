/** 공휴일·대체공휴일 판정 규칙 (소방계획서_25 S-3) — **순수 모듈**.
 *
 *  근거: 「관공서의 공휴일에 관한 규정」(대통령령 제36290호, 2026-04-30 개정 / 2026-05-01 시행).
 *  조문 원문은 `scripts/_probe-holiday-law.mts`로 법제처 OPEN API에서 언제든 다시 뽑을 수 있다.
 *
 *    제2조(공휴일) 1.일요일 2.국경일 3.1월 1일 4.설날 연휴 5.부처님오신날 6.노동절(5/1, 2026 신설)
 *                 7.어린이날 8.현충일 9.추석 연휴 10.기독탄신일 10의2.임기만료 선거일 11.임시공휴일
 *    제3조(대체공휴일)
 *      ① 1호: 제2·5·6·7·10호가 **토요일이나 일요일**과 겹치면
 *         2호: 제4·9호(설·추석)가 **일요일**과 겹치면          ← 토요일은 대상이 아니다
 *         3호: 제2·4~7·9·10호가 토·일이 아닌 날 **다른 공휴일**과 겹치면
 *         → 그 공휴일 다음의 첫 번째 **비공휴일**을 대체공휴일로 한다
 *      ② 대체공휴일끼리 겹치면 그 다음 첫 번째 비공휴일까지 대체공휴일로 한다
 *      ③ 대체공휴일이 토요일이면 그 다음 첫 번째 비공휴일로 미룬다
 *    → **신정·현충일·선거일·임시공휴일은 어느 호에도 없다 = 대체공휴일이 생기지 않는다.**
 *
 *  이 파일에 `'use server'`·`'server-only'`를 넣지 말 것 — 검증 스크립트가 직접 import 한다
 *  (선례: 소방계획서_18 Z-2 · 소방계획서_14 T-3-2b). 조회·fetch도 두지 않는다: 값 in → 값 out.
 */

/** 제2조 각 호 */
export type Clause =
  | 'C2'     // 국경일 — 3·1절·제헌절·광복절·개천절·한글날
  | 'C3'     // 1월 1일
  | 'C4'     // 설날 연휴 3일
  | 'C5'     // 부처님오신날
  | 'C6'     // 노동절 5월 1일 (2026-05-01 시행)
  | 'C7'     // 어린이날
  | 'C8'     // 현충일
  | 'C9'     // 추석 연휴 3일
  | 'C10'    // 기독탄신일
  | 'C10_2'  // 임기만료 선거일
  | 'C11'    // 임시공휴일

/** 한 날짜에 겹쳐 있는 공휴일 **전부**를 보관한다.
 *  names·clauses가 배열인 것이 핵심 — 종전 구현은 Map<date, name> 하나라 뒤에 온 공휴일을
 *  버렸고(2025-05-05 부처님오신날 소실), 그래서 제3조①3호 '겹침' 판정 자체가 불가능했다. */
export type BaseHoliday = {
  date: string       // 'YYYY-MM-DD' (KST 기준)
  names: string[]    // ['어린이날', '부처님오신날']
  clauses: Clause[]  // ['C7', 'C5']
}

/* ── 제3조제1항 각 호 — **법 개정 시 이 세 배열과 NAME_PERIODS만 고치면 된다** ── */
/** ①1호 — 토요일 또는 일요일과 겹치면 */
const SUB_ON_WEEKEND: readonly Clause[] = ['C2', 'C5', 'C6', 'C7', 'C10']
/** ①2호 — 일요일과 겹치면 (설·추석은 토요일 겹침이 대상이 아니다) */
const SUB_ON_SUNDAY: readonly Clause[] = ['C4', 'C9']
/** ①3호 — 평일에 다른 공휴일과 겹치면 */
const SUB_ON_OVERLAP: readonly Clause[] = ['C2', 'C4', 'C5', 'C6', 'C7', 'C9', 'C10']

/** 개별 공휴일의 지정·해제 이력 — 호(Clause) 단위로는 표현할 수 없는 것들.
 *  구간은 **연도 기준**이며 비어 있는 쪽은 무한(±∞)이다. 어느 구간에도 안 들어가면 그 해엔 공휴일이 아니다. */
const NAME_PERIODS: Record<string, Array<{ fromYear?: number; toYear?: number }>> = {
  // 2007년까지 공휴일 → 2008~2025 비공휴일(국경일이지만 공휴일 아님) → 2026 재지정(법률 제21338호, 2026-05-11 시행).
  // 비공휴일 기간을 공휴일로 넣으면 영업일이 밀려 법정 제출기한을 초과할 수 있다.
  '제헌절': [{ toYear: 2007 }, { fromYear: 2026 }],
  // 2026-05-01 시행(대통령령 제36290호). date-holidays가 제공하지 않아 어댑터가 주입하고 여기서 연도를 건다.
  '노동절': [{ fromYear: 2026 }],
}

/** 공휴일 이름 → 제2조 호. 여기 없는 이름은 clause 미상으로 두고 대체공휴일 대상에서 제외한다
 *  (모르는 것을 대체 대상으로 넣어 과다 생성하는 것보다 안전하다). */
const CLAUSE_BY_NAME: Record<string, Clause> = {
  '3·1절': 'C2', '삼일절': 'C2', '제헌절': 'C2', '광복절': 'C2', '개천절': 'C2', '한글날': 'C2',
  '신정': 'C3', '1월1일': 'C3',
  '설날': 'C4',
  '석가탄신일': 'C5', '부처님오신날': 'C5',
  '노동절': 'C6',
  '어린이날': 'C7',
  '현충일': 'C8',
  '추석': 'C9',
  '기독탄신일': 'C10', '성탄절': 'C10',
}

export function clauseOf(name: string): Clause | null {
  return CLAUSE_BY_NAME[name.trim()] ?? null
}

/** 그 해에 이 공휴일이 유효한가 — NAME_PERIODS에 없는 이름은 항상 유효 */
export function isActiveHoliday(name: string, year: number): boolean {
  const periods = NAME_PERIODS[name.trim()]
  if (!periods) return true
  return periods.some(p => (p.fromYear === undefined || year >= p.fromYear)
    && (p.toYear === undefined || year <= p.toYear))
}

/* ── 날짜 유틸 (로컬 타임존 기준 — 입력·출력 모두 'YYYY-MM-DD') ── */
const pad = (n: number) => String(n).padStart(2, '0')
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }

const has = (list: readonly Clause[], cs: Clause[]) => cs.some(c => list.includes(c))

/** 대체공휴일 이름 — 원인 공휴일을 괄호에 담는다. 특일 정보 API의 '대체공휴일(삼일절)' 표기와 맞춘다 */
const subName = (names: string[]) => `대체공휴일(${names.join('·')})`

/** 제3조 대체공휴일 산출 — 순수 함수.
 *
 *  @param base 같은 날짜가 하나로 병합된 공휴일 목록(정규화는 호출자 책임)
 *  @returns 새로 생기는 대체공휴일만. 입력은 그대로 두고 결과를 합치는 것은 호출자가 한다.
 */
export function computeSubstitutes(base: BaseHoliday[]): BaseHoliday[] {
  const publicSet = new Set(base.map(b => b.date))
  const assigned = new Set<string>()
  const out: BaseHoliday[] = []

  // 날짜 오름차순 — ②항(대체끼리 겹침)이 배정 순서에 의존하므로 정렬이 규칙의 일부다
  for (const b of [...base].sort((x, y) => x.date.localeCompare(y.date))) {
    const dow = parse(b.date).getDay()

    // 트리거 판정 — 날짜당 최대 1회(Q-5). 겹친 공휴일 수만큼 늘리지 않는다
    const triggered =
      dow === 0 ? has(SUB_ON_WEEKEND, b.clauses) || has(SUB_ON_SUNDAY, b.clauses)
      : dow === 6 ? has(SUB_ON_WEEKEND, b.clauses)
      : b.names.length >= 2 && has(SUB_ON_OVERLAP, b.clauses)   // ①3호 — 평일 겹침
    if (!triggered) continue

    // "그 공휴일 다음의 첫 번째 비공휴일"을 찾는다.
    //  · 일요일을 건너뛰는 것은 주말이라서가 아니라 **제2조제1호가 일요일을 공휴일로 정하기 때문**이다
    //  · 토요일을 건너뛰는 것은 제3조제3항 (토요일은 비공휴일이지만 대체공휴일이 될 수 없다)
    //  · 이미 배정된 날을 건너뛰는 것은 제3조제2항
    const cur = parse(b.date)
    let found: string | null = null
    for (let i = 0; i < 30; i++) {          // 상한 — 연휴+연속 대체가 겹쳐도 30일이면 반드시 빠져나온다
      cur.setDate(cur.getDate() + 1)
      const iso = toISO(cur)
      const d = cur.getDay()
      if (d === 0 || d === 6) continue
      if (publicSet.has(iso) || assigned.has(iso)) continue
      found = iso
      break
    }
    if (!found) continue                     // 도달 불가 — 조용히 넘긴다(과다 생성보다 누락이 안전)

    assigned.add(found)
    out.push({ date: found, names: [subName(b.names)], clauses: [] })
    // clauses를 비워 두는 이유: 제3조①은 제2조 각 호만 대상이라 **대체공휴일이 다시 대체를 낳지 않는다**
  }
  return out
}

/** 같은 날짜의 공휴일을 하나로 접는다 — 이름·호를 모두 보존한다(중복 제거만).
 *  API(같은 locdate 2행)와 라이브러리(연휴 확장) 양쪽 입력에 공통으로 쓴다. */
export function mergeByDate(items: Array<{ date: string; name: string; clause?: Clause | null }>): BaseHoliday[] {
  const map = new Map<string, BaseHoliday>()
  for (const it of items) {
    const cur = map.get(it.date)
    const clause = it.clause ?? clauseOf(it.name)
    if (!cur) {
      map.set(it.date, { date: it.date, names: [it.name], clauses: clause ? [clause] : [] })
      continue
    }
    if (!cur.names.includes(it.name)) cur.names.push(it.name)
    if (clause && !cur.clauses.includes(clause)) cur.clauses.push(clause)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** BaseHoliday[] → 저장·소비 형태. 겹친 이름은 '·'로 잇는다 */
export function flatten(list: BaseHoliday[]): Array<{ date: string; name: string }> {
  return [...list]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(b => ({ date: b.date, name: b.names.join('·') }))
}
