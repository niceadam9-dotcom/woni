/** 사전 안내 SMS 순수 함수 (소방계획서_24 S2)
 *
 *  `server-only`도 `'use server'`도 붙이지 않는다 — 서버(발송)·클라이언트(화면 미리보기)·
 *  테스트(무서버 단언)가 모두 import한다. 네트워크·DB를 만지지 않는 것이 이 파일의 규칙이다.
 *
 *  왜 분리하나 — 종전에는 수신자 우선순위 판정(pickContact)이 클라이언트 컴포넌트 안에 박혀 있어
 *  서버·크론이 재사용할 수 없었다(P-10). 그래서 "화면과 크론이 각자 발송 규칙을 갖는" 구조가 됐다.
 *  발송 규칙은 여기 한 곳에만 둔다.
 */

// ── 타입 ──────────────────────────────────────────────────────
export type Contact = {
  id?: string
  role: string | null          // 대표·직원1·직원2 등 (contact_role)
  name: string | null
  phone: string | null
  /** Q-10 — true면 이 사람에게 보낸다. 고객의 관계인이 **전원 NULL**이면 우선순위 1명 폴백 */
  sms_recipient?: boolean | null
}

export type SmsTarget = {
  planItemId: string | null    // adhoc은 null
  customerId: string
  customerName: string
  visitDate: string            // YYYY-MM-DD — 발송·판정의 기준 축
  inspectionType?: string | null
  /** 계획 축 — monthly(정기) / special_*(자체) / event(일반) / null. 표시용 배지에만 쓴다 */
  planType?: string | null
  assigneeName?: string | null
  regionSi?: string | null
  regionMyeon?: string | null
  regionRi?: string | null
  /** 방문 준비용 지도(S5-7) — 지역 3단은 묶음용이고, 실제로 찾아가려면 주소가 필요하다 */
  address?: string | null
  /** 지정관계인(inspections.contact_id 등)이 있으면 우선순위 최상단 */
  designated?: Contact | null
  contacts: Contact[]
  /** 점검일 미확정(planned) 등 — 목록에는 보이되 체크 불가 (S8-11) */
  sendable?: boolean
  unsendableReason?: string | null
}

/** 유형 × 계획축 **쌍** — 배열 둘로 나누면 어느 유형이 어느 축인지 복원할 수 없어
 *  배지가 틀린 색으로 나간다(같은 고객·같은 날에 자체와 정기가 섞일 수 있다). */
export type SmsNature = { inspectionType: string | null; planType: string | null }

export type SmsGroup = {
  customerId: string
  customerName: string
  visitDate: string
  planItemIds: string[]
  recipients: Contact[]        // 정규화된 번호 기준으로 중복 제거됨
  regionSi: string | null
  regionMyeon: string | null
  regionRi: string | null
  /** 방문 준비용 지도(S5-7) — 지역 3단은 묶음용이고, 실제로 찾아가려면 주소가 필요하다 */
  address: string | null
  /** ⚠ 고객에게 나가는 문자 본문의 {점검종류} 원천(sms.ts renderSmsFor) — 표시용으로 바꾸지 말 것.
   *  화면 배지는 natures를 쓴다. */
  inspectionTypes: string[]
  /** 표시 전용 — 유형·계획축 쌍(중복 제거). adhoc은 빈 배열 */
  natures: SmsNature[]
  /** 역할 '대표'인 관계인 — **수신자가 아니어도** 담는다.
   *  pickContacts는 '누가 받는가'만 답하고 '사장님한테는 안 간다'를 말해주지 않는다.
   *  문자는 취소가 안 되므로 발송 전에만 되돌릴 수 있는 정보다. */
  representative: Contact | null
  assigneeName: string | null
  sendable: boolean
  unsendableReason: string | null
}

export type NoPhoneEntry = {
  customerId: string
  customerName: string
  visitDate: string
  planItemIds: string[]
  reason: string
  /** ⚠ 지역·담당을 **반드시 함께 나른다.**
   *
   *  종전엔 이 필드들이 없어 화면이 null로 채웠고, 지역·담당 필터가 등가 비교라
   *  **어떤 필터를 걸어도 이 행들이 통째로 사라졌다.** 지역으로 좁혀 일하는 것이 이 화면의
   *  주 동선인데, 그 순간 '문자를 못 받는 고객'만 골라 화면에서 지우는 셈이었다.
   *  게다가 화면은 아무 신호도 내지 않는다 — 조용히 사라지는 것이 이 기능 최악의 실패다. */
  regionSi: string | null
  regionMyeon: string | null
  regionRi: string | null
  assigneeName: string | null
  address: string | null
}

