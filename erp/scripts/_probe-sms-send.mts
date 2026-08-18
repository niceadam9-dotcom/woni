/** 발송 모듈 실패 경로 프로브 (소방계획서_24 S3 — S11-2·S11-3·S11-4·S11-5의 서버측 선행 확인)
 *  실행: npx tsx --conditions=react-server scripts/_probe-sms-send.mts     (스테이징 DB)
 *
 *  UI를 올리기 전에 **돈이 나가는 경로의 실패 처리**부터 확인한다. 이 차수의 선결 과제가
 *  "실패해도 화면에는 발송됨으로 보인다"(P-1·P-2)였으므로, 확인할 것은 성공이 아니라 실패다:
 *    · 자격증명이 없으면 조용히 성공하지 않고 failed 행이 남는가
 *    · 번호 없는 고객이 no_phone 행으로 남는가(조용한 소멸 금지)
 *    · 수신자 2명이면 2행인가(1행=1수신자)
 *    · dryRun은 DB를 오염시키지 않는가
 *
 *  ⚠ 로컬에는 SOLAPI 키가 없다 — 그래서 실제 발송은 일어나지 않는다. 그 상태 자체가
 *    ⑤ 자격증명 없음 경로의 자연스러운 시험대다. 실발송은 서버 재기동 후 별도 지시(§6-6).
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan } from './_e2e-helpers.mjs'

const { createAdminClient } = await import('../src/lib/supabase/admin.ts')
const { loadSmsTargets, loadAdhocTarget, prepareSms, sendInspectionSms, loadSentPairs, smsGuards } =
  await import('../src/lib/sms.ts')
const { todayKst, addDays } = await import('../src/lib/sms-recipients.ts')

const SUF = Math.random().toString(36).slice(2, 7)
const admin = createAdminClient()
const today = todayKst()
const VISIT = addDays(today, 1)

let userId = ''
const custIds: string[] = []
let plan: { id: string; created: boolean } | null = null

const logsOf = async (cid: string) =>
  ((await raw.from('sms_send_log').select('*').eq('customer_id', cid)).data ?? []) as any[]

try {
  console.log(`— 안전장치 상태: dryRun=${smsGuards().dryRun} allowlist=${smsGuards().allowlist.length}건 max=${smsGuards().maxPerRun} 자격증명=${smsGuards().hasCredentials}`)

  userId = await mkUser({ email: `smsprobe.${SUF}@e2e.test`, name: `문자${SUF}`, employeeId: `SP-${SUF}`, role: 'admin' })

  const y = +VISIT.slice(0, 4), mo = +VISIT.slice(5, 7)
  plan = await ensurePlan(y, mo, userId)

  // 고객A — 관계인 2명 체크(수신자 멀티) + 같은 날 계획 2건(중복 접기)
  const cidA = await mkCustomer({ customer_name: `문자A${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '강하면', region_ri: '전수리' })
  custIds.push(cidA)
  await raw.from('customer_contacts').insert([
    { customer_id: cidA, role: '대표', name: '홍길동', phone: '01011112222', sms_recipient: true },
    { customer_id: cidA, role: '직원1', name: '김철수', phone: '01033334444', sms_recipient: true },
    { customer_id: cidA, role: '직원2', name: '이영희', phone: '01055556666' },
  ])
  const mkItem = async (cid: string, seq: number, type: string) => {
    const { data, error } = await raw.from('inspection_plan_items').insert({
      plan_id: plan!.id, customer_id: cid, sequence_num: seq,
      inspection_type: type, plan_type: 'monthly',
      scheduled_date: VISIT, status: 'confirmed',
    }).select('id').single()
    if (error) throw new Error(`계획 항목 생성 실패: ${error.message}`)
    return (data as any).id as string
  }
  const a1 = await mkItem(cidA, 1, '작동')
  const a2 = await mkItem(cidA, 2, '종합')

  // 고객B — 번호 없음
  const cidB = await mkCustomer({ customer_name: `문자B${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '양평읍' })
  custIds.push(cidB)
  await raw.from('customer_contacts').insert([{ customer_id: cidB, role: '대표', name: '무번호', phone: null }])
  const b1 = await mkItem(cidB, 1, '작동')

  // 고객C — 미확정(planned)
  const cidC = await mkCustomer({ customer_name: `문자C${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '강하면', region_ri: '전수리' })
  custIds.push(cidC)
  await raw.from('customer_contacts').insert([{ customer_id: cidC, role: '대표', name: '미확정', phone: '01077778888' }])
  const { data: cItem } = await raw.from('inspection_plan_items').insert({
    plan_id: plan.id, customer_id: cidC, sequence_num: 1, inspection_type: '작동',
    plan_type: 'monthly', scheduled_date: VISIT, status: 'planned',
  }).select('id').single()
  const c1 = (cItem as any).id as string

  console.log('\n— loadSmsTargets')
  const targets = await loadSmsTargets(admin, { planItemIds: [a1, a2, b1, c1] })
  check('계획 4건이 대상으로 로드된다', targets.length === 4, String(targets.length))
  check('미확정 건은 sendable:false로 함께 온다(목록에서 숨기지 않는다)',
    targets.filter(t => t.sendable === false).length === 1 &&
    /미확정/.test(targets.find(t => t.sendable === false)?.unsendableReason ?? ''))

  console.log('\n— prepareSms (모달이 그릴 것)')
  const prep = await prepareSms(admin, targets)
  check('★ 같은 고객 같은 날 2건 → 그룹 1개', prep.groups.filter(g => g.customerId === cidA).length === 1)
  check('그 그룹에 planItemIds 2개', prep.groups.find(g => g.customerId === cidA)!.planItemIds.length === 2)
  check('★ 번호 없는 고객은 noPhone으로 분리', prep.noPhone.length === 1 && prep.noPhone[0].customerId === cidB)
  check('수신자 2명 → 통수 2', prep.preview.find(p => p.group.customerId === cidA)!.perRecipient.length === 2)
  const txt = prep.preview.find(p => p.group.customerId === cidA)!.perRecipient[0].text
  check('문구에 미치환 변수가 없다', !/[{}]/.test(txt), txt)
  check('문구가 SMS 범위(90바이트 이하)', prep.preview[0].perRecipient[0].msgType === 'SMS',
    String(prep.preview[0].perRecipient[0].byteLen))
  check('내일 방문이면 {디데이}가 "내일"로 치환', /내일/.test(txt), txt)
  check('미확정 고객C는 발송 불가로 표시',
    prep.groups.find(g => g.customerId === cidC)?.sendable === false)

  console.log('\n— sendInspectionSms: dryRun (DB 미기록)')
  process.env.SMS_DRY_RUN = '1'
  const dry = await sendInspectionSms(admin, { targets, actorId: userId })
  check('dryRun은 성공으로 보고', dry.ok && dry.sent === 2, JSON.stringify({ ok: dry.ok, sent: dry.sent }))
  check('★ dryRun은 sms_send_log에 아무것도 남기지 않는다(리허설이 이력을 오염시키면 안 된다)',
    (await logsOf(cidA)).length === 0 && (await logsOf(cidB)).length === 0)
  delete process.env.SMS_DRY_RUN

  console.log('\n— sendInspectionSms: 자격증명 없음 (P-1의 핵심 수리)')
  const before = smsGuards().hasCredentials
  const savedKey = process.env.SOLAPI_API_KEY, savedSec = process.env.SOLAPI_API_SECRET
  delete process.env.SOLAPI_API_KEY; delete process.env.SOLAPI_API_SECRET
  const real = await sendInspectionSms(admin, { targets, actorId: userId })
  check('★ 조용히 성공하지 않는다 — ok:false + 사유', !real.ok && /자격증명|발신번호/.test(real.error ?? ''), real.error ?? '')
  const aLogs = await logsOf(cidA)
  check('★ 수신자 2명 → sms_send_log 2행(1행=1수신자)', aLogs.length === 2, String(aLogs.length))
  check('★ 그 2행이 전부 failed + 사유', aLogs.every(l => l.status === 'failed' && !!l.error))
  check('행에 to_phone·contact_role·contact_name이 채워진다(P-3 해소)',
    aLogs.every(l => l.to_phone && l.contact_role && l.contact_name),
    JSON.stringify(aLogs.map(l => [l.to_phone, l.contact_role, l.contact_name])))
  check('행에 plan_item_ids 2개가 실린다', aLogs.every(l => (l.plan_item_ids ?? []).length === 2))
  check('lead_days = 방문일 - 오늘 = 1(실측값)', aLogs.every(l => l.lead_days === 1), JSON.stringify(aLogs.map(l => l.lead_days)))
  check('visit_date가 방문일', aLogs.every(l => l.visit_date === VISIT))
  const bLogs = await logsOf(cidB)
  check('★ 번호 없는 고객은 no_phone 행으로 남는다(P-2 해소 — 못 받은 고객이 기록에 남는다)',
    bLogs.length === 1 && bLogs[0].status === 'no_phone' && !!bLogs[0].error, JSON.stringify(bLogs.map(l => l.status)))
  const cLogs = await logsOf(cidC)
  check('★ 미확정 고객에게는 아무 행도 생기지 않는다(발송도, 기록도 없다)', cLogs.length === 0, String(cLogs.length))
  if (savedKey) process.env.SOLAPI_API_KEY = savedKey
  if (savedSec) process.env.SOLAPI_API_SECRET = savedSec
  check('자격증명 유무 판정이 env를 그대로 반영', smsGuards().hasCredentials === before)

  console.log('\n— 상한 (SMS_MAX_PER_RUN)')
  process.env.SMS_MAX_PER_RUN = '1'
  const over = await sendInspectionSms(admin, { targets, actorId: userId })
  check('★ 상한 초과 시 부분 발송하지 않고 통째로 거부', !over.ok && /상한/.test(over.error ?? ''), over.error ?? '')
  const aLogs2 = await logsOf(cidA)
  check('상한에 걸리면 새 행도 안 생긴다', aLogs2.length === 2, String(aLogs2.length))
  delete process.env.SMS_MAX_PER_RUN

  console.log('\n— allowlist')
  process.env.SMS_DRY_RUN = '1'
  process.env.SMS_ALLOWLIST = '010-1111-2222'
  const allow = await sendInspectionSms(admin, { targets, actorId: userId })
  check('allowlist는 dryRun보다 뒤에 적용된다(리허설은 전건 미리보기)', allow.sent === 2, String(allow.sent))
  delete process.env.SMS_DRY_RUN
  const allow2 = await sendInspectionSms(admin, { targets, actorId: userId })
  check('★ 실발송에서는 목록 밖 번호가 skip된다', allow2.skipped === 1, JSON.stringify({ skipped: allow2.skipped }))
  delete process.env.SMS_ALLOWLIST
  await raw.from('sms_send_log').delete().eq('customer_id', cidA)
  await raw.from('sms_send_log').delete().eq('customer_id', cidB)

  console.log('\n— loadSentPairs (미발송 판정, S5-10)')
  await raw.from('sms_send_log').insert({
    kind: 'pre_visit', customer_id: cidA, plan_item_ids: [a1], visit_date: VISIT,
    content: 'x', status: 'sent', sent_by: userId,
  })
  const pairs = await loadSentPairs(admin, today, addDays(today, 7))
  check('보낸 (고객, 방문일) 쌍이 잡힌다', pairs.has(`${cidA}|${VISIT}`))
  check('★ 방문일을 옮기면 그 쌍은 미발송이 된다(재안내를 놓치지 않는다)',
    !pairs.has(`${cidA}|${addDays(VISIT, 2)}`))

  console.log('\n— 임의 발송 (Q-17): 계획 회차가 늘지 않아야 한다')
  const beforeItems = ((await raw.from('inspection_plan_items').select('id').eq('customer_id', cidA)).data ?? []).length
  const adhocT = await loadAdhocTarget(admin, cidA, addDays(today, 3))
  check('adhoc 대상은 planItemId 없이 만들어진다', !!adhocT && adhocT.planItemId === null)
  process.env.SMS_DRY_RUN = '1'
  const adhocDry = await sendInspectionSms(admin, { targets: [adhocT!], actorId: userId, kind: 'adhoc' })
  delete process.env.SMS_DRY_RUN
  check('adhoc도 수신자 2명 → 2통', adhocDry.sent === 2, String(adhocDry.sent))
  const afterItems = ((await raw.from('inspection_plan_items').select('id').eq('customer_id', cidA)).data ?? []).length
  check('★ 임의 발송은 계획 항목을 만들지 않는다(점검 실적 오염 금지)',
    beforeItems === afterItems, `${beforeItems} → ${afterItems}`)

  console.log('\n— 과거 방문일 가드')
  const past = await loadSmsTargets(admin, { from: addDays(today, -10), to: addDays(today, -1) })
  check('★ 지난 방문일은 발송 대상에서 빠진다("지난 날에 방문합니다"는 성립하지 않는다)',
    past.length === 0, String(past.length))
} finally {
  for (const c of custIds) {
    await raw.from('sms_send_log').delete().eq('customer_id', c)
    await cleanupCustomer(c)
  }
  if (plan?.created) await raw.from('inspection_plans').delete().eq('id', plan.id)
  await delUser(userId)
}
summary()
