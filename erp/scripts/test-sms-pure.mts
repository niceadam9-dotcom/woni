/** 사전 안내 SMS 순수 함수 단언 (소방계획서_24 S11-1)
 *  실행: npx tsx scripts/test-sms-pure.mts   — **서버·DB 불필요**, 결정적이고 빠르다
 *
 *  이 파일이 지키는 것들은 전부 "틀려도 화면상으로는 멀쩡해 보이는" 종류다:
 *    · 수신자를 잘못 고르면 → 엉뚱한 사람이 받고, 받아야 할 사람은 모른다
 *    · 그룹화를 빠뜨리면    → 같은 번호로 2~3통(요금·고객 피로)
 *    · 리가 빈 고객을 숨기면 → 그 고객만 영영 문자가 안 간다
 *    · unverified를 failed로 두면 → 실제로 나간 문자를 재발송한다
 */
import {
  normalizePhone, isSendablePhone, maskPhone, pickContacts, groupTargets, countMessages,
  groupByRegion, smsByteLength, smsKind, dDayLabel, daysBetween, todayKst, addDays,
  validateLeadRules, resolvePendingNotices, parseSolapiResult, renderTemplate, unresolvedVars, shortDate,
  type SmsTarget, type Contact,
} from '../src/lib/sms-recipients.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const C = (role: string, name: string, phone: string | null, sms?: boolean | null): Contact =>
  ({ role, name, phone, sms_recipient: sms })

const T = (o: Partial<SmsTarget> & { customerId: string; visitDate: string; contacts: Contact[] }): SmsTarget => ({
  planItemId: o.planItemId ?? `pi-${o.customerId}-${o.visitDate}`,
  customerName: o.customerName ?? `고객${o.customerId}`,
  inspectionType: o.inspectionType ?? '작동',
  ...o,
})

console.log('— 전화번호')
ok('normalizePhone이 구분자를 제거', normalizePhone('010-1234-5678') === '01012345678')
ok('11자리 휴대폰은 발송 가능', isSendablePhone('010-1234-5678'))
ok('9자리 유선도 발송 가능(031-123-4567)', isSendablePhone('031-123-4567'))
ok('0으로 시작하지 않으면 거부', !isSendablePhone('1588-1234'))
ok('빈 값 거부', !isSendablePhone(null) && !isSendablePhone(''))
ok('마스킹은 앞 3·뒤 4만 남긴다', maskPhone('01012345678') === '010-****-5678', maskPhone('01012345678'))

console.log('\n— pickContacts (Q-10) 4케이스')
ok('① 전원 미지정(NULL) → 대표 1명 폴백',
  (() => { const r = pickContacts({ contacts: [C('대표', '홍길동', '01011112222'), C('직원1', '김철수', '01033334444')] })
    return r.length === 1 && r[0].name === '홍길동' })())
ok('② 2명 체크 → 2명 모두',
  (() => { const r = pickContacts({ contacts: [C('대표', '홍길동', '01011112222', true), C('직원1', '김철수', '01033334444', true), C('직원2', '이영희', '01055556666')] })
    return r.length === 2 && r.map(c => c.name).join(',') === '홍길동,김철수' })())
ok('③ 체크됐지만 번호 없음 → 제외(폴백으로 돌아가지 않는다)',
  (() => { const r = pickContacts({ contacts: [C('대표', '홍길동', null, true), C('직원1', '김철수', '01033334444')] })
    return r.length === 0 })(),
  '한 명이라도 체크했으면 그 지정이 의사표시다 — 번호가 없으면 noPhone으로 드러나야 한다')
ok('④ 지정관계인이 폴백 최상단',
  (() => { const r = pickContacts({ designated: C('지정', '박담당', '01099998888'), contacts: [C('대표', '홍길동', '01011112222')] })
    return r.length === 1 && r[0].name === '박담당' })())
