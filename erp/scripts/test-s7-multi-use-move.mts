// 소방계획서_43 S7 — 1.10.3 다중이용업소 카드의 1.4 이사 E2E (2026-09-09, 사용자 확정 B안)
// 실행: npx tsx scripts/test-s7-multi-use-move.mts  (로컬 dev 서버 + 스테이징 DB)
//
// 이 이사의 진짜 위험은 '보이는가'가 아니라 **저장이 갈라졌는가**다:
//   1.4는 fire_facilities(건물별 행), 이 카드는 sections.multiUse(고객별 JSONB 1행).
//   카드를 1.4 안에 두면서 저장은 따로 두었으므로, 양쪽 저장이 서로를 지우지 않는지가 핵심이다.
//   특히 form110의 save()에서 multiUse 키를 뺐다 — 부분 업데이트가 정말 보존하는지 실측해야 한다.
//
// ⚠ 공허 통과 방지: '지워지지 않았다' 계열 단언은 **먼저 값이 실재했음을 단언**한 뒤에만 센다.
//    값이 애초에 없었으면 무엇을 저장해도 '무손상'이라 늘 초록이다.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 's7-mu-move-e2e@erp-test.com'
let userId = ''
let customerId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

/** 고객의 sections.multiUse 를 DB에서 직접 읽는다 — 화면 말고 저장소가 정본 */
async function readMu(): Promise<Record<string, unknown> | null> {
  const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const s = (data as { sections?: Record<string, unknown> } | null)?.sections
  return (s?.multiUse as Record<string, unknown> | undefined) ?? null
}

