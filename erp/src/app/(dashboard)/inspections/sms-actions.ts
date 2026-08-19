'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import {
  loadSmsTargets, loadAdhocTarget, prepareSms, sendInspectionSms, loadSentPairs, smsGuards,
  loadLeadRules, countUnsentNotices, OVERDUE_WINDOW_DAYS,
} from '@/lib/sms'
import {
  groupTargets, resolvePendingNotices, validateLeadRules,
  todayKst, addDays, maskPhone, normalizePhone,
} from '@/lib/sms-recipients'
import { COMPANY_PROFILE_ORDER } from '@/lib/company-profile'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { confirmPlanItemStageOneAction, moveMonthlyPlanItemAction } from '@/app/(dashboard)/inspection-plans/actions'

/** 사전 안내 SMS 서버 액션 (소방계획서_24 S4)
 *
 *  ⚠ 이 파일은 `'use server'`다 — **async 함수만 export한다.** 타입이나 상수를 export하면
 *  모듈 평가가 깨져 API 라우트가 전부 404가 되는데 tsc·build는 통과해 발견이 늦다
 *  (소방계획서_18에서 실제로 겪은 사고).
 *
 *  권한은 `requirePermission`이 아니라 `can()` + `{ error }` 반환을 쓴다 —
 *  requirePermission은 redirect()라서 모달 안에서 부르면 화면이 통째로 튄다(P-4).
 */

async function guard(perm: 'inspection_sms_send' | 'message_template_manage' | 'inspection_plan_manage') {
  const profile = await getProfile()
  if (!profile) return { error: '로그인이 필요합니다.' as const, profile: null }
  if (!can(profile.role, perm)) return { error: '권한이 없습니다.' as const, profile: null }
  return { error: null, profile }
}

// ── 발송 준비 (모달이 그릴 것 전부를 서버가 만든다) ──────────────
/** 클라이언트는 번호를 계산하지 않는다 — 달력이 무엇을 로드했는지와 무관하게
 *  어느 진입점에서 열어도 **같은 완전한 목록**이 나오게 하려는 것이다(Q-14). */
export async function prepareInspectionSmsAction(source: {
  kind: 'items' | 'range' | 'adhoc'
  planItemIds?: string[]
  from?: string
  to?: string
  customerId?: string
  visitDate?: string
  overrideBody?: string
}) {
  const g = await guard('inspection_sms_send')
  if (g.error) return { error: g.error }
  const admin = createAdminClient()

  let targets
  if (source.kind === 'adhoc') {
    if (!source.customerId || !source.visitDate) return { error: '고객과 방문일을 선택해주세요.' }
    if (source.visitDate < todayKst()) return { error: '지난 날짜에는 방문 안내를 보낼 수 없습니다.' }
    const t = await loadAdhocTarget(admin, source.customerId, source.visitDate)
    if (!t) return { error: '고객을 찾을 수 없습니다.' }
    targets = [t]
  } else if (source.kind === 'items') {
    targets = await loadSmsTargets(admin, { planItemIds: source.planItemIds ?? [] })
  } else {
    if (!source.from || !source.to) return { error: '기간을 지정해주세요.' }
    targets = await loadSmsTargets(admin, { from: source.from, to: source.to })
  }

  const prep = await prepareSms(admin, targets, source.overrideBody)
  const dates = prep.groups.map(x => x.visitDate).sort()
  const sent = dates.length
    ? await loadSentPairs(admin, dates[0], dates[dates.length - 1])
    : new Set<string>()
  const guards = smsGuards()

  return {
    body: prep.body,
    totalMessages: prep.totalMessages,
    noPhone: prep.noPhone,
    dryRun: guards.dryRun,
    allowlistOn: guards.allowlist.length > 0,
    credentialsMissing: !guards.hasCredentials || !guards.from,
    groups: prep.preview.map(p => ({
      customerId: p.group.customerId,
      customerName: p.group.customerName,
      visitDate: p.group.visitDate,
      planItemIds: p.group.planItemIds,
      inspectionTypes: p.group.inspectionTypes,
      // 지역·유형쌍은 SmsGroup에 이미 있었는데 여기서 잘려 모달이 못 받고 있었다
      regionSi: p.group.regionSi, regionMyeon: p.group.regionMyeon, regionRi: p.group.regionRi,
      natures: p.group.natures,
      // 대표는 **선택 대상이 아니다** — 원번호를 클라이언트에 두지 않는다(발송은 picked의 원번호만 되돌린다).
      // 수신자 여부는 서버에서 판정한다(클라이언트엔 마스킹 값뿐이라 비교가 불가능하다).
      representative: p.group.representative ? {
        name: p.group.representative.name,
        phoneMasked: maskPhone(p.group.representative.phone),
        isRecipient: p.group.recipients.some(
          c => normalizePhone(c.phone) === normalizePhone(p.group.representative!.phone),
        ),
      } : null,
      sendable: p.group.sendable,
      unsendableReason: p.group.unsendableReason,
      alreadySent: sent.has(`${p.group.customerId}|${p.group.visitDate}`),
      recipients: p.perRecipient.map(r => ({
        name: r.contact.name, role: r.contact.role,
        phone: r.contact.phone, phoneMasked: maskPhone(r.contact.phone),
        text: r.text, byteLen: r.byteLen, msgType: r.msgType, unresolved: r.unresolved,
      })),
    })),
  }
}

