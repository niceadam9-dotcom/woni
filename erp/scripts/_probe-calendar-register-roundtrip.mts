/** 달력 → 등록 **페이지** → 왔던 사이드바로 복귀 — 실화면 왕복 (2026-09-23)
 *  실행: TEST_BASE_URL=http://localhost:3107 npx tsx scripts/_probe-calendar-register-roundtrip.mts
 *        (로컬 dev + 스테이징 DB)
 *
 *  2026-09-22 계약 교대(모달 → `/customers/new` 페이지) 뒤 옛 프로브 셋은 모달·완료 띠를 전제로
 *  쓰여 있어 이 흐름을 못 걷는다. 여기서는 **끝까지 눌러** 사용자 요청의 본문을 확인한다:
 *    「입력 다 하고 다시 사이드바 화면으로 복귀하도록, **만약 사이드바에서 왔다면**」
 *
 *  갈래 A — 데이 패널에서 왔다 → 등록 → **그 날짜 사이드바가 다시 열린다** + 달력도 그 달
 *  갈래 B — 툴바에서 왔다(패널 닫힘) → 등록 → 달력으로만 돌아온다(패널 없음)
 *  갈래 C — from이 `//evil.com` → 복귀 약속이 안 뜬다(검증식이 걸렀다)
 *  갈래 D — from 없이 /customers/new → 종전대로 고객 상세로 간다(폴백)
 *
 *  🚨 **자기가 만든 것만 지운다** — 이름에 표식(E2E-RT-)을 넣고 만든 id만 지운다.
 *  🚨 되돌림 실패는 조용히 넘기지 않는다.
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { createClient } from '@supabase/supabase-js'

const STAMP = Date.now().toString(36)
const EMAIL = `cal-rt-${STAMP}@test.local`
const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const g = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
const db = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

const iso = (offsetDays: number) =>
  new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10)

const made: string[] = []

async function purge(customerId: string) {
  const { data: insps } = await db.from('inspections').select('id').eq('customer_id', customerId)
  for (const i of insps ?? []) await db.from('inspection_steps').delete().eq('inspection_id', i.id as string)
  await db.from('inspections').delete().eq('customer_id', customerId)
  await db.from('inspection_plan_items').delete().eq('customer_id', customerId)
  await db.from('customer_contacts').delete().eq('customer_id', customerId)
  await db.from('buildings').delete().eq('customer_id', customerId)
  await db.from('activity_logs').delete().eq('entity_id', customerId)
  const { error } = await db.from('customers').delete().eq('id', customerId)
  return error?.message
}

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '달력왕복프로브', employeeId: `E2E-RT-${STAMP}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(90000)
  try { await login(page, EMAIL) } catch (e) {
    throw new Error(`로그인 실패 — URL=${page.url()} · ${String(e).slice(0, 120)}`)
  }

  const qs = () => new URL(page.url()).searchParams
  let lastContinueLabel = ''

  /** 등록 페이지에서 필수 6칸을 채우고 저장. 점검일자는 **프리필을 그대로 둔다**(그게 검사 대상이다).
   *  2026-10-06 — 달력에서 오면 버튼이 둘이다: 'calendar' = [나중에 입력 · 달력으로], 'continue' = [저장하고 다음]. */
  async function fillAndSubmit(label: string, name: string, via: 'calendar' | 'continue' = 'continue') {
    await page.getByText('고객명 (건물명)').first().waitFor()
    await page.locator('input[placeholder="주소 검색 후 동/호수 등 추가 입력"]').fill(`서울시 테스트구 ${STAMP}로 ${label}`)
    await page.locator('input[placeholder="주소 검색 시 자동입력 또는 직접 입력"]').fill(name)
    await page.locator('#new-use-approval').fill('2020-01-01')
    await page.locator('[id="contact-대표-name"]').fill('테스트대표')
    const submit = via === 'calendar'
      ? page.locator('[data-testid="new-submit-calendar"]')
      : page.locator('button[type="submit"]').last()
    const enabled = await page.waitForFunction(
      () => !([...document.querySelectorAll('button[type="submit"]')].pop() as HTMLButtonElement | undefined)?.disabled,
      undefined, { timeout: 60000 },
    ).then(() => true).catch(() => false)
    if (!enabled) throw new Error(`${label}: [등록]이 안 풀렸다 — 버튼 글씨="${(await submit.innerText()).trim()}"`)
    // 필수를 다 채운 뒤라야 주 버튼이 제 문구를 낸다(그 전엔 「필수 항목을 채워주세요」)
    lastContinueLabel = (await page.locator('[data-testid="new-submit-continue"]').innerText().catch(() => '')).trim()
    const before = page.url()
    await submit.click()
    await page.waitForURL(u => u.toString() !== before && !u.pathname.startsWith('/customers/new'), { timeout: 90000 })
    const { data } = await db.from('customers').select('id').eq('customer_name', name).maybeSingle()
    const cid = (data as { id: string } | null)?.id
    if (cid) made.push(cid)
    return cid
  }

  /** 달력 툴바가 보이는 달 — 「yyyy년 M월」 라벨을 읽는다(없으면 ''). 대조군 B가 이 판정이 공허하지 않음을 증명한다. */
  const shownMonth = async () => {
    const t = await page.locator('body').innerText()
    const mm = t.match(/(\d{4})년 (\d{1,2})월/)
    return mm ? `${Number(mm[1])}-${Number(mm[2])}` : ''
  }

  const anchorValue = async () => {
    const v = await page.locator('#new-anchor-date').inputValue()
    return v
  }

  // ── 갈래 A — 데이 패널에서 왔다 ──
  {
    const D = iso(45)
    const [y, m] = D.split('-').map(Number)
    await page.goto(`${BASE}/inspections/calendar?day=${D}`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="daypanel-new-customer"]').waitFor()
    check('A ㉢ `?day=`로 들어오면 그 날짜 패널이 열린다', true)
    check('A ㉠ 패널이 열려 있는 동안 주소에 day가 남는다', qs().get('day') === D, page.url())

    await page.locator('[data-testid="daypanel-new-customer"]').click()
    await page.waitForURL(u => u.pathname === '/customers/new')
    const from = qs().get('from') ?? ''
    check('★ A ㉡ 등록 페이지 주소의 from이 그 날짜 사이드바를 싣는다',
      from.startsWith('/inspections/calendar') && new URLSearchParams(from.split('?')[1] ?? '').get('day') === D, from)
    check('A 등록 페이지 anchor = 짚은 날짜', qs().get('anchor') === D, page.url())
    check('★ A 점검일자가 짚은 날짜로 프리필된다', (await anchorValue()) === D, await anchorValue())
    // 2026-09-23 — 페이지를 열면 **커서가 고객명**에 있다(사용자 요청). 달력에서 와도 같다.
    const focusedId = await page.evaluate(() => document.activeElement?.id ?? '')
    check('★ A 열자마자 커서가 고객명에 있다', focusedId === 'new-customer-name', focusedId || '(없음)')
    check('A 기준일 두 칸이 강조 줄 안에 있다', (await page.locator('[data-testid="new-keydates"] #new-anchor-date').count()) === 1)
    check('A 복귀 약속 문구가 뜬다', (await page.getByText('점검달력으로 돌아갑니다').count()) === 1)
    check('A 달력에서 왔으니 버튼이 둘이다 (나중에 입력 · 달력으로 / 저장하고 다음)',
      (await page.locator('[data-testid="new-submit-calendar"]').count()) === 1
      && (await page.locator('[data-testid="new-submit-continue"]').count()) === 1)

    const cid = await fillAndSubmit('A', `E2E-RT-${STAMP}-패널`, 'calendar')
    check('A 고객이 만들어졌다', !!cid)
    check('★ A 등록 뒤 달력으로 돌아왔다', new URL(page.url()).pathname === '/inspections/calendar', page.url())
    check('★ A 복귀 주소가 day를 들고 있다', qs().get('day') === D, page.url())
    check('★ A 복귀 주소가 new=(방금 등록한 고객)를 들고 있다', !!cid && qs().get('new') === cid, page.url())
    // 「다시 고객을 선택해야 하므로 불편」(2026-10-06) — 달력 맨 위 띠에서 바로 상세로 간다
    const banner = page.locator('[data-testid="cal-new-customer"]')
    const bannerUp = await banner.waitFor({ timeout: 60000 }).then(() => true).catch(() => false)
    check('★★ A 「등록 완료 · 상세정보 입력」 띠가 뜬다', bannerUp && (await banner.innerText()).includes(`E2E-RT-${STAMP}-패널`))
    const detailHref = bannerUp ? await page.locator('[data-testid="cal-new-customer-detail"]').getAttribute('href') ?? '' : ''
    check('★ A 띠의 [상세정보 입력]은 차례 모드(onboarding=1 + 달력 from, new 없음)로 연다',
      detailHref.startsWith(`/customers/${cid}?created=1&onboarding=1&from=`)
      && decodeURIComponent(detailHref.split('from=')[1] ?? '').startsWith('/inspections/calendar')
      && !/new=/.test(decodeURIComponent(detailHref.split('from=')[1] ?? '')), detailHref)
    const reopened = await page.locator('[data-testid="daypanel-new-customer"]').waitFor({ timeout: 60000 }).then(() => true).catch(() => false)
    check('★★ A **그 사이드바가 다시 열렸다**', reopened)
    const header = reopened ? await page.locator('div.fixed.top-0.right-0 p.font-semibold').first().innerText() : ''
    check('★ A 다시 열린 사이드바가 **짚은 날짜**다', header.startsWith(`${m}월 ${Number(D.slice(8))}일`), header)
    // 달력도 그 달인가 — 패널만 열리고 달력이 기한초과 달로 뛰면 「11월 패널 옆 7월 달력」이 된다.
    const shown = await shownMonth()
    check('★ A 달력도 **보던 달**로 섰다 (패널과 같은 달)', shown === `${y}-${m}`, `보이는 달=${shown} / 기대=${y}-${m}`)
    check('A 「등록 완료」 띠는 없다 (돌아온 사이드바가 이미 증언한다)',
      (await page.locator('[data-testid="calendar-created-banner"]').count()) === 0)
    if (cid) {
      const { data: items } = await db.from('inspection_plan_items').select('scheduled_date').eq('customer_id', cid)
      check('A DB에 계획 항목이 생겼다', (items ?? []).length > 0, `${(items ?? []).length}건`)
    }
    if (bannerUp) {
      // 🚨 패널이 열려 있으면 화면 전체 배경막이 깔린다 — 줄이 패널 **안**에 있어야 눌린다(2026-10-06 실측)
      check('★ A 사이드바가 열려 있으니 「등록 완료」 줄은 사이드바 안에 있다',
        (await banner.getAttribute('data-where')) === 'panel' && (await banner.count()) === 1)
      if (process.env.PROBE_SHOT) await page.screenshot({ path: process.env.PROBE_SHOT })
      await page.locator('[data-testid="cal-new-customer-close"]').click({ timeout: 15000 })
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('new'), undefined, { timeout: 10000 }).catch(() => null)
      check('A 띠를 닫으면 띠도 주소의 new도 사라진다 (사이드바는 남는다)',
        (await banner.count()) === 0 && !qs().get('new') && qs().get('day') === D, page.url())
    }
  }

  // ── 갈래 B — 툴바에서 왔다 (패널 닫힘) ──
  {
    await page.goto(`${BASE}/inspections/calendar`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="calendar-new-customer"]').click()
    await page.waitForURL(u => u.pathname === '/customers/new')
    const from = qs().get('from') ?? ''
    check('★ B 툴바 입구의 from에는 day가 **없다**', from.startsWith('/inspections/calendar') && !/[?&]day=/.test(from), from)
    // 2026-10-06 차례 모드 — [저장하고 다음] → 건물정보 → 관계인 → 소방계획서 → [완료 · 달력으로]
    const cid = await fillAndSubmit('B', `E2E-RT-${STAMP}-툴바`, 'continue')
    check('B 고객이 만들어졌다', !!cid)
    check('★ B [저장하고 다음]은 고객 상세(진행 띠)로 간다',
      !!cid && new URL(page.url()).pathname === `/customers/${cid}` && qs().get('onboarding') === '1'
      && (qs().get('from') ?? '').startsWith('/inspections/calendar'), page.url())
    const strip = page.locator('[data-testid="onboarding-strip"]')
    const stripUp = await strip.waitFor({ timeout: 60000 }).then(() => true).catch(() => false)
    if (!stripUp && process.env.PROBE_SHOT) await page.screenshot({ path: process.env.PROBE_SHOT, fullPage: false })
    if (!stripUp) throw new Error(`B 진행 띠가 안 떴다 — URL=${page.url()}`)
    check('★ B 띠가 차례 모드다', (await strip.getAttribute('data-mode')) === 'sequence')
    const cur = async () => page.locator('[data-testid="onboarding-strip"] [data-state="current"]').getAttribute('data-testid').catch(() => '')
    const sel = async () => (await page.locator('[role="tab"][aria-selected="true"]').first().innerText()).trim()
    check('★ B 1번째: 건물정보 탭이 열린다', (await cur()) === 'onboarding-step-buildings' && (await sel()).startsWith('건물'), `${await cur()} / ${await sel()}`)
    check('B 저장 직전 주 버튼 문구 = 「저장하고 다음: 건물정보」', /저장하고 다음: 건물정보/.test(lastContinueLabel), lastContinueLabel)
    const nextBtn = page.locator('[data-testid="onboarding-next"]')
    check('B 건물 용도가 비었으니 「건너뛰고 다음: 관계인」', /건너뛰고 다음: 관계인/.test(await nextBtn.innerText()), await nextBtn.innerText())
    await nextBtn.click()
    await page.waitForFunction(() => document.querySelector('[data-testid="onboarding-strip"] [data-state="current"]')?.getAttribute('data-testid') === 'onboarding-step-contacts', undefined, { timeout: 15000 }).catch(() => null)
    check('★★ B 2번째: 관계인을 **건너뛰지 않는다** (등록 때 찼어도 들른다)',
      (await cur()) === 'onboarding-step-contacts' && (await sel()).startsWith('관계인'), `${await cur()} / ${await sel()}`)
    check('B 관계인은 찼으니 「다음: 소방계획서」(건너뛰고 없음)', /^다음: 소방계획서/.test((await nextBtn.innerText()).trim()), await nextBtn.innerText())
    await nextBtn.click()
    await page.waitForFunction(() => document.querySelector('[data-testid="onboarding-strip"] [data-state="current"]')?.getAttribute('data-testid') === 'onboarding-step-plan', undefined, { timeout: 15000 }).catch(() => null)
    check('★ B 3번째: 소방계획서', (await cur()) === 'onboarding-step-plan', `${await cur()} / ${await sel()}`)
    // ⚠ 기다리지 않고 **바로** 누른다 — 소방계획서 탭이 서버를 왕복하는 동안 떠나도 이동이 서야 한다
    //   (Link였을 땐 여기서 관계인 탭으로 되돌아앉았다 — 2026-10-06, 5초 기다리면 통과하던 경합)
    const done = page.locator('[data-testid="onboarding-done"]')
    check('★ B 끝에서 [완료 · 달력으로]가 뜬다', (await done.count()) === 1 && (await nextBtn.count()) === 0)
    await done.click()
    await page.waitForURL(u => u.pathname === '/inspections/calendar', { timeout: 90000 })
    check('★ B [완료 · 달력으로]로 달력에 돌아왔다', new URL(page.url()).pathname === '/inspections/calendar', page.url())
    check('★ B 돌아온 주소가 new=를 들고 있고 띠가 뜬다', qs().get('new') === cid
      && await page.locator('[data-testid="cal-new-customer"]').waitFor({ timeout: 60000 }).then(() => true).catch(() => false), page.url())
    await page.locator('[data-testid="calendar-new-customer"]').waitFor()
    check('★ B 사이드바는 **열리지 않는다** (패널에서 온 게 아니다)',
      (await page.locator('[data-testid="daypanel-new-customer"]').count()) === 0 && !qs().get('day'), page.url())
    // 대조군 — 패널 없이 돌아오면 달력은 A의 달이 **아니어야** 한다(45일 뒤라 늘 다른 달).
    //   이게 같으면 A의 「보던 달」 판정은 무엇을 봐도 초록인 공허 단언이다.
    const [ay, am] = iso(45).split('-').map(Number)
    const shownB = await shownMonth()
    check('★ B 대조군 — 달력이 A의 달이 아니다 (A의 달 판정이 공허하지 않다)', shownB !== '' && shownB !== `${ay}-${am}`, `보이는 달=${shownB}`)
  }

  // ── 갈래 C — 오픈 리다이렉트 ──
  {
    await page.goto(`${BASE}/customers/new?anchor=${iso(10)}&from=${encodeURIComponent('//evil.com/x')}`, { waitUntil: 'domcontentloaded' })
    await page.getByText('고객명 (건물명)').first().waitFor()
    check('★ C from=//evil.com이면 복귀 약속이 **안 뜬다** (검증식이 걸렀다)',
      (await page.getByText('점검달력으로 돌아갑니다').count()) === 0
      && (await page.locator('[data-testid="new-submit-calendar"]').count()) === 0)
  }

  // ── 갈래 D — 폴백: from 없이 ──
  {
    await page.goto(`${BASE}/customers/new`, { waitUntil: 'domcontentloaded' })
    await page.getByText('고객명 (건물명)').first().waitFor()
    check('D from 없이 열면 점검일자는 비어 있다 (지어내지 않는다)', (await anchorValue()) === '', await anchorValue())
    check('D 일반 등록은 버튼 하나 [고객 등록] — 달력 선택 버튼이 없다',
      (await page.locator('[data-testid="new-submit-calendar"]').count()) === 0)
    await page.locator('#new-anchor-date').fill(iso(30))
    const cid = await fillAndSubmit('D', `E2E-RT-${STAMP}-직접`)
    check('D 고객이 만들어졌다', !!cid)
    check('★ D from이 없으면 종전대로 고객 상세로 간다',
      !!cid && new URL(page.url()).pathname === `/customers/${cid}` && qs().get('created') === '1', page.url())
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  for (const cid of made) {
    const err = await purge(cid)
    if (err) console.error(`⚠ 픽스처 정리 실패(${cid}): ${err} — 수동 확인 필요`)
  }
  const { data: left } = await db.from('customers').select('id, customer_name').like('customer_name', `E2E-RT-${STAMP}%`)
  if ((left ?? []).length) console.error(`⚠ 남은 픽스처: ${JSON.stringify(left)}`)
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
