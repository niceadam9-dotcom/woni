import 'server-only'

import { createHmac } from 'crypto'
import type { createAdminClient } from '@/lib/supabase/admin'
import { loadTemplate, companyVars } from '@/lib/message-template'
import { COMPANY_PROFILE_ORDER } from '@/lib/company-profile'
import { fetchAllRows } from '@/lib/supabase/paginate'
import {
  pickContacts, groupTargets, countMessages, normalizePhone, maskPhone,
  smsByteLength, smsKind, dDayLabel, daysBetween, todayKst, shortDate, addDays,
  parseSolapiResult, renderTemplate, unresolvedVars, resolvePendingNotices, validateLeadRules,
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

/** '동시에 누른 것'으로 볼 시간 창(④-b).
 *  이보다 오래된 발송은 경합이 아니라 **의도한 재발송**이고, 그쪽은 ②-b가 확인을 받는다.
 *  짧으면 느린 요청이 서로를 못 보고, 길면 정상 재발송이 경합으로 오인된다. */
const CONCURRENT_WINDOW_MS = 120_000

/** '시기 지남'을 거슬러 볼 **하한 날짜**: 창(오늘-30)과 기능 도입일(epoch) 중 늦은 쪽.
 *
 *  `epoch`가 null이면(=아직 한 번도 안 보냄) **오늘**을 준다 — 과거 구간이 아예 없어져
 *  '시기 지남'이 0이 된다. 기능을 쓴 적이 없으면 놓친 것도 없다.
 *
 *  ⚠ 뱃지(countUnsentNotices)와 배너(listSmsStatusAction)가 **이 함수 하나**를 쓴다.
 *  각자 계산하면 주석엔 '같은 규칙'이라 써 놓고 수가 갈린다 — 사용자는 어느 쪽을 믿을지 모른다. */
export function overdueFloor(windowFrom: string, epoch: string | null): string {
  if (!epoch) return todayKst()
  return windowFrom > epoch ? windowFrom : epoch
}

/** 고객 → 관계인 임베드.
 *
 *  ⚠ `!customer_id` 힌트가 **반드시** 있어야 한다. 마이그레이션 145가
 *  `customers.manager_contact_id → customer_contacts(id)`를 만들면서 두 테이블 사이 관계가
 *  둘이 됐고, 힌트 없는 임베드는 PostgREST가 `PGRST201`로 **거절**한다(추측 아닌 실측).
 *  그 순간 발송 대상 조회가 통째로 throw해서 문자 발송 화면이 열리지 않는다.
 *
 *  상수로 묶어 두는 이유: 같은 임베드를 쓰는 곳이 둘(대상 목록·임의 발송 1건)인데
 *  한쪽만 고치면 나머지가 조용히 남는다 — 실제로 145 적용 직후 두 곳이 함께 깨졌다. */
const CONTACTS_EMBED = 'customer_contacts!customer_id ( id, role, name, phone, sms_recipient )'

// ── 안전장치 ──────────────────────────────────────────────────
/** 문자는 되돌릴 수 없고 돈이 나간다. 세 겹으로 막는다. */
export function smsGuards() {
  return {
    /** 네트워크 호출 없이 가짜 성공 — 운영에서 "잠깐 멈춤" 스위치로도 쓴다.
     *
     *  ⚠ `=== '1'` 정확 일치였다. 이건 **발송을 멈추는** 스위치인데, `true`·`on`·`yes`로 적으면
     *  가드가 열린 채 실발송됐다 — 켰다고 믿는 순간이 가장 위험하다는 점에서 allowlist
     *  fail-open과 같은 부류인데, 하필 더 중요한 쪽에 그 처리가 없었다.
     *  참으로 읽힐 만한 값은 전부 참으로 본다. 애매하면 **멈추는 쪽**이 안전하다. */
    dryRun: ['1', 'true', 'yes', 'on', 'y'].includes((process.env.SMS_DRY_RUN ?? '').trim().toLowerCase()),
    /** 목록 밖 번호는 전부 skip. 스테이징에 걸어두면 사고 시 최대 피해가 본인 1통 */
    allowlist: (process.env.SMS_ALLOWLIST ?? '').split(',').map(s => normalizePhone(s)).filter(Boolean),
    /** 값이 **설정돼 있었는가** — 정규화 결과가 비었는지와 따로 본다.
     *
     *  ⚠ 이 둘을 구분하지 않으면 fail-open이 된다: `SMS_ALLOWLIST="내번호"`처럼 숫자가 없는
     *  오타를 넣으면 normalizePhone이 전부 버려 빈 배열이 되고, 빈 배열은 '미설정'과 같아
     *  **전건이 실고객에게 나간다**. 가드를 켰다고 믿는 순간이 가장 위험하다.
     *  화면 배너도 함께 사라져 켜진 줄 알 단서조차 없다. */
    allowlistSet: (process.env.SMS_ALLOWLIST ?? '').trim().length > 0,
    /** 1회 상한 — 초과하면 발송 자체를 안 한다(부분 발송으로 어중간하게 만들지 않는다).
     *
     *  ⚠ `Number(x) || 200`이었다. 그래서 **0을 넣으면 200이 된다** — 상한 0으로 전면 차단하려는
     *  운영자가 정확히 반대 결과를 얻는다. 0은 0으로, 숫자가 아닐 때만 기본값으로 되돌린다. */
    maxPerRun: (() => {
      const raw = (process.env.SMS_MAX_PER_RUN ?? '').trim()
      if (raw === '') return 200
      const n = Number(raw)
      return Number.isFinite(n) && n >= 0 ? n : 200
    })(),
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
          ${CONTACTS_EMBED}
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
  // ⚠ **조용히 빈 목록을 돌려주지 않는다.**
  //
  //  종전엔 오류를 삼키고 []를 반환했다. 그러면 배너는 "오늘 보낼 안내 없음 ✓",
  //  모달은 "보낼 대상이 없습니다", 사이드바 뱃지는 0이 된다 — 조회가 실패했을 뿐인데
  //  화면 전체가 **정상적으로 할 일이 없는 상태**와 똑같이 보인다. 방문 전날 전건 미발송을
  //  아무도 모르게 넘길 수 있는 형태라, 이 기능에서 가장 위험한 종류의 침묵이다.
  //  던지면 호출부의 error 경로를 타고 사용자에게 사유가 뜬다.
  if (page.error) {
    // fetchAllRows의 error는 **문자열**이다(객체 아님) — .message로 읽으면 빌드가 깨진다
    throw new Error(`발송 대상을 불러오지 못했습니다: ${page.error}`)
  }
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
  const { data, error } = await admin
    .from('customers')
    .select(`id, customer_name, is_active, address, region_si, region_myeon, region_ri, ${CONTACTS_EMBED}`)
    .eq('id', customerId).maybeSingle()
  // 조회 실패를 null로 뭉개면 화면에 "고객을 찾을 수 없습니다"가 떠 원인을 엉뚱한 곳에서 찾게 된다
  if (error) throw new Error(`고객 정보를 불러오지 못했습니다: ${error.message}`)
  const c = data as unknown as {
    id: string; customer_name: string; is_active: boolean | null
    address: string | null
    region_si: string | null; region_myeon: string | null; region_ri: string | null
    customer_contacts: Contact[] | null
  } | null
  if (!c) return null
  // ⚠ is_active를 select만 하고 쓰지 않았다 — **계약이 끝난 고객에게 임의 발송이 나갔다.**
  //   계획 경로(loadSmsTargets:144)는 같은 조건을 거른다. 두 경로의 규칙이 갈리면 안 된다.
  if (c.is_active === false) return null
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
    /** 이미 보낸 건을 **알고도** 다시 보낸다(화면에서 한 번 더 확인한 경우).
     *  기본 false — 모르고 두 번 나가는 것을 기본값이 막아야 한다. */
    allowResend?: boolean
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

  // ①-b **알 수 없는** 변수 — 아무것도 보내지 않는다.
  //
  // 문구 **설정** 저장은 알 수 없는 변수를 이미 거부한다(message-template-actions.ts:60-69).
  // 그런데 이 함수가 받는 overrideBody(모달 인라인 편집)는 그 검사를 통과하지 않는다 —
  // `{점검일자}` 같은 오타가 글자 그대로 고객 문자에 찍히고, 문자는 되돌릴 수 없으며 돈도 나간 뒤다.
  // 화면에서도 버튼을 막지만 이 액션은 공개 엔드포인트라 화면 가드만으로는 우회된다.
  //
  // ⚠ **오타와 '값이 빈 변수'를 구분한다.** renderTemplate은 값이 비면 `{담당자}`를 그대로
  //   남긴다(sms-recipients.ts renderTemplate — 조용한 빈칸을 막으려는 의도적 설계).
  //   그것까지 여기서 막으면, 담당자가 없는 계획 한 건 때문에 **그 배치 전체가 안 나간다**.
  //   오타는 문구 전체의 문제라 전건 차단이 맞고, 빈 값은 그 건만의 문제라 아래에서 건별로 뺀다.
  //   (화면 가드도 knownVars 기준이라, 이렇게 해야 서버와 화면 판정이 갈라지지 않는다.)
  const known = new Set(smsVarNames(base))
  const unknownVars = [...unresolvedAll].filter(v => !known.has(v))
  if (unknownVars.length > 0) {
    const names = unknownVars.map(v => `{${v}}`).join(', ')
    return { ...empty, ok: false, error: `알 수 없는 변수가 있습니다: ${names} — 이대로 보내면 고객에게 글자 그대로 나갑니다.` }
  }

  // ①-c 값이 비어 `{변수}`가 남은 **건만** 뺀다 — 나머지는 정상 발송한다.
  //   조용히 빼지 않고 사유와 함께 noPhone 옆에 기록한다(못 받은 고객이 기록에 남아야 조치가 된다).
  //
  // ⚠ 여기엔 **세 번째 경우**가 있다(3차 판정). 위 2분법은 '오타=전건 / 빈 값=건별'인데,
  //   `{회사전화}`처럼 **모든 건에 공통인 값**이 비면 결과적으로 전건이 빠진다.
  //   그건 그 건들의 문제가 아니라 **회사 정보 한 칸의 문제**이므로, 사유가 그렇게 읽혀야 한다.
  //   종전 문구는 "값을 채우거나 문구에서 빼주세요"라 사용자가 고객 데이터를 뒤지게 만들었고,
  //   company_profile 조회가 한 번 실패한 경우엔 값이 멀쩡히 채워져 있어 영원히 못 찾는다.
  const emptyVarUnits = units.filter(u => unresolvedVars(u.text).length > 0)
  const sendableUnits = units.filter(u => unresolvedVars(u.text).length === 0)
  if (emptyVarUnits.length > 0 && sendableUnits.length === 0) {
    // 전 건에 공통으로 비어 있는 변수를 골라, **어디를 고쳐야 하는지**까지 말한다.
    // 회사 정보 계열(base)이면 회사 관리를, 아니면 그 데이터를 가리켜야 사용자가 헤매지 않는다.
    const commonEmpty = [...unresolvedAll].filter(v => units.every(u => unresolvedVars(u.text).includes(v)))
    const names = (commonEmpty.length > 0 ? commonEmpty : [...unresolvedAll]).map(v => `{${v}}`).join(', ')
    const companyOnes = commonEmpty.filter(v => v in base)
    return {
      ...empty, ok: false,
      error: commonEmpty.length > 0
        ? `문구의 ${names} 값이 비어 있습니다 — 모든 건이 그래서 한 통도 보낼 수 없습니다.`
          + (companyOnes.length > 0
            ? ' 회사 정보(회사 관리)에 그 값이 비었거나 불러오지 못한 상태입니다.'
            : ' 해당 값을 채우거나 문구에서 빼주세요.')
        : `문구의 ${names} 값이 비어 있어 보낼 수 있는 건이 없습니다 — 값을 채우거나 문구에서 빼주세요.`,
    }
  }

  // ② dryRun — DB에도 남기지 않는다. 리허설이 이력을 오염시키면 리허설이 아니다.
  //
  // ⚠ sent에는 **0을 넣는다**(dryRunPlanned로 따로 알린다). 종전엔 sent=units.length라
  // 화면이 "발송됨 N"으로 읽고 `sent > 0`을 성공 신호로 써서 목록까지 갱신했다 —
  // 한 통도 안 나간 리허설을 성공으로 오인하게 만든다. 이 기능에서 가장 하면 안 되는 착각이다.
  if (g.dryRun) {
    return {
      ok: true, sent: 0, failed: 0, unverified: 0, noPhone: noPhone.length, skipped: emptyVarUnits.length,
      dryRunPlanned: sendableUnits.length,
      error: `[리허설] 실제로 발송하지 않았습니다 — 실제로 보내면 ${sendableUnits.length}통입니다.`
        + (emptyVarUnits.length > 0 ? ` (변수 값이 비어 제외 ${emptyVarUnits.length}건)` : ''),
      rows: [
        ...sendableUnits.map(u => ({
          customerName: u.group.customerName, phoneMasked: maskPhone(u.phone),
          contactName: u.contact.name, status: 'dry_run', error: null,
        })),
        ...emptyVarUnits.map(u => ({
          customerName: u.group.customerName, phoneMasked: maskPhone(u.phone),
          contactName: u.contact.name, status: 'failed',
          error: `문구의 ${unresolvedVars(u.text).map(v => `{${v}}`).join(', ')} 값이 비어 있습니다`,
        })),
      ],
    }
  }

  // ②-b 이미 보낸 건 — **서버가 다시 묻는다**.
  //
  // 화면에도 확인 1회가 있지만(모달 confirmDup) 그건 탭 하나 안의 상태다.
  // 탭을 두 개 열거나 액션을 다시 호출하면 그 확인을 통째로 건너뛴다 —
  // 이 액션은 'use server' 공개 엔드포인트라 화면 가드는 우회를 전제해야 한다.
  //
  // ⚠ **유니크 인덱스를 걸지 않는 이유**(Q-12): 재발송은 사람의 판단이다.
  // 실패했거나 고객이 못 받았으면 다시 보내야 하고, 인덱스는 그 길까지 영구히 막는다.
  // 그래서 '막는' 대신 '한 번 더 확인'한다 — allowResend를 명시해야 통과한다.
  if (!opts.allowResend) {
    const dates = groups.map(x => x.visitDate).sort()
    const already = await loadSentPairs(admin, dates[0], dates[dates.length - 1])
    const dup = groups.filter(x => already.has(`${x.customerId}|${x.visitDate}`))
    if (dup.length > 0) {
      const names = dup.slice(0, 3).map(x => x.customerName).join(', ')
      return {
        ...empty, ok: false,
        error: `이미 안내를 보낸 건이 ${dup.length}곳 있습니다 (${names}${dup.length > 3 ? ' 외' : ''}).`
          + ' 다시 보내려면 화면에서 한 번 더 확인해주세요.',
      }
    }
  }

  // ③ allowlist — 설정돼 있으면 그 밖의 번호는 보내지 않는다.
  //   **설정됐는데 쓸 수 있는 번호가 하나도 없으면 전건을 막는다**(fail-closed).
  //   빈 목록을 '미설정'으로 흘려보내면 오타 하나가 실고객 전건 발송이 된다.
  if (g.allowlistSet && g.allowlist.length === 0) {
    return {
      ...empty, ok: false,
      error: 'SMS_ALLOWLIST가 설정돼 있으나 유효한 번호가 하나도 없습니다 — 오타로 가드가 풀리는 것을 막기 위해 발송하지 않았습니다.',
    }
  }
  const sendUnits = g.allowlistSet ? sendableUnits.filter(u => g.allowlist.includes(u.phone)) : sendableUnits
  const skipped = sendableUnits.length - sendUnits.length + emptyVarUnits.length

  // ④ sending 행 claim (발송 **전에**)
  //
  // ⚠ claim이 실패하면 **보내지 않는다**. 종전엔 insert 오류를 버리고 rowIds에 ''를 넣은 뒤 그대로
  // 발송해서, 돈은 나갔는데 이력이 없는 건이 생길 수 있었다 — 그러면 화면이 그 건을 '미발송'으로
  // 표시하고 다음 발송 때 재발송·이중 과금이 된다. claim을 발송 전에 두는 이유가 바로 그것을
  // 막기 위해서인데 오류를 무시하면 그 장치가 정확히 필요한 순간에만 무력해진다(P-1의 재발 형태).
  const rowIds: string[] = []
  const claims: Array<{ id: string; created_at: string; unit: Unit }> = []

  /** 번호 없는 고객을 기록한다 — 못 받았다는 사실이 남아야 사람이 조치할 수 있다(P-2).
   *
   *  **모든 종료 경로에서 불린다.** 성공만이 아니라 claim 실패·경합 중단에서도 남겨야 한다 —
   *  중단됐다고 그 고객이 문자를 받은 것은 아니기 때문이다. 두 번 불려도 안전하도록
   *  한 번만 실행한다(중단 경로가 정상 경로와 겹칠 수 있다).
   *  이 기록 실패는 발송을 막지 않는다(보낼 대상과 무관) — 다만 삼키지 않고 로그로 표면화한다. */
  let noPhoneRecorded = false
  const recordNoPhone = async () => {
    if (noPhoneRecorded) return
    noPhoneRecorded = true
    for (const n of noPhone) {
      const { error: npErr } = await admin.from('sms_send_log').insert({
        kind, customer_id: n.customerId, plan_item_ids: n.planItemIds, visit_date: n.visitDate,
        lead_days: daysBetween(today, n.visitDate),
        to_phone: null, from_phone: g.from || null, content: '(발송 안 됨)',
        status: 'no_phone', error: n.reason, trigger, sent_by: opts.actorId,
      } as Record<string, unknown>)
      if (npErr) console.error('[sms] 번호없음 기록 실패 — 이 고객은 화면에서 미발송으로 남습니다:', n.customerId, npErr.message)
    }
  }
  /** 이미 claim한 행을 sending 상태로 방치하지 않는다 — 중단도 기록으로 남겨야 사람이 판단한다.
   *
   *  `discard=true`면 **행을 지운다**. 경합에서 물러난 쪽이 그 경우다.
   *  물러난 쪽은 Solapi를 부른 적이 없으므로 '실패'가 아니라 **아무 일도 없었던 것**이다.
   *  failed로 남기면 목록의 상태 우선순위가 failed > sent라(sms-actions rowOf)
   *  **승자가 실제로 보낸 그 건이 화면에 '실패'로 표시되고**, 기본 필터(발송 제외)에 계속 남아
   *  재발송을 유도한다 — 이 기능이 막으려던 거짓말의 정확한 반대 방향이다.
   *  반면 claim 실패 같은 진짜 사고는 failed로 남겨야 사람이 본다.
   *  (경합 패자 삭제는 ④-b가 건별로 직접 처리한다 — 종전의 `discard` 인자는 그때 옮기며
   *   아무도 true로 넘기지 않는 죽은 분기가 됐다. 같은 규칙이 두 곳에 있으면 갈라진다.) */
  const abortClaimed = async (reason: string): Promise<SendResult> => {
    for (const id of rowIds) {
      await admin.from('sms_send_log').update({ status: 'failed', error: reason }).eq('id', id)
    }
    // ⚠ 번호 없는 고객 기록은 **중단해도 남겨야 한다.** 종전엔 기록 루프가 이 조기 반환보다
    //   아래에 있어, claim 실패·경합으로 끊기면 못 받은 고객이 흔적 없이 사라지고
    //   결과창은 "번호없음 0"이라고 말했다 — 이 모듈이 P-2로 규정한 그 사고다.
    await recordNoPhone()
    return {
      ok: false, error: reason,
      sent: 0, failed: sendUnits.length, unverified: 0, noPhone: noPhone.length, skipped,
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
    } as Record<string, unknown>).select('id, created_at').single()
    const claimed = data as { id: string; created_at: string } | null
    if (claimErr || !claimed?.id) {
      return abortClaimed(
        '발송 이력을 기록하지 못해 발송을 중단했습니다 — 보냈는데 기록이 없으면 재발송·이중 과금이 됩니다.'
        + ` (사유: ${claimErr?.message ?? '이력 행 생성 실패'})`,
      )
    }
    rowIds.push(claimed.id)
    claims.push({ ...claimed, unit: u })
  }

  // ④-b 동시 발송 감지 — **claim 뒤에** 본다.
  //
  // ②-b는 '이미 보낸 것'을 막지만, 두 탭이 **동시에** 누르면 어느 쪽도 상대의 sent 행을
  // 아직 못 본다(read-then-write의 TOCTOU). 그래서 claim을 먼저 하고 **그 다음에** 확인한다:
  // 두 요청 모두 상대의 sending 행을 보게 되므로, 더 이른 쪽만 진행하고 늦은 쪽은 스스로 물러난다.
  //
  // ⚠ 판정 단위는 **요청이 아니라 메시지**(고객·방문일·번호)다.
  //
  //  요청 단위로 비교하면(내 claim 최소 순위 vs 상대 최소 순위) 두 가지가 다 깨진다:
  //   · 부분 겹침 — A={X,Y}, B={Y,Z}면 비교가 비대칭이라 **양쪽 다 진행**하고 Y가 2통 받는다.
  //   · 사슬형 — A={X}, B={X,Y}, C={Y}면 B와 C가 **둘 다 물러나** Y가 아무에게서도 안 나간다.
  //  중복을 막아야 하는 대상은 '요청'이 아니라 '한 사람에게 가는 한 통'이므로,
  //  겹치는 그 메시지만 떨어뜨리고 겹치지 않는 나머지는 그대로 보낸다.
  //  같은 메시지에 대해서는 (created_at, id) 전순서로 정확히 한쪽만 이긴다.
  //
  // 유니크 인덱스 없이 경합만 잡는 방식이라 정상 재발송 경로는 그대로 열려 있다.
  const racedIdx = new Set<number>()
  if (claims.length > 0) {
    const since = new Date(Date.now() - CONCURRENT_WINDOW_MS).toISOString()
    const mine = new Set(rowIds)
    const rank = (r: { id: string; created_at: string }) => `${r.created_at}|${r.id}`
    for (let i = 0; i < claims.length; i++) {
      const c = claims[i]
      const { data: rivals, error: rivalErr } = await admin.from('sms_send_log')
        .select('id, created_at')
        .eq('customer_id', c.unit.group.customerId)
        .eq('visit_date', c.unit.group.visitDate)
        .eq('to_phone', c.unit.phone)
        // ⚠ **의도한 재발송을 경합으로 오인하면 안 된다.**
        //   allowResend는 사용자가 화면에서 한 번 더 확인했다는 뜻이다. 그런데 직전의
        //   sent·unverified를 라이벌로 세면 **발송 직후 120초 동안 재발송이 막히고**,
        //   "다른 창에서 보내는 중"이라며 **존재하지도 않는 창**을 가리킨다.
        //   고객이 "문자 못 받았다"고 전화한 직후가 정확히 그 창이고, unverified(나갔는지
        //   모르는 상태)를 확인차 다시 보내려는 경우도 여기 걸린다 —
        //   Q-12가 유니크 인덱스를 철회하며 지키려던 길이 바로 이것이다.
        //   그래서 재발송을 명시했으면 **아직 나가는 중인 것(sending)만** 경합으로 본다.
        .in('status', opts.allowResend ? ['sending'] : ['sending', 'sent', 'unverified'])
        .gte('created_at', since)
      // 조회 자체가 실패하면 경합 여부를 **모르는** 것이다. 모르는 채로 보내면 가드가 없는 것과 같다.
      if (rivalErr) {
        return abortClaimed(`동시 발송 여부를 확인하지 못해 중단했습니다 (${rivalErr.message}).`)
      }
      const lost = (rivals ?? []).some(r => !mine.has(r.id) && rank(r) < rank(c))
      if (lost) {
        racedIdx.add(i)
        // 보낸 적이 없으므로 claim 행을 지운다 — failed로 남기면 목록 우선순위(failed > sent)
        // 때문에 **승자가 실제로 보낸 그 건이 '실패'로 표시**되고 재발송을 유도한다.
        //
        // ⚠ 삭제 실패를 삼키면 안 된다. 이 행은 승자 행보다 **나중**이라, 남으면 rowOf가
        //   그 번호의 최신으로 잡아 승자의 실제 발송이 영구히 '확인필요'가 되고
        //   loadSentPairs는 '보냄'으로 쳐서 재발송도 막힌다 — 양쪽으로 갇힌다.
        const { error: delErr } = await admin.from('sms_send_log').delete().eq('id', c.id)
        if (delErr) {
          console.error('[sms] 경합 claim 삭제 실패 — 이 행이 승자의 발송을 가립니다:', c.id, delErr.message)
          await admin.from('sms_send_log').update({
            status: 'failed', error: '동시 발송으로 취소됨(정리 실패 — 이 행은 무시해주세요)',
          }).eq('id', c.id)
        }
      }
    }
  }
  const liveUnits = sendUnits.filter((_, i) => !racedIdx.has(i))
  const liveRowIds = rowIds.filter((_, i) => !racedIdx.has(i))
  const racedCount = racedIdx.size
  if (racedCount > 0 && liveUnits.length === 0) {
    await recordNoPhone()   // 중단해도 못 받은 고객은 기록에 남아야 한다(P-2)
    return {
      ...empty, ok: false, skipped: skipped + racedCount, noPhone: noPhone.length,
      error: `선택한 건을 방금 다른 창에서 보내는 중입니다 (${racedCount}건).`
        + ' 이중 발송을 막기 위해 보내지 않았습니다 — 먼저 시작된 쪽의 결과를 확인해주세요.',
    }
  }

  // ①-c에서 뺀 건도 기록한다 — 조용히 빠지면 "왜 이 고객만 문자가 안 갔지"를 알 길이 없다.
  for (const u of emptyVarUnits) {
    const reason = `문구의 ${unresolvedVars(u.text).map(v => `{${v}}`).join(', ')} 값이 비어 있어 보내지 않았습니다`
    const { error: evErr } = await admin.from('sms_send_log').insert({
      kind, customer_id: u.group.customerId, plan_item_ids: u.group.planItemIds, visit_date: u.group.visitDate,
      lead_days: daysBetween(today, u.group.visitDate),
      to_phone: u.phone, from_phone: g.from || null,
      contact_role: u.contact.role, contact_name: u.contact.name,
      content: u.text, byte_len: u.byteLen, msg_type: u.msgType,
      status: 'failed', error: reason, trigger, sent_by: opts.actorId,
    } as Record<string, unknown>)
    if (evErr) console.error('[sms] 빈 변수 제외 기록 실패:', u.group.customerId, evErr.message)
  }

  await recordNoPhone()

  // ⑤ 자격증명 없음 → 조용히 성공하지 않는다. 이 한 줄이 P-1의 핵심 수리다.
  if (!g.hasCredentials || !g.from) {
    const reason = !g.hasCredentials
      ? 'Solapi 자격증명이 설정되지 않았습니다 (SOLAPI_API_KEY·SOLAPI_API_SECRET).'
      : '발신번호가 설정되지 않았습니다 (SOLAPI_SENDER_PHONE).'
    for (const id of liveRowIds) await admin.from('sms_send_log').update({ status: 'failed', error: reason }).eq('id', id)
    return {
      ok: false, error: reason, sent: 0, failed: liveUnits.length, unverified: 0, noPhone: noPhone.length,
      skipped: skipped + racedCount,
      rows: liveUnits.map(u => ({
        customerName: u.group.customerName, phoneMasked: maskPhone(u.phone),
        contactName: u.contact.name, status: 'failed', error: reason,
      })),
    }
  }

  // ⑥⑦ 발송 1회 → 번호별 판정
  const res = liveUnits.length > 0
    ? await callSolapi(liveUnits.map(u => ({ to: u.phone, from: g.from, text: u.text })))
    : { status: 200, body: { messageList: [] } }
  const verdicts = parseSolapiResult(liveUnits.map(u => u.phone), res.status, res.body)

  const rows: SendResult['rows'] = []
  let sent = 0, failed = 0, unverified = 0
  for (let i = 0; i < liveUnits.length; i++) {
    const u = liveUnits[i]
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
    } as Record<string, unknown>).eq('id', liveRowIds[i])
    // 결과 기록 실패는 발송을 되돌릴 수 없으니 중단하지 않는다. 대신 삼키지도 않는다 —
    // sending으로 남은 행은 사람이 봐야 한다(조용히 지나가면 '보냈는지 모르는' 건이 된다).
    if (upd.error) {
      console.error('[sms] 발송 결과 기록 실패 — 행이 sending으로 남습니다:', liveRowIds[i], upd.error.message)
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
    ok: failed === 0, sent, failed, unverified, noPhone: noPhone.length,
    skipped: skipped + racedCount, rows,
    error: failed > 0 ? `${failed}건 발송 실패 — 사유는 건별 결과를 확인해주세요.` : undefined,
  }
}