// ── 발송 ──────────────────────────────────────────────────────
export async function sendInspectionSmsAction(input: {
  kind: 'items' | 'range' | 'adhoc'
  planItemIds?: string[]
  from?: string
  to?: string
  customerId?: string
  visitDate?: string
  overrideBody?: string
  recipientOverride?: Record<string, string[]>
}) {
  const g = await guard('inspection_sms_send')
  if (g.error) return { ok: false, error: g.error, sent: 0, failed: 0, unverified: 0, noPhone: 0, skipped: 0, rows: [] }
  const admin = createAdminClient()

  let targets
  if (input.kind === 'adhoc') {
    if (!input.customerId || !input.visitDate) return { ok: false, error: '고객과 방문일을 선택해주세요.', sent: 0, failed: 0, unverified: 0, noPhone: 0, skipped: 0, rows: [] }
    if (input.visitDate < todayKst()) return { ok: false, error: '지난 날짜에는 방문 안내를 보낼 수 없습니다.', sent: 0, failed: 0, unverified: 0, noPhone: 0, skipped: 0, rows: [] }
    const t = await loadAdhocTarget(admin, input.customerId, input.visitDate)
    if (!t) return { ok: false, error: '고객을 찾을 수 없습니다.', sent: 0, failed: 0, unverified: 0, noPhone: 0, skipped: 0, rows: [] }
    targets = [t]
  } else if (input.kind === 'items') {
    targets = await loadSmsTargets(admin, { planItemIds: input.planItemIds ?? [] })
  } else {
    if (!input.from || !input.to) return { ok: false, error: '기간을 지정해주세요.', sent: 0, failed: 0, unverified: 0, noPhone: 0, skipped: 0, rows: [] }
    targets = await loadSmsTargets(admin, { from: input.from, to: input.to })
  }

  const res = await sendInspectionSms(admin, {
    targets,
    actorId: g.profile!.id,
    kind: input.kind === 'adhoc' ? 'adhoc' : (input.overrideBody != null ? 'manual' : 'pre_visit'),
    trigger: 'manual',
    overrideBody: input.overrideBody,
    recipientOverride: input.recipientOverride,
  })
  revalidatePath('/inspections/sms')
  revalidatePath('/inspections/calendar')
  return res
}

// ── 화면 조회 (S5) ────────────────────────────────────────────
/** 문자 발송 화면의 목록.
 *
 *  **2축 UNION이다**(S5-9) — 한 조인으로는 임의 발송(adhoc)이 보이지 않는다.
 *    축 A(보낼 것) = 계획 항목 기준 · 축 B(보낸 것) = sms_send_log 기준
 *  둘을 `(customer_id, visit_date)`로 병합하고, A에 없는 B 행은 '임의'로 남긴다.
 */
