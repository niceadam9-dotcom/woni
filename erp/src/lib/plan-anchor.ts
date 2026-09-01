/** 연간 점검계획의 **기산점** 해석 — 단일 원천 (순수·무의존).
 *
 *  ## 왜 이 파일이 생겼나
 *
 *  법령(시행규칙 [별표 3])은 종합점검 시기를 **건축물 사용승인일이 속하는 달**로, 작동점검을
 *  **그로부터 6개월이 되는 달**로 정한다. 그런데 이 앱은 2026-07-14에 사용승인일 폴백을 걷어내고
 *  `plan_anchor_date`(점검계획일)만 기산점으로 썼다 — 즉 **법정 시기와 무관한 달**에 종합점검이
 *  배치될 수 있었다.
 *
 *  ## 왜 단순히 뒤집지 않았나 (B안)
 *
 *  실측했다. 스테이징 활성 고객 301건 중 두 날짜가 다 있는 246건에서 **(월) 불일치가 88건(35.8%)**
 *  이다. 그리고 그 불일치는 데이터 썩음이 아니라 **의도된 운영 결정**이다 — 계획일이
 *  `2026-01-08`·`2026-01-09`·`2026-01-13`처럼 순차로 깔려 있다. 점검업체가 300개 고객의 방문을
 *  열두 달로 **분산**한 흔적이다. 그대로 뒤집으면 88건의 연간 방문 일정이 한꺼번에 다른 달로 옮겨간다.
 *
 *  그래서 축을 **고객별로** 가른다: `plan_anchor_manual`이 켜진 고객은 사람이 정한 날을 계속 쓰고,
 *  꺼진 고객만 법정 축(사용승인일)을 탄다. 마이그레이션이 기존 불일치 고객을 `true`로 백필하므로
 *  **기존 일정은 한 건도 안 움직이고 신규 고객만 법정 축으로 들어온다.**
 *
 *  ## 컬럼이 아직 없을 때 (중요)
 *
 *  `plan_anchor_manual`은 마이그레이션 155가 적용돼야 존재한다. 적용 전에는 값이 `undefined`로
 *  들어오고, 그때 이 함수는 **현행 동작을 그대로 재현**한다(점검계획일 최우선). 즉 코드를 먼저
 *  배포해도 기산점은 한 칸도 안 움직인다 — 154가 세운 '배포 순서 자유' 규약과 같은 방식이다.
 *  ⚠ 이 폴백을 지우면 마이그레이션 전에 코드가 뜨는 순간 전 고객 일정이 재배치된다.
 */

export type AnchorSource =
  | 'approval'  // 사용승인일 — 법정 축
  | 'manual'    // 점검계획일 — 사람이 지정한 예외(또는 마이그레이션 전 레거시)
  | 'first'     // 최초 점검시작일 — 둘 다 없을 때의 마지막 폴백
  | null        // 기산점 없음 → 계획을 생성하지 않는다

export type AnchorResolution = {
  date: string | null
  source: AnchorSource
  /** 사용승인일과 점검계획일의 **월**이 다르다 — 화면에 배지로 드러내 사람이 알아채게 한다.
   *  `source`와 무관하게 계산한다(어느 쪽을 쓰든 '어긋나 있다'는 사실은 같다). */
  divergent: boolean
}

export type AnchorInput = {
  use_approval_date?: string | null
  plan_anchor_date?: string | null
  /** 마이그레이션 155 컬럼. **undefined/null = 컬럼 미적용** → 레거시 동작(점검계획일 최우선) */
  plan_anchor_manual?: boolean | null
  firstInspectionStart?: string | null
}

const month = (d?: string | null): number | null =>
  d && d.length >= 7 ? Number(d.slice(5, 7)) : null

/** 기산점 해석 — 우선순위는 `plan_anchor_manual` 축에 따라 갈린다. */
export function resolveAnchor(c: AnchorInput): AnchorResolution {
  const approval = c.use_approval_date || null
  const manualDate = c.plan_anchor_date || null
  const first = c.firstInspectionStart || null

  const ma = month(approval), mp = month(manualDate)
  const divergent = ma !== null && mp !== null && ma !== mp

  // 컬럼 미적용(undefined/null)은 **레거시**다 — 사용승인일을 쓰지 않던 그때 그대로.
  const legacy = c.plan_anchor_manual === undefined || c.plan_anchor_manual === null
  const preferManual = legacy || c.plan_anchor_manual === true

  const order: Array<[string | null, AnchorSource]> = preferManual
    ? [[manualDate, 'manual'], [legacy ? null : approval, 'approval'], [first, 'first']]
    : [[approval, 'approval'], [manualDate, 'manual'], [first, 'first']]

  for (const [date, source] of order) if (date) return { date, source, divergent }
  return { date: null, source: null, divergent }
}

/** 기산점이 **실제로 바뀌었는가** — 계획 재계산·확정 일정 팝업의 방아쇠.
 *
 *  ⚠ 필드 하나를 보고 판정하면 안 된다. 종전 코드는 `plan_anchor_date`만 비교했는데,
 *  기산점이 사용승인일 축으로 옮겨간 뒤로 그 판정은 **사용승인일 변경을 통째로 놓친다**:
 *   · 기존 계획의 월이 안 고쳐지고
 *   · 확정 일정 보호 팝업이 안 뜨며
 *   · `plan_id`가 (연,월) 단위라 다음 생성 때 **새 월에 회차가 하나 더** 생긴다
 *     (충돌 키가 `plan_id,customer_id,sequence_num`이라 다른 달은 충돌로 안 걸린다)
 *
 *  반대로 **바뀌지 않은 것도 정확히 알아야** 한다 — `manual=true`인 고객의 사용승인일을 고치면
 *  기산점은 그대로이므로 재계산도 팝업도 띄우면 안 된다(쓸데없이 일정을 흔든다).
 *  그래서 필드 비교가 아니라 **해석 결과**를 비교한다. */
export function anchorChanged(before: AnchorInput, after: AnchorInput): boolean {
  return resolveAnchor(before).date !== resolveAnchor(after).date
}

/** 화면 표기용 짧은 라벨 — 기산점이 어디서 왔는지 사람이 알 수 있게 한다. */
export function anchorSourceLabel(source: AnchorSource): string {
  return source === 'approval' ? '사용승인일'
    : source === 'manual' ? '점검계획일'
    : source === 'first' ? '최초 점검일'
    : '없음'
}