/** 설정된 시점 규칙 — company_profile은 '단일 행' 전제지만 실측상 여러 행일 수 있어
 *  정렬을 고정한다(고정 안 하면 저장한 행과 읽는 행이 달라진다). */
export async function loadLeadRules(admin: Admin): Promise<number[]> {
  const { data, error } = await admin.from('company_profile').select('sms_lead_rules')
    .order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle()
  // ⚠ 오류를 버리고 `?? [1]` 폴백으로 가면, 설정이 [7,1]이어도 조용히 [1]이 되어
  //   **7일 전 안내 줄이 통째로 사라진다.** 사용자는 "이번 주엔 대상이 없나 보다"로 읽는다.
  //   설정을 못 읽은 것과 설정이 [1]인 것은 완전히 다른 상태다.
  if (error) throw new Error(`발송 시점 설정을 불러오지 못했습니다: ${error.message}`)
  return validateLeadRules((data as { sms_lead_rules?: unknown } | null)?.sms_lead_rules ?? [1]).rules
}

/** '시기 지남'을 어디까지 거슬러 볼 것인가의 **하한**.
 *
 *  ⚠ 하한이 없으면 **기능을 켠 날 한 달치 방문이 전부 '안내 못 하고 지난 방문'으로 뜬다**.
 *  그 건들은 사전 안내라는 기능이 없던 시절의 방문이라 안내를 '놓친' 것이 아니다.
 *  수백 건짜리 빨간 경고는 읽히지 않고, 진짜로 놓친 한 건을 그 속에 묻는다.
 *
 *  기준은 **첫 발송 이력**이다 — 이 기능을 실제로 쓰기 시작한 시점이고, 자체 조정된다.
 *  이력이 하나도 없으면 아직 한 번도 안 썼다는 뜻이므로 '놓친 방문'도 성립하지 않는다(null).
 *  상수로 날짜를 박으면 스테이징·운영이 갈리고 시간이 지나면 아무도 못 고친다. */
