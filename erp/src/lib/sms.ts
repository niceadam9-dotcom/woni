import 'server-only'

import { createHmac } from 'crypto'
import type { createAdminClient } from '@/lib/supabase/admin'
import { loadTemplate, companyVars } from '@/lib/message-template'
import { COMPANY_PROFILE_ORDER } from '@/lib/company-profile'
import { fetchAllRows } from '@/lib/supabase/paginate'
import {
  pickContacts, groupTargets, countMessages, normalizePhone, maskPhone,
  smsByteLength, smsKind, dDayLabel, daysBetween, todayKst, shortDate, addDays,
  parseSolapiResult, renderTemplate, resolvePendingNotices, validateLeadRules,
  type SmsTarget, type SmsGroup, type Contact,
} from '@/lib/sms-recipients'

/** 사전 안내 SMS — **유일한 발송 경로** (소방계획서_24 S3)
 *
 *  화면·크론·임의 발송이 전부 이 함수를 지난다. 종전에는 발송 규칙이 클라이언트 컴포넌트에
 *  흩어져 있어(P-10) 경로마다 규칙이 갈라졌다.
 *
 *  실패를 정직하게 남기는 것이 이 모듈의 존재 이유다 — 종전 saveSmsAction은 Solapi 호출
 *  결과와 무관하게 sms_sent_at을 찍었고, 번호가 없어 걸러진 항목까지 같은 루프를 돌아
 *  **문자를 못 받은 고객이 '발송됨'으로 보였다**(P-1·P-2).
 */

type Admin = ReturnType<typeof createAdminClient>

/** '시기 지남'을 며칠까지 거슬러 볼 것인가.
 *  무한이면 몇 달 전 건까지 계속 떠서 경고가 소음이 되고, 짧으면 놓친 방문을 못 본다.
 *  한 달이면 "이번 달에 연락 없이 간 곳"을 덮는다 — 사전 안내의 실무 주기와 맞다. */
export const OVERDUE_WINDOW_DAYS = 30

// ── 안전장치 ──────────────────────────────────────────────────
/** 문자는 되돌릴 수 없고 돈이 나간다. 세 겹으로 막는다. */
export function smsGuards() {
  return {
    /** 네트워크 호출 없이 가짜 성공 — 운영에서 "잠깐 멈춤" 스위치로도 쓴다 */
    dryRun: process.env.SMS_DRY_RUN === '1',
    /** 목록 밖 번호는 전부 skip. 스테이징에 걸어두면 사고 시 최대 피해가 본인 1통 */
    allowlist: (process.env.SMS_ALLOWLIST ?? '').split(',').map(s => normalizePhone(s)).filter(Boolean),
    /** 1회 상한 — 초과하면 발송 자체를 안 한다(부분 발송으로 어중간하게 만들지 않는다) */
    maxPerRun: Number(process.env.SMS_MAX_PER_RUN ?? 200) || 200,
    from: process.env.SOLAPI_SENDER_PHONE ?? process.env.SMS_SENDER_PHONE ?? '',
    hasCredentials: !!(process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET),
  }
}

// ── 대상 조회 ─────────────────────────────────────────────────
export type LoadTargetsInput =
  | { planItemIds: string[] }
  /** includePast=true면 **지난 방문일도 싣는다** — '시기 지남'(안내 못 하고 지나간 방문)을
   *  세려면 그 건들이 필요한데, 기본 경로는 발송 대상만 만들므로 과거를 버린다(아래 주석 참조). */
  | { from: string; to: string; includePast?: boolean }

/** 발송 대상을 만든다.
 *
 *  `plan_type` 필터를 걸지 않는다 — 달력의 계획 칩 축은 monthly·event만 로드하지만(P-8),
 *  자체점검도 방문이므로 여기서 빠지면 그 건들에 문자를 보낼 방법이 없어진다.
 *
 *  미확정(`planned`) 건은 **빼지 않고 `sendable:false`로 함께 반환**한다(S8-11).
 *  달력에는 미확정 칩도 보이므로 조용히 빼면 "달력에 있는데 문자 목록엔 없다"가 된다.
 */
