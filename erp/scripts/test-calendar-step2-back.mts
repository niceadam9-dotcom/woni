/** 점검달력 ↔ **2단계 배치확인서** 복귀 왕복 프로브 (2026-09-21 사용자 확인 요청).
 *
 *  요청 동선: 점검달력 → 2단계 배치확인서 보고서 → 보조인력 입력 → 배치확인서 →
 *             **점검달력 사이드 우측바로 복귀**
 *
 *  기존 `_probe-calendar-sheet-back.mts`는 `.first()`라 **①(점검표 입력)만** 잰다.
 *  여기서는 **②로 들어가는 문 두 개**를 각각 묻는다 — 둘 중 하나만 닫혀 있으면
 *  사용자는 «어느 문으로 들어갔는가»에 따라 돌아오는 자리가 달라진다.
 *
 *  붙드는 것:
 *   ① 달력 패널이 열리고 주소에 `?insp=`가 박힌다
 *   ② [문A] 2단계 줄의 [배치확인서] 링크 — `?step=2` + `from=`에 **insp** 실림
 *   ③ [문B] 패널 하단 [N단계로 이동](`daypanel-detail-link`) — `from=`에 **insp** 실림?
 *   ④ 작업대 ②칸에 배치확인서·보조인력이 함께 있다
 *   ⑤ 작업대 [←]가 달력으로 되돌리고 **사이드 패널이 다시 열린다**
 *
 *  실행: npx tsx scripts/_probe-calendar-step2-back.mts   (로컬 dev + 스테이징 DB)
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'cal-step2-e2e@erp-test.com'
let userId = ''
let custId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
/** `from=`이 **쿼리 경계까지** 맞는지 — `xfrom=`이 통과하는 부분문자열 함정 방지 */
const fromValue = (href: string): string | null => {
  const m = /[?&]from=([^&]*)/.exec(href)
  return m ? decodeURIComponent(m[1]) : null
}

try {
  userId = await mkUser({ email: EMAIL, name: '2단계복귀프로브', employeeId: 'E2E-ST2' })
  custId = await mkCustomer({ customer_name: '2단계복귀프로브고객', address: '경기 양평군 테스트로 88', created_by: userId })
  const { data: ins, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = ins.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', (d: { accept: () => Promise<void> }) => { void d.accept() })
  await login(page, EMAIL)

  // ══ ① 달력 → 회차 클릭 → 사이드 패널 + 주소 ?insp= ════════════════════════
  await page.goto(`${BASE}/inspections/calendar`)
  await page.waitForSelector('text=/점검 달력|달력/', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const chip = page.locator('text=2단계복귀프로브고객').first()
  const chipSeen = await chip.waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false)
  check('(전제) 달력에 이 회차가 보인다', chipSeen)
  if (!chipSeen) throw new Error('달력에 회차가 없다 — 이후 단언이 공허하다')
  await chip.click()
  await page.waitForTimeout(1500)

  check('① 주소에 ?insp= 가 박힌다 (복귀 주소의 원천)',
    page.url().includes(`insp=${inspId}`), page.url())

  // ══ ② [문A] 2단계 줄의 [배치확인서] 링크 ══════════════════════════════════
  const stepLinks = page.locator('[data-testid="calendar-step-input"]')
  const n = await stepLinks.count()
  const hrefs: string[] = []
  for (let i = 0; i < n; i++) hrefs.push((await stepLinks.nth(i).getAttribute('href')) ?? '')
  const step2 = hrefs.find(h => /\?step=2(&|$)/.test(h)) ?? null
  check('② [문A] 2단계 줄에 [배치확인서] 링크가 있다', !!step2,
    step2 ?? `단계링크 ${n}개: ${hrefs.map(h => h.split('?')[1]?.slice(0, 18)).join(' | ')}`)
  if (step2) {
    const f = fromValue(step2)
    check('② [문A] from= 이 달력을 가리킨다', !!f && f.startsWith('/inspections/calendar'), String(f))
    check('② [문A] from= 에 **열린 패널(insp)**이 실린다 ← 우측바 복귀의 조건',
      !!f && new RegExp(`[?&]insp=${inspId}(&|$)`).test(f), String(f))
  }

  // ══ ③ [문B] 패널 하단 [N단계로 이동] ══════════════════════════════════════
  const bottom = page.locator('[data-testid="daypanel-detail-link"]').first()
  const bSeen = await bottom.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)
  check('③ [문B] 패널 하단 [단계로 이동] 링크가 있다', bSeen)
  if (bSeen) {
    const bh = (await bottom.getAttribute('href')) ?? ''
    const bf = fromValue(bh)
    check('③ [문B] from= 이 달력을 가리킨다', !!bf && bf.startsWith('/inspections/calendar'), String(bf))
    check('③ [문B] from= 에 **열린 패널(insp)**이 실린다 ← 같은 조건을 문B에도 묻는다',
      !!bf && new RegExp(`[?&]insp=${inspId}(&|$)`).test(bf), `${bh}\n        from=${bf}`)
  }

  // ══ ④ 작업대 ②칸 — 배치확인서 + 보조인력이 한 칸에 ═════════════════════════
  const backTo = `/inspections/calendar?insp=${inspId}`
  await page.goto(`${BASE}/inspections/${inspId}?step=2&from=${encodeURIComponent(backTo)}`)
  await page.waitForTimeout(2500)
  const body = (await page.locator('main').innerText().catch(() => '')) as string
  /* 🚨 축을 화면의 **실제 문구**로 잡는다. 「배치확인서」는 달력 버튼의 라벨일 뿐이고,
     도착한 칸의 제목은 **「점검인력 배치신고」**다(실측 덤프). 부르는 이름이 갈라져 있다.
     「보조인력」도 화면에는 **「보조 인력 추가…」**로 띄어 쓴다 — 붙여 쓰면 공허하게 빨개진다. */
  check('④ ②칸이 열린다 — 「점검인력 배치신고」', body.includes('점검인력 배치신고'),
    body.slice(0, 160).replace(/\n/g, ' '))
  check('④ 같은 칸에 보조 인력 입력이 함께 있다 (별도 화면이 아니다)',
    body.includes('보조 인력 추가') && body.includes('참여 인력'),
    body.slice(0, 160).replace(/\n/g, ' '))
  check('④ (음성) 이 칸에서 점검표 입력이 같이 열리지는 않는다 — ①칸 것이다',
    !body.includes('빠른 결과 입력'), body.slice(0, 160).replace(/\n/g, ' '))

  // ══ ⑤ [←]가 달력으로 + 패널 재개 ══════════════════════════════════════════
  const back = page.locator('[data-testid="workbench-back"]').first()
  const backSeen = await back.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
  check('⑤ 작업대에 [←]가 있다', backSeen)
  if (backSeen) {
    check('⑤ [←]가 복귀 주소를 가리킨다', (await back.getAttribute('href')) === backTo,
      String(await back.getAttribute('href')))
    await back.click()
    await page.waitForURL(u => u.pathname === '/inspections/calendar', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2000)
    const reopened = await page.locator('[data-testid="calendar-step-input"]').first()
      .isVisible().catch(() => false)
    check('⑤ 돌아온 달력에서 **사이드 우측바가 다시 열려 있다** ← 요청의 알맹이', reopened, page.url())
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (inspId) await raw.from('inspections').delete().eq('id', inspId)
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
  summary()
}