export async function listSmsStatusAction(filters: {
  from: string
  to: string
  regionSi?: string | null
  regionMyeon?: string | null
  regionRi?: string | null
  /** 'not_sent' = 발송됨 제외(기본) — 이 화면의 일은 '아직 안 보낸 것'이라 그게 기본이다.
   *  'stuck' = 결과가 기록되지 않아 발송 여부를 모르는 건(사람이 확인해야 한다) */
  status?: 'all' | 'not_sent' | 'unsent' | 'sent' | 'failed' | 'no_phone' | 'stuck'
  assignee?: string | null
}) {
  const g = await guard('inspection_sms_send')
  if (g.error) return { error: g.error }
  const admin = createAdminClient()
  const today = todayKst()

  // 기간을 비워 두면 **오늘부터 1개월**을 본다(2026-08-19 사용자 지시).
  //
  // 경위: 처음엔 오늘~+7이 기본이라 사용자가 필터를 건 적도 없는데 목록이 잘려 있었다.
  // 그래서 '해제=전체'로 바꿨더니 이번엔 1000행을 넘겨 화면이 무거워졌다.
  // 사전 안내는 방문 며칠 전에 보내는 일이라 몇 달 뒤 계획까지 늘어놓을 이유가 없다 —
  // 기본은 1개월, 더 보고 싶으면 [전체]를 명시적으로 누른다.
  //
  // 하한이 오늘인 이유: 지난 방문일은 어차피 발송 대상이 아니고(loadSmsTargets가 거른다)
  // 배너의 '시기 지남'이 따로 알려준다.
  const from = filters.from || today
  const to = filters.to || addDays(today, 30)

  // ── 축 A: 계획 항목
  const targets = await loadSmsTargets(admin, { from, to })
  const { groups, noPhone } = groupTargets(targets)

  // ── 축 B: 발송 이력 (adhoc 포함)
  // 1행=1수신자라 계획 항목보다 빨리 불어난다 — 여기도 1000행 상한에 걸리면
  // '보낸 건'이 조용히 빠져 미발송으로 되살아난다(재발송·이중 과금). 끝까지 받아온다.
  // created_at은 동점이 날 수 있어 id를 2차 정렬로 고정한다(페이지가 밀리면 건너뛴다).
  const logPage = await fetchAllRows((f, t) => admin
    .from('sms_send_log')
    .select('id, kind, customer_id, visit_date, status, error, contact_name, contact_role, to_phone, created_at, customers:customer_id ( customer_name, address, region_si, region_myeon, region_ri )')
    .gte('visit_date', from).lte('visit_date', to)
    .order('created_at', { ascending: false })
    .order('id')
    .range(f, t))
  if (logPage.truncated) console.error('[sms] 발송 이력 로드 상한 도달:', logPage.rows.length)
  const logRaw = logPage.rows
  const logs = (logRaw ?? []) as unknown as Array<{
    id: string; kind: string; customer_id: string; visit_date: string
    status: string; error: string | null; contact_name: string | null; contact_role: string | null
    to_phone: string | null; created_at: string
    customers: { customer_name: string; address: string | null; region_si: string | null; region_myeon: string | null; region_ri: string | null } | null
  }>

  const byPair = new Map<string, typeof logs>()
  for (const l of logs) {
    const k = `${l.customer_id}|${l.visit_date}`
    const arr = byPair.get(k) ?? []
    arr.push(l); byPair.set(k, arr)
  }

  type Row = {
    key: string; customerId: string; customerName: string; visitDate: string
    planItemIds: string[]; inspectionTypes: string[]; assigneeName: string | null
    regionSi: string | null; regionMyeon: string | null; regionRi: string | null
    recipientCount: number; status: string; sentAt: string | null; reason: string | null
    isAdhoc: boolean; sendable: boolean; unsendableReason: string | null
    /** 방문 준비용 지도(S5-7) — 지역 3단은 묶음용이라 실제로 찾아가려면 주소가 필요하다 */
    address: string | null
    /** 점검일이 옮겨져 **옛 날짜로 이미 안내가 나간** 건 — 그 옛 날짜(S5-0b).
     *  재안내가 필요한지는 사람이 판단한다(자동 재발송은 하지 않는다). */
    movedFrom: string | null
  }

  /** 한 (고객, 방문일)의 여러 수신자 행을 한 줄로 접는다.
   *
   *  ⚠ 우선순위가 중요하다. 종전엔 `anySent`가 맨 앞이라 **3명 중 1명만 실패해도 '발송됨'**이었다.
   *  Q-9(멀티 수신자)의 근거가 "3명 중 1명 실패하면 그 한 명만 재발송"인데, 결과 창구가 그 1명을
   *  덮어버렸다 — 기본 필터(발송 제외)에서도 사라지므로 영구 은폐다. P-1이 표시 계층에서 재발한 꼴.
   *  그래서 **조치가 필요한 상태를 앞에 둔다**: sending → failed → no_phone → sent → unsent.
   *
   *  'sending'은 결과 기록이 실패해 굳은 행이다(sms.ts가 로그를 남긴다). 돈이 나갔을 수 있으므로
   *  '미발송'으로 떨어뜨리면 배너가 재발송을 권해 **이중 과금**이 된다. 별도 상태로 드러낸다. */
  const rowOf = (pair: string, base: Omit<Row, 'status' | 'sentAt' | 'reason' | 'key' | 'movedFrom'>): Row => {
    const ls = byPair.get(pair) ?? []
    const latest = ls[0] ?? null
    const sentRows = ls.filter(l => l.status === 'sent' || l.status === 'unverified')
    const failedRows = ls.filter(l => l.status === 'failed')
    const noPhoneRows = ls.filter(l => l.status === 'no_phone')
    const stuckRows = ls.filter(l => l.status === 'sending')

    const status =
      stuckRows.length ? 'stuck'
      : failedRows.length ? 'failed'
      : noPhoneRows.length ? 'no_phone'
      : sentRows.length ? 'sent'
      : 'unsent'

    // 일부만 실패한 경우를 숫자로 말한다 — '실패'만 뜨면 몇 명에게 갔는지 알 수 없다
    const partial = failedRows.length > 0 && sentRows.length > 0
      ? `${ls.length}명 중 ${failedRows.length}명 실패 (${sentRows.length}명 발송됨) · `
      : ''
    return {
      key: pair, ...base,
      status,
      movedFrom: null,   // 아래에서 전체 행을 다 만든 뒤 채운다(다른 행을 봐야 판정된다)
      sentAt: sentRows.length ? (latest?.created_at ?? null) : null,
      reason:
        stuckRows.length ? '발송 결과가 기록되지 않았습니다 — 실제 발송 여부를 확인해주세요'
        : failedRows.length ? partial + (failedRows[0]?.error ?? '')
        : noPhoneRows.length ? (noPhoneRows[0]?.error ?? null)
        : null,
    }
  }

  const rows: Row[] = []
  const seen = new Set<string>()
  for (const x of groups) {
    const pair = `${x.customerId}|${x.visitDate}`
    seen.add(pair)
    rows.push(rowOf(pair, {
      customerId: x.customerId, customerName: x.customerName, visitDate: x.visitDate,
      planItemIds: x.planItemIds, inspectionTypes: x.inspectionTypes, assigneeName: x.assigneeName,
      regionSi: x.regionSi, regionMyeon: x.regionMyeon, regionRi: x.regionRi,
      address: x.address,
      recipientCount: x.recipients.length, isAdhoc: false,
      sendable: x.sendable, unsendableReason: x.unsendableReason,
    }))
  }
  for (const n of noPhone) {
    const pair = `${n.customerId}|${n.visitDate}`
    if (seen.has(pair)) continue
    seen.add(pair)
    rows.push(rowOf(pair, {
      customerId: n.customerId, customerName: n.customerName, visitDate: n.visitDate,
      planItemIds: n.planItemIds, inspectionTypes: [], assigneeName: null,
      regionSi: null, regionMyeon: null, regionRi: null, address: null,
      recipientCount: 0, isAdhoc: false, sendable: false, unsendableReason: '전화번호 없음',
    }))
  }
  // 축 B에만 있는 것 = 임의 발송이거나 계획이 사라진 과거 이력
  for (const [pair, ls] of byPair) {
    if (seen.has(pair)) continue
    const l = ls[0]
    rows.push(rowOf(pair, {
      customerId: l.customer_id, customerName: l.customers?.customer_name ?? '(고객 미상)',
      visitDate: l.visit_date, planItemIds: [], inspectionTypes: [], assigneeName: null,
      regionSi: l.customers?.region_si ?? null, regionMyeon: l.customers?.region_myeon ?? null,
      regionRi: l.customers?.region_ri ?? null, address: l.customers?.address ?? null,
      recipientCount: ls.filter(x => x.to_phone).length,
      isAdhoc: ls.every(x => x.kind === 'adhoc'), sendable: false, unsendableReason: null,
    }))
  }

  // ── 일정변경 판정 (S5-0b) ─────────────────────────────────────────────
  // 점검일을 옮기면 (고객, 새 날짜)는 미발송이 된다(S5-10). 그 자체는 옳지만, 사용자는
  // "이 고객에겐 이미 8/19로 안내가 나갔다"는 사실을 모른 채 새로 보내게 된다 —
  // 고객은 두 날짜를 안내받고 어느 쪽이 맞는지 모른다.
  //
  // '다음 회차'와 구별하는 것이 핵심이다. 같은 고객의 8월 건을 보냈고 9월 건이 미발송인 것은
  // 일정변경이 아니라 정상이다. 그래서 **옛 날짜에 계획 항목이 더는 없을 때만** 이동으로 본다
  // (옮겨졌으니 그 날짜의 계획이 사라진 것이다). 계획이 그대로면 둘 다 살아 있는 별개 회차다.
  const sentDatesByCustomer = new Map<string, string[]>()
  for (const [pair, ls] of byPair) {
    if (!ls.some(l => l.status === 'sent' || l.status === 'unverified')) continue
    const [cid, vd] = pair.split('|')
    if (seen.has(pair) && rows.some(r => r.key === pair && r.planItemIds.length > 0)) continue  // 그 날짜에 계획이 살아 있다
    const a = sentDatesByCustomer.get(cid) ?? []
    a.push(vd); sentDatesByCustomer.set(cid, a)
  }
  for (const r of rows) {
    if (r.status !== 'unsent' || r.planItemIds.length === 0) continue
    const others = (sentDatesByCustomer.get(r.customerId) ?? []).filter(d => d !== r.visitDate)
    if (others.length === 0) continue
    r.movedFrom = others.sort().at(-1) ?? null   // 가장 최근에 안내한 옛 날짜
  }

  // 필터
  let out = rows
  const f = filters
  if (f.regionSi)    out = out.filter(r => r.regionSi === f.regionSi)
  if (f.regionMyeon) out = out.filter(r => r.regionMyeon === f.regionMyeon)
  if (f.regionRi)    out = out.filter(r => r.regionRi === f.regionRi)
  if (f.assignee)    out = out.filter(r => r.assigneeName === f.assignee)
  // 'not_sent'는 특정 상태가 아니라 **발송됨만 빼는** 축이다 —
  // 실패·번호없음도 아직 처리할 일이라 남겨야 한다(그것만 빼면 조치가 필요한 건이 사라진다)
  if (f.status === 'not_sent') out = out.filter(r => r.status !== 'sent')
  else if (f.status && f.status !== 'all') out = out.filter(r => r.status === f.status)

  // 배너 (Q-12) — 시점 규칙은 loadLeadRules 한 곳에서만 읽는다(정렬 고정 포함).
  //
  // ⚠ 배너는 **화면 필터와 독립**이어야 한다. 종전엔 loadSentPairs에 화면 기간(from~to)을 주고
  //   대상은 today~+rules로 읽어, 두 범위가 어긋나면 이미 보낸 건의 쌍이 조회되지 않아
  //   "내일 방문 — 미발송"이 다시 떴다(필터에서 [오늘]만 눌러도 재현). 재발송 유도다.
  //   이제 배너가 쓰는 두 조회를 **같은 창**으로 맞춘다.
  //
  // 과거까지 싣는 이유(includePast): '시기 지남'을 세려면 지난 방문일이 필요한데,
  // 기본 경로는 발송 대상만 만드느라 과거를 버려서 overdue가 **항상 0**이었다.
  const rules = await loadLeadRules(admin)
  const bannerFrom = addDays(today, -OVERDUE_WINDOW_DAYS)
  const bannerTo = addDays(today, Math.max(...rules, 1))
  const sentPairs = await loadSentPairs(admin, bannerFrom, bannerTo)
  const wide = await loadSmsTargets(admin, { from: bannerFrom, to: bannerTo, includePast: true })
  const { groups: wideGroups } = groupTargets(wide)
  const { notices, overdue } = resolvePendingNotices(
    wideGroups, rules, today, (c, v) => sentPairs.has(`${c}|${v}`))

  // 지역 3단 선택지 — 앞 단계가 정해지면 그 안의 값만
  const siList = [...new Set(rows.map(r => r.regionSi).filter(Boolean))].sort() as string[]
  const myeonList = [...new Set(rows.filter(r => !f.regionSi || r.regionSi === f.regionSi).map(r => r.regionMyeon).filter(Boolean))].sort() as string[]
  const riList = [...new Set(rows.filter(r => (!f.regionSi || r.regionSi === f.regionSi) && (!f.regionMyeon || r.regionMyeon === f.regionMyeon)).map(r => r.regionRi).filter(Boolean))].sort() as string[]

  return {
    rows: out.sort((a, b) =>
      (a.regionSi ?? '￿').localeCompare(b.regionSi ?? '￿') ||
      (a.regionMyeon ?? '￿').localeCompare(b.regionMyeon ?? '￿') ||
      (a.regionRi ?? '￿').localeCompare(b.regionRi ?? '￿') ||
      a.visitDate.localeCompare(b.visitDate) || a.customerName.localeCompare(b.customerName)),
    notices: notices.map(n => ({
      leadDays: n.leadDays, visitDate: n.visitDate, label: n.label,
      unsentCount: n.unsentCount, messageCount: n.messageCount,
      planItemIds: n.unsentGroups.flatMap(x => x.planItemIds),
    })),
    overdue: {
      count: overdue.count,
      items: overdue.groups.map(x => ({ customerName: x.customerName, visitDate: x.visitDate, planItemIds: x.planItemIds })),
    },
    regions: { si: siList, myeon: myeonList, ri: riList },
    assignees: [...new Set(rows.map(r => r.assigneeName).filter(Boolean))].sort() as string[],
    leadRules: rules,
    today,
  }
}