export async function loadSmsTargets(admin: Admin, input: LoadTargetsInput): Promise<SmsTarget[]> {
  const today = todayKst()
  // ⚠ PostgREST는 **요청당 1000행이 하드 상한**이고 넘친 만큼은 오류 없이 그냥 빠진다.
  // 기간 필터를 해제(전체)할 수 있게 되면서 실제로 이 상한에 걸렸다 — 화면 행 수가
  // 1000/1001에서 오락가락했다. 발송 화면에서 잘리면 **그 고객만 안내를 못 받는데
  // 화면상으로는 아무 문제가 없어 보인다**. 그래서 끝까지 받아온다.
  // 페이지를 나누므로 정렬은 동점 없는 키(id)로 고정해야 건너뛰거나 중복되지 않는다.
  const build = (from: number, to: number) => {
    let q = admin
      .from('inspection_plan_items')
      .select(`
        id, scheduled_date, status, inspection_type, plan_type,
        profiles:assigned_employee_id ( name ),
        customers:customer_id (
          id, customer_name, is_active, address, region_si, region_myeon, region_ri,
          customer_contacts ( id, role, name, phone, sms_recipient )
        )
      `)
      .not('scheduled_date', 'is', null)
    // ⚠ 'completed'를 빼지 않는다(2026-08-19 실측 수정). 이 컬럼의 completed는 '점검이 끝났다'가
    // 아니라 **'계획 단계를 졸업했다'**는 뜻이다 — 점검일을 확정하면 startInspectionCore가 점검 건을
    // 만들면서 이 항목을 completed로 바꾼다(inspection-start.ts:117). 확정=자동 시작이라, 방문 며칠
    // 전에 점검일을 확정해 두는 정상 업무만으로 자체점검(종합·작동)이 사전 안내 대상에서 통째로
    // 사라졌다(스테이징 실측: 오늘 이후 자체점검 4건 중 2건이 이 사유로 누락).
    // 방문이 지났는지는 아래 scheduled_date >= today 가드가 이미 본다.
      .in('status', ['planned', 'confirmed', 'completed'])

    if ('planItemIds' in input) {
      q = q.in('id', input.planItemIds)
    } else {
      // 지난 방문일에 "방문합니다"는 성립하지 않으므로 **발송 대상**에서는 오늘 이후만 본다.
      // 단 includePast면 그대로 둔다 — '시기 지남'을 세려면 지난 건이 필요하기 때문이다.
      const from = input.includePast || input.from >= today ? input.from : today
      q = q.gte('scheduled_date', from).lte('scheduled_date', input.to)
    }
    return q.order('id').range(from, to)
  }

  if ('planItemIds' in input && input.planItemIds.length === 0) return []

  const page = await fetchAllRows(build)
  if (page.error) return []
  // 조용히 적게 보여주지 않는다 — 상한에 걸리면 서버 로그에 남긴다
  if (page.truncated) console.error('[sms] 발송 대상 로드 상한 도달 — 일부가 빠졌을 수 있다:', page.rows.length)

  const rows = page.rows as unknown as Array<{
    id: string; scheduled_date: string; status: string
    inspection_type: string | null; plan_type: string | null
    profiles: { name: string } | null
    customers: {
      id: string; customer_name: string; is_active: boolean | null
      address: string | null
      region_si: string | null; region_myeon: string | null; region_ri: string | null
      customer_contacts: Contact[] | null
    } | null
  }>

  const out: SmsTarget[] = []
  for (const r of rows) {
    const c = r.customers
    if (!c || c.is_active === false) continue          // 계약이 끝난 고객에게 보내지 않는다
    // 과거 방문일 가드 — planItemIds 경로에도 적용된다(모달에 지난 건이 실리면 안 된다).
    // includePast일 때만 통과시킨다: '시기 지남'은 **보내려는 게 아니라 놓친 것을 알리려는** 목록이다.
    const wantsPast = !('planItemIds' in input) && input.includePast === true
    if (r.scheduled_date < today && !wantsPast) continue
    out.push({
      planItemId: r.id,
      customerId: c.id,
      customerName: c.customer_name,
      visitDate: r.scheduled_date,
      inspectionType: r.inspection_type,
      // 조회는 이미 하고 있었는데(select) 여기서 버려져 화면이 정기/자체를 구별하지 못했다
      planType: r.plan_type,
      assigneeName: r.profiles?.name ?? null,
      regionSi: c.region_si, regionMyeon: c.region_myeon, regionRi: c.region_ri,
      address: c.address,
      contacts: c.customer_contacts ?? [],
      // completed도 발송 가능하다 — 확정을 지나 점검이 시작된 상태이지 미확정이 아니다.
      // 여기서 빼면 위 status 필터를 넓힌 의미가 없어지고 '점검일 미확정'이라는 틀린 사유가 붙는다.
      // 지난 방문일(includePast로 실린 건)은 **보낼 수 없다** — 사유를 달아 모달에서도 막는다.
      sendable: r.status !== 'planned' && r.scheduled_date >= today,
      unsendableReason:
        r.scheduled_date < today ? '이미 지난 방문일 — 사전 안내를 보낼 수 없습니다'
        : r.status === 'planned' ? '점검일 미확정 — 점검확정에서 확정해주세요'
        : null,
    })
  }
  return out
}