ok('⑤ 같은 번호 2역할 → 1통(대표=직원1)',
  (() => { const r = pickContacts({ contacts: [C('대표', '홍길동', '010-1111-2222', true), C('직원1', '홍길동', '01011112222', true)] })
    return r.length === 1 })())
ok('⑥ 체크가 있으면 대표가 미체크여도 안 보낸다',
  (() => { const r = pickContacts({ contacts: [C('대표', '홍길동', '01011112222'), C('직원2', '이영희', '01055556666', true)] })
    return r.length === 1 && r[0].name === '이영희' })())
// 2026-08-19 — 대표 기본 체크 + '해제하면 안 보낸다'. 종전엔 해제가 NULL로 되돌아가 폴백이
// 대표를 도로 집어넣었고, 그래서 체크를 꺼도 문자가 나갔다(끄는 수단이 없는 것과 같았다).
ok('★⑦ 대표를 해제(false)하면 아무에게도 안 간다 — 폴백이 되살리지 않는다',
  (() => { const r = pickContacts({ contacts: [C('대표', '홍길동', '01011112222', false)] })
    return r.length === 0 })(),
  '해제는 의사표시다 — 미지정(NULL)과 구분하지 않으면 끌 수가 없다')
ok('★⑧ 전원 해제면 번호가 있어도 안 간다',
  (() => { const r = pickContacts({ contacts: [C('대표', '홍길동', '01011112222', false), C('직원1', '김철수', '01033334444', false)] })
    return r.length === 0 })())
ok('★⑨ 해제와 체크가 섞이면 체크한 사람에게만',
  (() => { const r = pickContacts({ contacts: [C('대표', '홍길동', '01011112222', false), C('직원1', '김철수', '01033334444', true)] })
    return r.length === 1 && r[0].name === '김철수' })())
ok('★⑩ 미지정(NULL)은 종전대로 폴백 1명 — 레거시 고객이 조용히 끊기지 않는다',
  (() => { const r = pickContacts({ contacts: [C('대표', '홍길동', '01011112222', null), C('직원1', '김철수', '01033334444', null)] })
    return r.length === 1 && r[0].name === '홍길동' })())

console.log('\n— groupTargets (P-12) — 이 기능의 핵심 리스크')
{
  const cs = [C('대표', '홍길동', '01011112222')]
  const { groups, noPhone } = groupTargets([
    T({ customerId: 'A', visitDate: '2026-09-19', contacts: cs, planItemId: 'p1', inspectionType: '작동' }),
    T({ customerId: 'A', visitDate: '2026-09-19', contacts: cs, planItemId: 'p2', inspectionType: '종합' }),
  ])
  ok('★ 같은 고객 같은 날 계획 2건 → 그룹 1개, planItemIds 2개',
    groups.length === 1 && groups[0].planItemIds.length === 2, JSON.stringify(groups.map(g => g.planItemIds)))
  ok('점검유형 2종이 함께 실린다', groups[0].inspectionTypes.join(',') === '작동,종합')
  ok('통수는 수신자 수 기준 = 1', countMessages(groups) === 1)
  ok('noPhone 없음', noPhone.length === 0)
}
{
  const cs = [C('대표', '홍길동', '01011112222')]
  const { groups } = groupTargets([
    T({ customerId: 'A', visitDate: '2026-09-19', contacts: cs }),
    T({ customerId: 'A', visitDate: '2026-09-22', contacts: cs }),
  ])
  ok('다른 날 같은 고객 → 그룹 2개', groups.length === 2)
}
{
  const { groups, noPhone } = groupTargets([
    T({ customerId: 'B', customerName: '번호없는곳', visitDate: '2026-09-19', contacts: [C('대표', '무번호', null)] }),
  ])
  ok('★ 번호 없는 고객은 그룹에서 빠지고 noPhone에 남는다(조용한 소멸 금지, P-2)',
    groups.length === 0 && noPhone.length === 1 && noPhone[0].customerName === '번호없는곳')
  ok('noPhone에도 planItemIds가 실린다', noPhone[0].planItemIds.length === 1)
}
{
  const cs = [C('대표', '홍', '01011112222', true), C('직원1', '김', '01033334444', true)]
  const { groups } = groupTargets([T({ customerId: 'C', visitDate: '2026-09-19', contacts: cs })])
  ok('수신자 2명이면 통수 2', countMessages(groups) === 2)
}
{
  const cs = [C('대표', '홍', '01011112222')]
  const { groups } = groupTargets([
    T({ customerId: 'D', visitDate: '2026-09-19', contacts: cs, planItemId: 'p1' }),
    T({ customerId: 'D', visitDate: '2026-09-19', contacts: cs, planItemId: 'p2', sendable: false, unsendableReason: '점검일 미확정' }),
  ])
  ok('한 건이라도 발송 불가면 그룹 전체가 불가(미확정이 섞인 채 나가지 않는다)',
    groups.length === 1 && groups[0].sendable === false && groups[0].unsendableReason === '점검일 미확정')
  ok('발송 불가 그룹은 통수에서 빠진다', countMessages(groups) === 0)
}

