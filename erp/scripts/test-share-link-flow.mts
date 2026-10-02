/** 관계인 열람·승인 링크 E2E (불량 → 매출 2단계, 2026-10-02)
 *  실행: npx tsx scripts/test-share-link-flow.mts   (dev 서버 · 마이그 170 적용 DB)
 *
 *  고정하는 것:
 *   · 직원이 보수 견적 페이지에서 [링크 만들기] → /p/{43자 토큰} 주소가 한 번 보인다 · DB에는 해시만(원문 토큰 0)
 *   · **로그인 안 한 브라우저**로 링크를 열면 견적 표·합계가 보이고, /login으로 튕기지 않는다
 *   · 열람이 share_link_events(viewed)에 쌓인다
 *   · 이름+동의로 승인 → quotes 「승인」·approval_channel=portal·approved_by_name · 이벤트 approved · 담당자 알림 quote_approved
 *   · 다시 열면 「승인 완료」 문구 · 직원 쪽 링크 목록에 열람 n회·승인자
 *   · 위조 토큰·철회된 링크·만료된 링크 → 전부 404 · 다른 사내 경로(/customers)는 여전히 로그인으로 보낸다
 */
import { chromium } from 'playwright'
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'share-flow-e2e@erp-test.com'
let userId = '', cust = '', insp = '', quoteId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
let anon: import('playwright').Browser | null = null