/** 임의 발송(Q-17)용 대상 1건 — 계획 항목 없이 고객+날짜만으로 만든다 */
export async function loadAdhocTarget(admin: Admin, customerId: string, visitDate: string): Promise<SmsTarget | null> {
  const { data } = await admin
    .from('customers')
    .select('id, customer_name, is_active, address, region_si, region_myeon, region_ri, customer_contacts ( id, role, name, phone, sms_recipient )')
    .eq('id', customerId).maybeSingle()
  const c = data as unknown as {
    id: string; customer_name: string; is_active: boolean | null
    address: string | null
    region_si: string | null; region_myeon: string | null; region_ri: string | null
    customer_contacts: Contact[] | null
  } | null
  if (!c) return null
  return {
    planItemId: null, customerId: c.id, customerName: c.customer_name, visitDate,
    // 계획 항목이 없으니 유형·계획축이 존재하지 않는다 — '빠뜨린 것'과 구분되게 null을 못 박는다
    inspectionType: null, planType: null, assigneeName: null,
    regionSi: c.region_si, regionMyeon: c.region_myeon, regionRi: c.region_ri,
    address: c.address,
    contacts: c.customer_contacts ?? [],
    sendable: true, unsendableReason: null,
  }
}

// ── 문구 렌더 ─────────────────────────────────────────────────
export type RenderedMessage = { text: string; byteLen: number; msgType: 'SMS' | 'LMS'; unresolved: string[] }

/** 그룹·수신자별 문구. `{디데이}`는 **발송 시점 기준**으로 계산한다 — 배너 규칙값이 아니다. */
export function renderSmsFor(
  bodyTemplate: string,
  base: Record<string, string>,
  group: { visitDate: string; customerName: string; inspectionTypes?: string[]; assigneeName?: string | null },
  contact: Contact | null,
  today: string,
): RenderedMessage {
  const lead = daysBetween(today, group.visitDate)
  const text = renderTemplate(bodyTemplate, {
    ...base,
    고객명: group.customerName,
    관계인명: contact?.name ?? '',
    디데이: dDayLabel(lead),
    점검일: group.visitDate,
    점검일짧게: shortDate(group.visitDate),
    점검종류: (group.inspectionTypes ?? []).join('·'),
    담당자: group.assigneeName ?? '',
  })
  const unresolved = [...new Set([...text.matchAll(/\{([^}]+)\}/g)].map(m => m[1].trim()))]
  return { text, byteLen: smsByteLength(text), msgType: smsKind(text), unresolved }
}