// ── 전화번호 ──────────────────────────────────────────────────
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[^0-9]/g, '')
}

/** 발송 가능한 번호인가 — 국내 휴대폰/유선 최소 길이만 본다.
 *  과하게 엄격하면 실제 고객 번호가 조용히 빠지고, 그 고객만 영영 문자를 못 받는다. */
export function isSendablePhone(raw: string | null | undefined): boolean {
  const d = normalizePhone(raw)
  return d.length >= 9 && d.length <= 11 && d.startsWith('0')
}

/** 로그·API 응답에 남기는 마스킹 — 개인정보가 평문으로 흐르지 않게 */
export function maskPhone(raw: string | null | undefined): string {
  const d = normalizePhone(raw)
  if (d.length < 7) return '***'
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`
}

// ── 수신자 선정 (Q-9·Q-10) ────────────────────────────────────
const FALLBACK_ORDER = ['대표', '직원1', '직원2']

/** 이 고객에게 문자를 받을 사람들.
 *
 *  ① 관계인 중 `sms_recipient === true`가 **하나라도** 있으면 → 그 사람들에게만
 *  ② 전원 미지정(NULL)이면 → 기존 우선순위 1명 폴백(지정관계인 → 대표 → 직원1 → 직원2)
 *
 *  폴백을 두는 이유: 기존 고객 수백 곳을 일괄 설정하지 않아도 되고, 도입만으로
 *  문자량이 갑자기 몇 배가 되는 사고도 없다. 종전 동작(1명)과 정확히 같다.
 *
 *  번호가 없는 사람은 제외한다 — 체크했더라도 보낼 수 없다(화면이 그 사실을 따로 알린다).
 *  같은 번호를 쓰는 두 역할(대표=직원1)은 1통으로 접는다 — 비용과 고객 피로가 둘 다 준다.
 */
export function pickContacts(target: { designated?: Contact | null; contacts: Contact[] }): Contact[] {
  const all = target.contacts ?? []
  const chosen = all.filter(c => c.sms_recipient === true)

  let picked: Contact[]
  if (chosen.length > 0) {
    picked = chosen.filter(c => isSendablePhone(c.phone))
  } else if (all.some(c => c.sms_recipient === false)) {
    // **명시적으로 해제한 고객에게는 보내지 않는다**(2026-08-19 사용자 확정).
    // 종전엔 해제해도 폴백이 대표를 도로 집어넣어 체크를 꺼도 문자가 나갔다 —
    // 끄는 수단이 없는 것과 같았다. '아무도 체크 안 함'(NULL, 미결정)과
    // '꺼 두었음'(false, 결정)을 구분해야 그 의사가 지켜진다.
    picked = []
  } else {
    // 폴백 — 1명만
    const one =
      (target.designated && isSendablePhone(target.designated.phone)) ? target.designated
      : FALLBACK_ORDER
          .map(role => all.find(c => c.role === role && isSendablePhone(c.phone)))
          .find(Boolean) ?? null
    picked = one ? [one] : []
  }

  // 같은 번호 중복 제거 (역할이 달라도 1통)
  const seen = new Set<string>()
  const out: Contact[] = []
  for (const c of picked) {
    const k = normalizePhone(c.phone)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}

// ── 그룹화 (P-12) ─────────────────────────────────────────────
/** 발송 단위로 접는다 — 키는 **고객 + 방문일**.
 *
 *  선택 단위는 계획 항목인데 발송 단위는 고객+방문일이다. 같은 고객이 같은 날
 *  정기와 자체점검을 동시에 가질 수 있고(다른 계획이면 UNIQUE 제약도 안 걸린다),
 *  종합은 1차·2차가 따로 있다. 접지 않으면 같은 번호로 2~3통이 간다.
 *
 *  번호가 하나도 없는 고객은 `noPhone`으로 **분리해서 돌려준다** — 조용히 빼면
 *  "문자를 못 받은 고객"이 아무 기록도 없이 사라진다(P-2가 정확히 그 사고였다).
 */
export function groupTargets(targets: SmsTarget[]): { groups: SmsGroup[]; noPhone: NoPhoneEntry[] } {
  const map = new Map<string, SmsGroup>()
  const noPhoneMap = new Map<string, NoPhoneEntry>()

  for (const t of targets) {
    const key = `${t.customerId}|${t.visitDate}`
    const recipients = pickContacts(t)

    if (recipients.length === 0) {
      const e = noPhoneMap.get(key) ?? {
        customerId: t.customerId, customerName: t.customerName, visitDate: t.visitDate,
        planItemIds: [],
        // 번호는 있는데 **수신을 껐을** 수도 있다. 사유를 하나로 고정하면 화면이
        // "고객관리에서 연락처를 채워주세요"라고 잘못 안내한다(번호는 멀쩡히 있다).
        reason: (t.contacts ?? []).some(c => c.sms_recipient === false)
          ? '이 고객은 문자 수신을 받지 않도록 설정되어 있습니다'
          : '발송 가능한 전화번호가 없습니다',
        regionSi: t.regionSi ?? null, regionMyeon: t.regionMyeon ?? null, regionRi: t.regionRi ?? null,
        assigneeName: t.assigneeName ?? null, address: t.address ?? null,
      }
      if (t.planItemId && !e.planItemIds.includes(t.planItemId)) e.planItemIds.push(t.planItemId)
      noPhoneMap.set(key, e)
      continue
    }

    const g = map.get(key) ?? {
      customerId: t.customerId, customerName: t.customerName, visitDate: t.visitDate,
      planItemIds: [], recipients, inspectionTypes: [], natures: [],
      representative: (t.contacts ?? []).find(c => c.role === '대표') ?? null,
      regionSi: t.regionSi ?? null, regionMyeon: t.regionMyeon ?? null, regionRi: t.regionRi ?? null,
      address: t.address ?? null,
      assigneeName: t.assigneeName ?? null,
      sendable: t.sendable !== false,
      unsendableReason: t.unsendableReason ?? null,
    }
    if (t.planItemId && !g.planItemIds.includes(t.planItemId)) g.planItemIds.push(t.planItemId)
    if (t.inspectionType && !g.inspectionTypes.includes(t.inspectionType)) g.inspectionTypes.push(t.inspectionType)
    // 표시용 쌍 — 둘 다 없으면(adhoc) 담지 않는다. 담으면 배지가 'null(자체)'로 찍힌다
    if (t.inspectionType || t.planType) {
      const nk = `${t.inspectionType ?? ''}|${t.planType ?? ''}`
      if (!g.natures.some(n => `${n.inspectionType ?? ''}|${n.planType ?? ''}` === nk)) {
        g.natures.push({ inspectionType: t.inspectionType ?? null, planType: t.planType ?? null })
      }
    }
    // 뒤에 붙는 target이 대표를 들고 올 수도 있다(첫 target에 없었던 경우)
    if (!g.representative) g.representative = (t.contacts ?? []).find(c => c.role === '대표') ?? null
    // 한 건이라도 발송 불가면 그룹 전체를 불가로 — 미확정 회차가 섞인 채 나가면 안 된다
    if (t.sendable === false) { g.sendable = false; g.unsendableReason = t.unsendableReason ?? '점검일 미확정' }
    map.set(key, g)
  }

  const groups = [...map.values()].sort((a, b) =>
    a.visitDate.localeCompare(b.visitDate) || a.customerName.localeCompare(b.customerName))
  return { groups, noPhone: [...noPhoneMap.values()] }
}

/** 실제 나갈 통수 = 수신자 수 (그룹 수가 아니다 — 비용은 수신자로 센다) */
export function countMessages(groups: SmsGroup[]): number {
  return groups.filter(g => g.sendable).reduce((n, g) => n + g.recipients.length, 0)
}

// ── 지역 3단 (Q-11) ───────────────────────────────────────────
/** 지역 3단만 있으면 무엇이든 묶을 수 있다 — 모달(SmsGroup)과 발송 화면(행)이 같은 규칙을 쓰게 */
export type RegionLike = { regionSi: string | null; regionMyeon: string | null; regionRi: string | null }

export type RegionGroup<T extends RegionLike = SmsGroup> = {
  si: string | null
  myeon: string | null
  ri: string | null
  label: string
  groups: T[]
}

/** 시/군 → 읍/면 → 리로 묶는다. 담당자가 하루 동선을 지역으로 짜기 때문이다.
 *
 *  **리가 빈 고객을 숨기지 않는다** — 묶음 자체는 그대로 남긴다.
 *  필터에서 빠지면 그 고객만 영영 문자가 안 가는데, 화면상으로는 아무 문제가 없어 보인다.
 *
 *  다만 라벨에 **'(리 없음)'을 쓰지 않는다**(2026-08-19). 실측상 읍/면이 있는 고객의
 *  94%(256/273)가 리 없음이라 화면이 온통 그 문구로 뒤덮여 읽는 데 방해만 됐다.
 *  없는 것을 굳이 말하지 않고 `양평군 · 개군면`에서 끝낸다 — 리가 있는 소수만 한 칸 더 붙는다. */
export function groupByRegion<T extends RegionLike>(groups: T[]): RegionGroup<T>[] {
  const map = new Map<string, RegionGroup<T>>()
  for (const g of groups) {
    const si = g.regionSi || null, myeon = g.regionMyeon || null, ri = g.regionRi || null
    const key = `${si ?? ''}|${myeon ?? ''}|${ri ?? ''}`
    const parts = [si ?? '(지역 미상)', myeon, ri].filter(Boolean)
    const rg = map.get(key) ?? { si, myeon, ri, label: parts.join(' · '), groups: [] }
    rg.groups.push(g)
    map.set(key, rg)
  }
  const cmp = (a: string | null, b: string | null) => (a ?? '￿').localeCompare(b ?? '￿')
  return [...map.values()].sort((a, b) => cmp(a.si, b.si) || cmp(a.myeon, b.myeon) || cmp(a.ri, b.ri))
}

// ── 길이·요금 ─────────────────────────────────────────────────
/** EUC-KR 기준 바이트 수 — 한글 2, 그 외 1. 요금이 갈리는 지점이라 화면이 실시간으로 보여준다. */
export function smsByteLength(text: string): number {
  let n = 0
  for (const ch of text) n += ch.charCodeAt(0) > 0x7f ? 2 : 1
  return n
}

/** 90바이트 초과면 LMS — 요금이 2~3배가 된다 */
export function smsKind(text: string): 'SMS' | 'LMS' {
  return smsByteLength(text) > 90 ? 'LMS' : 'SMS'
}

// ── 디데이 (Q-13) ─────────────────────────────────────────────
/** 발송 시점과 방문일의 차이를 사람 말로. 문구를 시점마다 복제하지 않기 위한 장치다. */
export function dDayLabel(leadDays: number): string {
  if (leadDays === 0) return '오늘'
  if (leadDays === 1) return '내일'
  if (leadDays === 2) return '모레'
  if (leadDays < 0) return `${Math.abs(leadDays)}일 전`
  return `${leadDays}일 후`
}

/** KST 기준 두 날짜의 일수 차 (visitDate - baseDate) */
export function daysBetween(baseDate: string, visitDate: string): number {
  const a = Date.UTC(+baseDate.slice(0, 4), +baseDate.slice(5, 7) - 1, +baseDate.slice(8, 10))
  const b = Date.UTC(+visitDate.slice(0, 4), +visitDate.slice(5, 7) - 1, +visitDate.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/** KST 오늘 (YYYY-MM-DD) — 서버 시간대가 무엇이든 한국 날짜로 판정한다 */
export function todayKst(now: number = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10)
}

/** baseDate에서 n일 뒤 (YYYY-MM-DD) */
export function addDays(baseDate: string, n: number): string {
  const t = Date.UTC(+baseDate.slice(0, 4), +baseDate.slice(5, 7) - 1, +baseDate.slice(8, 10)) + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

// ── 배너 시점 규칙 (Q-12·Q-13) ────────────────────────────────
export type LeadRuleError = string | null

/** 시점 규칙 검증 — 중복·음수·비정수를 거부한다. 저장 전에 막지 않으면 배너가 이상해진다. */
export function validateLeadRules(input: unknown): { rules: number[]; error: LeadRuleError } {
  if (!Array.isArray(input)) return { rules: [], error: '시점 목록의 형식이 올바르지 않습니다.' }
  const nums: number[] = []
  for (const v of input) {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isInteger(n)) return { rules: [], error: '시점은 정수(일)여야 합니다.' }
    if (n < 0) return { rules: [], error: '시점은 0(당일) 이상이어야 합니다.' }
    if (n > 365) return { rules: [], error: '시점은 365일 이내여야 합니다.' }
    if (nums.includes(n)) return { rules: [], error: `중복된 시점이 있습니다: ${dDayLabel(n)}` }
    nums.push(n)
  }
  if (nums.length === 0) return { rules: [], error: '시점을 최소 1개 지정해주세요.' }
  // 먼 시점부터 — 배너에서 급한 것이 아래로 오면 눈이 헤맨다
  return { rules: nums.sort((a, b) => b - a), error: null }
}

export type PendingNotice = {
  leadDays: number
  visitDate: string
  label: string                // '내일(8/19) 방문'
  groups: SmsGroup[]
  unsentGroups: SmsGroup[]
  unsentCount: number          // 곳
  messageCount: number         // 통
}

export type PendingOverdue = {
  groups: SmsGroup[]
  count: number
}

/** 배너 줄을 계산한다 — Q-12의 심장이자, 나중에 크론(S10)이 그대로 부를 함수다.
 *
 *  설계 응답의 핵심: 사용자가 대상을 **찾지 않게** 한다. 시스템이 규칙과 오늘 날짜로
 *  "보낼 대상"을 계산해 제시하고, 사용자는 통수를 확인하고 승인만 한다(P-17).
 *
 *  `isSent(customerId, visitDate)`는 (고객, 방문일) 쌍으로 판정한다 — 계획 항목 기준이면
 *  날짜를 옮긴 뒤 옛 문자가 새 날짜를 가려 재안내를 놓친다(S5-10).
 *
 *  '시기 지남'은 **조회 전용**이다. 지난 방문일에 "내일 갑니다"는 성립하지 않으므로
 *  발송 대상에서 빼되, 숨기지도 않는다(사용자가 일정을 재조정해야 하는 신호다).
 */
export function resolvePendingNotices(
  groups: SmsGroup[],
  leadRules: number[],
  today: string,
  isSent: (customerId: string, visitDate: string) => boolean,
): { notices: PendingNotice[]; overdue: PendingOverdue } {
  const notices: PendingNotice[] = []
  for (const lead of [...leadRules].sort((a, b) => b - a)) {
    const visitDate = addDays(today, lead)
    const inDay = groups.filter(g => g.visitDate === visitDate && g.sendable)
    const unsent = inDay.filter(g => !isSent(g.customerId, g.visitDate))
    const md = `${+visitDate.slice(5, 7)}/${+visitDate.slice(8, 10)}`
    notices.push({
      leadDays: lead,
      visitDate,
      label: `${dDayLabel(lead)}(${md}) 방문`,
      groups: inDay,
      unsentGroups: unsent,
      unsentCount: unsent.length,
      messageCount: countMessages(unsent),
    })
  }
  const over = groups.filter(g => g.visitDate < today && !isSent(g.customerId, g.visitDate))
  return { notices, overdue: { groups: over, count: over.length } }
}

// ── Solapi 응답 판정 (P-11) ───────────────────────────────────
export type SendVerdict = {
  status: 'sent' | 'failed' | 'unverified'
  messageId?: string | null
  statusCode?: string | null
  error?: string | null
}

/** 번호별 판정. **스키마를 못 읽으면 `unverified`** — 이게 이 함수의 요점이다.
 *
 *  인식 실패를 `failed`로 두면 **실제로 나간 문자를 재발송**한다(고객은 두 번 받고 요금도 두 번).
 *  반대로 `sent`로 두면 진짜 실패를 놓친다. 그래서 제3의 상태를 둔다 —
 *  화면은 '발송됨 + 툴팁'으로 보여주되 DB에는 구분해 남긴다(G-10).
 *
 *  종전 `_sendSolapi`는 배치 1회 호출에 `res.ok`만 봐서 10명 중 3명 실패를 구분할 수 없었다.
 */
export function parseSolapiResult(
  phones: string[],
  httpStatus: number,
  body: unknown,
): Map<string, SendVerdict> {
  const out = new Map<string, SendVerdict>()
  const norm = (p: string) => normalizePhone(p)

  if (httpStatus < 200 || httpStatus >= 300) {
    const msg = typeof body === 'string' ? body : JSON.stringify(body ?? {})
    // ⚠ **응답을 못 받은 것과 거절당한 것은 다르다.**
    //
    //  status 0 = 네트워크 예외(연결 리셋·읽기 타임아웃). 요청이 Solapi에 닿은 뒤 응답만
    //  못 받았을 수 있다 — 즉 **문자는 나갔을 수 있다**. 5xx도 같은 회색지대다.
    //  이걸 failed로 적으면 loadSentPairs의 재발송 방어망(sent·unverified·sending)에서
    //  빠져 배너가 그 건을 미발송으로 되살리고, ②-b 중복 확인마저 통과한다 —
    //  확인 절차 없는 이중 과금. unverified가 존재하는 이유가 정확히 이 경우다.
    //  4xx는 요청 자체가 거절된 것이므로 failed가 맞다(재시도해야 한다).
    const uncertain = httpStatus === 0 || httpStatus >= 500
    for (const p of phones) {
      out.set(norm(p), uncertain
        ? {
          status: 'unverified', statusCode: String(httpStatus),
          error: `발송 여부를 확인하지 못했습니다 (${httpStatus === 0 ? '네트워크 오류' : `Solapi ${httpStatus}`}): ${msg.slice(0, 200)}`,
        }
        : { status: 'failed', error: `Solapi 오류 (${httpStatus}): ${msg.slice(0, 300)}` })
    }
    return out
  }

  const b = (body ?? {}) as Record<string, unknown>

  // ① 접수가 거부된 번호 — 실패는 **여기에만** 실린다
  const failedList = Array.isArray(b.failedMessageList) ? (b.failedMessageList as Record<string, unknown>[]) : []
  for (const raw of failedList) {
    const to = norm(String(raw.to ?? raw.receiver ?? ''))
    if (!to) continue
    const code = raw.statusCode != null ? String(raw.statusCode) : null
    out.set(to, {
      status: 'failed', messageId: null, statusCode: code,
      error: String(raw.statusMessage ?? `상태코드 ${code ?? '없음'}`),
    })
  }

  // ② 나머지는 groupInfo 집계로 가른다.
  //    send-many/detail 성공 응답에는 **번호별 배열이 없다**(2026-08-19 실측). 오는 것은
  //    `groupInfo.count.registeredSuccess`(접수 성공 건수)와 위 실패 목록뿐이고, 개별
  //    messageId도 없어 `groupId`가 유일한 추적 키다(`/messages/v4/list?groupId=`로 조회).
  //    종전 코드는 번호별 배열을 찾다 못 찾고 전건을 unverified로 떨어뜨렸다 — 실제로는
  //    나간 문자라 재발송 시 이중 과금이 된다.
  const gi = (b.groupInfo ?? {}) as Record<string, unknown>
  const count = (gi.count ?? {}) as Record<string, unknown>
  const groupId = gi.groupId != null ? String(gi.groupId) : null
  // 접수 시점의 그룹 상태. SENDING = 접수됨(통신사 전달은 비동기) — 수신 완료가 아니다.
  const groupStatus = gi.status != null ? String(gi.status) : null
  const registered = Number(count.registeredSuccess ?? NaN)
  const rest = phones.map(norm).filter(p => !out.has(p))

  // 접수 성공 건수가 남은 번호 수와 **정확히** 맞을 때만 sent로 본다. 어긋나면 누가 성공인지
  // 응답만으로 가릴 수 없으므로 unverified에 둔다 — 성공을 부풀리지 않는다.
  const allRegistered = Number.isFinite(registered) && rest.length > 0 && registered === rest.length
  for (const p of rest) {
    out.set(p, allRegistered
      ? { status: 'sent', messageId: groupId, statusCode: groupStatus }
      : {
          status: 'unverified', messageId: groupId, statusCode: groupStatus,
          error: `접수 결과를 확인하지 못했습니다(접수 성공 ${Number.isFinite(registered) ? registered : '불명'}건 / 대상 ${rest.length}건)`,
        })
  }
  return out
}

// ── 문구 치환 ─────────────────────────────────────────────────
/** `{변수}` 치환. 값이 없는 변수는 **그대로 남긴다** — 조용히 빈칸이 되면
 *  "[] 내일 9/19" 같은 문자가 고객에게 나간다. 남아 있으면 화면이 경고할 수 있다. */
export function renderTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{([^}]+)\}/g, (m, k) => {
    const v = vars[String(k).trim()]
    return v == null || v === '' ? m : String(v)
  })
}

/** 치환되지 않고 남은 변수 목록 */
export function unresolvedVars(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([^}]+)\}/g)].map(m => m[1].trim()))]
}

/** '9/19(금)' — 문구에 쓰는 짧은 날짜 */
export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()]
  return `${+date.slice(5, 7)}/${+date.slice(8, 10)}(${dow})`
}
