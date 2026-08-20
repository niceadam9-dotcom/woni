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

// ── 밀폐(hermetic) 기준선 ────────────────────────────────────────
// 이 프로브는 **실패 경로**를 시험한다. 종전에는 "로컬에 키가 없으니 실발송은 안 일어난다"는
// 환경의 우연에 기대고 있었다 — 2026-08-19 .env.local에 SOLAPI 실키가 들어오자 그 전제가 깨져,
// '자격증명 없음' 절이 그대로 **진짜 발송**을 시도하는 코드가 됐다. 안전장치를 시험하는 스크립트가
// 안전장치를 환경에 위임하면 안 된다. 그래서 여기서 명시적으로 끊는다.
delete process.env.SOLAPI_API_KEY
delete process.env.SOLAPI_API_SECRET
// 상한·allowlist도 고정한다 — .env.local의 운영 안전값(SMS_MAX_PER_RUN=1 등)이 들어오면
// 상한 절이 먼저 걸려 뒤 절들이 통째로 엉뚱하게 실패한다(실제로 6건이 그렇게 실패했다).
process.env.SMS_MAX_PER_RUN = '200'
delete process.env.SMS_ALLOWLIST
delete process.env.SMS_DRY_RUN
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan } from './_e2e-helpers.mjs'

const { createAdminClient } = await import('../src/lib/supabase/admin.ts')
const { loadSmsTargets, loadAdhocTarget, prepareSms, sendInspectionSms, loadSentPairs, smsGuards, countUnsentNotices, loadLeadRules, loadSmsEpoch, overdueFloor, OVERDUE_WINDOW_DAYS } =
  await import('../src/lib/sms.ts')
const { todayKst, addDays } = await import('../src/lib/sms-recipients.ts')

const SUF = Math.random().toString(36).slice(2, 7)
const admin = createAdminClient()
const today = todayKst()
const VISIT = addDays(today, 1)

