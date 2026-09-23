/** 결과보고서 엑셀 고지(`X-Workbook-Missing`)를 **채울 수 있는 것 / 없는 것**으로 가른다.
 *  순수·무의존 — 화면(클라이언트)과 검사가 같이 쓴다.
 *
 *  ## 왜 필요한가
 *  라우트는 이미 「무엇이 비었나」를 정확히 말한다. 그런데 지금은 **한 줄짜리 평문**이라
 *  화면이 그걸 읽기만 하고 **채우러 갈 길을 못 준다**. 그리고 그 안에는 성질이 다른 셋이 섞여 있다:
 *    · 사용자가 채울 수 있는 것 — 「점검표 미입력 5종 → 기본 ○ 인쇄」
 *    · **채울 수 없는 것** — 「보조 점검인력 8번째부터 미표기(허브 7행)」처럼 **서식 행수 상한**
 *    · 누락이 아닌 **안내** — 「문서번호 자동 제안(승 진 2609-1)」
 *  가르지 않고 「입력하세요」로 내보내면 사용자가 **못 고치는 것을 고치려 든다**.
 *
 *  ## 🚨 추측하지 않는다
 *  `fire-plan-notice.ts:31~35`가 남긴 사고(장소명 「3.5층창고」를 시트 3.5로 읽어 엉뚱한 화면으로
 *  보냄)를 그대로 피한다. 분류는 **고정 접두 매칭**뿐이고, 표에 없으면 `unknown`으로 두어
 *  **글자로만 남긴다**(지금과 똑같은 모습이라 아무것도 나빠지지 않는다).
 *
 *  ## 실측이 정한 것 (2026-09-22 · 스테이징 자체점검 31건 전수)
 *  - **31/31에 고지가 있다.** 고지는 예외가 아니라 상시다.
 *  - **27/31이 절단된다**(`…외 N자 생략`). 다만 라우트가 `' | '` 경계로 되감아 자르므로
 *    **조각이 문장 중간에서 끊기지 않는다** — 꼬리만 독립 조각으로 붙는다.
 *  - 「회사 팩스 미등록」·「대리인 생년월일 미입력」이 **31/31**이다. 회차가 아니라 **회사·직원**
 *    축이라 매번 같은 자리에 띄우면 소음이 된다 → `scope: 'org'`로 갈라 화면이 낮춰 그릴 수 있게 한다.
 */

export type WorkbookNoticeKind =
  /** 사용자가 채울 수 있다 — 목적지가 있다 */
  | 'fixable'
  /** 서식 행수 상한·자산 부재 — **채울 수 없다**. 알리기만 한다 */
  | 'cap'
  /** 누락이 아니라 안내·요약 (문서번호 제안·착지 집계·자동 정정) */
  | 'info'
  /** 600자 절단 꼬리 */
  | 'truncated'
  /** 표에 없다 — 글자로만 남긴다(목적지를 지어내지 않는다) */
  | 'unknown'

/** 어디로 보내야 채울 수 있는가 */
export type WorkbookFixTarget =
  | 'sheet'        // 점검표 입력
  | 'facilities'   // 1.4 소방시설 대장(공통 탭)
  | 'common11'     // 1.1 일반현황(공통 탭) — 송달 동의·대상물 급수가 여기서 입력된다
  | 'defects'      // 불량·사진 (⑤)
  | 'period'       // 점검기간(시작·종료일)
  | 'annex'        // 별지 입력(④ 제출 단계)
  | 'crew'         // 점검 참여자
  | 'info'         // 고객 기본정보
  | 'contacts'     // 관계인 탭
  | 'buildings'    // 건물·시설 탭
  | 'reports'      // 보고서 탭(전년도 업무 실시사항)
  | 'plan'         // 소방계획서 탭
  | 'assets'       // 지도·사진
  | 'org'          // 본사 정보·직원 관리 (회차 밖)

export type WorkbookNoticePart = {
  /** 원문 조각 — 분류가 뭐든 **글자는 그대로 보존한다** */
  text: string
  kind: WorkbookNoticeKind
  target?: WorkbookFixTarget
  /** 칩에 쓸 짧은 글씨 */
  label?: string
  /** 회차 축인가, 고객 축인가, 회사 축인가 — 화면이 묶어 그릴 때 쓴다 */
  scope?: 'inspection' | 'customer' | 'org'
}

export type Rule = {
  /** 고정 접두/패턴 — 추측 금지, 소스 리터럴과 실측 표본에서만 옮겨 적는다 */
  test: RegExp
  kind: WorkbookNoticeKind
  target?: WorkbookFixTarget
  label?: string
  scope?: WorkbookNoticePart['scope']
}