/** 문구에서 **쓸 수 있는** 변수 이름 전부.
 *
 *  화면이 인라인 편집 중 오타를 즉시 잡으려면 이 목록이 필요하다. 미리보기(`unresolved`)로는
 *  안 된다 — 그건 서버가 렌더한 시점의 문구 기준이라, 사용자가 방금 타이핑한 `{점검일자}`를
 *  모른다. 목록을 클라이언트에 복사해 두면 여기와 갈라지므로 서버가 내려준다. */
export function smsVarNames(base: Record<string, string>): string[] {
  return [...new Set([
    ...Object.keys(base),
    '고객명', '관계인명', '디데이', '점검일', '점검일짧게', '점검종류', '담당자',
  ])]
}

/** 발송 전 미리보기 묶음 — 화면(모달)이 그대로 그린다. 클라이언트는 번호를 계산하지 않는다. */
export async function prepareSms(admin: Admin, targets: SmsTarget[], overrideBody?: string) {
  const tpl = overrideBody != null ? { body: overrideBody } : await loadTemplate(admin, 'inspection_sms')
  const base = await companyVars()
  const today = todayKst()
  const { groups, noPhone } = groupTargets(targets)
  const preview = groups.map(g => ({
    group: g,
    perRecipient: g.recipients.map(c => ({ contact: c, ...renderSmsFor(tpl.body, base, g, c, today) })),
  }))
  return { body: tpl.body, groups, noPhone, preview, totalMessages: countMessages(groups), knownVars: smsVarNames(base) }
}

// ── 발송 ──────────────────────────────────────────────────────
export type SendResult = {
  ok: boolean
  error?: string
  sent: number
  failed: number
  unverified: number
  noPhone: number
  skipped: number
  /** 리허설(SMS_DRY_RUN)에서 "실제로 보내면 몇 통인가" — sent와 섞지 않는다.
   *  sent에 넣으면 화면이 '발송됨'으로 읽어 한 통도 안 나간 것을 성공으로 오인한다. */
  dryRunPlanned?: number
  rows: Array<{ customerName: string; phoneMasked: string; contactName: string | null; status: string; error: string | null }>
}

async function callSolapi(messages: Array<{ to: string; from: string; text: string }>) {
  const apiKey = process.env.SOLAPI_API_KEY!, apiSecret = process.env.SOLAPI_API_SECRET!
  const date = new Date().toISOString()
  const salt = Math.random().toString(36).substring(2, 18)
  const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex')
  try {
    const res = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({ messages }),
    })
    const text = await res.text()
    let body: unknown = text
    try { body = JSON.parse(text) } catch { /* 원문 유지 */ }
    return { status: res.status, body }
  } catch (e) {
    return { status: 0, body: `네트워크 오류: ${String(e)}` }
  }
}

/** 발송 — 순서가 곧 안전장치다.
 *
 *  ① 상한 → ② dryRun(DB 미기록) → ③ allowlist → ④ `sending` 행 기록 →
 *  ⑤ 자격증명 없으면 `failed`(**조용히 성공 금지**) → ⑥ Solapi 1회 →
 *  ⑦ 행별 결과 + 원문 → ⑧ noPhone 기록 → ⑨ 활동 로그
 *
 *  ④를 발송 **전에** 하는 이유: 여기서 프로세스가 죽어도 `sending`이 남아
 *  "보냈는지 모름"이 드러난다. 발송 후에 기록하면 죽었을 때 흔적이 아예 없다.
 */