let userId = ''
const custIds: string[] = []
let plan: { id: string; created: boolean } | null = null
// D1 검증용 과거 계획 — 우리가 만든 것만 되돌린다(기존 월 계획은 건드리지 않는다)
let madePastPlan: string | null = null
let pastItemId: string | null = null

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

  console.log('\n— 관계인 임베드 힌트 (145 이후 PGRST201 재발 방지)')
  {
    // 마이그레이션 145가 customers.manager_contact_id를 추가한 순간 customers↔customer_contacts
    // 관계가 둘이 됐고, **힌트 없는 임베드는 전부 PGRST201로 거절**됐다(양방향 실측).
    // 문자 발송 화면·문의 등록·메일 수신자 후보가 함께 죽었다. 새 코드가 힌트를 빼먹으면
    // 그 화면만 조용히 비므로 여기서 소스 전체를 훑어 고정한다.
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(join(dir, e.name))
        : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [])
    // ⚠ 주석을 먼저 걷어낸다 — 이 결함을 설명하는 주석 자체가 `customer_contacts(id)`를 담고 있어
    //   걷어내지 않으면 **고쳐 놓은 파일이 도로 걸린다**(첫 시도에서 11파일이 그렇게 잡혔다).
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const bad = walk('src').filter(f => {
      const s = strip(readFileSync(f, 'utf8'))
      // ① customers → customer_contacts. `from('customer_contacts')`는 따옴표가 사이에 있어 안 걸린다
      if (/customer_contacts\s*\(/.test(s)) return true
      // ② 역방향은 **그 조회 안에서만** 모호하다. 같은 파일 다른 줄의
      //    `inspections → customers(customer_name)`는 관계가 하나뿐이라 멀쩡한데,
      //    파일 단위로 보면 그것까지 잡는다(2파일이 그렇게 걸렸다). 체인 뒤만 본다.
      return [...s.matchAll(/from\('customer_contacts'\)/g)]
        .some(m => /(?<!!)\bcustomers\s*\(/.test(s.slice(m.index!, m.index! + 300)))
    })
    check('★ src에 힌트 없는 customer_contacts↔customers 임베드가 없다', bad.length === 0, bad.join(', '))
  }

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
  // ★ 리허설은 **sent=0**이어야 한다(예정 통수는 dryRunPlanned로 따로 준다).
  //   종전엔 sent=units.length라 화면이 "발송됨 N"으로 읽고 sent>0을 성공 신호로 써서,
  //   한 통도 안 나간 리허설을 성공으로 오인하게 만들었다(D6).
  check('★ 리허설은 sent=0 — "발송됨"으로 오인되지 않는다', dry.ok && dry.sent === 0,
    JSON.stringify({ ok: dry.ok, sent: dry.sent }))
  check('리허설이 예정 통수를 따로 알린다', dry.dryRunPlanned === 2, String(dry.dryRunPlanned))
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
  // 종전 이 자리에는 `hasCredentials === before`가 있었는데, 상단에서 키를 이미 지운 탓에
  // 양변이 **변하지 않은 환경에 대한 같은 식**이라 구조적으로 실패가 불가능했다(판정 지적).
  // 실제로 env를 넣었다 뺐다 하며 판정이 따라오는지를 본다.
  {
    const wasKey = process.env.SOLAPI_API_KEY, wasSec = process.env.SOLAPI_API_SECRET
    process.env.SOLAPI_API_KEY = 'probe-key'; process.env.SOLAPI_API_SECRET = 'probe-secret'
    const on = smsGuards().hasCredentials
    delete process.env.SOLAPI_API_KEY; delete process.env.SOLAPI_API_SECRET
    const off = smsGuards().hasCredentials
    check('★ 자격증명 판정이 env를 실제로 따라간다(넣으면 true, 빼면 false)',
      on === true && off === false, JSON.stringify({ on, off }))
    if (wasKey) process.env.SOLAPI_API_KEY = wasKey
    if (wasSec) process.env.SOLAPI_API_SECRET = wasSec
  }

  console.log('\n— 스위치 값 해석 (fail-open 방지)')
  {
    // ★ SMS_DRY_RUN은 **발송을 멈추는** 스위치다. '1' 정확 일치였을 때 true/on 오타면
    //   가드가 열린 채 실발송됐다 — 켰다고 믿는 순간이 가장 위험하다.
    const saved = process.env.SMS_DRY_RUN
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      process.env.SMS_DRY_RUN = v
      check(`★ SMS_DRY_RUN='${v}'는 멈춤으로 읽는다`, smsGuards().dryRun === true, v)
    }
    process.env.SMS_DRY_RUN = '0'
    check("SMS_DRY_RUN='0'은 멈춤이 아니다(과잉 차단 금지)", smsGuards().dryRun === false)
    delete process.env.SMS_DRY_RUN
    check('SMS_DRY_RUN 미설정은 멈춤이 아니다', smsGuards().dryRun === false)
    if (saved !== undefined) process.env.SMS_DRY_RUN = saved

    // ★ SMS_MAX_PER_RUN=0은 '전면 차단' 의도다. `Number(x) || 200`이라 200이 됐었다.
    const savedMax = process.env.SMS_MAX_PER_RUN
    process.env.SMS_MAX_PER_RUN = '0'
    check('★ SMS_MAX_PER_RUN=0은 0이다(200으로 뒤집히지 않는다)', smsGuards().maxPerRun === 0,
      String(smsGuards().maxPerRun))
    process.env.SMS_MAX_PER_RUN = 'abc'
    check('숫자가 아니면 기본값 200', smsGuards().maxPerRun === 200, String(smsGuards().maxPerRun))
    if (savedMax !== undefined) process.env.SMS_MAX_PER_RUN = savedMax; else delete process.env.SMS_MAX_PER_RUN
  }

  console.log('\n— 상한 (SMS_MAX_PER_RUN)')
  process.env.SMS_MAX_PER_RUN = '1'
  const over = await sendInspectionSms(admin, { targets, actorId: userId })
  check('★ 상한 초과 시 부분 발송하지 않고 통째로 거부', !over.ok && /상한/.test(over.error ?? ''), over.error ?? '')
  const aLogs2 = await logsOf(cidA)
  check('상한에 걸리면 새 행도 안 생긴다', aLogs2.length === 2, String(aLogs2.length))
  delete process.env.SMS_MAX_PER_RUN

  console.log('\n— 중복 발송 방지 (서버측)')
  {
    // 화면의 확인 1회는 탭 하나 안의 상태다. 탭 두 개·액션 재호출은 그걸 통째로 건너뛴다.
    // 유니크 인덱스는 걸지 않는다(Q-12: 재발송은 사람 판단) — 그래서 '막기'가 아니라 '다시 묻기'다.
    await raw.from('sms_send_log').delete().eq('customer_id', cidA)
    await raw.from('sms_send_log').insert({
      kind: 'pre_visit', customer_id: cidA, plan_item_ids: [a1], visit_date: VISIT,
      content: 'x', status: 'sent', sent_by: userId,
    })
    const oneTarget = targets.filter((t: any) => t.customerId === cidA)

    const blocked = await sendInspectionSms(admin, { targets: oneTarget, actorId: userId })
    check('★ 이미 보낸 건은 서버가 막는다(화면 확인을 우회해도)',
      !blocked.ok && /이미 안내를 보낸/.test(blocked.error ?? ''), blocked.error ?? '')

    process.env.SMS_DRY_RUN = '1'
    const allowed = await sendInspectionSms(admin, { targets: oneTarget, actorId: userId, allowResend: true })
    check('★ allowResend를 명시하면 통과한다(재발송 길을 영구히 막지 않는다)',
      allowed.ok === true, JSON.stringify({ ok: allowed.ok, error: allowed.error }))
    delete process.env.SMS_DRY_RUN

    // 동시 경합 — 두 요청이 서로의 sent 행을 아직 못 보는 상황(TOCTOU).
    //
    // ⚠ 종전엔 `Promise.all`로 sendInspectionSms 둘을 동시에 불러 겹치기를 **기대**했다.
    //   그런데 자격증명이 없으면 ⑤가 곧바로 claim 행을 failed로 바꾸고 끝나서, 먼저 들어간
    //   쪽이 **두 번째가 라이벌을 조회하기도 전에 sending을 벗는다**. 그러면 둘 다 이긴다.
    //   실제로 2026-08-19 같은 코드가 37초 간격으로 ✅ 한 번·❌ 한 번을 냈다 — 기계 상태가
    //   판정을 좌우했다. 돈이 나가는 가드를 이런 검사에 맡길 수 없다.
    //
    //   그래서 상대를 **행으로 고정**한다: 'sending'인 라이벌 행을 직접 심어 두고,
    //   우리 요청의 claim이 그보다 늦은지/이른지로 양쪽 분기를 결정적으로 태운다.
    const phonesA = ['01011112222', '01033334444']   // cidA의 수신 대상 2명(위 시드)
    const plantRivals = async (createdAt: string) => {
      await raw.from('sms_send_log').delete().eq('customer_id', cidA)
      const { data, error } = await raw.from('sms_send_log').insert(
        phonesA.map(p => ({
          kind: 'pre_visit', customer_id: cidA, plan_item_ids: [a1], visit_date: VISIT,
          to_phone: p, content: 'rival', status: 'sending', sent_by: userId, created_at: createdAt,
        }))).select('id, created_at')
      if (error) throw new Error(`라이벌 행 심기 실패: ${error.message}`)
      // created_at을 못 쓰면(기본값이 덮으면) 이 검사는 순서를 못 만든다 — 조용히 통과시키지 않는다
      check('전제: 라이벌 행의 created_at을 지정할 수 있다',
        (data ?? []).every((r: any) => r.created_at.slice(0, 19) === createdAt.slice(0, 19)),
        JSON.stringify((data ?? []).map((r: any) => r.created_at)))
      return (data ?? []).map((r: any) => r.id as string)
    }

    // ① 상대가 **먼저** 시작한 경우 — 우리가 물러나야 한다
    const earlier = await plantRivals(new Date(Date.now() - 5_000).toISOString())
    const r1 = await sendInspectionSms(admin, { targets: oneTarget, actorId: userId, allowResend: true })
    check('★ 먼저 시작한 창이 있으면 스스로 물러난다(두 탭 이중 발송 차단)',
      !r1.ok && /다른 창에서 보내는 중/.test(r1.error ?? ''), r1.error ?? 'ok')
    check('★ 물러나도 라이벌 행은 건드리지 않는다(승자의 발송을 지우지 않는다)',
      (await logsOf(cidA)).filter(r => earlier.includes(r.id)).length === earlier.length)

    // ② 상대가 **나중에** 시작한 경우 — 우리가 진행해야 한다(둘 다 물러나면 아무도 못 보낸다)
    await plantRivals(new Date(Date.now() + 5_000).toISOString())
    const r2 = await sendInspectionSms(admin, { targets: oneTarget, actorId: userId, allowResend: true })
    check('★ 상대가 나중에 시작했으면 우리가 진행한다(livelock 방지, 판정 D6)',
      !/다른 창에서 보내는 중/.test(r2.error ?? ''), r2.error ?? 'ok')
    check('진행한 쪽은 발송 단계까지 도달한다(자격증명 없음으로 끝남)',
      /자격증명/.test(r2.error ?? ''), r2.error ?? 'ok')

    // 물러난 쪽이 sending으로 남으면 '보냈는지 모름'이 되어 사람이 판단할 수 없다.
    // 심어 둔 라이벌은 우리가 만든 게 아니므로 세지 않는다(그건 '다른 창'의 몫이다).
    const planted = new Set([...earlier, ...(await logsOf(cidA)).filter(r => r.content === 'rival').map(r => r.id)])
    const stuck = (await logsOf(cidA)).filter(r => r.status === 'sending' && !planted.has(r.id))
    check('물러난 쪽이 sending으로 방치되지 않는다', stuck.length === 0, String(stuck.length))
    // ★ 판정 D5 — 물러난 쪽이 failed 행을 남기면, 목록 우선순위가 failed > sent라
    //   **승자가 실제로 보낸 그 건이 화면에 '실패'로 표시**되고 재발송을 유도한다.
    //   물러난 쪽은 Solapi를 부른 적이 없으므로 '아무 일도 없었던 것'이어야 한다.
    const ghosts = (await logsOf(cidA)).filter(r => /다른 창에서 보내는 중/.test(r.error ?? ''))
    check('★ 물러난 쪽은 failed 행조차 남기지 않는다(승자의 발송을 가리지 않게)',
      ghosts.length === 0, String(ghosts.length))
    await raw.from('sms_send_log').delete().eq('customer_id', cidA)
  }

  console.log('\n— allowlist fail-closed (독립 판정 D4)')
  {
    // 오타로 유효 번호가 0이 되면 '미설정'과 구별되지 않아 **전건이 실고객에게 나간다**.
    // 가드를 켰다고 믿는 순간이 가장 위험하므로, 닫히는 쪽으로 실패해야 한다.
    process.env.SMS_ALLOWLIST = '내번호'          // 숫자가 없다 → 정규화 결과 0건
    const failOpen = await sendInspectionSms(admin, { targets, actorId: userId })
    check('★ allowlist가 설정됐는데 유효 번호가 0이면 발송을 막는다(fail-closed)',
      !failOpen.ok && /유효한 번호가 하나도/.test(failOpen.error ?? ''), failOpen.error ?? '')
    delete process.env.SMS_ALLOWLIST
  }

  console.log('\n— 빈 변수는 그 건만 뺀다 (과잉 차단 금지)')
  {
    // 오타(알 수 없는 변수)는 문구 전체의 문제라 전건 차단이 맞다.
    // 그러나 값이 빈 변수는 그 건만의 문제다 — 담당자 없는 계획 하나 때문에
    // 배치 전체가 안 나가면 그게 더 큰 사고다.
    // 한 건만 담당자가 있고 나머지는 비어 있는 **섞인** 상황이라야 부분 차단을 볼 수 있다.
    // 전부 비면 '보낼 게 하나도 없음'이 맞는 답이라 판정이 되지 않는다.
    // targets 개수에 기대지 않는다 — 담당자 있는 건 1 + 없는 건 1을 명시적으로 만든다.
    // (한때 targets가 1건이라 '섞임'이 성립하지 않아 이 단언이 조용히 통과했다)
    // ⚠ targets[0]에 기대면 안 된다 — .order('id')의 id가 무작위 UUID라 4개 픽스처 중
    //   어느 것이 앞에 올지 매번 달라진다. 번호 없는 고객이나 미확정 건이 걸리면
    //   '섞임'이 성립하지 않아 이 절이 무작위로 실패했다(판정 실측). 술어로 고른다.
    const base0: any = targets.find((t: any) => t.customerId === cidA && t.sendable !== false)
    if (!base0) throw new Error('픽스처 전제 붕괴: 발송 가능한 고객A 대상이 없다')
    const mixed = [
      { ...base0, assigneeName: '김태건' },
      { ...base0, customerId: cidB, customerName: '담당없는곳', planItemId: null, assigneeName: null },
    ]
    process.env.SMS_DRY_RUN = '1'
    const withEmpty = await sendInspectionSms(admin, {
      targets: mixed, actorId: userId,
      overrideBody: '{고객명}님 {점검일}({담당자} 담당) 방문합니다',
    })
    check('★ 값이 빈 변수 때문에 배치 전체가 막히지 않는다(담당자 있는 건은 나간다)',
      withEmpty.ok === true && (withEmpty.dryRunPlanned ?? 0) > 0,
      JSON.stringify({ ok: withEmpty.ok, planned: withEmpty.dryRunPlanned, error: withEmpty.error }))
    check('빈 변수 건은 조용히 빠지지 않고 제외로 집계된다',
      (withEmpty.skipped ?? 0) > 0, JSON.stringify({ skipped: withEmpty.skipped }))
    delete process.env.SMS_DRY_RUN

    // 전부 비면 '보낼 게 없다'고 분명히 말해야 한다 — 조용히 0통 성공은 금지
    const allEmpty = await sendInspectionSms(admin, {
      targets: [{ ...base0, assigneeName: null }], actorId: userId,
      overrideBody: '{고객명}님 {점검일}({담당자} 담당) 방문합니다',
    })
    check('보낼 수 있는 건이 하나도 없으면 사유와 함께 실패로 말한다',
      !allEmpty.ok && /값이 비어/.test(allEmpty.error ?? ''), allEmpty.error ?? '')
  }

  console.log('\n— 미치환 변수 (인라인 편집 오타)')
  {
    // 문구 **설정** 저장은 알 수 없는 변수를 이미 거부하지만, 모달 인라인 편집(overrideBody)은
    // 그 검사를 비켜 간다. 화면 버튼도 막지만 액션은 공개 엔드포인트라 서버가 막아야 실효가 있다.
    const before = (await logsOf(cidA)).length
    const typo = await sendInspectionSms(admin, {
      targets, actorId: userId,
      overrideBody: '{고객명}님 {점검일자}에 방문합니다',   // 올바른 변수는 {점검일}
    })
    check('★ 미치환 변수가 있으면 발송을 거부한다(글자 그대로 고객에게 나가는 것을 막는다)',
      !typo.ok && /점검일자/.test(typo.error ?? ''), typo.error ?? '')
    check('거부 시 sms_send_log에 행을 남기지 않는다(상한과 같은 자리에서 끊는다)',
      (await logsOf(cidA)).length === before, String((await logsOf(cidA)).length))
    // 올바른 변수만 쓰면 통과해야 한다 — 아니면 정상 문구까지 막는 과잉 차단이다
    process.env.SMS_DRY_RUN = '1'
    const okBody = await sendInspectionSms(admin, {
      targets, actorId: userId, overrideBody: '{고객명}님 {점검일}에 방문합니다',
    })
    check('알려진 변수만 쓰면 통과한다(과잉 차단 아님)', okBody.ok === true, JSON.stringify({ ok: okBody.ok, error: okBody.error }))
    delete process.env.SMS_DRY_RUN
  }

  console.log('\n— allowlist')
  process.env.SMS_DRY_RUN = '1'
  process.env.SMS_ALLOWLIST = '010-1111-2222'
  const allow = await sendInspectionSms(admin, { targets, actorId: userId })
  check('allowlist는 dryRun보다 뒤에 적용된다(리허설은 전건 미리보기)',
    allow.dryRunPlanned === 2, String(allow.dryRunPlanned))
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
  {
    // ★ `unverified`가 재발송 방어망에 **실제로 들어 있는지** 아무도 확인하지 않았다(판정 M11).
    //   parseSolapiResult가 이 제3상태를 만든 이유 전체가 여기 들어가기 위해서인데,
    //   빠지면 '나갔을 수 있는' 문자가 미발송으로 되살아나 배너가 재발송을 권한다.
    //   P-11이 막으려던 이중 과금이 조용히 복원되고 전 스위트는 그린이다.
    const d2 = addDays(VISIT, 3), d3 = addDays(VISIT, 4)
    await raw.from('sms_send_log').insert([
      { kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: d2, content: 'x', status: 'unverified', sent_by: userId },
      { kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: d3, content: 'x', status: 'sending', sent_by: userId },
    ])
    const p2 = await loadSentPairs(admin, today, addDays(today, 14))
    check('★ unverified도 이미 보냄으로 친다(나갔을 수 있는 문자를 되살리지 않는다)',
      p2.has(`${cidA}|${d2}`), `unverified 쌍 누락 — 재발송·이중 과금 경로가 열린다`)
    check('★ sending도 이미 보냄으로 친다(보냈는지 모르는 건을 다시 보내지 않는다)',
      p2.has(`${cidA}|${d3}`))
    // 반대로 failed·no_phone은 되살아나야 한다 — 아니면 재시도 길이 막힌다
    const d4 = addDays(VISIT, 5)
    await raw.from('sms_send_log').insert({
      kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: d4, content: 'x', status: 'failed', sent_by: userId,
    })
    const p3 = await loadSentPairs(admin, today, addDays(today, 14))
    check('failed는 이미 보냄이 아니다(재시도할 수 있어야 한다)', !p3.has(`${cidA}|${d4}`))
    await raw.from('sms_send_log').delete().eq('customer_id', cidA).in('visit_date', [d2, d3, d4])
  }

  console.log('\n— 시기 지남 하한 (기능 도입 전 방문까지 세지 않는가)')
  {
    // 하한이 없으면 **기능을 켠 날 한 달치 방문이 전부 '안내 못 함'으로 뜬다**.
    // 수백 건짜리 빨간 경고는 읽히지 않고, 진짜로 놓친 한 건을 그 속에 묻는다.
    // 종전 단언은 `overdueCount > 0`이라는 하한뿐이라 1이든 300이든 통과했다.
    // ⚠ 실 이력을 지웠다 되돌리는 방식은 쓰지 않는다 — 공유 스테이징에서 스크립트가 중간에
    //   죽으면 발송 이력이 통째로 사라진다. 검증 때문에 실데이터를 위험에 두면 안 된다.
    //   대신 조회 결과만 갈아끼워 **경계 동작**을 본다.
    const epoch = await loadSmsEpoch(admin)
    check('발송 이력이 있으면 그 날짜가 기준이 된다(없으면 null)',
      epoch === null || /^\d{4}-\d{2}-\d{2}$/.test(epoch), String(epoch))

    const stub = (row: unknown): any => {
      const chain: any = new Proxy({}, {
        get: (_t, p) => p === 'then'
          ? (res: (v: unknown) => void) => res({ data: row, error: null })
          : () => chain,
      })
      return { from: () => chain }
    }
    check('★ 이력이 하나도 없으면 기준일이 null이다(도입 전 방문을 놓친 것으로 세지 않는다)',
      (await loadSmsEpoch(stub(null))) === null)
    check('첫 이력 날짜가 그대로 기준일이 된다',
      (await loadSmsEpoch(stub({ created_at: '2026-08-19T08:41:11.000Z' }))) === '2026-08-19')
    // 하한이 실제로 걸리는지 — 창(오늘-30)과 기준일 중 **늦은 쪽**이어야 한다.
    // ⚠ 종전 단언은 `today > win`뿐이라 **하한 함수를 한 번도 부르지 않고** 통과했다.
    //   날짜 산술의 자명한 성질을 확인했을 뿐, 하한이 사라져도 초록불이었다(가짜 양성).
    const win = addDays(today, -OVERDUE_WINDOW_DAYS)
    check('★ 기준일이 창보다 늦으면 기준일이 하한이다(도입 당일 한 달치가 뜨지 않는다)',
      overdueFloor(win, addDays(today, -3)) === addDays(today, -3),
      overdueFloor(win, addDays(today, -3)))
    check('기준일이 창보다 이르면 창이 하한이다(몇 달 전 건까지 띄우지 않는다)',
      overdueFloor(win, addDays(today, -400)) === win, overdueFloor(win, addDays(today, -400)))
    check('이력이 없으면 하한이 오늘이다(과거 구간 자체가 없어진다)',
      overdueFloor(win, null) === today, overdueFloor(win, null))
    // 뱃지와 배너가 **같은 함수**를 쓰는가 — 각자 계산하면 두 화면이 다른 수를 말한다
    check('★ 배너(listSmsStatusAction)가 하한을 따로 계산하지 않는다',
      /overdueFloor\(addDays\(today, -OVERDUE_WINDOW_DAYS\), await loadSmsEpoch\(admin\)\)/
        .test(readFileSync('src/app/(dashboard)/inspections/sms-actions.ts', 'utf8')))
  }

  console.log('\n— recipientOverride: 뺀 사람에게 가지 않는가 (3차 판정 — 미검증 1순위)')
  {
    // 모달에서 수신자를 체크 해제하면 **그 사람에게는 안 가야 한다.** 그런데 이 경로를
    // 실행하는 테스트가 하나도 없었다(E2E는 발송 버튼을 끝내 누르지 않는다).
    // 틀리면 뺀 사람에게 문자가 가고 돈이 나가는데, 아무도 모른다.
    const two = targets.filter((t: any) => t.customerId === cidA)
    const g0 = two[0]
    const key = `${g0.customerId}|${g0.visitDate}`
    process.env.SMS_DRY_RUN = '1'

    const both = await sendInspectionSms(admin, { targets: two, actorId: userId })
    check('전제: 지정 없이 보내면 수신자 2명 전원', both.dryRunPlanned === 2, String(both.dryRunPlanned))

    const one = await sendInspectionSms(admin, {
      targets: two, actorId: userId, recipientOverride: { [key]: ['010-1111-2222'] },
    })
    check('★ 한 명만 남기면 1통이다(뺀 사람에게 가지 않는다)', one.dryRunPlanned === 1,
      JSON.stringify({ planned: one.dryRunPlanned, rows: one.rows.map(r => r.phoneMasked) }))
    // 마스킹은 010-****-2222 형태라 앞자리로는 못 가른다 — 뒷 4자리로 본다
    check('★ 남긴 사람이 맞다(엉뚱한 사람에게 가지 않는다)',
      one.rows.length === 1 && /2222$/.test(one.rows[0].phoneMasked), JSON.stringify(one.rows))

    // 목록에 없는 번호를 넣어도 **추가되면 안 된다** — override는 좁히는 용도다
    const inject = await sendInspectionSms(admin, {
      targets: two, actorId: userId, recipientOverride: { [key]: ['010-9999-8888'] },
    })
    check('★ 목록에 없는 번호를 넣어도 발송 대상이 되지 않는다(주입 방지)',
      !inject.ok || (inject.dryRunPlanned ?? 0) === 0,
      JSON.stringify({ ok: inject.ok, planned: inject.dryRunPlanned, error: inject.error }))
    delete process.env.SMS_DRY_RUN
  }

  console.log('\n— 재발송이 경합으로 오인되지 않는가 (3차 판정 1순위)')
  {
    // allowResend는 "사용자가 화면에서 한 번 더 확인했다"는 뜻이다. 그런데 ④-b가 직전
    // sent/unverified를 라이벌로 세면 **발송 직후 120초 동안 재발송이 막히고**,
    // "다른 창에서 보내는 중"이라며 존재하지 않는 창을 가리켰다.
    // 종전 시험은 dryRun(claim 이전 반환) 아래에 있어 ④-b가 한 번도 실행되지 않았다.
    await raw.from('sms_send_log').delete().eq('customer_id', cidA)
    const one = targets.filter((t: any) => t.customerId === cidA).slice(0, 1)
    const g0: any = one[0]
    // 방금 보낸 것처럼 sent 행을 심는다(경합 창 안)
    await raw.from('sms_send_log').insert({
      kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: g0.visitDate,
      to_phone: '01011112222', content: 'x', status: 'sent', sent_by: userId,
    })
    const resend = await sendInspectionSms(admin, {
      targets: one, actorId: userId, allowResend: true,
      recipientOverride: { [`${g0.customerId}|${g0.visitDate}`]: ['010-1111-2222'] },
    })
    check('★ 확인을 거친 재발송이 "다른 창에서 보내는 중"으로 막히지 않는다',
      !/다른 창에서 보내는 중/.test(resend.error ?? ''), resend.error ?? '(막히지 않음)')
    // 자격증명이 없으므로 failed로 끝나는 것이 정상 — 요점은 **경합으로 거부되지 않는 것**
    check('재발송이 실제 발송 단계까지 도달한다(자격증명 없음으로 끝남)',
      /자격증명|발신번호/.test(resend.error ?? ''), resend.error ?? '')

    // 반대로 allowResend 없이 in-flight(sending)와 부딪히면 여전히 막혀야 한다
    await raw.from('sms_send_log').delete().eq('customer_id', cidA)
    await raw.from('sms_send_log').insert({
      kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: g0.visitDate,
      to_phone: '01011112222', content: 'x', status: 'sending', sent_by: userId,
    })
    const racing = await sendInspectionSms(admin, {
      targets: one, actorId: userId, allowResend: true,
      recipientOverride: { [`${g0.customerId}|${g0.visitDate}`]: ['010-1111-2222'] },
    })
    check('★ 아직 나가는 중(sending)인 건은 재발송 확인을 했어도 막는다',
      /다른 창에서 보내는 중/.test(racing.error ?? ''), racing.error ?? '')
    await raw.from('sms_send_log').delete().eq('customer_id', cidA)
  }

  console.log('\n— 중단해도 번호없음은 기록되는가 (3차 판정 — P-2 재발)')
  {
    // claim 실패·경합으로 조기 반환하면 번호 없는 고객이 흔적 없이 사라지고
    // 결과창은 "번호없음 0"이라 말했다 — 이 모듈이 P-2로 규정한 그 사고다.
    await raw.from('sms_send_log').delete().eq('customer_id', cidB)
    const withNoPhone = targets.filter((t: any) => t.customerId === cidA || t.customerId === cidB)
    const g0: any = withNoPhone.find((t: any) => t.customerId === cidA)
    // 경합을 만든다: 같은 번호로 sending 행을 먼저 심어 우리 요청이 지게 한다
    await raw.from('sms_send_log').insert({
      kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: g0.visitDate,
      to_phone: '01011112222', content: 'x', status: 'sending', sent_by: userId,
    })
    // allowResend=true로 ②-b(이미 보냄 확인)를 지나 ④-b(경합) 중단 경로에 실제로 도달시킨다.
    // 안 그러면 ②-b에서 먼저 끊겨 검증하려는 경로를 밟지 못한다.
    const aborted = await sendInspectionSms(admin, {
      targets: withNoPhone, actorId: userId, allowResend: true,
      recipientOverride: { [`${g0.customerId}|${g0.visitDate}`]: ['010-1111-2222'] },
    })
    const bLogs = await logsOf(cidB)
    check('★ 경합으로 중단돼도 번호 없는 고객은 기록에 남는다(P-2 재발 방지)',
      bLogs.some(l => l.status === 'no_phone'), JSON.stringify(bLogs.map(l => l.status)))
    check('결과의 noPhone 수도 0이 아니다', (aborted.noPhone ?? 0) > 0, JSON.stringify({ noPhone: aborted.noPhone }))
    await raw.from('sms_send_log').delete().eq('customer_id', cidA)
    await raw.from('sms_send_log').delete().eq('customer_id', cidB)
  }

  console.log('\n— 조회 실패 주입: 침묵하지 않는가 (2차 판정 1순위)')
  {
    // 이 가드들은 **조회가 실제로 실패해야** 도달한다. 변이로는 못 덮고, 그래서
    // 지금껏 아무도 확인하지 않았다. 실패를 주입해 "조용한 빈 결과"가 아닌지 본다.
    //
    // loadSentPairs가 빈 집합을 돌려주면 ②-b 중복 확인·배너·뱃지·모달 배지가 **동시에**
    // 무력화된다 — 조회 한 번 실패가 곧 전건 재발송·이중 과금이다.
    const boom = { message: 'injected: connection reset' }
    const chain = (): any => new Proxy({}, {
      get: (_t, p) => p === 'then'
        ? (res: (v: unknown) => void) => res({ data: null, error: boom })
        : () => chain(),
    })
    const boomAdmin: any = { from: () => chain() }

    let threw = ''
    try { await loadSentPairs(boomAdmin, today, addDays(today, 7)) }
    catch (e) { threw = e instanceof Error ? e.message : String(e) }
    check('★ 발송 이력 조회가 실패하면 빈 집합이 아니라 오류다(전건 재발송 방지)',
      /불러오지 못/.test(threw), threw || '조용히 빈 집합을 돌려줬다 — 이미 보낸 건이 전부 미발송으로 보인다')

    let threw2 = ''
    try { await loadSmsTargets(boomAdmin, { from: today, to: addDays(today, 7) }) }
    catch (e) { threw2 = e instanceof Error ? e.message : String(e) }
    check('★ 발송 대상 조회가 실패하면 빈 목록이 아니라 오류다("보낼 안내 없음 ✓" 방지)',
      /불러오지 못/.test(threw2), threw2 || '조용히 []를 돌려줬다')

    let threw3 = ''
    try { await loadLeadRules(boomAdmin) }
    catch (e) { threw3 = e instanceof Error ? e.message : String(e) }
    check('★ 시점 설정 조회가 실패하면 [1]로 축소되지 않는다(7일 전 줄이 사라지는 것 방지)',
      /불러오지 못/.test(threw3), threw3 || '조용히 [1] 폴백 — 설정한 시점 줄이 통째로 사라진다')
  }

  console.log('\n— 임의 발송 (Q-17): 계획 회차가 늘지 않아야 한다')
  const beforeItems = ((await raw.from('inspection_plan_items').select('id').eq('customer_id', cidA)).data ?? []).length
  const adhocT = await loadAdhocTarget(admin, cidA, addDays(today, 3))
  check('adhoc 대상은 planItemId 없이 만들어진다', !!adhocT && adhocT.planItemId === null)
  {
    // ★ 계약이 끝난 고객 제외가 무방비였다(판정 M12) — 계획 경로는 거르는데 임의 발송은
    //   is_active를 select만 하고 쓰지 않아 **해지 고객에게 문자가 나갔다**.
    await raw.from('customers').update({ is_active: false }).eq('id', cidA)
    const inactive = await loadAdhocTarget(admin, cidA, addDays(today, 3))
    check('★ 계약이 끝난 고객에게는 임의 발송 대상이 만들어지지 않는다', inactive === null,
      inactive ? '해지 고객에게 문자가 나간다' : '')
    const planned = await loadSmsTargets(admin, { from: today, to: addDays(today, 7) })
    check('계획 경로도 같은 규칙을 쓴다(두 경로가 갈리지 않는다)',
      !planned.some((t: any) => t.customerId === cidA))
    await raw.from('customers').update({ is_active: true }).eq('id', cidA)
  }
  process.env.SMS_DRY_RUN = '1'
  const adhocDry = await sendInspectionSms(admin, { targets: [adhocT!], actorId: userId, kind: 'adhoc' })
  delete process.env.SMS_DRY_RUN
  check('adhoc도 수신자 2명 → 2통(리허설이라 예정 통수로 센다)',
    adhocDry.dryRunPlanned === 2, String(adhocDry.dryRunPlanned))
  const afterItems = ((await raw.from('inspection_plan_items').select('id').eq('customer_id', cidA)).data ?? []).length
  check('★ 임의 발송은 계획 항목을 만들지 않는다(점검 실적 오염 금지)',
    beforeItems === afterItems, `${beforeItems} → ${afterItems}`)

  console.log('\n— PostgREST 1000행 상한 (조용히 잘리지 않는가)')
  {
    // 넘친 만큼은 오류 없이 그냥 빠진다 — 발송 화면에서 잘리면 **그 고객만 안내를 못 받는데
    // 화면상으로는 아무 문제가 없어 보인다**. 화면 행 수로는 못 잰다(고객+방문일로 접히기 때문에
    // 1260건이 291행이 된다) — 그래서 여기서 **접기 전 대상 수**를 직접 센다.
    const wide = await loadSmsTargets(admin, { from: today, to: addDays(today, 365) })
    const { count: dbCount } = await raw.from('inspection_plan_items')
      .select('id', { count: 'exact', head: true })
      .not('scheduled_date', 'is', null)
      .gte('scheduled_date', today).lte('scheduled_date', addDays(today, 365))
      .in('status', ['planned', 'confirmed', 'completed'])
    check('★ 1년 범위 대상이 1000건에서 멈추지 않는다(상한을 넘겨 받는다)',
      (dbCount ?? 0) <= 1000 || wide.length > 1000,
      `대상 ${wide.length}건 / DB 후보 ${dbCount}건 — 정확히 1000이면 잘린 것이다`)
    check('대상 수가 DB 후보를 넘지 않는다(페이지 중복 수집 없음)',
      wide.length <= (dbCount ?? 0), `${wide.length} vs ${dbCount}`)
    const ids = new Set(wide.map(t => t.planItemId))
    check('★ 페이지 경계에서 중복이 생기지 않는다(id 정렬 고정)',
      ids.size === wide.length, `고유 ${ids.size} / 전체 ${wide.length}`)
  }

  console.log('\n— D1: 시기 지남(안내 못 하고 지난 방문)이 실제로 잡히는가')
  {
    // 어제 방문 건을 만든다 — 종전에는 loadSmsTargets가 from을 today로 clamp하고
    // 과거 행을 drop해서 overdue가 **구조적으로 항상 0**이었다(배너 줄이 렌더될 수 없었다).
    const yesterday = addDays(today, -1)
    const { data: pastPlan } = await raw.from('inspection_plans')
      .select('id').eq('year', +yesterday.slice(0, 4)).eq('month', +yesterday.slice(5, 7)).maybeSingle()
    let pastPlanId = (pastPlan as any)?.id
    if (!pastPlanId) {
      const { data: np } = await raw.from('inspection_plans')
        .insert({ year: +yesterday.slice(0, 4), month: +yesterday.slice(5, 7), status: 'draft', auto_generated: true, created_by: userId })
        .select('id').single()
      pastPlanId = (np as any).id
      madePastPlan = pastPlanId
    }
    // 고객C를 쓴다 — 고객A는 위 절에서 이미 이 달 계획을 가져
    // UNIQUE(plan_id, customer_id, sequence_num)에 걸릴 수 있다(과거 계획이 같은 달일 때).
    // 오류를 삼키지 않는다: null을 그대로 쓰면 이 절이 무엇을 검증했는지 알 수 없게 된다.
    const { data: pi, error: piErr } = await raw.from('inspection_plan_items').insert({
      plan_id: pastPlanId, customer_id: cidC, sequence_num: 2,
      inspection_type: '작동', plan_type: 'monthly',
      scheduled_date: yesterday, status: 'confirmed',
    }).select('id').single()
    if (piErr || !pi) throw new Error(`D1 픽스처(과거 방문 건) 생성 실패: ${piErr?.message ?? 'no row'}`)
    pastItemId = (pi as any).id

    const past = await loadSmsTargets(admin, { from: addDays(today, -7), to: today, includePast: true })
    check('★ includePast면 지난 방문일이 실린다(종전엔 통째로 버려졌다)',
      past.some(t => t.visitDate === yesterday), `${past.length}건`)
    const pastOnes = past.filter(t => t.visitDate === yesterday)
    check('★ 지난 건은 발송 불가로 표시된다(모달에 실려도 못 보낸다)',
      pastOnes.length > 0 && pastOnes.every(t => t.sendable === false && /지난 방문일/.test(t.unsendableReason ?? '')),
      JSON.stringify(pastOnes.map(t => t.unsendableReason)))

    const withoutPast = await loadSmsTargets(admin, { from: addDays(today, -7), to: today })
    check('기본 경로(includePast 없음)는 여전히 지난 건을 뺀다', !withoutPast.some(t => t.visitDate === yesterday))

    const cnt = await countUnsentNotices(admin)
    check('★ 배너 집계가 시기 지남을 0이 아닌 값으로 낸다(D1 해소)',
      cnt.overdueCount > 0, `overdueCount=${cnt.overdueCount}`)
  }

  console.log('\n— D3: 결과 기록이 굳은 행(sending)은 미발송으로 되살아나지 않는다')
  {
    const vd = addDays(today, 2)
    await raw.from('sms_send_log').insert({
      kind: 'pre_visit', customer_id: cidA, plan_item_ids: [], visit_date: vd,
      content: 'x', status: 'sending', sent_by: userId,
    })
    const pairs = await loadSentPairs(admin, today, addDays(today, 7))
    check('★ sending도 "보냄"으로 친다 — 미발송으로 두면 배너가 재발송을 권해 이중 과금이 된다',
      pairs.has(`${cidA}|${vd}`), '돈이 나갔을 수 있는 건이다')
    await raw.from('sms_send_log').delete().eq('customer_id', cidA).eq('visit_date', vd)
  }

  console.log('\n— 과거 방문일 가드')
  const past = await loadSmsTargets(admin, { from: addDays(today, -10), to: addDays(today, -1) })
  check('★ 지난 방문일은 발송 대상에서 빠진다("지난 날에 방문합니다"는 성립하지 않는다)',
    past.length === 0, String(past.length))
} finally {
  // 과거 계획 항목이 남으면 다음 실행의 '시기 지남' 수를 오염시킨다 — 고객보다 먼저 지운다
  if (pastItemId) await raw.from('inspection_plan_items').delete().eq('id', pastItemId)
  for (const c of custIds) {
    await raw.from('sms_send_log').delete().eq('customer_id', c)
    await cleanupCustomer(c)
  }
  if (madePastPlan) await raw.from('inspection_plans').delete().eq('id', madePastPlan)
  if (plan?.created) await raw.from('inspection_plans').delete().eq('id', plan.id)
  await delUser(userId)
}
summary()
