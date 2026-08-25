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

  // ── 1. ?sheet=auto — 입력 전용 페이지에서 첫 미완성 시트가 스스로 열린다 ────
  //    2026-08-25: ① [입력]의 목적지가 점검 상세 드로어 → `/inspections/{id}/sheet`(소방계획서_28 S1)로 이관.
  //    자동 오픈 판정은 같은 pickAutoOpenSheet라 의미가 보존된다.
  const SHEET_URL = `${BASE}/inspections/${inspId}/sheet?sheet=auto`
  console.log('— 1. 딥링크 자동 오픈(입력 전용 페이지)')
  await page.goto(SHEET_URL)
  await page.waitForLoadState('networkidle')
  const openTitle = page.locator('h2').first()
  let opened = false
  try { await openTitle.waitFor({ state: 'visible', timeout: 12000 }); opened = !!(await openTitle.textContent())?.trim() }
  catch { /* 아래에서 실패로 보고 */ }
  check('?sheet=auto — 첫 미완성 시트가 자동으로 열린다', opened)

  // 열린 시트가 **미완성**인지 — 다 채운 시트를 열면 규칙이 어긋난 것이다
  const counter = await page.locator('h2 ~ span').first().textContent().catch(() => null)
  const m = counter?.match(/(\d+)\s*\/\s*(\d+)/)
  check('열린 시트가 미완성이다(응답 < 분모)', !!m && Number(m[1]) < Number(m[2]), counter ?? '카운터 못 읽음')

  // ── 2. sheet 파라미터가 없으면 열리지 않는다 ───────────────────────────────
  console.log('— 2. 파라미터 없으면 자동 오픈 없음')
  await page.goto(`${BASE}/inspections/${inspId}/sheet`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  check('파라미터가 없으면 아무 시트도 열리지 않는다(목록만)',
    await page.locator('text=왼쪽에서 설비를 선택하세요').count() > 0)
  // 옛 목적지도 썩지 않아야 한다 — 북마크·과거 알림 링크 회귀 방지
  await page.goto(`${BASE}/inspections/${inspId}?step=1&sheet=auto`)
  await page.waitForLoadState('networkidle')
  let legacy = false
  try { await page.locator('[data-testid="drawer-sheet-na"]').waitFor({ state: 'visible', timeout: 12000 }); legacy = true } catch { /* 보고 */ }
  check('옛 링크(점검 상세 ?sheet=auto)도 그대로 동작한다', legacy)

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
    const inputLink = page.locator(`a[href="/inspections/${inspId}/sheet?sheet=auto"]`)
    await inputLink.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    check('① 칸에 [점검표 입력] 링크가 보인다(입력 전용 페이지행)', await inputLink.count() > 0)
    check('① 링크가 옛 목적지(점검 상세 드로어)를 가리키지 않는다',
      await page.locator(`a[href="/inspections/${inspId}?step=1&sheet=auto"]`).count() === 0)
    check('[사유 완료] 버튼도 함께 남아 있다',
      await page.getByRole('button', { name: '사유 완료' }).count() > 0)
    check('옛 단독 [완료] 버튼은 사라졌다',
      await page.getByRole('button', { name: /^완료$/ }).count() === 0)

    // R4-4: 순서 강제 폐지 — ⑤의 [불량 조치]도 ①이 미완료인 채로 보여야 한다
    check('①이 미완료여도 ⑤ [불량 조치] 링크가 보인다(순서 강제 없음)',
      await page.locator(`a[href="/inspections/${inspId}?step=5#defects"]`).count() > 0)

    // 실제로 눌러서 도착지가 열리는지 — 링크만 있고 안 열리면 의미가 없다
    await inputLink.first().click()
    await page.waitForURL(u => u.pathname.endsWith(`/inspections/${inspId}/sheet`), { timeout: 15000 }).catch(() => {})
    await page.waitForLoadState('networkidle')
    check('[점검표 입력] 클릭 → 입력 전용 페이지로 이동', page.url().includes(`/inspections/${inspId}/sheet`), page.url())
    let arrived = false
    try {
      await page.waitForSelector('text=점검표 입력 —', { timeout: 12000 })
      await page.locator('h2').first().waitFor({ state: 'visible', timeout: 12000 })
      arrived = !!(await page.locator('h2').first().textContent())?.trim()
    } catch { /* 보고 */ }
    check('도착 후 첫 미완성 시트가 열려 있다', arrived)
  }
} finally {
  if (browser) await browser.close()
  if (inspId) await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
  await cleanupCustomer(custId)
  await delUser(userId)
}

summary()