console.log('\n— groupByRegion (Q-11)')
{
  const cs = [C('대표', '홍', '01011112222')]
  const { groups } = groupTargets([
    T({ customerId: 'R1', customerName: '전수리마을회관', visitDate: '2026-09-19', contacts: cs, regionSi: '양평군', regionMyeon: '강하면', regionRi: '전수리' }),
    T({ customerId: 'R2', customerName: '강하빌라', visitDate: '2026-09-19', contacts: cs, regionSi: '양평군', regionMyeon: '강하면', regionRi: '전수리' }),
    T({ customerId: 'R3', customerName: '양평읍상가', visitDate: '2026-09-19', contacts: cs, regionSi: '양평군', regionMyeon: '양평읍', regionRi: null }),
    T({ customerId: 'R4', customerName: '가평건물', visitDate: '2026-09-19', contacts: cs, regionSi: '가평군', regionMyeon: '가평읍', regionRi: '읍내리' }),
  ])
  const rgs = groupByRegion(groups)
  ok('3단으로 묶인다(전수리 2건이 한 묶음)', rgs.length === 3 && rgs.some(r => r.ri === '전수리' && r.groups.length === 2),
    JSON.stringify(rgs.map(r => [r.label, r.groups.length])))
  // 지키려는 것은 라벨 문구가 아니라 **그 고객이 사라지지 않는가**다.
  // '(리 없음)' 표기는 뺐지만(읍/면 있는 고객의 94%가 리 없음이라 화면이 뒤덮였다)
  // 묶음 자체는 남아야 한다 — 빠지면 그 고객만 영영 문자가 안 간다.
  ok('★ 리가 빈 고객도 묶음으로 남는다 — 숨기면 그 고객만 영영 문자가 안 간다',
    rgs.some(r => r.myeon === '양평읍' && r.ri === null && r.groups.some(g => g.customerId === 'R3')),
    JSON.stringify(rgs.map(r => r.label)))
  ok('리가 없으면 라벨을 읍/면에서 끝낸다(없는 것을 굳이 말하지 않는다)',
    rgs.some(r => r.label === '양평군 · 양평읍'), JSON.stringify(rgs.map(r => r.label)))
  ok('정렬은 시/군 → 읍/면 → 리', rgs[0].si === '가평군', JSON.stringify(rgs.map(r => r.si)))
}