/** 분류 규칙.
 *
 *  🚨 **규칙은 서로 배타적이어야 한다** — 한 문장이 둘 이상에 걸리면 `find`가 먼저 쓴 것을 집고,
 *    그 「먼저」는 줄 순서라는 우연이다. 나중에 넓은 패턴을 하나 끼워 넣는 순간 조용히 가려진다.
 *    검사가 실측 표본 전수로 **두 규칙에 걸리는 문장이 0건**임을 단언한다(그래서 이 배열을 수출한다).
 *    새 규칙을 더할 때는 기존 것과 겹치지 않게 **앵커(^…$)를 충분히** 걸어라. */
export const WORKBOOK_NOTICE_RULES: readonly Rule[] = [
  // ── 절단 꼬리 ───────────────────────────────────────────────
  { test: /^…외 \d+자 생략$/, kind: 'truncated' },

  // ── 안내·요약 (누락이 아니다) ────────────────────────────────
  // 착지 집계 — 이 회차 전체 요약이라 목적지가 없다
  { test: /^점검표 항목 \d+건 중 \d+건 반영/, kind: 'info', scope: 'inspection' },
  // 문서번호는 **자동으로 제안된 값**이다. 「채우세요」로 내보내면 멀쩡한 것을 고치러 간다
  { test: /^문서번호 자동 제안\(/, kind: 'info', scope: 'inspection' },
  // 대장에 없는 설비의 응답을 ／로 눌러 인쇄한 것 — 제품이 이미 옳게 처리했다는 알림
  { test: /^미설치 항목 \d+건\(.*번지지 않도록 ／로 인쇄됨$/, kind: 'info', scope: 'inspection' },

  // ── 서식 행수 상한·자산 부재 (채울 수 없다) ───────────────────
  { test: /\(허브 7행\)$/, kind: 'cap' },
  { test: /\(엑셀 \d+행 상한\)/, kind: 'cap' },
  { test: /\(현1 \d+행 상한\)/, kind: 'cap' },
  { test: /\(시트 상한 \d+건\)/, kind: 'cap' },
  { test: /^목차 미표기:/, kind: 'cap' },
  { test: /^점검표 서식 미동봉\(자산 없음\):/, kind: 'cap' },

  // ── 점검표 (회차 축) ────────────────────────────────────────
  { test: /^점검표 미입력 \d+종 → 기본 ○ 인쇄/, kind: 'fixable', target: 'sheet', label: '점검표 입력', scope: 'inspection' },
  { test: /^설치 설비 중 점검표 무응답 \d+건/, kind: 'fixable', target: 'sheet', label: '점검표 입력', scope: 'inspection' },
  { test: /^점검표 항목 미입력 \d+건/, kind: 'fixable', target: 'sheet', label: '점검표 입력', scope: 'inspection' },
  { test: /^점검표 응답$/, kind: 'fixable', target: 'sheet', label: '점검표 입력', scope: 'inspection' },

  // ── 설비 대장 (고객 축) ─────────────────────────────────────
  { test: /^대장 미체크인데 점검표 응답 있음 \d+건/, kind: 'fixable', target: 'facilities', label: '설비 대장', scope: 'customer' },
  { test: /^설비 대장 미등록 시트 /, kind: 'fixable', target: 'facilities', label: '설비 대장', scope: 'customer' },
  { test: /특별피난계단 전실 제원은 입력했는데 개소가 비어 있음/, kind: 'fixable', target: 'facilities', label: '세부제원', scope: 'customer' },
  { test: /주차장 입력값.*반영/, kind: 'fixable', target: 'buildings', label: '건물 정보', scope: 'customer' },

  // ── 불량·사진 (회차 축) ─────────────────────────────────────
  { test: /^불량사진 \d+장 누락/, kind: 'fixable', target: 'defects', label: '불량 사진', scope: 'inspection' },
  { test: /^불량사진 시트 미첨부/, kind: 'fixable', target: 'defects', label: '불량 사진', scope: 'inspection' },

  // ── 점검 기본값 (회차 축) ───────────────────────────────────
  { test: /^점검기간$/, kind: 'fixable', target: 'period', label: '점검기간', scope: 'inspection' },
  { test: /^점검일자 없음 — 점검 시작·종료일 미입력$/, kind: 'fixable', target: 'period', label: '점검기간', scope: 'inspection' },
  { test: /^주된 점검인력$/, kind: 'fixable', target: 'crew', label: '점검 참여자', scope: 'inspection' },
  { test: /^대리인\(주된 점검인력\) 없음/, kind: 'fixable', target: 'crew', label: '점검 참여자', scope: 'inspection' },

  // ── 고객 기본정보 ──────────────────────────────────────────
  { test: /^주소$/, kind: 'fixable', target: 'info', label: '기본정보', scope: 'customer' },
  { test: /^사용승인일$/, kind: 'fixable', target: 'info', label: '기본정보', scope: 'customer' },
  // 송달 동의·대상물 급수는 **공통 탭 1.1**에서 입력한다(2026-09-23 실측 — 기본정보 폼에는 두 칸이 없다.
  //   종전 목적지 'info'는 채우러 간 사람이 칸을 못 찾는 화면이었다. fire-plan-chip-target의 consent와 같은 자리)
  { test: /^송달 동의$/, kind: 'fixable', target: 'common11', label: '공통 1.1', scope: 'customer' },
  { test: /^소방안전관리등급\(대상물 급수\) 미입력/, kind: 'fixable', target: 'common11', label: '공통 1.1', scope: 'customer' },
  { test: /^관할 소방서 없음/, kind: 'fixable', target: 'info', label: '기본정보', scope: 'customer' },
  { test: /^고객명\(건물명\) 없음$/, kind: 'fixable', target: 'info', label: '기본정보', scope: 'customer' },
  { test: /^수신\(고객명\) 없음$/, kind: 'fixable', target: 'info', label: '기본정보', scope: 'customer' },
  { test: /^수신 수동 저장값\(/, kind: 'fixable', target: 'annex', label: '별지 입력', scope: 'inspection' },

  // ── 건물 ───────────────────────────────────────────────────
  { test: /^건축허가일$/, kind: 'fixable', target: 'buildings', label: '건물 정보', scope: 'customer' },

  // ── 관계인 ─────────────────────────────────────────────────
  { test: /^소방안전관리자 선임 형태 미입력/, kind: 'fixable', target: 'contacts', label: '관계인', scope: 'customer' },
  { test: /^소방안전관리자 미지정/, kind: 'fixable', target: 'contacts', label: '관계인', scope: 'customer' },
  { test: /^소방안전관리자 전화번호 없음/, kind: 'fixable', target: 'contacts', label: '관계인', scope: 'customer' },
  { test: /^소방안전관리자 최근 교육이수일 미입력/, kind: 'fixable', target: 'contacts', label: '관계인', scope: 'customer' },
  { test: /^관계인 성명 없음/, kind: 'fixable', target: 'contacts', label: '관계인', scope: 'customer' },
  { test: /^관계인 생년월일 미입력/, kind: 'fixable', target: 'contacts', label: '관계인', scope: 'customer' },

  // ── 보고서 탭 (전년도 업무 실시사항) ─────────────────────────
  { test: /^전년도\(\d+\) 완료된 자체점검 이력 없음/, kind: 'fixable', target: 'reports', label: '보고서 탭', scope: 'customer' },
  { test: /^전년도\(\d+\) 소방안전교육 실적 없음/, kind: 'fixable', target: 'reports', label: '보고서 탭', scope: 'customer' },
  { test: /^전년도\(\d+\) 소방훈련 실적 없음/, kind: 'fixable', target: 'reports', label: '보고서 탭', scope: 'customer' },

  // ── 소방계획서 ─────────────────────────────────────────────
  { test: /^소방계획서 서식 입력 없음/, kind: 'fixable', target: 'plan', label: '소방계획서', scope: 'customer' },

  // ── 지도·사진 ──────────────────────────────────────────────
  { test: /^표지 건물 사진 미등록/, kind: 'fixable', target: 'assets', label: '지도·사진', scope: 'customer' },

  // ── 회사·직원 (회차 밖 — 31/31에 상시로 뜬다. 화면은 낮춰 그린다) ──
  { test: /^회사 팩스 미등록/, kind: 'fixable', target: 'org', label: '본사 정보', scope: 'org' },
  { test: /^대표자 미등록/, kind: 'fixable', target: 'org', label: '본사 정보', scope: 'org' },
  { test: /^자격정보$/, kind: 'fixable', target: 'org', label: '직원 관리', scope: 'org' },
  { test: /^대리인 생년월일 미입력/, kind: 'fixable', target: 'org', label: '직원 관리', scope: 'org' },
]

/** 고지 원문 → 조각별 분류. 빈 문자열이면 빈 배열. */
export function parseWorkbookNotice(raw: string): WorkbookNoticePart[] {
  if (!raw || !raw.trim()) return []
  return raw.split(' | ').map(s => s.trim()).filter(Boolean).map(text => {
    const hit = WORKBOOK_NOTICE_RULES.find(r => r.test.test(text))
    if (!hit) return { text, kind: 'unknown' as const }
    return { text, kind: hit.kind, target: hit.target, label: hit.label, scope: hit.scope }
  })
}

/** 채우러 갈 수 있는 조각 수 — 화면이 「N군데 비었습니다」로 쓴다 */
export function fixableParts(parts: readonly WorkbookNoticePart[]): WorkbookNoticePart[] {
  return parts.filter(p => p.kind === 'fixable')
}
/** 채울 수 없는 조각(서식 상한) — 별도 덩이로 그려 사용자가 찾아 헤매지 않게 한다 */
export function capParts(parts: readonly WorkbookNoticePart[]): WorkbookNoticePart[] {
  return parts.filter(p => p.kind === 'cap')
}

/** 목적지 → 실제 주소. **여기 한 곳**에서만 만든다.
 *
 *  ⚠ 점검 쪽 목적지는 `stepInputLink`를 그대로 태운다 — 단계별 입력면의 정본이고,
 *    거기 주소를 여기 베껴 적으면 한쪽만 고쳐지는 순간 「채우러 갔는데 그 칸이 없는」 화면이 된다.
 *  ⚠ `from`은 **호출부가 붙인다**(달력·작업대가 각자 다른 곳으로 돌아간다).
 */
export function workbookFixHref(
  target: WorkbookFixTarget,
  ids: { inspectionId: string; customerId: string },
  stepInputLink: (inspectionId: string, stepNum: number) => { href: string } | null,
): string {
  const { inspectionId: i, customerId: c } = ids
  const step = (n: number) => stepInputLink(i, n)?.href ?? `/inspections/${i}?step=${n}`
  switch (target) {
    case 'sheet':      return step(1)                         // 점검표 입력 전용 페이지
    case 'defects':    return step(5)                         // 불량 조치 + 사진
    case 'crew':       return step(2)                         // ②「참여 인력」 — 참여자는 그 슬롯 하나다
    case 'period':     return step(4)                         // 기한·점검기간이 ④에 모여 있다
    case 'annex':      return step(4)                         // 별지 9호 입력도 ④
    case 'facilities': return `/customers/${c}?tab=facilities&form=1.4`
    case 'common11':   return `/customers/${c}?tab=facilities&form=1.1`
    case 'buildings':  return `/customers/${c}?tab=buildings`
    case 'contacts':   return `/customers/${c}?tab=contacts`
    case 'reports':    return `/customers/${c}?tab=reports&form=duty`
    case 'plan':       return `/customers/${c}?tab=plan`
    case 'assets':     return `/customers/${c}?tab=plan&form=1.3`  // 지도·사진은 서식 1.3 안에 있다
    case 'info':       return `/customers/${c}?tab=info`
    case 'org':        return '/settings'                     // 본사 정보(직원 자격은 /admin/users)
  }
}

/** 화면이 그릴 **네 덩이**로 가른다 — 분리 규칙은 JSX가 아니라 여기에 둔다.
 *
 *  🚨 컴포넌트 안에서 `filter`로 갈랐더니 변이(`caps = []`)가 그대로 살아남았다 —
 *    JSX에 그 글자가 남아 있어 **모양만 보는 단언이 초록**이었다(2026-09-22).
 *    규칙이 순수 함수로 나와 있어야 실제 동작을 단언할 수 있다.
 *  ⚠ `org`를 `fixable`에서 **빼는** 것이 요점이다: 회사·직원 축은 실측상 31/31에 상시로 떠서
 *    회차와 같은 무게로 그리면 정작 이번에 채울 것을 가린다. */
export function splitNoticeParts(parts: readonly WorkbookNoticePart[]): {
  fixable: WorkbookNoticePart[]
  org: WorkbookNoticePart[]
  caps: WorkbookNoticePart[]
  rest: WorkbookNoticePart[]
} {
  return {
    fixable: parts.filter(p => p.kind === 'fixable' && p.scope !== 'org'),
    org: parts.filter(p => p.kind === 'fixable' && p.scope === 'org'),
    caps: parts.filter(p => p.kind === 'cap'),
    rest: parts.filter(p => p.kind === 'unknown'),
  }
}

// ── 보고서 준비도 — 고객 탭이 **엑셀을 받기 전에** 빈칸을 알려 준다 (2026-09-23 사용자 요청) ──
//
// 사용자: 「기본정보~보고서 탭을 입력하도록 유도해야 한다 — 보고서 엑셀을 채우려면」.
// 종전엔 빈칸을 **엑셀을 받은 뒤에야** 알 수 있었다(고지는 다운로드 헤더에서만 만들어진다).
// ⚠ 규칙을 새로 적지 않는다 — 위 분류표가 정한 목적지를 탭 키로 옮길 뿐이다. 두 벌이면
//   「탭은 다 채웠다는데 엑셀은 비었다」가 생긴다.

/** 보고서 엑셀을 채우는 고객 탭 — **탭 바 순서 그대로**(「다음 빈 탭」이 이 순서로 걷는다) */
export const REPORT_INPUT_TABS = ['info', 'buildings', 'contacts', 'facilities', 'reports'] as const
export type ReportInputTab = typeof REPORT_INPUT_TABS[number]

/** 목적지 → 고객 탭. 여기 없는 목적지(회차 축·소방계획서·본사)는 탭 뱃지에 **세지 않는다** —
 *  회차 축은 달력 단계 버튼이, 소방계획서는 자기 탭 뱃지(n/12)가, 본사는 설정 화면이 맡는다. */
const TAB_OF_TARGET: Partial<Record<WorkbookFixTarget, ReportInputTab>> = {
  info: 'info',
  buildings: 'buildings',
  contacts: 'contacts',
  facilities: 'facilities',
  common11: 'facilities',
  reports: 'reports',
}
export function reportTabOfTarget(t: WorkbookFixTarget | undefined): ReportInputTab | null {
  return (t && TAB_OF_TARGET[t]) ?? null
}

export type ReportGap = { text: string; short: string; target: WorkbookFixTarget }

/** 원문 → 화면용 짧은 글씨. 「 — 」 뒤는 **어디에 인쇄되나**라서 칩에는 앞만 쓴다(원문은 title로 보존) */
export function gapShortText(text: string): string {
  const i = text.indexOf(' — ')
  return (i > 0 ? text.slice(0, i) : text).trim()
}

/** 조립 함수의 `missing` 원문 → 탭별 빈칸. **고객 축·채울 수 있는 것**만 남긴다. */
export function groupReportGaps(missing: readonly string[]): Record<ReportInputTab, ReportGap[]> {
  const out = Object.fromEntries(REPORT_INPUT_TABS.map(k => [k, [] as ReportGap[]])) as Record<ReportInputTab, ReportGap[]>
  const seen = new Set<string>()
  for (const p of parseWorkbookNotice(missing.join(' | '))) {
    if (p.kind !== 'fixable' || p.scope !== 'customer' || !p.target) continue
    const tab = reportTabOfTarget(p.target)
    if (!tab) continue
    // 공문·위임장·9호가 같은 빈칸을 각자 알린다(예: 「관계인 성명」) — 한 칸은 한 번만 센다
    const short = gapShortText(p.text)
    if (seen.has(`${tab}|${short}`)) continue
    seen.add(`${tab}|${short}`)
    out[tab].push({ text: p.text, short, target: p.target })
  }
  return out
}

/** 달력 사이드바 [입력하기]의 목적지 — **첫 빈 탭**(탭 바 순서). 다 찼거나 모르면 기본정보.
 *  공통 탭은 트리 노드가 둘이라 첫 빈칸이 1.1이면 1.1을, 아니면 1.4를 연다. 보고서 탭은 전년도 업무 칸. */
export function reportInputTarget(byTab: Record<ReportInputTab, readonly ReportGap[]> | null): { tab: ReportInputTab; form: string | null } {
  const tab = (byTab && REPORT_INPUT_TABS.find(k => byTab[k].length > 0)) || 'info'
  const form = tab === 'facilities' ? (byTab?.facilities[0]?.target === 'common11' ? '1.1' : '1.4')
    : tab === 'reports' ? 'duty' : null
  return { tab, form }
}

/** 「다음 빈 탭」 — 지금 탭 **뒤**에서 먼저 찾고, 없으면 앞에서 찾는다(되감기). 다 찼으면 null */
export function nextGapTab(byTab: Record<ReportInputTab, readonly unknown[]>, current: string): ReportInputTab | null {
  const i = REPORT_INPUT_TABS.indexOf(current as ReportInputTab)
  const order = i < 0 ? [...REPORT_INPUT_TABS]
    : [...REPORT_INPUT_TABS.slice(i + 1), ...REPORT_INPUT_TABS.slice(0, i)]
  return order.find(k => byTab[k].length > 0) ?? null
}
