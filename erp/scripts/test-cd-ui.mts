// C·D 배치 E2E — §1-2 앵커/세로 전환 · §11-5 필드 포커스 · §9-8c-3 카드 흐림 · §10-R3 서식 버전·새 개정판
// 실행: npx tsx scripts/test-cd-ui.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'cd-ui-e2e@erp-test.com'
let userId = ''
let custId = ''
let genId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: 'CD검증', employeeId: 'E2E-CD' })
  custId = await mkCustomer({ customer_name: 'CD검증고객', created_by: userId })
  genId = await mkCustomer({ customer_name: 'CD일반관리고객', created_by: userId, inspection_type: '일반관리' })
  // fp-* 입력 활성화를 위한 건물 (수신기위치 필드는 건물 없으면 disabled)
  const { error: bErr } = await raw.from('buildings').insert({ customer_id: custId, building_name: 'CD검증동', is_active: true, created_by: userId })
  if (bErr) console.log('  [건물 insert 실패]', bErr.message)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── C-1: 1.10 앵커 바 + 해시 딥링크 ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.10`)
  await page.waitForSelector('text=1.10.1 연간 자체점검 계획')
  check('1.10 앵커 바 노출', await page.isVisible('button:has-text("1.10.4 화재 이력")'))
  await page.click('button:has-text("1.10.4 화재 이력")')
  await page.waitForTimeout(400)
  check('앵커 클릭 → URL #c-1.10.4', page.url().includes('#c-1.10.4'))
  // 해시 딥링크 진입 — 카드 요소 존재 + 스크롤 시도 (뷰포트 검증은 환경 의존이라 요소·해시만)
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.12#c-1.14`)
  await page.waitForSelector('text=1.14 화재예방 및 홍보')
  check('1.12~1.15 앵커 바 + 해시 진입', await page.isVisible('button:has-text("1.15 피해 복구")') && page.url().includes('#c-1.14'))

  // ── C-2: 누락 칩 → 필드 단위 포커스 ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForLoadState('networkidle')
  const rcChip = page.locator('button:has-text("수신기위치 ↗")').first()
  if (await rcChip.count() > 0) {
    await rcChip.click()
    const focused = await page.waitForFunction(() => document.activeElement?.id === 'fp-receiver', null, { timeout: 8000 })
      .then(() => true).catch(() => false)
    const diag = await page.evaluate(() => {
      const el = document.getElementById('fp-receiver') as HTMLInputElement | null
      return JSON.stringify({
        active: document.activeElement?.id || document.activeElement?.tagName,
        exists: !!el, disabled: el?.disabled, ring: el?.classList.contains('ring-2'),
        url: location.search + location.hash,
      })
    })
    check('수신기위치 칩 → fp-receiver 포커스', focused, diag)
  } else {
    check('수신기위치 칩 노출', false)
  }
  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForLoadState('networkidle')
  await page.locator('button:has-text("사용승인일 ↗")').first().click()
  await page.waitForSelector('[role=tab][aria-selected="true"]:has-text("기본정보")', { timeout: 15000 })
  await page.waitForTimeout(1200)
  const infoActive = await page.evaluate(() => document.activeElement?.id ?? '')
  check('사용승인일 칩 → 기본정보 편집 + cf-approval 포커스', infoActive === 'cf-approval', `active=${infoActive}`)

  // 대장 전용 칩(높이·세대수·승강기 등) — 탭 이동 없이 이 화면에서 [건축물대장 불러오기] 즉시 실행 (사용자 보고 2026-07-25)
  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForLoadState('networkidle')
  await page.locator('button:has-text("높이 ↗")').first().click()
  const ledgerRan = await page.waitForSelector('text=/지번 정보가 없습니다|확정 저장|가져올 값이 없습니다/', { timeout: 15000 })
    .then(() => true).catch(() => false)
  check('높이 칩 → 대장 불러오기 실행(미리보기/안내)', ledgerRan)
  check('높이 칩 — 소방계획서 탭 유지', (await page.locator('[role=tab][aria-selected="true"]:has-text("소방계획서")').count()) === 1)

  // ── C-3: 보고서 센터 — 일반관리 고객 흐림·선택 불가 ──
  await page.goto(`${BASE}/reports`)
  await page.waitForSelector('text=소방계획서 HWP 생성')
  await page.fill('input[placeholder="고객명 입력 (부분 검색)"]', 'CD일반관리고객')
  await page.waitForSelector('text=일반관리 — 대상 아님')
  const genBtn = page.locator('button:has-text("CD일반관리고객")').first()
  check('일반관리 후보 흐림 + disabled', await genBtn.isDisabled())

  // ── D: 서식 버전 baseline 연동 + 새 개정판 뱃지·반영 완료 ──
  check('별지 9호 카드 버전 = baseline 공포일', await page.isVisible('text=2026-07-01 공포 (법제처)'))
  // 개정 시뮬레이션: announce_date만 앞으로 (크론 동작과 동일)
  await raw.from('law_form_baselines').update({ announce_date: '20270101' }).eq('key', 'report9')
  await page.goto(`${BASE}/reports`)
  await page.waitForSelector('text=법제처 서식 개정이 감지됐습니다')
  check('개정 배너 + 새 개정판 뱃지', await page.isVisible('text=새 개정판') && await page.isVisible('text=2027-01-01 공포 (법제처)'))
  await page.click('button:has-text("재심기 반영 완료")')
  await page.waitForTimeout(1500)
  await page.goto(`${BASE}/reports`)
  await page.waitForSelector('text=보고서 센터')
  check('반영 완료 → 뱃지 해제', !(await page.isVisible('text=새 개정판')))
  const { data: bl } = await raw.from('law_form_baselines').select('announce_date, seed_date').eq('key', 'report9').single()
  check('DB seed_date 갱신', bl?.seed_date === '20270101', JSON.stringify(bl))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  // baseline 원복 (스테이징 DB)
  await raw.from('law_form_baselines').update({ announce_date: '20260701', seed_date: '20260701' }).eq('key', 'report9')
  if (browser) await browser.close()
  for (const id of [custId, genId]) {
    if (!id) continue
    await raw.from('fire_plan_forms').delete().eq('customer_id', id)
    await raw.from('buildings').delete().eq('customer_id', id)
    await cleanupCustomer(id)
  }
  if (userId) await delUser(userId)
}
summary()