console.log('\n— 길이·요금 (LMS 경계)')
ok('한글은 2바이트', smsByteLength('가나다') === 6)
ok('영숫자는 1바이트', smsByteLength('abc123') === 6)
ok('90바이트는 SMS', smsKind('가'.repeat(45)) === 'SMS' && smsByteLength('가'.repeat(45)) === 90)
ok('91바이트부터 LMS(요금 2~3배)', smsKind('가'.repeat(45) + 'a') === 'LMS')
{
  const seed = '[승진소방ENG] 내일 9/19(금)\n소방시설 점검을 위해 방문합니다.\n문의 031-000-0000'
  ok(`기본 문구가 SMS 범위 안(${smsByteLength(seed)}바이트)`, smsKind(seed) === 'SMS', `${smsByteLength(seed)}바이트`)
}

console.log('\n— 디데이·날짜')
ok('0=오늘', dDayLabel(0) === '오늘')
ok('1=내일', dDayLabel(1) === '내일')
ok('2=모레', dDayLabel(2) === '모레')
ok('7=7일 후', dDayLabel(7) === '7일 후')
ok('음수는 지난 날로 표기', dDayLabel(-3) === '3일 전')
ok('daysBetween 월경계', daysBetween('2026-08-30', '2026-09-02') === 3)
ok('addDays 월경계', addDays('2026-08-30', 3) === '2026-09-02')
ok('todayKst는 UTC+9 기준', todayKst(Date.UTC(2026, 7, 18, 16, 0, 0)) === '2026-08-19',
  todayKst(Date.UTC(2026, 7, 18, 16, 0, 0)))
ok('shortDate 요일 포함', shortDate('2026-09-19') === '9/19(토)', shortDate('2026-09-19'))

console.log('\n— validateLeadRules (Q-13)')
ok('정상값은 먼 시점부터 정렬', JSON.stringify(validateLeadRules([1, 3]).rules) === '[3,1]')
ok('0(당일) 허용', validateLeadRules([0]).error === null)
ok('중복 거부', /중복/.test(validateLeadRules([1, 1]).error ?? ''))
ok('음수 거부', /0\(당일\) 이상/.test(validateLeadRules([-1]).error ?? ''))
ok('비정수 거부', /정수/.test(validateLeadRules([1.5]).error ?? ''))
ok('빈 배열 거부', /최소 1개/.test(validateLeadRules([]).error ?? ''))
ok('배열 아님 거부', /형식/.test(validateLeadRules('1' as unknown).error ?? ''))

console.log('\n— resolvePendingNotices (Q-12의 심장)')
{
  const cs = [C('대표', '홍', '01011112222')]
  const today = '2026-08-18'
  const { groups } = groupTargets([
    T({ customerId: 'N1', visitDate: addDays(today, 1), contacts: cs }),
    T({ customerId: 'N2', visitDate: addDays(today, 1), contacts: cs }),
    T({ customerId: 'N3', visitDate: addDays(today, 3), contacts: cs }),
    T({ customerId: 'N4', visitDate: addDays(today, -2), contacts: cs }),   // 시기 지남
  ])
  const sentSet = new Set(['N2|' + addDays(today, 1)])
  const { notices, overdue } = resolvePendingNotices(groups, [3, 1], today,
    (cid, vd) => sentSet.has(`${cid}|${vd}`))
  ok('규칙 수만큼 배너 줄', notices.length === 2)
  ok('먼 시점이 먼저', notices[0].leadDays === 3 && notices[1].leadDays === 1)
  ok('★ 이미 보낸 건은 미발송에서 빠진다', notices[1].unsentCount === 1, JSON.stringify(notices[1].unsentGroups.map(g => g.customerId)))
  ok('통수가 수신자 기준으로 계산', notices[1].messageCount === 1)
  ok('라벨에 디데이와 월/일', notices[1].label === `내일(${+addDays(today,1).slice(5,7)}/${+addDays(today,1).slice(8,10)}) 방문`, notices[1].label)
  ok('시기 지남은 별도로 분리(발송 대상 아님)', overdue.count === 1 && overdue.groups[0].customerId === 'N4')
  ok('시기 지남이 배너 줄에는 섞이지 않는다', notices.every(n => n.groups.every(g => g.visitDate >= today)))

  // 날짜를 옮기면 옛 발송 기록이 새 날짜를 가리면 안 된다 — S5-10의 핵심
  const moved = groupTargets([T({ customerId: 'N2', visitDate: addDays(today, 1), contacts: cs })]).groups
  const movedTo = groupTargets([T({ customerId: 'N2', visitDate: addDays(today, 3), contacts: cs })]).groups
  const r1 = resolvePendingNotices(moved, [1], today, (c, v) => sentSet.has(`${c}|${v}`))
  const r2 = resolvePendingNotices(movedTo, [3], today, (c, v) => sentSet.has(`${c}|${v}`))
  ok('★ 점검일을 옮기면 다시 미발송이 된다(재안내를 놓치지 않는다)',
    r1.notices[0].unsentCount === 0 && r2.notices[0].unsentCount === 1)
}

