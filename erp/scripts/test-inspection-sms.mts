/** 사전 안내 SMS UI 배선 E2E (소방계획서_24 S11-2)
 *  실행: npx tsx scripts/test-inspection-sms.mts   (dev 서버 필요)
 *
 *  서버 로직(수신자 선정·중복 접기·실패 처리·판정)은 _probe-sms-send.mts가 32건으로 덮는다.
 *  여기서 확인하는 것은 **프로브가 볼 수 없는 화면 배선**이다:
 *    · 모니터링이 실제로 사라지고 새 화면으로 이어지는가(S6)
 *    · 달력 버튼이 그날 전 건을 띄우는가 — 달력이 로드하지 않는 자체점검까지(Q-14의 핵심)
 *    · 미확정 건이 목록에서 조용히 빠지지 않는가(S8-11)
 *    · 시점 태그를 추가·삭제하면 배너 줄 수가 따라오는가(Q-13)
 *    · 고객관리 수신 체크가 저장되고 통수 안내가 뜨는가(S5-b)
 */
import { chromium, type Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan, login, check, summary } from './_e2e-helpers.mjs'

const SUF = Math.random().toString(36).slice(2, 7)
const EMAIL = `smsui.${SUF}@e2e.test`
const kst = (d = 0) => new Date(Date.now() + 9 * 3600_000 + d * 86400_000).toISOString().slice(0, 10)
const TOMORROW = kst(1)