export async function sendInspectionSms(
  admin: Admin,
  opts: {
    targets: SmsTarget[]
    actorId: string
    kind?: 'pre_visit' | 'manual' | 'adhoc'
    trigger?: 'cron' | 'manual'
    overrideBody?: string
    /** 회차 한정 수신자 변경 — customerId|visitDate → 허용 번호 목록 */
    recipientOverride?: Record<string, string[]>
  },
): Promise<SendResult> {
  const g = smsGuards()
  const today = todayKst()
  const kind = opts.kind ?? 'pre_visit'
  const trigger = opts.trigger ?? 'manual'
  const empty: SendResult = { ok: true, sent: 0, failed: 0, unverified: 0, noPhone: 0, skipped: 0, rows: [] }

  const tpl = opts.overrideBody != null ? { body: opts.overrideBody } : await loadTemplate(admin, 'inspection_sms')
  const base = await companyVars()
  const { groups: allGroups, noPhone } = groupTargets(opts.targets)

  // 미확정 건은 발송하지 않는다 — 목록에는 보이되 나가지는 않는다
  let groups = allGroups.filter(x => x.sendable)
  const blocked = allGroups.length - groups.length

  // 회차 한정 수신자 변경 적용
  if (opts.recipientOverride) {
    groups = groups.map(x => {
      const allow = opts.recipientOverride![`${x.customerId}|${x.visitDate}`]
      if (!allow) return x
      const set = new Set(allow.map(normalizePhone))
      return { ...x, recipients: x.recipients.filter(c => set.has(normalizePhone(c.phone))) }
    }).filter(x => x.recipients.length > 0)
  }

  // ① 상한 — 초과 시 아무것도 보내지 않는다
  const total = countMessages(groups)
  if (total > g.maxPerRun) {
    return { ...empty, ok: false, error: `1회 발송 상한(${g.maxPerRun}통)을 넘습니다 — ${total}통. 범위를 좁혀 나눠 보내주세요.` }
  }
  if (total === 0 && noPhone.length === 0) {
    return { ...empty, ok: false, error: blocked > 0 ? '선택한 건이 모두 점검일 미확정입니다.' : '보낼 대상이 없습니다.' }
  }

  // 발송 단위 펼치기 (1행 = 1수신자)
  type Unit = { group: SmsGroup; contact: Contact; text: string; byteLen: number; msgType: 'SMS' | 'LMS'; phone: string }
  const units: Unit[] = []
  const unresolvedAll = new Set<string>()
  for (const x of groups) {
    for (const c of x.recipients) {
      const r = renderSmsFor(tpl.body, base, x, c, today)
      for (const v of r.unresolved) unresolvedAll.add(v)
      units.push({ group: x, contact: c, text: r.text, byteLen: r.byteLen, msgType: r.msgType, phone: normalizePhone(c.phone) })
    }
  }

  // ①-b 치환되지 않은 변수 — 아무것도 보내지 않는다.
  //
  // 문구 **설정** 저장은 알 수 없는 변수를 이미 거부한다(message-template-actions.ts:60-69).
  // 그런데 이 함수가 받는 overrideBody(모달 인라인 편집)는 그 검사를 통과하지 않는다 —
  // `{점검일자}` 같은 오타가 글자 그대로 고객 문자에 찍히고, 문자는 되돌릴 수 없으며 돈도 나간 뒤다.
  // 화면에서도 버튼을 막지만 이 액션은 공개 엔드포인트라 화면 가드만으로는 우회된다.
  if (unresolvedAll.size > 0) {
    const names = [...unresolvedAll].map(v => `{${v}}`).join(', ')
    return { ...empty, ok: false, error: `치환되지 않은 변수가 있습니다: ${names} — 이대로 보내면 고객에게 글자 그대로 나갑니다.` }
  }

  // ② dryRun — DB에도 남기지 않는다. 리허설이 이력을 오염시키면 리허설이 아니다.
  //
  // ⚠ sent에는 **0을 넣는다**(dryRunPlanned로 따로 알린다). 종전엔 sent=units.length라
  // 화면이 "발송됨 N"으로 읽고 `sent > 0`을 성공 신호로 써서 목록까지 갱신했다 —
  // 한 통도 안 나간 리허설을 성공으로 오인하게 만든다. 이 기능에서 가장 하면 안 되는 착각이다.
  if (g.dryRun) {
    return {
      ok: true, sent: 0, failed: 0, unverified: 0, noPhone: noPhone.length, skipped: 0,
      dryRunPlanned: units.length,
      error: `[리허설] 실제로 발송하지 않았습니다 — 실제로 보내면 ${units.length}통입니다.`,
      rows: units.map(u => ({
        customerName: u.group.customerName, phoneMasked: maskPhone(u.phone),
        contactName: u.contact.name, status: 'dry_run', error: null,
      })),
    }
  }

  // ③ allowlist — 목록이 설정돼 있으면 그 밖의 번호는 보내지 않는다
  const sendUnits = g.allowlist.length > 0 ? units.filter(u => g.allowlist.includes(u.phone)) : units
  const skipped = units.length - sendUnits.length

  // ④ sending 행 claim (발송 **전에**)
  //
  // ⚠ claim이 실패하면 **보내지 않는다**. 종전엔 insert 오류를 버리고 rowIds에 ''를 넣은 뒤 그대로
  // 발송해서, 돈은 나갔는데 이력이 없는 건이 생길 수 있었다 — 그러면 화면이 그 건을 '미발송'으로
  // 표시하고 다음 발송 때 재발송·이중 과금이 된다. claim을 발송 전에 두는 이유가 바로 그것을
  // 막기 위해서인데 오류를 무시하면 그 장치가 정확히 필요한 순간에만 무력해진다(P-1의 재발 형태).
  const rowIds: string[] = []
  /** 이미 claim한 행을 sending 상태로 방치하지 않는다 — 중단도 기록으로 남겨야 사람이 판단한다 */
  const abortClaimed = async (reason: string): Promise<SendResult> => {
    for (const id of rowIds) {
      await admin.from('sms_send_log').update({ status: 'failed', error: reason }).eq('id', id)
    }
    return {
      ok: false, error: reason,
      sent: 0, failed: sendUnits.length, unverified: 0, noPhone: 0, skipped,
      rows: sendUnits.map(u => ({
        customerName: u.group.customerName, phoneMasked: maskPhone(u.phone),
        contactName: u.contact.name, status: 'failed', error: reason,
      })),
    }
  }
  for (const u of sendUnits) {
    const { data, error: claimErr } = await admin.from('sms_send_log').insert({
      kind,
      customer_id: u.group.customerId,
      plan_item_ids: u.group.planItemIds,
      visit_date: u.group.visitDate,
      lead_days: daysBetween(today, u.group.visitDate),
      to_phone: u.phone,
      from_phone: g.from || null,
      contact_role: u.contact.role,
      contact_name: u.contact.name,
      content: u.text,
      byte_len: u.byteLen,
      msg_type: u.msgType,
      status: 'sending',
      trigger,
      sent_by: opts.actorId,
    } as Record<string, unknown>).select('id').single()
    const rowId = (data as { id: string } | null)?.id
    if (claimErr || !rowId) {
      return abortClaimed(
        '발송 이력을 기록하지 못해 발송을 중단했습니다 — 보냈는데 기록이 없으면 재발송·이중 과금이 됩니다.'
        + ` (사유: ${claimErr?.message ?? '이력 행 생성 실패'})`,
      )
    }
    rowIds.push(rowId)
  }

  // 번호 없는 고객도 기록한다 — 못 받았다는 사실이 남아야 사람이 조치할 수 있다(P-2).
  // 이 기록 실패는 발송을 막지 않는다(보낼 대상과 무관) — 다만 삼키지 않고 로그로 표면화한다.
  for (const n of noPhone) {
    const { error: npErr } = await admin.from('sms_send_log').insert({
      kind, customer_id: n.customerId, plan_item_ids: n.planItemIds, visit_date: n.visitDate,
      lead_days: daysBetween(today, n.visitDate),
      to_phone: null, from_phone: g.from || null, content: '(발송 안 됨)',
      status: 'no_phone', error: n.reason, trigger, sent_by: opts.actorId,
    } as Record<string, unknown>)
    if (npErr) console.error('[sms] 번호없음 기록 실패 — 이 고객은 화면에서 미발송으로 남습니다:', n.customerId, npErr.message)
  }

  // ⑤ 자격증명 없음 → 조용히 성공하지 않는다. 이 한 줄이 P-1의 핵심 수리다.
  if (!g.hasCredentials || !g.from) {
    const reason = !g.hasCredentials
      ? 'Solapi 자격증명이 설정되지 않았습니다 (SOLAPI_API_KEY·SOLAPI_API_SECRET).'
      : '발신번호가 설정되지 않았습니다 (SOLAPI_SENDER_PHONE).'
    for (const id of rowIds) if (id) await admin.from('sms_send_log').update({ status: 'failed', error: reason }).eq('id', id)
    return {
      ok: false, error: reason, sent: 0, failed: sendUnits.length, unverified: 0, noPhone: noPhone.length, skipped,
      rows: sendUnits.map(u => ({
        customerName: u.group.customerName, phoneMasked: maskPhone(u.phone),
        contactName: u.contact.name, status: 'failed', error: reason,
      })),
    }
  }

  // ⑥⑦ 발송 1회 → 번호별 판정
  const res = sendUnits.length > 0
    ? await callSolapi(sendUnits.map(u => ({ to: u.phone, from: g.from, text: u.text })))
    : { status: 200, body: { messageList: [] } }
  const verdicts = parseSolapiResult(sendUnits.map(u => u.phone), res.status, res.body)

  const rows: SendResult['rows'] = []
  let sent = 0, failed = 0, unverified = 0
  for (let i = 0; i < sendUnits.length; i++) {
    const u = sendUnits[i]
    const v = verdicts.get(u.phone) ?? { status: 'unverified' as const, error: '판정 없음' }
    if (v.status === 'sent') sent++; else if (v.status === 'failed') failed++; else unverified++
    // claim이 보장되므로 조건 없이 갱신한다 — 종전의 `if (rowIds[i])`는 claim 실패를 조용히
    // 건너뛰어, 발송 결과가 sending 상태로 굳는 행을 만들었다.
    const upd = await admin.from('sms_send_log').update({
      status: v.status,
      provider_message_id: v.messageId ?? null,
      provider_status_code: v.statusCode ?? null,
      provider_raw: (res.body ?? null) as Record<string, unknown> | null,
      error: v.error ?? null,
    } as Record<string, unknown>).eq('id', rowIds[i])
    // 결과 기록 실패는 발송을 되돌릴 수 없으니 중단하지 않는다. 대신 삼키지도 않는다 —
    // sending으로 남은 행은 사람이 봐야 한다(조용히 지나가면 '보냈는지 모르는' 건이 된다).
    if (upd.error) {
      console.error('[sms] 발송 결과 기록 실패 — 행이 sending으로 남습니다:', rowIds[i], upd.error.message)
    }
    rows.push({
      customerName: u.group.customerName, phoneMasked: maskPhone(u.phone),
      contactName: u.contact.name, status: v.status, error: v.error ?? null,
    })
  }

  // ⑨ 활동 로그 — 번호는 마스킹해서 남긴다. sms_send_log가 원천이라 이 실패가 발송 판정을
  // 바꾸지는 않지만, 조용히 넘기면 감사 흔적만 사라진다.
  const { error: logErr } = await admin.from('activity_logs').insert({
    actor_id: opts.actorId,
    action: 'inspection_sms_sent',
    entity_type: 'sms_send_log',
    entity_id: null,
    metadata: {
      kind, trigger, sent, failed, unverified, no_phone: noPhone.length, skipped,
      recipients: rows.map(r => r.phoneMasked),
    },
  } as Record<string, unknown>)
  if (logErr) console.error('[sms] 발송 활동 로그 기록 실패:', logErr.message)

  return {
    ok: failed === 0, sent, failed, unverified, noPhone: noPhone.length, skipped, rows,
    error: failed > 0 ? `${failed}건 발송 실패 — 사유는 건별 결과를 확인해주세요.` : undefined,
  }
}