/** 사이드바 뱃지·대시보드 위젯 — 오늘 기준 미발송 곳 수 (S9-5).
 *
 *  세는 로직은 lib/sms.ts의 countUnsentNotices 하나뿐이다 — 그 함수가 배너와 **같은**
 *  resolvePendingNotices를 쓴다. 뱃지가 배너와 다른 수를 보여주면 사용자는 어느 쪽을 믿을지 모른다. */
export async function countUnsentNoticesAction() {
  const g = await guard('inspection_sms_send')
  if (g.error) return { count: 0, messages: 0, nearest: null }
  const r = await countUnsentNotices(createAdminClient())
  return { count: r.count, messages: r.messages, nearest: r.nearest }
}

/** 임의 발송용 고객 후보 — **전 활성 고객** (S9-6③).
 *
 *  문자 발송 화면에 뜬 행에서만 고르게 하면 '계획이 잡힌 고객'만 선택할 수 있다.
 *  그런데 Q-17이 든 사례(견적 방문·계획 없는 AS·상담)는 **계획이 없는 고객**이다 —
 *  후보를 화면 행으로 한정하면 정작 이 기능이 필요한 경우를 못 고른다(독립 판정 지적).
 *
 *  초성 검색은 클라이언트의 CustomerFilterSearch가 하므로 여기서는 목록만 준다.
 *  활성 고객 수백 규모라 한 번에 실어도 무겁지 않다. */