export async function loadSmsEpoch(admin: Admin): Promise<string | null> {
  const { data, error } = await admin.from('sms_send_log')
    .select('created_at').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (error) throw new Error(`발송 이력 시작일을 불러오지 못했습니다: ${error.message}`)
  const at = (data as { created_at?: string } | null)?.created_at
  return at ? at.slice(0, 10) : null
}

/** 지금 보내야 할 안내가 몇 곳인가 — 사이드바 뱃지·대시보드 위젯이 함께 쓴다 (S9-5).
 *
 *  뱃지가 배너와 다른 수를 보여주면 사용자는 어느 쪽을 믿을지 모른다.
 *  그래서 배너와 **같은 함수**(resolvePendingNotices)로 센다. */
export async function countUnsentNotices(admin: Admin): Promise<{
  count: number
  messages: number
  /** 보낼 수 **없어서** 사람이 손봐야 하는 곳(번호 없음·수신 해제·점검일 미확정).
   *  count에서 빼고 세면 이 고객들만 골라 뱃지·위젯에서 지우는 셈이 된다. */
  blockedCount: number
  rules: number[]
  /** 가장 가까운(작은 lead) 시점의 요약 — 위젯 문구용 */
  nearest: { leadDays: number; visitDate: string; label: string; unsentCount: number; messageCount: number; totalCount: number; blockedCount: number } | null
  /** 안내 못 하고 지나간 방문 — 발송은 못 하지만 **알려는 줘야 한다** */
  overdueCount: number
}> {
  const today = todayKst()
  const rules = await loadLeadRules(admin)
  const to = addDays(today, Math.max(...rules, 1))
  // ★ 지난 방문일도 함께 싣는다(includePast) — 종전에는 from을 today로 clamp해서
  //   overdue가 **구조적으로 항상 0**이었고 '시기 지남' 줄이 렌더될 수 없었다.
  //   OVERDUE_WINDOW만 거슬러 본다: 몇 달 전 건까지 계속 띄우면 경고가 소음이 된다.
  //   그리고 **기능을 쓰기 시작한 날**보다 앞으로는 가지 않는다(loadSmsEpoch) —
  //   그 전 방문은 안내를 '놓친' 것이 아니라 안내라는 기능이 없던 시절의 방문이다.
  const epoch = await loadSmsEpoch(admin)
  const from = overdueFloor(addDays(today, -OVERDUE_WINDOW_DAYS), epoch)
  const targets = await loadSmsTargets(admin, { from, to, includePast: true })
  // noPhone도 함께 넘긴다 — 안 넘기면 번호 없는 고객이 뱃지·위젯에서 통째로 빠져
  // "보낼 안내가 없습니다 ✓"가 된다(resolvePendingNotices blockedCount 주석)
  const { groups, noPhone } = groupTargets(targets)
  const sent = await loadSentPairs(admin, from, to)
  const { notices, overdue } = resolvePendingNotices(
    groups, rules, today, (c, v) => sent.has(`${c}|${v}`), noPhone)

  // '보낼 것'뿐 아니라 '못 보내는 것'도 할 일이다 — 뱃지에서 빠지면 초록불이 거짓말이 된다
  const withWork = [...notices].sort((a, b) => a.leadDays - b.leadDays)
      .find(n => n.unsentCount > 0 || n.blockedCount > 0)
    ?? [...notices].sort((a, b) => a.leadDays - b.leadDays)[0] ?? null
  const blockedTotal = notices.reduce((n, x) => n + x.blockedCount, 0)
  return {
    count: notices.reduce((n, x) => n + x.unsentCount, 0),
    messages: notices.reduce((n, x) => n + x.messageCount, 0),
    /** 번호 없음·수신 해제·점검일 미확정 — 보낼 수 없어 사람이 손봐야 하는 곳 */
    blockedCount: blockedTotal,
    rules,
    nearest: withWork ? {
      leadDays: withWork.leadDays, visitDate: withWork.visitDate, label: withWork.label,
      unsentCount: withWork.unsentCount, messageCount: withWork.messageCount,
      totalCount: withWork.groups.length,
      blockedCount: withWork.blockedCount,
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
  // ⚠ **조회 실패를 삼키면 '이미 보냄'이 통째로 빈 집합이 된다.**
  //
  //  그러면 ②-b 중복 재확인이 통과하고, 배너·뱃지·모달의 '발송됨' 배지가 **동시에** 사라진다 —
  //  사용자는 "아직 아무것도 안 보냈네"라고 믿고 이미 받은 고객 전원에게 다시 보낸다.
  //  조회 한 번 실패가 곧 전건 이중 과금이고, 페이지 일부만 실패하면 절반만 되살아나 더 나쁘다.
  //  바로 위 loadSmsTargets는 정확히 이 사고를 막으려고 throw한다 — 돈이 걸린 쪽이 여기다.
  if (page.error) {
    throw new Error(`발송 이력을 불러오지 못해 중단했습니다(이미 보낸 건을 알 수 없습니다): ${page.error}`)
  }
  if (page.truncated) console.error('[sms] 발송 이력(쌍) 로드 상한 도달 — 중복 발송 위험:', page.rows.length)
  const set = new Set<string>()
  for (const r of page.rows as Array<{ customer_id: string; visit_date: string }>) {
    set.add(`${r.customer_id}|${r.visit_date}`)
  }
  return set
}

export { pickContacts }