console.log('\n— parseSolapiResult (P-11) — unverified가 요점')
{
  const phones = ['01011112222', '01033334444']
  const all = parseSolapiResult(phones, 200, { messageList: [
    { to: '01011112222', statusCode: '2000', messageId: 'M1' },
    { to: '01033334444', statusCode: '2000', messageId: 'M2' },
  ] })
  ok('전건 성공', [...all.values()].every(v => v.status === 'sent'))

  const partial = parseSolapiResult(phones, 200, { messageList: [
    { to: '01011112222', statusCode: '2000', messageId: 'M1' },
    { to: '01033334444', statusCode: '3019', statusMessage: '수신거부', messageId: 'M2' },
  ] })
  ok('★ 부분 실패를 번호별로 구분(종전에는 res.ok만 봐서 불가능했다)',
    partial.get('01011112222')!.status === 'sent' && partial.get('01033334444')!.status === 'failed')
  ok('실패 사유가 남는다', /수신거부/.test(partial.get('01033334444')!.error ?? ''))

  const http4xx = parseSolapiResult(phones, 401, { errorMessage: 'invalid api key' })
  ok('HTTP 4xx는 전건 failed', [...http4xx.values()].every(v => v.status === 'failed'))
  ok('4xx 사유에 상태코드', /401/.test(http4xx.get('01011112222')!.error ?? ''))

  const unknown = parseSolapiResult(phones, 200, { somethingElse: true })
  ok('★ 알 수 없는 스키마 → unverified (failed로 두면 실제 나간 문자를 재발송한다)',
    [...unknown.values()].every(v => v.status === 'unverified'))

  const missing = parseSolapiResult(phones, 200, { messageList: [{ to: '01011112222', statusCode: '2000' }] })
  ok('응답에 없는 번호도 unverified', missing.get('01033334444')!.status === 'unverified')

  const noCode = parseSolapiResult(['01011112222'], 200, { messageList: [{ to: '01011112222', messageId: 'M1' }] })
  ok('상태코드가 없으면 unverified', noCode.get('01011112222')!.status === 'unverified')
}

console.log('\n— 문구 치환')
{
  const body = '[{회사명}] {디데이} {점검일짧게}\n소방시설 점검을 위해 방문합니다.\n문의 {회사전화}'
  const out = renderTemplate(body, { 회사명: '승진소방ENG', 디데이: '내일', 점검일짧게: '9/19(토)', 회사전화: '031-000-0000' })
  ok('전 변수 치환', !/[{}]/.test(out), out)
  ok('치환 결과가 SMS 범위', smsKind(out) === 'SMS', `${smsByteLength(out)}바이트`)
  const partial = renderTemplate(body, { 회사명: '승진소방ENG' })
  ok('★ 값 없는 변수는 그대로 남긴다(조용히 빈칸이 되면 이상한 문자가 나간다)', /\{디데이\}/.test(partial))
  ok('미치환 변수를 열거할 수 있다',
    unresolvedVars(partial).join(',') === '디데이,점검일짧게,회사전화', unresolvedVars(partial).join(','))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
