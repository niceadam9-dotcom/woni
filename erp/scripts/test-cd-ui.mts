// C 배치 E2E — §1-2 앵커/세로 전환 · §11-5 누락 칩 → 필드 포커스
// (구 §9-8c-3 카드 흐림 · §10-R3 서식 버전·새 개정판은 보고서 센터 해체로 삭제 — 아래 C-3 주석)
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
  // 기본정보 탭으로 보내는 누락 칩(주소·사용승인일)은 **존재하지 않는다**.
  // computeFirePlanReadiness가 내보내는 라벨 10개는 전부 1.1 일반현황 항목이고
  // (수신기위치·구조·지붕·선임일·급수·화재보험·운영시간·인원·자위소방대·선임 형태),
  // 주소·사용승인일은 고객 기본정보 축이라 준비율에 든 적이 없다(git log -S로 확인 —
  // 그 라벨이 이 파일에 있었던 적이 없다). plan-tab-view의 CHIP_TARGET·CHIP_FIELD_ID에
  // 남은 두 항목은 라벨이 안 나오므로 죽은 매핑이다.
  // 종전 이 자리에서 '사용승인일 ↗'를 눌러 cf-approval 포커스를 보려다 **항상** 타임아웃이 났다.
  // 없는 것을 기다리는 단언을 지우되, 사라진 사실 자체는 단언으로 남긴다.
  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForLoadState('networkidle')
  check('기본정보 탭행 누락 칩은 없다 — 준비율은 1.1 항목만 센다',
    await page.locator('button:has-text("사용승인일 ↗"), button:has-text("주소 ↗")').count() === 0)

  // ⚠ 대장 전용 칩(높이·세대수·승강기 등)도 **뜨지 않는다**. 위와 같은 이유다 —
  //   ↗ 칩을 만드는 곳은 plan-tab-view.tsx:295 한 곳뿐이고 거기 들어가는 라벨은
  //   readiness.missing(=1.1 항목 10개)이 전부다. '높이'는 그 10개에 없고, git log -S로
  //   보면 readiness에 들어 있던 적도 없다.
  //   → CHIP_TARGET의 buildings·info 항목 전부와, gotoMissing의 그 두 분기(탭 이동 +
  //     cf-* 포커스 / 즉시 대장 조회)는 **도달할 수 없는 코드**다.
  //   2026-07-25 사용자 보고로 만든 '칩에서 대장 즉시 실행'이 그래서 쓰이지 못하고 있다.
  //   테스트를 지우기보다 이 사실을 단언으로 고정해 둔다 — 칩이 되살아나면 여기가 먼저 깨진다.
  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForLoadState('networkidle')
  const chipLabels = await page.locator('button:text-matches("↗$")').allInnerTexts()
  const buildingChips = chipLabels.filter(t => /^(높이|세대수|승강기|주차장|연면적|건축면적|층수|건물 용도|건축허가일|건물동수)\s*↗$/.test(t.trim()))
  check('건물 탭행 누락 칩도 없다 — 준비율이 건물 항목을 세지 않는다',
    buildingChips.length === 0, buildingChips.join(','))
  check('보이는 칩은 전부 1.1 일반현황 항목이다',
    chipLabels.every(t => /^(수신기위치|구조|지붕|선임일|급수|화재보험|운영시간|인원|자위소방대|선임 형태)\s*↗$/.test(t.trim())),
    chipLabels.join(','))

  // ── C-3·D 삭제 (2026-08-19) — 보고서 센터가 해체됐다 ──
  //   원래 여기서 /reports의 ① 일반관리 후보 흐림 ② 별지 9호 카드의 baseline 공포일
  //   ③ 새 개정판 뱃지·[재심기 반영 완료] → seed_date 갱신을 확인했다.
  //   소방계획서_8 Phase B에서 보고서 센터를 해체하면서 그 화면이 사라졌다:
  //     · app/(dashboard)/reports 아래에 페이지 파일이 하나도 없다(구 딥링크는 대시보드로 보낸다)
  //     · '소방계획서 HWP 생성'·'새 개정판'·'법제처 서식 개정이 감지됐습니다'가 src 전역에 없다
  //   그래서 이 단언들은 되살릴 화면이 없어 지운다.
  //   ⚠ 다만 개정 감지 자체는 살아 있다 — api/cron/law-revision-check가 law_form_baselines를
  //     계속 쓴다. **UI가 없어졌을 뿐 크론은 도는데 그 경로를 덮는 테스트가 지금 없다.**
  //     크론 단위 검증은 별도로 필요하다(이 파일은 화면 배치 테스트라 여기가 자리가 아니다).
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
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
