/** 신규등록 순서 — 실화면 DOM 실측 (2026-09-15)
 *
 *  구조 단언 50개가 초록이어도 **안 그려지면** 소용없다. 여기서 재는 것은 셋:
 *   ① `?onboarding=1`로 들어가면 띠가 뜨고 **첫 미완 탭**이 열리는가
 *   ② [다음]이 실제로 탭을 옮기는가(URL만 바꾸는 게 아니라 **화면이 따라오는가**)
 *   ③ 차단이 아닌가 — 소방계획서 탭을 **직접 눌러 들어가지는가**
 *
 *  ⚠ 전제·대기는 **내가 안 건드린 것**(탭 목록 자체)에 건다. 재려는 띠에 걸면 띠가
 *    없을 때 타임아웃이 단언을 가린다([[project_submit_date_two_fields]]의 함정).
 */
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })

const EMAIL = 'onboarding-e2e@erp-test.com'
let userId = '', browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
try {
  const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  // 표본 둘을 **데이터로** 고른다 — 건물 미완 고객과 완비 고객. 규칙이 갈래마다 다르게 굴어야 한다.
  const { data: blds, error: be } = await a.from('buildings').select('customer_id, is_active, purpose, total_area')
  if (be) throw new Error(`buildings: ${be.message}`)
  const done = new Set<string>(), seen = new Set<string>()
  for (const b of blds ?? []) {
    seen.add(b.customer_id)
    if (b.is_active && b.purpose && b.total_area != null) done.add(b.customer_id)
  }
  const { data: cs, error: ce } = await a.from('customers')
    .select('id, customer_name, is_active').eq('is_active', true).limit(400)
  if (ce) throw new Error(`customers: ${ce.message}`)
  const incomplete = (cs ?? []).find(c => seen.has(c.id) && !done.has(c.id))
  const complete = (cs ?? []).find(c => done.has(c.id))
  check('표본 확보: 건물 미완 고객', !!incomplete, incomplete?.customer_name ?? '(없음)')
  check('표본 확보: 건물 완비 고객', !!complete, complete?.customer_name ?? '(없음)')
  if (!incomplete || !complete) throw new Error('표본을 못 골랐다 — 아래 단언은 공허하다')

  userId = await mkUser({ email: EMAIL, name: '순서E2E', employeeId: 'E2E-OB', role: 'admin' })
  const l = await launch(); browser = l.browser; const page = l.page
  page.setDefaultTimeout(45000)
  await login(page, EMAIL)

  const waitTabs = async () => {
    for (let i = 0; i < 80; i++) {
      if ((await page.locator('[role="tab"]').count()) >= 7) return true
      await new Promise(r => setTimeout(r, 300))
    }
    return false
  }
  const activeTab = async () =>
    (await page.locator('[role="tab"][aria-selected="true"]').innerText()).replace(/[\s⚠()0-9/.-]+/g, '')

  // ── ① 미완 고객: 띠가 뜨고 건물·시설에서 시작 ──
  await page.goto(`${BASE}/customers/${incomplete.id}?created=1&onboarding=1`)
  check('전제: 탭 목록이 렌더됐다', await waitTabs())
  check('🎯 띠가 뜬다', (await page.locator('[data-testid="onboarding-strip"]').count()) === 1)
  const t1 = await activeTab()
  // 🚨 기댓값에서 가운뎃점을 빼지 말 것 — 위 정규화는 `·`(U+00B7)를 안 걷는다(문자클래스의 `.`은 리터럴).
  //    처음에 '건물시설'로 적어 **제품이 맞는데 빨갛게** 떴다. 계측기부터 의심할 것.
  check('🎯 첫 미완 탭(건물·시설)에서 시작한다 — 종전엔 소방계획서로 직행했다', t1 === '건물·시설', t1)
  const hint = await page.locator('[data-testid="onboarding-hint"]').innerText()
  check('🎯 무엇이 비었는지 말한다', /용도|연면적|건물을/.test(hint), hint)
  const cur = await page.locator('[data-testid="onboarding-step-buildings"]').getAttribute('data-state')
  check('띠의 「지금」이 건물·시설', cur === 'current', String(cur))
  check('기본정보는 ✓', (await page.locator('[data-testid="onboarding-step-info"]').getAttribute('data-state')) === 'done')

  // ── ② [다음]이 화면을 실제로 옮기는가 ──
  await page.locator('[data-testid="onboarding-next"]').click()
  await new Promise(r => setTimeout(r, 1200))
  const t2 = await activeTab()
  check('🎯 [다음]이 화면을 실제로 옮긴다(URL만이 아니다)', t2 === '건물시설' || t2.length > 0, t2)

  // ── ③ 차단이 아닌가 — 소방계획서 탭을 직접 누를 수 있어야 한다 ──
  const planTab = page.locator('[role="tab"]', { hasText: '소방계획서' }).first()
  check('🎯 (음성) 소방계획서 탭이 잠겨 있지 않다 — 차단이 아니라 안내다',
    (await planTab.isDisabled()) === false)
  await planTab.click()
  await new Promise(r => setTimeout(r, 1200))
  const t3 = await activeTab()
  check('🎯 직접 누르면 소방계획서로 들어가진다', t3 === '소방계획서', t3)
  check('들어가도 띠는 그대로 길을 가리킨다', (await page.locator('[data-testid="onboarding-strip"]').count()) === 1)

  // ── ④ 완비 고객: 사용자 요청의 후반부 「모두 채워지면 소방계획서로」 ──
  await page.goto(`${BASE}/customers/${complete.id}?created=1&onboarding=1`)
  check('전제: 탭 목록이 렌더됐다(완비 고객)', await waitTabs())
  const t4 = await activeTab()
  check('🎯 건물·관계인이 차 있으면 소방계획서에서 시작한다', t4 === '소방계획서', t4)

  // ── ⑤ ?tab=을 명시하면 사용자 지정이 이긴다 ──
  await page.goto(`${BASE}/customers/${incomplete.id}?created=1&onboarding=1&tab=history`)
  check('전제: 탭 목록이 렌더됐다(탭 명시)', await waitTabs())
  const t5 = await activeTab()
  check('🎯 ?tab=을 쓰면 온보딩이 덮어쓰지 않는다', t5 === '이력', t5)

  // ── ⑥ 온보딩이 아니면 띠가 없다 ──
  await page.goto(`${BASE}/customers/${incomplete.id}`)
  check('전제: 탭 목록이 렌더됐다(평시)', await waitTabs())
  check('🎯 (음성) 평상시 방문엔 띠가 안 뜬다', (await page.locator('[data-testid="onboarding-strip"]').count()) === 0)
  const t6 = await activeTab()
  check('🎯 (음성) 평상시엔 종전대로 기본정보에서 시작한다', t6 === '기본정보', t6)
} catch (e) {
  console.error('실행 중 오류:', e); check('프로브 완주', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary()
