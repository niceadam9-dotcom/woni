// 단계 [입력] 진입 경로 E2E — 실제 브라우저로 딥링크·드로어 자동 오픈·버튼 위계 확인
// 실행: npx tsx scripts/test-step-input-link-e2e.mts   (로컬 dev + 스테이징 DB)
//
// 순수 함수·배선은 test-step-input-link.mts가 이미 단언한다. 여기서는 **화면에서 실제로 열리는지**만 본다 —
// 자동 오픈은 마운트 타이밍·RSC 커밋에 걸리기 쉬워 소스 검사로는 증명되지 않는다.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'step-input-link-e2e@erp-test.com'
let userId = ''
let custId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const STEP_DEFS = [
  { step_num: 1, name_ko: '점검일',                                days: 0 },
  { step_num: 2, name_ko: '배치확인서 보고서 작성',                days: 7 },
  { step_num: 3, name_ko: '관계인 보고서 제출',                    days: 14 },
  { step_num: 4, name_ko: '소방서 보고서 제출 및 이행계획서 등록', days: 21 },
  { step_num: 5, name_ko: '소방보수 완료',                        days: 28 },
  { step_num: 6, name_ko: '이행완료보고서 제출',                  days: 35 },
]
const INSTALLED = '소화기구 및 자동소화장치'

try {
  userId = await mkUser({ email: EMAIL, name: '입력링크E2E', employeeId: 'E2E-SIL' })
  custId = await mkCustomer({ customer_name: '입력링크E2E고객', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: custId, building_name: '본관', is_active: true, created_by: userId })
    .select('id').single()
  // 설치 설비가 있어야 보드가 시트를 보여준다 — 자동 오픈 후보 필터와 같은 조건
  await raw.from('fire_facilities').insert({
    building_id: bld!.id, category: '소화설비', facility_code: INSTALLED, installed: true,
  })

  const { data: ins } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id

  // inspection_steps — 트리거가 있으면 이미 있고, 없으면 직접 생성(test-h28 관례)
  const { data: exSteps } = await raw.from('inspection_steps').select('step_num').eq('inspection_id', inspId)
  if (!exSteps || exSteps.length === 0) {
    await raw.from('inspection_steps').insert(STEP_DEFS.map(d => {
      const dt = new Date(kstShift(-1) + 'T12:00:00'); dt.setDate(dt.getDate() + d.days)
      return { inspection_id: inspId, step_num: d.step_num, name_ko: d.name_ko, due_date: dt.toISOString().split('T')[0] }
    }))
  }

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  // ── 1. ?sheet=auto — 첫 미완성 시트 드로어가 스스로 열린다 ──────────────────
  console.log('— 1. 딥링크 자동 오픈')
  await page.goto(`${BASE}/inspections/${inspId}?step=1&sheet=auto`)
  await page.waitForLoadState('networkidle')
  const drawer = page.locator('[data-testid="drawer-sheet-na"]')
  let opened = false
  try { await drawer.waitFor({ state: 'visible', timeout: 12000 }); opened = true } catch { /* 아래에서 실패로 보고 */ }
  check('?sheet=auto — 점검표 드로어가 자동으로 열린다', opened)

  // 열린 시트가 **미완성**인지 — 다 채운 시트를 열면 규칙이 어긋난 것이다
  const counter = await page.locator('[data-testid="drawer-sheet-na"]').locator('xpath=preceding-sibling::span[1]').textContent().catch(() => null)
  const m = counter?.match(/(\d+)\s*\/\s*(\d+)/)
  check('열린 시트가 미완성이다(응답 < 분모)', !!m && Number(m[1]) < Number(m[2]), counter ?? '카운터 못 읽음')

  // ── 2. sheet 파라미터가 없으면 열리지 않는다 ───────────────────────────────
  console.log('— 2. 파라미터 없으면 자동 오픈 없음')
  await page.goto(`${BASE}/inspections/${inspId}?step=1`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  check('?step=1만이면 드로어는 닫힌 채다(기존 동작 보존)',
    !(await page.locator('[data-testid="drawer-sheet-na"]').isVisible().catch(() => false)))

  // ── 3. ?step=5 — ⑤ 칸이 선택되고 #defects 앵커가 렌더된다 ──────────────────
  console.log('— 3. ?step=5 딥링크')
  // ⑤는 불량이 있어야 활성 단계(activeStepNums) — 없으면 기본값으로 떨어지는 게 정상이다
  await raw.from('inspection_defects').insert({
    inspection_id: inspId, item_name: 'E2E 불량', location: '본관 1층', status: 'pending', created_by: userId,
  })
  await page.goto(`${BASE}/inspections/${inspId}?step=5#defects`)
  await page.waitForLoadState('networkidle')
  check('?step=5 — #defects 앵커가 DOM에 있다', await page.locator('#defects').count() > 0)

  // ── 4. 달력 슬라이드 패널 — 두 버튼과 위계 ────────────────────────────────
  console.log('— 4. 달력 패널 버튼')
  await page.goto(`${BASE}/inspections/calendar`)
  await page.waitForLoadState('networkidle')
  const ev = page.locator('.rbc-event', { hasText: '입력링크E2E고객' }).first()
  let panelOpen = false
  try { await ev.click({ timeout: 12000 }); panelOpen = true } catch { /* 아래 보고 */ }
  check('달력에서 이 점검 건을 열 수 있다', panelOpen)

  if (panelOpen) {
    const inputLink = page.locator(`a[href="/inspections/${inspId}?step=1&sheet=auto"]`)
    await inputLink.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    check('① 칸에 [점검표 입력] 링크가 보인다', await inputLink.count() > 0)
    check('[사유 완료] 버튼도 함께 남아 있다',
      await page.getByRole('button', { name: '사유 완료' }).count() > 0)
    check('옛 단독 [완료] 버튼은 사라졌다',
      await page.getByRole('button', { name: /^완료$/ }).count() === 0)

    // R4-4: 순서 강제 폐지 — ⑤의 [불량 조치]도 ①이 미완료인 채로 보여야 한다
    check('①이 미완료여도 ⑤ [불량 조치] 링크가 보인다(순서 강제 없음)',
      await page.locator(`a[href="/inspections/${inspId}?step=5#defects"]`).count() > 0)

    // 실제로 눌러서 도착지가 열리는지 — 링크만 있고 안 열리면 의미가 없다
    await inputLink.first().click()
    await page.waitForURL(u => u.pathname.includes(`/inspections/${inspId}`), { timeout: 15000 }).catch(() => {})
    await page.waitForLoadState('networkidle')
    let arrived = false
    try { await drawer.waitFor({ state: 'visible', timeout: 12000 }); arrived = true } catch { /* 보고 */ }
    check('[점검표 입력] 클릭 → 상세로 이동하고 드로어가 열린다', arrived)
  }
} finally {
  if (browser) await browser.close()
  if (inspId) await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
  await cleanupCustomer(custId)
  await delUser(userId)
}

summary()
