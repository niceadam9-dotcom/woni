/** 미래 점검일자 = 1차 회차 점검일 그대로 (2026-10-07 사용자 확정 「가 + ①」) — 실화면 등록 E2E
 *  실행: npx tsx scripts/test-anchor-future-first.mts   (dev 서버 + 스테이징 DB)
 *
 *  사용자 신고 재현: 달력 10월 9일(한글날) [+] → 고객 등록(일반관리 · 사용승인일 10-05 · 점검일자 10-09)
 *  → 종전엔 1차가 10-07(사용승인일 10-05가 지나 「오늘 이후 첫 영업일」)로 잡혔다.
 *  기대: 1차 scheduled = 입력한 날 그대로(공휴일이어도 옮기지 않음) · planned(법정 자리)는 그대로 ·
 *        다음 해 회차는 사용승인일 축 그대로 · 6단계 마감일이 그 날 기준으로 채워짐.
 *  날짜는 실행일에 기대지 않게 고른다: 사용승인일 = 이번 달 1일 이전 해 같은 달(이미 지난 날),
 *  점검일자 = 오늘+N 중 **공휴일**(없으면 토요일)로 — ①(그대로 둔다)을 실제로 밟게.
 *  🚨 자기가 만든 것만 지운다(이름 표식 E2E-AF-). */
import { BASE, check, summary, mkUser, delUser, launch, login, raw as db } from './_e2e-helpers.mjs'

const STAMP = Date.now().toString(36)
const EMAIL = `anchor-fut-${STAMP}@test.local`
const NAME = `E2E-AF-${STAMP}`
const kst = (offsetDays: number) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10)

// 점검일자 — 앞으로 60일 안의 공휴일(스테이징 holidays 표), 없으면 첫 토요일
const { data: hol } = await db.from('holidays').select('date').gt('date', kst(1)).lte('date', kst(60)).order('date').limit(1)
let ANCHOR = (hol as Array<{ date: string }> | null)?.[0]?.date ?? ''
if (!ANCHOR) for (let i = 2; i < 10; i++) if (new Date(kst(i) + 'T00:00:00Z').getUTCDay() === 6) { ANCHOR = kst(i); break }
// 사용승인일 — 점검일자보다 앞선 같은 달의 1일(이미 지났을 수도, 아닐 수도) 대신, 확실히 지난 날: 오늘-2
const APPROVAL = kst(-2)
console.log(`점검일자 ${ANCHOR}(공휴일·주말) · 사용승인일 ${APPROVAL}`)

let userId = '', browser: { close: () => Promise<void> } | null = null, cid: string | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '미래점검일 검증', employeeId: `AF-${STAMP}`, role: 'admin' })
  const l = await launch(); browser = l.browser; const page = l.page
  page.setDefaultTimeout(90000)
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/new?anchor=${ANCHOR}&from=${encodeURIComponent(`/inspections/calendar?day=${ANCHOR}`)}`, { waitUntil: 'domcontentloaded' })
  await page.getByText('고객명 (건물명)').first().waitFor()
  check('1-1 점검일자 프리필 = 짚은 날', (await page.locator('#new-anchor-date').inputValue()) === ANCHOR)
  await page.locator('#new-customer-name').fill(NAME)
  await page.locator('input[placeholder="주소 검색 후 동/호수 등 추가 입력"]').fill(`서울시 테스트구 ${STAMP}로 1`)
  await page.locator('#new-use-approval').fill(APPROVAL)
  await page.locator('input[name=inspection_category][value="일반관리"]').check({ force: true })
    .catch(async () => { await page.getByText('일반관리', { exact: true }).first().click() })
  await page.locator('[id="contact-대표-name"]').fill('테스트관계인')
  const before = page.url()
  await page.locator('[data-testid="new-submit-save"]').click()
  await page.waitForURL(u => u.toString() !== before && !u.pathname.startsWith('/customers/new'), { timeout: 90000 })

  const { data: c } = await db.from('customers').select('id, inspection_type, plan_anchor_date, use_approval_date').eq('customer_name', NAME).maybeSingle()
  cid = (c as { id: string } | null)?.id ?? null
  check('2-1 고객 생성', !!cid)
  check('2-2 일반관리', (c as { inspection_type: string } | null)?.inspection_type === '일반관리', (c as { inspection_type: string } | null)?.inspection_type)
  const { data: items } = await db.from('inspection_plan_items')
    .select('planned_date, scheduled_date, step1_date, step4_date, plan_type, inspection_id').eq('customer_id', cid!).order('planned_date')
  const rows = (items ?? []) as Array<{ planned_date: string; scheduled_date: string; step1_date: string | null; step4_date: string | null; plan_type: string; inspection_id: string | null }>
  console.log('  계획:', rows.map(r => `${r.planned_date}→${r.scheduled_date}`).join(' · '))
  const first = rows[0]
  check('3-1 1차 점검일 = 입력한 날 그대로(공휴일이어도)', first?.scheduled_date === ANCHOR, first?.scheduled_date)
  // 사용승인일이 이틀 전이라 법정 자리는 「오늘 이후 첫 영업일」 — 공휴일인 점검일자와 같을 수 없다
  check('3-2 1차 법정 자리(planned)는 덮지 않는다', !!first && first.planned_date !== ANCHOR, first?.planned_date)
  check('3-3 6단계 마감일 채움(step1 = 그 날)', first?.step1_date === ANCHOR && !!first?.step4_date, `${first?.step1_date} / ${first?.step4_date}`)
  check('3-4 시작하지 않는다(미래)', !first?.inspection_id)
  const next = rows[1]
  check('3-5 다음 회차는 사용승인일 축 그대로(scheduled == planned)', !!next && next.scheduled_date === next.planned_date, next ? `${next.planned_date}→${next.scheduled_date}` : '없음')
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  await browser?.close()
  if (cid) {
    await db.from('inspection_plan_items').delete().eq('customer_id', cid)
    await db.from('customer_contacts').delete().eq('customer_id', cid)
    await db.from('buildings').delete().eq('customer_id', cid)
    const { error } = await db.from('customers').delete().eq('id', cid)
    check('정리 — 만든 고객 삭제', !error, error?.message)
  }
  if (userId) await delUser(userId)
}
summary()