export async function listSmsCustomerOptionsAction() {
  const g = await guard('inspection_sms_send')
  if (g.error) return { customers: [] }
  const admin = createAdminClient()
  const { data } = await admin
    .from('customers')
    .select('id, customer_name, customer_code')
    .eq('is_active', true)
    .order('customer_name')
    .limit(2000)
  return {
    customers: ((data ?? []) as Array<{ id: string; customer_name: string; customer_code: string | null }>)
      .map(c => ({ id: c.id, name: c.customer_name, sub: c.customer_code ?? undefined })),
  }
}

// ── 시점 규칙 설정 (Q-13) ─────────────────────────────────────
export async function getSmsSettingsAction() {
  const g = await guard('inspection_sms_send')
  if (g.error) return { error: g.error }
  // loadLeadRules를 쓴다 — 여기만 정렬이 빠져 있어 설정 화면이 저장한 것과 다른 행을 읽을 수 있었다
  const rules = await loadLeadRules(createAdminClient())
  const p = await getProfile()
  return { rules, canEdit: !!p && can(p.role, 'message_template_manage') }
}

export async function saveSmsSettingsAction(rulesInput: unknown) {
  const g = await guard('message_template_manage')
  if (g.error) return { error: g.error }
  const { rules, error } = validateLeadRules(rulesInput)
  if (error) return { error }
  const admin = createAdminClient()
  const { data: row } = await admin.from('company_profile').select('id')
    .order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle()
  if (!row) return { error: '회사 정보가 없습니다. 먼저 본사 정보를 등록해주세요.' }
  const { error: upErr } = await admin.from('company_profile')
    .update({ sms_lead_rules: rules } as Record<string, unknown>).eq('id', (row as { id: string }).id)
  if (upErr) return { error: '시점 저장에 실패했습니다.' }
  revalidatePath('/inspections/sms')
  revalidatePath('/settings/message-templates')
  return { rules }
}