/** 설정된 시점 규칙 — company_profile은 '단일 행' 전제지만 실측상 여러 행일 수 있어
 *  정렬을 고정한다(고정 안 하면 저장한 행과 읽는 행이 달라진다). */
export async function loadLeadRules(admin: Admin): Promise<number[]> {
  const { data } = await admin.from('company_profile').select('sms_lead_rules')
    .order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle()
  return validateLeadRules((data as { sms_lead_rules?: unknown } | null)?.sms_lead_rules ?? [1]).rules
}

/** 지금 보내야 할 안내가 몇 곳인가 — 사이드바 뱃지·대시보드 위젯이 함께 쓴다 (S9-5).
 *
 *  뱃지가 배너와 다른 수를 보여주면 사용자는 어느 쪽을 믿을지 모른다.
 *  그래서 배너와 **같은 함수**(resolvePendingNotices)로 센다. */
export async function countUnsentNotices(admin: Admin): Promise<{
  count: number
  messages: number
  rules: number[]
  /** 가장 가까운(작은 lead) 시점의 요약 — 위젯 문구용 */
  nearest: { leadDays: number; visitDate: string; label: string; unsentCount: number; messageCount: number; totalCount: number } | null
  /** 안내 못 하고 지나간 방문 — 발송은 못 하지만 **알려는 줘야 한다** */
  overdueCount: number
}> {
  const today = todayKst()
  const rules = await loadLeadRules(admin)
  const to = addDays(today, Math.max(...rules, 1))
  // ★ 지난 방문일도 함께 싣는다(includePast) — 종전에는 from을 today로 clamp해서
  //   overdue가 **구조적으로 항상 0**이었고 '시기 지남' 줄이 렌더될 수 없었다.
  //   OVERDUE_WINDOW만 거슬러 본다: 몇 달 전 건까지 계속 띄우면 경고가 소음이 된다.
  const from = addDays(today, -OVERDUE_WINDOW_DAYS)
  const targets = await loadSmsTargets(admin, { from, to, includePast: true })
  const { groups } = groupTargets(targets)
  const sent = await loadSentPairs(admin, from, to)
  const { notices, overdue } = resolvePendingNotices(groups, rules, today, (c, v) => sent.has(`${c}|${v}`))

  const withWork = [...notices].sort((a, b) => a.leadDays - b.leadDays).find(n => n.unsentCount > 0)
    ?? [...notices].sort((a, b) => a.leadDays - b.leadDays)[0] ?? null
  return {
    count: notices.reduce((n, x) => n + x.unsentCount, 0),
    messages: notices.reduce((n, x) => n + x.messageCount, 0),
    rules,
    nearest: withWork ? {
      leadDays: withWork.leadDays, visitDate: withWork.visitDate, label: withWork.label,
      unsentCount: withWork.unsentCount, messageCount: withWork.messageCount,
      totalCount: withWork.groups.length,
    } : null,
    overdueCount: overdue.count,
  }
}

