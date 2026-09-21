/** 「달력 → 설비 확인(1.4) → 점검표 입력 → 달력(우측바) 」 **한 바퀴 실보행** 프로브.
 *
 *  2026-09-21 사용자: 운영에서 이 바퀴가 안 돈다(「배포가 안 된 것 같다」).
 *  배포는 실측으로 확증됨(운영 HEAD e99941f ⊇ 317a7e01·81028958, 마커 착지).
 *  → 그렇다면 **배선 안에 끊긴 고리**가 있다. 추론하지 말고 걸어서 찾는다.
 *
 *  🚨 `from=`은 홉마다 다시 인코딩된다(두 겹 인코딩). 문자열을 눈으로 재지 말고
 *     **실제로 클릭해서 도착지를 본다** — 멀쩡한 링크를 빨갛게 보는 함정이 있다.
 *
 *  실행: npx tsx scripts/_probe-lap-facilities-sheet-calendar.mts
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'lap-fsc-e2e@erp-test.com'
let userId = '', custId = '', inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

try {
  userId = await mkUser({ email: EMAIL, name: '한바퀴프로브', employeeId: 'E2E-LAP' })
  custId = await mkCustomer({ customer_name: '한바퀴프로브고객', address: '경기 양평군 테스트로 90', created_by: userId })
  /* 🚨 표본이 갈림 조건을 **실제로 세워야** 한다 — 갈림은 `total>0 AND unverified>0`이다.
     건물을 안 만들면 total=0이라 ①이 설계대로 점검표로 직행하고, 그걸 결함으로 오독한다
     (첫 판에서 실제로 그랬다). 건물 1동을 만들되 `facilities_verified_at`은 **비워 둔다**. */
  const { error: bErr } = await raw.from('buildings').insert({
    customer_id: custId, building_name: '본관', is_active: true, created_by: userId,
  })
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  const { data: ins, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = ins.id

  const l = await launch(); browser = l.browser; const page = l.page
  page.on('dialog', (d: { accept: () => Promise<void> }) => { void d.accept() })
  await login(page, EMAIL)

  // ══ ① 달력 → 회차 패널 ═══════════════════════════════════════════════════
  await page.goto(`${BASE}/inspections/calendar`)
  await page.waitForTimeout(1500)
  const chip = page.locator('text=한바퀴프로브고객').first()
  const seen = await chip.waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false)
  check('(전제) 달력에 회차가 보인다', seen)
  if (!seen) throw new Error('달력에 회차 없음 — 이후 단언 공허')
  await chip.click()
  await page.waitForTimeout(1500)
  check('① 주소에 ?insp= 가 박힌다', page.url().includes(`insp=${inspId}`), page.url())

  // ══ ② ①단계 링크가 **설비 확인**으로 갈렸는가 (대장이 비었으므로) ════════════
  const links = page.locator('[data-testid="calendar-step-input"]')
  const n = await links.count()
  const hrefs: string[] = []
  for (let i = 0; i < n; i++) hrefs.push((await links.nth(i).getAttribute('href')) ?? '')
  const facLink = hrefs.find(h => h.includes('/facilities')) ?? null
  check('② 대장이 비어 ①이 **설비 확인**으로 갈린다', !!facLink,
    facLink ?? `단계링크: ${hrefs.map(h => h.split('?')[0]).join(' | ')}`)

  // ══ ③ 실제로 클릭해서 설비 화면 도착 ═════════════════════════════════════
  const idx = hrefs.findIndex(h => h.includes('/facilities'))
  if (idx < 0) throw new Error('①이 설비로 안 갈렸다 — 이후 단언 공허')
  await links.nth(idx).click()
  await page.waitForURL(u => u.pathname.endsWith('/facilities'), { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
  check('③ 설비 확인 화면에 도착', page.url().includes('/facilities'), page.url())
  check('③ 순서 띠(① 설비 확인 → ② 점검표 입력)가 보인다',
    await page.locator('[data-testid="facilities-stepband"]').isVisible().catch(() => false))

  // ══ ④ [점검표 입력] 전진 버튼 → 점검표 ════════════════════════════════════
  const toSheet = page.locator('[data-testid="facilities-to-sheet"]').first()
  const tsSeen = await toSheet.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
  check('④ [점검표 입력] 전진 버튼이 있다', tsSeen)
  if (!tsSeen) throw new Error('전진 버튼 없음')
  await toSheet.click()
  await page.waitForURL(u => u.pathname.endsWith('/sheet'), { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(3000)
  check('④ 점검표 입력 화면에 도착', page.url().includes('/sheet'), page.url())

  // ══ ⑤ 점검표 [←] — 달력으로? 그리고 **우측바가 열리는가** ══════════════════
  const back = page.locator('[data-testid="sheet-entry-back"]').first()
  const bSeen = await back.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
  check('⑤ 점검표에 [←]가 있다', bSeen)
  if (bSeen) {
    const bh = (await back.getAttribute('href')) ?? ''
    check('⑤ [←]가 **달력**을 가리킨다 (점검 상세가 아니라)',
      bh.startsWith('/inspections/calendar'), bh)
    check('⑤ [←] 주소에 **insp**가 실려 있다 ← 우측바 복귀의 조건',
      new RegExp(`[?&]insp=${inspId}(&|$)`).test(bh), bh)
    await back.click()
    await page.waitForURL(u => u.pathname === '/inspections/calendar', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2500)
    check('⑥ 달력으로 돌아왔다', page.url().includes('/inspections/calendar'), page.url())
    const reopened = await page.locator('[data-testid="calendar-step-input"]').first()
      .isVisible().catch(() => false)
    check('⑥ **사이드 우측바가 다시 열려 있다** ← 이 바퀴의 알맹이', reopened, page.url())
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