// ── 지역 묶음 일괄 날짜 이동 (S12② / Q-16) ────────────────────
/** 담당자가 "다음 주 강하면 5곳을 하루에 몰아서" 도는 실무. 지금은 5건을 각각 열어 고쳐야 한다.
 *
 *  이동은 **S12①로 단일화된 확정 경로 하나만** 태운다 — 여기서 직접 UPDATE하면
 *  P-19가 만든 것과 같은 갈라짐이 새로 생긴다.
 *  건별 실패를 삼키지 않는다: 1단계 완료 건은 가드에 막히고 정기는 같은 달 제약이 있다. */
export async function bulkMovePlanDatesAction(planItemIds: string[], newDate: string) {
  // 권한은 **이 함수가 실제로 행사하는 것**으로 검사한다 — 건별로 moveMonthlyPlanItemAction /
  // confirmPlanItemStageOneAction이 requirePermission('inspection_plan_manage')를 부르고,
  // 그 함수는 실패 시 redirect()로 **던진다**. sms 권한만 통과시키면 루프 중간에 예외가 나
  // 일부만 쓰인 채 failed에 아무것도 안 남는다. 오늘은 두 키의 역할 집합이 같아 동작 변화 없음.
  // 데이 패널(점검달력) 일괄 이동도 이 액션을 그대로 쓴다 (2026-08-19).
  const g = await guard('inspection_plan_manage')
  if (g.error) return { moved: 0, failed: [{ name: '', reason: g.error }] }
  if (!Array.isArray(planItemIds) || planItemIds.length === 0) return { moved: 0, failed: [] }
  if (planItemIds.length > 200) return { moved: 0, failed: [{ name: '', reason: '한 번에 200건까지 이동할 수 있습니다.' }] }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { moved: 0, failed: [{ name: '', reason: '날짜 형식이 올바르지 않습니다.' }] }
  if (newDate < todayKst()) return { moved: 0, failed: [{ name: '', reason: '지난 날짜로는 이동할 수 없습니다.' }] }

  const admin = createAdminClient()
  const { data } = await admin.from('inspection_plan_items')
    .select('id, plan_type, customers:customer_id ( customer_name )').in('id', planItemIds)
  const rows = (data ?? []) as unknown as Array<{ id: string; plan_type: string | null; customers: { customer_name: string } | null }>
  const names = new Map<string, string>()
  const planTypes = new Map<string, string | null>()
  for (const r of rows) {
    names.set(r.id, r.customers?.customer_name ?? '(고객 미상)')
    planTypes.set(r.id, r.plan_type)
  }

  let moved = 0
  const failed: Array<{ name: string; reason: string }> = []
  for (const id of planItemIds) {
    // 정기(monthly)는 **moveMonthlyPlanItemAction으로 태운다** — '같은 달 안에서만 이동'이라는
    // 규칙이 그 함수에만 있기 때문이다. 종전에는 여기서 confirm을 직접 불러 그 제약이 새어,
    // 다른 달로 옮겨도 조용히 성공했다(moved에 포함). 규칙을 여기 복제하지 않고 경로를 태우는 이유는
    // 복제하는 순간 두 곳이 갈라지기 때문이다 — P-19가 정확히 그 사고였다.
    const pt = planTypes.get(id)
    const res = pt === 'monthly' || pt === 'event'
      ? await moveMonthlyPlanItemAction(id, newDate)
      : await confirmPlanItemStageOneAction(id, newDate)
    if (res.error) failed.push({ name: names.get(id) ?? '(고객 미상)', reason: res.error })
    else moved++
  }
  revalidatePath('/inspections/sms')
  revalidatePath('/inspection-plans')
  revalidatePath('/inspections/calendar')
  return { moved, failed }
}
