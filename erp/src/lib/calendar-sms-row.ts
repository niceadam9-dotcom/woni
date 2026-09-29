/** 점검달력 데이 패널 — 이 행이 **사전 안내 문자의 대상(방문)인가** (2026-09-29)
 *
 *  데이 패널에는 방문이 아닌 일정이 섞여 있다. 「단계 일정」의 ②~⑥은 **서류 마감일**이고,
 *  거기에 "내일 방문합니다"가 나가면 사고다 — 달력이 칩을 체크해 넘기지 않고 날짜만 넘기던
 *  이유가 바로 그것이었다(소방계획서_24 Q-14). 골라 보내기를 열면서 그 방어를 여기로 옮긴다.
 *
 *  ⚠ 이 판정은 **체크박스·아이콘을 붙일지**만 정한다. 실제 발송 대상은 여전히 서버가 계산한
 *    그날 목록이고(발송 모달), 달력이 고른 고객은 그 목록의 「미리 체크」일 뿐이다.
 *
 *  JSX에 묻어 두지 않는 이유: 식별자 유무만 보는 소스 단언은 조건이 비어도 초록이다.
 *  여기로 밀어내야 **값으로** 셀 수 있다(calendar-plan-row.ts와 같은 규약). */

/** 그 날짜에 문자를 보낼 수 있는가 — 권한이 있고, 지난 날짜가 아니어야 한다.
 *  지난 방문일에 "방문합니다"는 성립하지 않는다(서버도 발송 불가로 돌려준다). */
export function smsDayOpen(opts: { canSendSms: boolean; date: string | null; today: string }): boolean {
  return opts.canSendSms && !!opts.date && opts.date >= opts.today
}

/** 「단계 일정」 행 — **1단계(점검일)만** 방문이다. 끝난 방문은 안내할 것이 없다. */
export function isSmsStepRow(
  r: { kind?: string; stepNum: number; stepStatus: string; customerId?: string },
  dayOpen: boolean,
): boolean {
  return dayOpen && r.kind === 'step' && r.stepNum === 1 && r.stepStatus !== 'completed' && !!r.customerId
}

/** 「계획 일정」 행(정기·일반·미시작 자체점검) — 전부 방문이다. 끝난 방문만 뺀다. */
export function isSmsPlanRow(p: { status: string }, dayOpen: boolean): boolean {
  return dayOpen && p.status !== 'completed'
}