async function main() {
  const browser = await chromium.launch()
  const page: Page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(20000)

  let userId = ''
  const custIds: string[] = []
  let plan: { id: string; created: boolean } | null = null
  let savedRules: unknown = null

  try {
    userId = await mkUser({ email: EMAIL, name: `문자UI${SUF}`, employeeId: `SU-${SUF}`, role: 'admin' })

    plan = await ensurePlan(+TOMORROW.slice(0, 4), +TOMORROW.slice(5, 7), userId)
    const mkItem = async (cid: string, planType: string, status: string, type = '작동') => {
      const { data, error } = await raw.from('inspection_plan_items').insert({
        plan_id: plan!.id, customer_id: cid, sequence_num: 1,
        inspection_type: type, plan_type: planType,
        scheduled_date: TOMORROW, status,
      }).select('id').single()
      if (error) throw new Error(`계획 항목 생성 실패: ${error.message}`)
      return (data as { id: string }).id
    }

    // A — 자체점검(달력 계획 칩 축에 안 실리는 종류), 관계인 2명
    const cidA = await mkCustomer({ customer_name: `문자UI-A${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '강하면', region_ri: '전수리' })
    custIds.push(cidA)
    await raw.from('customer_contacts').insert([
      { customer_id: cidA, role: '대표', name: '홍길동', phone: '01011112222' },
      { customer_id: cidA, role: '직원1', name: '김철수', phone: '01033334444' },
    ])
    await mkItem(cidA, 'special_작동', 'confirmed')

    // B — 정기(달력 계획 칩에 실림)
    const cidB = await mkCustomer({ customer_name: `문자UI-B${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '양평읍' })
    custIds.push(cidB)
    await raw.from('customer_contacts').insert([{ customer_id: cidB, role: '대표', name: '이대표', phone: '01055556666' }])
    await mkItem(cidB, 'monthly', 'confirmed')

    // C — 미확정(planned)
    const cidC = await mkCustomer({ customer_name: `문자UI-C${SUF}`, created_by: userId, region_si: '양평군', region_myeon: '강하면', region_ri: '전수리' })
    custIds.push(cidC)
    await raw.from('customer_contacts').insert([{ customer_id: cidC, role: '대표', name: '미확정', phone: '01077778888' }])
    await mkItem(cidC, 'monthly', 'planned')

    // 시점 규칙을 **알려진 기준값 [1]로 고정하고 시작**한다.
    // 앞선 실행이 [3,1]을 남기면 배너 첫 줄이 '3일 후'가 되고 태그 추가도 중복으로 막혀
    // 테스트가 자기 잔재에 걸린다(실제로 겪었다). 원래 값은 finally에서 되돌린다.
    const { data: cpBefore } = await raw.from('company_profile')
      .select('id, sms_lead_rules').order('id', { ascending: true }).limit(1).maybeSingle()
    savedRules = (cpBefore as { sms_lead_rules: unknown } | null)?.sms_lead_rules ?? [1]
    await raw.from('company_profile').update({ sms_lead_rules: [1] }).not('id', 'is', null)

    await login(page, EMAIL, PW)

    console.log('\n— S6: 모니터링 폐지')
    await page.goto(`${BASE}/inspection-plans/monitor`, { waitUntil: 'networkidle' })
    check('★ 구 모니터링 주소가 문자 발송으로 이어진다(404·죽은 링크 아님)',
      page.url().includes('/inspections/sms'), page.url())
    const sidebar = await page.locator('nav, aside').first().innerText().catch(() => '')
    check('사이드바에서 [점검현황 모니터링]이 사라졌다', !/점검현황 모니터링/.test(sidebar))
    check('사이드바에 [문자 발송]이 있다', /문자 발송/.test(sidebar), sidebar.slice(0, 200))

    console.log('\n— S5: 문자 발송 화면')
    await page.waitForSelector('[data-testid="sms-row"]', { timeout: 20000 })
    const rowsTxt = await page.locator('[data-testid="sms-row"]').allInnerTexts()
    check('★ 자체점검 건이 목록에 뜬다(달력 계획 칩 축에는 없는 종류)',
      rowsTxt.some(t => t.includes(`문자UI-A${SUF}`)), rowsTxt.join(' | ').slice(0, 300))
    check('정기 건도 뜬다', rowsTxt.some(t => t.includes(`문자UI-B${SUF}`)))
    check('★ 미확정 건도 숨기지 않는다', rowsTxt.some(t => t.includes(`문자UI-C${SUF}`)))
    check('지역 3단 묶음 헤더가 리까지 보여준다',
      (await page.locator('[data-testid="sms-region-group"]').allInnerTexts()).some(t => t.includes('전수리')),
      (await page.locator('[data-testid="sms-region-group"]').allInnerTexts()).join(' | '))
    check('리가 빈 고객은 (리 없음)으로 묶여 사라지지 않는다',
      (await page.locator('[data-testid="sms-region-group"]').allInnerTexts()).some(t => t.includes('리 없음')))
    check('필터는 기본으로 접혀 있다(주 동선은 배너)',
      await page.locator('[data-testid="sms-filter-toggle"]').isVisible() &&
      !(await page.locator('select').first().isVisible().catch(() => false)))

    console.log('\n— Q-12: 승인 배너')
    const notices = await page.locator('[data-testid="sms-notice"]').allInnerTexts()
    check('배너 줄이 그려진다', notices.length >= 1, notices.join(' | '))
    check('★ 내일 방문 건이 미발송으로 집계된다', notices.some(t => /내일/.test(t) && /미발송/.test(t)), notices.join(' | '))

    console.log('\n— S8: 모달 (배너 승인 경로)')
    // 첫 줄이 아니라 **'내일' 줄**을 눌러야 한다 — 시점 규칙이 [3,1]이면 첫 줄은 3일 후이고
    // 그날 방문 고객은 이 테스트가 만든 건이 아니다(앞선 실행이 남긴 규칙에 걸려 오탐이 났다)
    const tomorrowNotice = page.locator('[data-testid="sms-notice"]').filter({ hasText: '내일' })
    check('내일 배너 줄이 하나 있다', await tomorrowNotice.count() === 1, String(await tomorrowNotice.count()))
    await tomorrowNotice.locator('[data-testid="sms-approve"]').click()
    await page.waitForSelector('[data-testid="sms-modal"]')
    await page.waitForSelector('[data-testid="sms-group"]', { timeout: 20000 })
    const groups = await page.locator('[data-testid="sms-group"]').allInnerTexts()
    check('★ 모달에 자체점검 고객이 든다', groups.some(t => t.includes(`문자UI-A${SUF}`)), groups.join(' | ').slice(0, 300))
    // 관계인 2명이 있지만 **아무도 체크하지 않았으므로** 폴백 1명(대표)만 나가는 것이 설계다(Q-10).
    // 도입만으로 문자량이 몇 배가 되지 않게 하는 장치라, 이 단언이 곧 폴백의 회귀 방어다.
    const groupA = groups.find(t => t.includes(`문자UI-A${SUF}`)) ?? ''
    check('★ 수신 미지정이면 대표 1명만(폴백) — 관계인이 2명이어도 2통이 되지 않는다',
      groupA.includes('홍길동') && !groupA.includes('김철수'), groupA.replace(/\n/g, ' '))
    check('★ 미확정 건은 사유와 함께 보이되 발송 불가',
      (await page.locator('[data-testid="sms-unsendable"]').count()) >= 1)
    check('자격증명이 없으면 "실제로 나가지 않는다"를 먼저 말한다',
      (await page.locator('[data-testid="sms-cred-warn"]').count()) >= 1)
    const sendLabel = await page.locator('[data-testid="sms-send"]').innerText()
    check('★ 발송 버튼에 실통수가 찍힌다(비용이 눌리기 전에 보인다)', /\d+통 발송/.test(sendLabel), sendLabel)
    check('문구 편집란이 있고 바이트·SMS/LMS를 보여준다',
      (await page.locator('[data-testid="sms-body"]').count()) === 1 &&
      /바이트/.test(await page.locator('[data-testid="sms-modal"]').innerText()))
    await page.keyboard.press('Escape').catch(() => {})
    await page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click().catch(() => {})

    console.log('\n— Q-14: 달력 진입 (날짜 전달 방식)')
    await page.goto(`${BASE}/inspections/calendar`, { waitUntil: 'networkidle' })
    check('툴바에 [사전안내 문자]가 있다', await page.locator('[data-testid="calendar-sms-toolbar"]').isVisible())
    await page.locator('[data-testid="calendar-sms-toolbar"]').click()
    await page.waitForSelector('[data-testid="sms-group"]', { timeout: 20000 })
    const calGroups = await page.locator('[data-testid="sms-group"]').allInnerTexts()
    check('★ 달력에서 열어도 자체점검 포함 전 건이 뜬다 — 달력이 무엇을 로드했는지와 무관(Q-14)',
      calGroups.some(t => t.includes(`문자UI-A${SUF}`)) && calGroups.some(t => t.includes(`문자UI-B${SUF}`)),
      calGroups.join(' | ').slice(0, 300))
    await page.locator('[data-testid="sms-modal"] button', { hasText: '닫기' }).first().click()

    console.log('\n— S5-b: 고객관리 수신 지정')
    await page.goto(`${BASE}/customers/${cidA}?tab=contacts`, { waitUntil: 'networkidle' })
    // 탭 셸이라 URL만으로 안 열리면 탭을 눌러 연다
    if (!(await page.locator('[data-testid="sms-recipient-summary"]').isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /관계인/ }).first().click().catch(() => {})
    }
    await page.waitForSelector('[data-testid="sms-recipient-summary"]', { state: 'visible' })
    const summaryBefore = await page.locator('[data-testid="sms-recipient-summary"]').innerText()
    check('미지정이면 "대표에게 1통"이라고 말한다(폴백을 숨기지 않는다)',
      /미지정/.test(summaryBefore) && /1통/.test(summaryBefore), summaryBefore)
    await page.locator('[data-testid="sms-recipient-toggle"] input').first().check()
    await page.waitForTimeout(1200)
    const { data: afterRow } = await raw.from('customer_contacts')
      .select('name, sms_recipient').eq('customer_id', cidA).eq('role', '대표').maybeSingle()
    check('★ 체크가 DB에 저장된다', (afterRow as { sms_recipient: boolean | null } | null)?.sms_recipient === true,
      JSON.stringify(afterRow))
    const summaryAfter = await page.locator('[data-testid="sms-recipient-summary"]').innerText()
    check('★ 체크 인원 = 회차당 통수를 화면이 말한다(비용이 정해지는 지점)',
      /1명/.test(summaryAfter) && /1회당 1통/.test(summaryAfter), summaryAfter)
    check('임의 발송 진입점이 고객 상세에 있다(Q-17 — 종전에는 누를 곳이 없었다)',
      await page.locator('[data-testid="customer-adhoc-sms"]').isVisible())

    console.log('\n— Q-13: 시점 설정')
    await page.goto(`${BASE}/settings/message-templates`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="lead-rule-tag"]')
    const before = await page.locator('[data-testid="lead-rule-tag"]').count()
    await page.locator('[data-testid="lead-rule-input"]').fill('3')
    await page.locator('[data-testid="lead-rule-add"]').click()
    await page.waitForTimeout(1500)
    check('★ 시점 태그를 추가하면 늘어난다', await page.locator('[data-testid="lead-rule-tag"]').count() === before + 1,
      String(await page.locator('[data-testid="lead-rule-tag"]').count()))
    const tags = await page.locator('[data-testid="lead-rule-tag"]').allInnerTexts()
    check('먼 시점이 앞에 온다(급한 것이 아래로 가지 않게)', /3일 후/.test(tags[0]), tags.join(','))
    // 중복 거부
    await page.locator('[data-testid="lead-rule-input"]').fill('3')
    await page.locator('[data-testid="lead-rule-add"]').click()
    await page.waitForTimeout(600)
    check('중복 시점은 거부한다', /이미 있는 시점/.test(await page.locator('main, body').first().innerText()))

    check('문구 3종 카드가 그려진다', await page.locator('[data-testid="template-card"]').count() === 3,
      String(await page.locator('[data-testid="template-card"]').count()))
    const cards = await page.locator('[data-testid="template-card"]').allInnerTexts()
    check('★ 관계인 보고 문구가 설정에서 보인다(종전엔 점검 건 안에만 있었다)',
      cards.some(t => t.includes('관계인 보고 메일')), cards.join(' | ').slice(0, 200))
    check('SMS 카드에만 바이트·요금 구분이 뜬다',
      (await page.locator('[data-testid="template-bytes"]').count()) === 1)

    console.log('\n— 배너가 설정 시점을 따라온다')
    await page.goto(`${BASE}/inspections/sms`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="sms-notice"]')
    check('★ 배너 줄 수 = 설정된 시점 수', await page.locator('[data-testid="sms-notice"]').count() === 2,
      String(await page.locator('[data-testid="sms-notice"]').count()))
  } finally {
    if (savedRules) {
      // 모든 행을 되돌린다 — 행이 갈라지면 다음 실행이 어느 행을 볼지에 따라 결과가 달라진다
      await raw.from('company_profile').update({ sms_lead_rules: savedRules }).not('id', 'is', null)
    }
    for (const c of custIds) {
      await raw.from('sms_send_log').delete().eq('customer_id', c)
      await cleanupCustomer(c)
    }
    if (plan?.created) await raw.from('inspection_plans').delete().eq('id', plan.id)
    await delUser(userId)
    await browser.close()
  }
  summary()
}

main().catch(e => { console.error(e); process.exit(1) })