try {
  console.log('[셋업]')
  userId = await mkUser({ email: EMAIL, name: '링크E2E', employeeId: 'E2E-SHL', role: 'admin' })
  cust = await mkCustomer({ customer_name: 'ZZ링크승인고객', created_by: userId, address: '비공개 주소 1번지' })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-09-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }
  const { data: d } = await raw.from('inspection_defects').insert({ inspection_id: insp, defect_code: 'L-01', defect_name: 'ZZ링크 감지기 불량', severity: '보통' }).select('id').single()
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  {
    const { data, error } = await raw.from('quotes').insert({
      customer_id: cust, inspection_id: insp, source: 'defect', quote_number: `QT-${today.replace(/-/g, '')}-9${Math.floor(Math.random() * 90 + 10)}`,
      quote_date: today, valid_until: '2099-12-31',
      items: [{ description: 'ZZ링크 감지기 불량', quantity: 1, unit_price: 50000, amount: 50000, defect_ids: [d!.id] }],
      subtotal: 50000, tax_amount: 5000, total_amount: 55000, status: '발송', created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`견적 생성 실패: ${error.message}`)
    quoteId = data!.id as string
  }

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)

  console.log('[1] 직원: 링크 만들기')
  await page.goto(`${BASE}/inspections/${insp}/repair`)
  await page.getByTestId('share-links-section').waitFor()
  await page.getByTestId('share-link-create').click()
  const urlBox = page.getByTestId('share-link-url')
  await urlBox.waitFor()
  const url = await urlBox.inputValue()
  const token = url.split('/p/')[1] ?? ''
  check('1-1 /p/{43자 토큰} 주소', /^[A-Za-z0-9_-]{43}$/.test(token), url)
  const { data: links } = await raw.from('share_links').select('id, token_hash, kind, quote_id, expires_at, revoked_at').eq('inspection_id', insp)
  check('1-2 share_links 1행 · kind=quote · 90일 안팎', links?.length === 1 && links[0].kind === 'quote' && links[0].quote_id === quoteId
    && Math.abs(new Date(links[0].expires_at).getTime() - Date.now() - 90 * 86_400_000) < 3_600_000)
  check('1-3 DB에 원문 토큰 없음(해시만)', !!links?.[0] && links[0].token_hash !== token && links[0].token_hash.length === 64)
  const linkId = links![0].id as string

  console.log('[2] 관계인: 로그인 없는 브라우저로 열기')
  anon = await chromium.launch()
  const ap = await (await anon.newContext()).newPage()
  ap.setDefaultTimeout(60000)
  const res = await ap.goto(`${BASE}/p/${token}`)
  check('2-1 200 · /login으로 안 튕김', res?.status() === 200 && !ap.url().includes('/login'), `${res?.status()} ${ap.url()}`)
  await ap.getByTestId('share-page').waitFor()
  check('2-2 합계 55,000원', (await ap.getByTestId('share-total').textContent())?.includes('55,000원') === true)
  check('2-3 고객 주소는 화면에 없다', !(await ap.locator('body').textContent() ?? '').includes('비공개 주소'))
  const { count: views } = await raw.from('share_link_events').select('id', { count: 'exact', head: true }).eq('link_id', linkId).eq('event', 'viewed')
  check('2-4 열람 이벤트 ≥1', (views ?? 0) >= 1, String(views))

  console.log('[3] 승인')
  await ap.getByTestId('share-approve-name').fill('박관계')
  await ap.getByTestId('share-approve-agree').check()
  await ap.getByTestId('share-approve-submit').click()
  await ap.getByTestId('share-approved').waitFor()
  check('3-1 「승인 완료」 문구', (await ap.getByTestId('share-approved').textContent())?.includes('박관계') === true)
  const { data: q } = await raw.from('quotes').select('status, approval_channel, approved_by_name, approved_at').eq('id', quoteId).single()
  check('3-2 quotes 승인·portal·이름', q?.status === '승인' && q?.approval_channel === 'portal' && q?.approved_by_name === '박관계' && !!q?.approved_at)
  const { data: apEv } = await raw.from('share_link_events').select('actor_name, ip').eq('link_id', linkId).eq('event', 'approved')
  check('3-3 승인 이벤트 1건 · 이름 기록', apEv?.length === 1 && apEv[0].actor_name === '박관계')
  const { data: notif } = await raw.from('notifications').select('type, recipient_id, reference_id').eq('type', 'quote_approved').eq('reference_id', insp)
  check('3-4 담당자 알림 quote_approved', (notif ?? []).some(n => n.recipient_id === userId))

  console.log('[4] 직원 쪽 목록')
  await page.reload()
  await page.getByTestId('share-link-list').waitFor()
  const listText = await page.getByTestId('share-link-list').textContent() ?? ''
  check('4-1 열람 n회·승인자 표시', /열람 \d+회/.test(listText) && listText.includes('박관계'), listText.slice(0, 120))

  console.log('[5] 404 경로')
  const forged = token.slice(0, 42) + (token.endsWith('A') ? 'B' : 'A')
  check('5-1 위조 토큰 404', (await ap.goto(`${BASE}/p/${forged}`))?.status() === 404)
  check('5-2 모양 틀린 토큰 404', (await ap.goto(`${BASE}/p/abc`))?.status() === 404)
  await raw.from('share_links').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', linkId)
  check('5-3 만료 링크 404', (await ap.goto(`${BASE}/p/${token}`))?.status() === 404)
  await raw.from('share_links').update({ expires_at: new Date(Date.now() + 86_400_000).toISOString(), revoked_at: new Date().toISOString() }).eq('id', linkId)
  check('5-4 철회 링크 404', (await ap.goto(`${BASE}/p/${token}`))?.status() === 404)
  check('5-5 철회 링크의 파일 경로도 404', (await ap.goto(`${BASE}/p/${token}/file`))?.status() === 404)
  await ap.goto(`${BASE}/customers`)
  check('5-6 사내 경로는 여전히 로그인으로', ap.url().includes('/login'))
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  console.log('[정리]')
  try { await anon?.close() } catch { /* */ }
  try { await browser?.close() } catch { /* */ }
  try {
    if (insp) {
      await raw.from('notifications').delete().eq('reference_id', insp).eq('type', 'quote_approved')
      await raw.from('share_links').delete().eq('inspection_id', insp)
      await raw.from('quotes').delete().eq('inspection_id', insp)
    }
    if (cust) await cleanupCustomer(cust)
    if (userId) await delUser(userId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