/** 이미 보낸 (고객, 방문일) 쌍 — '미발송' 판정의 단일 규칙 (S5-10).
 *  plan_item이 아니라 **방문일 쌍**이 키라서, 점검일을 옮기면 자동으로 다시 미발송이 된다. */
export async function loadSentPairs(admin: Admin, from: string, to: string): Promise<Set<string>> {
  // 1000행 상한에 걸리면 **보낸 건이 미발송으로 되살아난다** — 배너가 다시 권하고,
  // 승인하면 같은 고객에게 두 번 간다(돈도 두 번). 여기는 특히 끝까지 받아야 한다.
  const page = await fetchAllRows((f, t) => admin
    .from('sms_send_log')
    .select('customer_id, visit_date')
    // unverified·sending도 '보냄'으로 친다 — 둘 다 **실제로 나갔을 수 있는** 상태다.
    // 미발송으로 두면 배너가 재발송을 권하고, 이미 받은 고객이 두 번 받는다(요금도 두 번).
    // 대신 목록에서는 각각 '확인불가'·'확인필요'로 드러나 사람이 판단할 수 있다.
    .in('status', ['sent', 'unverified', 'sending'])
    .gte('visit_date', from).lte('visit_date', to)
    .order('id')
    .range(f, t))
  if (page.truncated) console.error('[sms] 발송 이력(쌍) 로드 상한 도달 — 중복 발송 위험:', page.rows.length)
  const set = new Set<string>()
  for (const r of page.rows as Array<{ customer_id: string; visit_date: string }>) {
    set.add(`${r.customer_id}|${r.visit_date}`)
  }
  return set
}

export { pickContacts }
