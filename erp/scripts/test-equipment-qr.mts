/** 설비 대장 3단계 E2E — QR 코드·라벨·리졸버 + 만료 예정 → 견적 초안 (통합계획 C3, 2026-10-03)
 *  실행: npx tsx scripts/test-equipment-qr.mts   (dev 서버 · 마이그 172 적용 DB)
 *
 *  고정하는 것:
 *   · [개체로]: 묶음 3대 → 한 대씩 3행 · [QR 코드 발급]: 수량 1 행 전부에 8자 코드(중복 0) · 다시 눌러도 기존 코드 불변
 *   · 라벨 HTML(?format=html): 코드 수만큼 칸·QR SVG, 사람용 앞 6자 · 미리보기는 tag_printed_at을 찍지 않는다 · 비로그인은 200이 아니다
 *   · /t/{code}: 카드(품목·위치·경과) · 소문자 코드 → 대문자로 · /t?q=앞6자 → 같은 카드 · 없는 코드 → 「등록되지 않은 코드」 · 비로그인 → /login
 *   · 견적 초안: 경과 3대만 한 줄(하자보수 기간 중 1대 제외·notes에 사유) · 단가 = 이 고객 최근 견적 같은 품목 단가 · asset_ids 3 · source=asset
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼 — 서버 액션 직접 호출(발급 재시도)
import { findActionId, collectScripts, callAction } from './_judge19-action.mjs'
import QRCode from 'qrcode'

const EMAIL = `equip-qr-${Date.now().toString(36)}@erp-test.com`
let userId = '', cust = '', bld = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const soonYm = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 60); return `${d.getUTCFullYear() - 10}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01` })()
const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`
const tags = async () => ((await raw.from('equipment_assets').select('id, qty, location, tag_code, tag_printed_at').eq('customer_id', cust).eq('status', 'in_use')).data ?? []) as Array<{ id: string; qty: number; location: string; tag_code: string | null; tag_printed_at: string | null }>

try {
  console.log('[셋업]')
  userId = await mkUser({ email: EMAIL, name: 'QR E2E', employeeId: 'E2E-EQQR', role: 'admin' })
  cust = await mkCustomer({ customer_name: 'ZZ설비QR고객', created_by: userId })
  {
    const { data, error } = await raw.from('buildings').insert({ customer_id: cust, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
    if (error) throw new Error(`건물: ${error.message}`); bld = data!.id
  }
  {
    const { error } = await raw.from('equipment_assets').insert([
      { customer_id: cust, building_id: bld, created_by: userId, category: 'powder', location: '3층', qty: 3, manufactured_on: '2015-03-01', lifespan_rule: 'legal10' },
      { customer_id: cust, building_id: bld, created_by: userId, category: 'powder', location: '1층', qty: 1, manufactured_on: soonYm, lifespan_rule: 'legal10', warranty_until: nextYear },
      { customer_id: cust, building_id: bld, created_by: userId, category: 'descender', location: '5층', qty: 1, manufactured_on: '2024-01-01', lifespan_rule: 'rec10' },
    ])
    if (error) throw new Error(`대장: ${error.message}`)
  }
  // 단가 재사용 근거 — 이 고객의 지난 견적(같은 품목명 줄 25,000원)
  {
    const { error } = await raw.from('quotes').insert({ customer_id: cust, quote_number: `QT-E2E-${Date.now().toString(36)}`, quote_date: '2026-01-05', status: '승인',
      items: [{ description: '분말소화기 교체', quantity: 2, unit_price: 25000, amount: 50000 }], subtotal: 50000, tax_amount: 5000, total_amount: 55000, created_by: userId })
    if (error) throw new Error(`지난 견적: ${error.message}`)
  }

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  const scriptUrls = collectScripts(page)
  await login(page, EMAIL)

  console.log('[1] 개체로 · QR 코드 발급')
  await page.goto(`${BASE}/customers/${cust}?tab=facilities&form=1.4`)
  await page.getByTestId('equipment-table').waitFor()
  page.once('dialog', d => d.accept())
  await page.locator('[data-testid="equipment-row"]', { hasText: '3층' }).getByTestId('equipment-explode').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="equipment-row"]').length === 5)
  const t0 = await tags()
  check('1-1 3층 3대 → 한 대씩 3행(총 5행 모두 qty 1)', t0.length === 5 && t0.every(r => r.qty === 1) && t0.filter(r => r.location === '3층').length === 3)
  await page.getByTestId('equipment-tag-issue').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="equipment-tag-code"]').length === 5)
  const t1 = await tags()
  const codes = t1.map(r => r.tag_code ?? '')
  check('1-2 5행 모두 8자 코드 · 중복 0', codes.every(c => /^[0-9A-HJKMNP-TV-Z]{8}$/.test(c)) && new Set(codes).size === 5, codes.join(','))
  check('1-3 발급 버튼은 비활성(남은 행 0)', await page.getByTestId('equipment-tag-issue').isDisabled())
  {
    const before = JSON.stringify(t1.map(r => [r.id, r.tag_code]).sort())
    // 같은 액션을 한 번 더(버튼은 비활성이라 직접) — 코드 있는 행은 건드리지 않아야 한다
    const id = await findActionId(page, 'issueEquipmentTagsAction', [...scriptUrls])
    check('1-4a 발급 액션 id', !!id)
    await callAction(page, id, [cust])
    check('1-4 코드는 다시 바뀌지 않는다(재발급 없음)', JSON.stringify((await tags()).map(x => [x.id, x.tag_code]).sort()) === before)
  }

  console.log('[2] 라벨 HTML')
  const res = await page.request.get(`${BASE}/customers/${cust}/equipment-labels?format=html`)
  const html = await res.text()
  check('2-1 200 · text/html', res.status() === 200 && (res.headers()['content-type'] ?? '').includes('text/html'), String(res.status()))
  check('2-2 칸 5개 · QR SVG 5개', (html.match(/class="cell"/g) ?? []).length === 5 && (html.match(/<svg/g) ?? []).length === 5)
  check('2-3 사람용 앞 6자 굵게 전부', codes.every(c => html.includes(`<b>${c.slice(0, 6)}</b>-${c.slice(6)}`)))
  {
    // QR 페이로드 = {기준 URL}/t/{코드} — 같은 인코더로 기대 URL을 그려 칸의 SVG와 바이트 대조(인코더가 결정적이라 같으면 같은 내용)
    const cellSvg = (c: string) => { const i = html.indexOf(`data-tag="${c}"`); const a = html.indexOf('<svg', i); return html.slice(a, html.indexOf('</svg>', a) + 6) }
    const want = await QRCode.toString(`${BASE.replace(/\/$/, '')}/t/${codes[0]}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
    check('2-3b QR 내용 = {BASE}/t/{코드}', cellSvg(codes[0]) === want.trim() || cellSvg(codes[0]) === want, `${cellSvg(codes[0]).length} vs ${want.length}`)
  }
  check('2-4 위치·건물 글자', html.includes('본관 · 3층') && html.includes('분말소화기'))
  check('2-5 미리보기는 tag_printed_at을 찍지 않는다', (await tags()).every(r => r.tag_printed_at === null))
  const one = t1.find(r => r.location === '5층')!
  const oneHtml = await (await page.request.get(`${BASE}/customers/${cust}/equipment-labels?format=html&ids=${one.id}`)).text()
  check('2-6 ids=1개 → 1장(재발행)', (oneHtml.match(/class="cell"/g) ?? []).length === 1 && oneHtml.includes(one.tag_code!.slice(0, 6)))
  {
    const anon = await fetch(`${BASE}/customers/${cust}/equipment-labels?format=html`, { redirect: 'manual' })
    check('2-7 비로그인 라벨 요청은 200이 아니다', anon.status !== 200, String(anon.status))
  }

  console.log('[3] /t 리졸버')
  const c3 = t1.find(r => r.location === '3층')!.tag_code!
  await page.goto(`${BASE}/t/${c3}`)
  await page.getByTestId('tag-card').waitFor()
  check('3-1 카드: 분말소화기 · 본관 · 3층 · 경과', ((await page.getByTestId('tag-card-title').textContent()) ?? '').includes('분말소화기')
    && ((await page.getByTestId('tag-card-location').textContent()) ?? '').includes('본관 · 3층')
    && ((await page.getByTestId('tag-card-expiry').textContent()) ?? '').includes('경과'))
  await page.goto(`${BASE}/t/${c3.toLowerCase()}`)
  await page.getByTestId('tag-card').waitFor()
  check('3-2 소문자 코드 → 대문자 경로로', page.url().endsWith(`/t/${c3}`), page.url())
  await page.goto(`${BASE}/t?q=${c3.slice(0, 6).toLowerCase()}`)
  await page.getByTestId('tag-card').waitFor()
  check('3-3 /t?q=앞6자 → 같은 카드', page.url().endsWith(`/t/${c3}`), page.url())
  await page.goto(`${BASE}/t/ZZZZZZZZ`)
  // 부하 중엔 렌더가 늦다 — isVisible()은 기다리지 않아 간헐 빨강(erp-14 실측 2/4). 나타날 때까지 기다린다
  const unknownShown = await page.getByTestId('tag-unknown').waitFor({ timeout: 30000 }).then(() => true, () => false)
  check('3-4 없는 코드 → 「등록되지 않은 코드」', unknownShown)
  {
    const anon = await fetch(`${BASE}/t/${c3}`, { redirect: 'manual' })
    check('3-5 비로그인 /t/{code} → /login', anon.status >= 300 && anon.status < 400 && (anon.headers.get('location') ?? '').includes('/login'), `${anon.status} ${anon.headers.get('location')}`)
  }

  console.log('[4] 만료 예정 → 견적 초안')
  await page.goto(`${BASE}/customers/${cust}?tab=facilities&form=1.4`)
  await page.getByTestId('equipment-table').waitFor()
  check('4-0 버튼 숫자 = 3대(하자보수 중 1대 제외)', ((await page.getByTestId('equipment-quote-draft').textContent()) ?? '').includes('(3대)'))
  await page.getByTestId('equipment-quote-draft').click()
  await page.getByTestId('equipment-quote-link').waitFor()
  const { data: qs } = await raw.from('quotes').select('quote_number, source, status, items, subtotal, notes').eq('customer_id', cust).eq('source', 'asset')
  const q = (qs ?? [])[0] as { quote_number: string; source: string; status: string; items: Array<{ description: string; quantity: number; unit_price: number; amount: number; detail: string; asset_ids: string[] }>; subtotal: number; notes: string | null } | undefined
  check('4-1 견적 1건 · source=asset · 작성중', (qs ?? []).length === 1 && q?.status === '작성중', JSON.stringify(qs))
  check('4-2 한 줄 「분말소화기 교체」 수량 3', q?.items.length === 1 && q.items[0].description === '분말소화기 교체' && q.items[0].quantity === 3, JSON.stringify(q?.items))
  check('4-3 단가 재사용 25,000 · 금액 75,000', q?.items[0].unit_price === 25000 && q.items[0].amount === 75000 && q.subtotal === 75000)
  check('4-4 asset_ids 3 · detail 3층(2015-03)', q?.items[0].asset_ids.length === 3 && q.items[0].detail.includes('3층 1대(2015-03)'))
  check('4-5 notes: 하자보수 1대 제외', (q?.notes ?? '').includes('1대'), q?.notes ?? '')
  check('4-6 화면 링크에 견적번호', ((await page.getByTestId('equipment-quote-link').textContent()) ?? '').includes(q?.quote_number ?? '@@'))
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  console.log('[정리]')
  try { await browser?.close() } catch { /* */ }
  try {
    if (cust) {
      await raw.from('quotes').delete().eq('customer_id', cust)
      await raw.from('equipment_assets').delete().eq('customer_id', cust)
      await cleanupCustomer(cust)
    }
    if (userId) await delUser(userId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