try {
  userId = await mkUser({ email: EMAIL, name: 'S7이사E2E', employeeId: 'E2E-S7MU' })
  customerId = await mkCustomer({ customer_name: 'S7이사E2E고객', address: '경기 양평군 테스트로 7', created_by: userId })
  const { error: bErr } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true, created_by: userId,
    floors_above: 3, floors_below: 1,
  })
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) 카드가 1.4에 있다 · 「기타」 아래다 ────────────────────────────────
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.4`)
  await page.waitForSelector('[data-testid="form14-etc"]')
  const muOn14 = await page.locator('[data-testid="form14-multi-use"]').count()
  check('S7-2 카드가 서식 1.4에 렌더된다', muOn14 === 1, `(count=${muOn14})`)
  check('S7-2 카드 제목은 절 번호 그대로 「1.10.3 다중이용업소 현황」',
    await page.locator('[data-testid="form14-multi-use"]:has-text("1.10.3 다중이용업소 현황")').isVisible())
  // 「기타」 **아래**임을 DOM 순서로 — '어딘가 있다'는 요청을 만족시키지 못한다
  const order = await page.evaluate(() => {
    const etc = document.querySelector('[data-testid="form14-etc"]')
    const mu = document.querySelector('[data-testid="form14-multi-use"]')
    if (!etc || !mu) return 'missing'
    // DOCUMENT_POSITION_FOLLOWING(4) = mu가 etc보다 뒤
    return (etc.compareDocumentPosition(mu) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'after' : 'before'
  })
  check('S7-2 카드가 「기타」 구역 **아래**에 온다', order === 'after', `(order=${order})`)
  check('S7-2 저장 단위 경계가 화면에 적혀 있다(건물 아님·고객 단위)',
    await page.locator('[data-testid="form14-multi-use"]:has-text("고객 단위")').isVisible())

  // ── 2) 1.10에서는 사라졌다 ────────────────────────────────────────────
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.10`)
  await page.waitForSelector('text=1.10.1 연간 자체점검 계획')
  check('S7-3 1.10 서식에 다중이용업소 카드가 없다',
    (await page.locator('#c-1\\.10\\.3').count()) === 0)
  check('S7-3 1.10 카드 앵커 바에서도 빠졌다',
    !(await page.isVisible('button:has-text("1.10.3 다중이용업소")')))
  check('S7-3 이웃 카드(1.10.2·1.10.4)는 그대로 있다',
    await page.isVisible('text=1.10.4 화재·비화재보 발생 이력'))

  // ── 3) 옛 딥링크 구제 — ?form=1.10#c-1.10.3 은 1.4로 착지해야 한다 ──────
  // ⚠ 직전 goto와 해시만 다르면 브라우저가 **문서 내 이동**으로 처리해 마운트 이펙트가 안 돈다.
  //   실사용자는 다른 화면에서 이 링크를 타고 오므로, 중립 페이지를 한 번 거쳐 진짜 진입을 만든다.
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.1`)
  await page.waitForSelector('text=① 시설현황')
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.10#c-1.10.3`)
  await page.waitForSelector('[data-testid="form14-multi-use"]', { timeout: 10000 }).catch(() => {})
  check('S7-4 옛 딥링크가 1.4로 착지하고 카드가 보인다',
    await page.locator('[data-testid="form14-multi-use"]').isVisible())
  check('S7-4 URL도 form=1.4로 정정된다', page.url().includes('form=1.4'), `(url=${page.url()})`)

  // ── 4) 카드 자기 저장 왕복 ───────────────────────────────────────────
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.4`)
  await page.waitForSelector('[data-testid="form14-multi-use"]')
  const card = page.locator('[data-testid="form14-multi-use"]')
  await card.locator('button:has-text("해당없음")').click()          // 해당 토글 ON
  await card.locator('button:has-text("단란주점")').first().click()   // 업종 1종 (MULTI_USE_CATEGORIES)
  await card.locator('input[placeholder="사업장명"]').fill('S7테스트업소')
  await card.locator('[data-testid="form14-multi-use-save"]').click()
  await page.waitForSelector('[data-testid="form14-multi-use"]:has-text("1.10.3 저장됨")')
  const saved = await readMu()
  check('S7-5 카드 [1.10.3 저장]이 sections.multiUse에 쓴다',
    !!saved && saved.applicable === true && (saved as { bizName?: string }).bizName === 'S7테스트업소',
    `(saved=${JSON.stringify(saved)})`)
  // ⚠ 아래 무손상 단언들의 전제 — 값이 실재해야 '안 지워졌다'가 뜻을 가진다
  const hadValue = !!saved && saved.applicable === true
  check('S7-5 (전제) 무손상 검사에 쓸 양성 표본이 실재한다', hadValue,
    hadValue ? '' : '⚠ 이 표본 없이는 아래 두 단언이 항진명제다')

  // ── 5) 1.10 저장이 multiUse를 지우지 않는다 (form110에서 키를 뺀 것의 실측) ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.10`)
  await page.waitForSelector('text=1.10.1 연간 자체점검 계획')
  // 1.10의 아무 값이나 바꿔 dirty를 만든 뒤 저장 — 무엇을 바꿨는지는 중요하지 않다.
  // 1.10.4 [행 추가]를 쓰는 이유: setDirty(true)가 그 자리에 직접 있어 '눌렀는데 안 더러워지는' 모호함이 없다
  await page.locator('#c-1\\.10\\.4 button:has-text("행 추가")').click()
  await page.locator('button:has-text("서식 1.10 저장")').click()
  await page.waitForSelector('text=✅ 서식 1.10 저장됨')
  const afterForm110 = await readMu()
  check('S7-6 1.10 저장 뒤에도 multiUse 무손상 (부분 업데이트 보존)',
    hadValue && !!afterForm110 && afterForm110.applicable === true
    && (afterForm110 as { bizName?: string }).bizName === 'S7테스트업소',
    `(after=${JSON.stringify(afterForm110)})`)

  // ── 6) 1.4 저장(건물별 설비)이 multiUse를 지우지 않는다 ──────────────────
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.4`)
  await page.waitForSelector('[data-testid="form14-etc"]')
  await page.locator('[data-testid="form14-etc"] button').first().click()   // 기타 1종 체크 → dirty
  await page.locator('[data-testid="form14-save"]').click()
  await page.waitForSelector('text=계획서·별지 4·9호 출력에 반영됩니다')
  const afterForm14 = await readMu()
  check('S7-7 1.4 저장 뒤에도 multiUse 무손상 (저장소가 갈라져 있다)',
    hadValue && !!afterForm14 && afterForm14.applicable === true
    && (afterForm14 as { bizName?: string }).bizName === 'S7테스트업소',
    `(after=${JSON.stringify(afterForm14)})`)

  // ── 7) 새로고침 후에도 화면에 값이 살아 있다 ────────────────────────────
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.4`)
  await page.waitForSelector('[data-testid="form14-multi-use"]')
  check('S7-8 새로고침 뒤 카드가 저장값을 복원한다',
    (await page.locator('[data-testid="form14-multi-use"] input[placeholder="사업장명"]').inputValue()) === 'S7테스트업소')
  check('S7-8 「해당」 토글도 복원된다',
    await page.locator('[data-testid="form14-multi-use"] button:has-text("해당")').first().isVisible())
} catch (e) {
  check('예외 없이 완주', false, String(e))
} finally {
  if (browser) await browser.close()
  await cleanupCustomer(customerId)
  await delUser(userId)
  summary()
}
