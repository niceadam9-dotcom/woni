// 소방안전관리 미입력 배지 프로브 (2026-09-05) — 관계인 탭 상단 배지가
// ① 미입력 항목을 나열하고 ② 누르면 아래 패널(#fire-safety-manager)로 내려가며
// ③ 전건 입력하면 사라지는지(대조군)를 실측한다.
// 실행: npx tsx scripts/_probe-fsm-badge.mts  (로컬 dev 서버 + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'fsm-badge-probe@erp-test.com'
let userId = ''
let customerId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '배지프로브', employeeId: 'E2E-FSMB' })
  customerId = await mkCustomer({ customer_name: '배지프로브고객', address: '경기 양평군 테스트로 1', created_by: userId })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1. 미입력 상태 — 배지가 5개 항목을 나열한다 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=contacts`)
  const badge = page.locator('[data-testid="fsm-missing-badge"]')
  await badge.waitFor({ timeout: 30000 })
  const text = await badge.innerText()
  check('미입력 배지가 보인다', true)
  for (const item of ['소방안전관리자 지목', '최근 교육이수일', '대표자 구분', '급수']) {
    check(`배지에 「${item}」 나열`, text.includes(item), text)
  }
  // 선임 형태는 127이 DB 기본값('업무대행감독')을 깔아 신규 고객도 차 있다 — 나열되면 안 된다
  check('선임 형태는 나열 안 됨 (127 기본값)', !text.includes('선임 형태'), text)

  // ── 1-b. 선임 형태를 비우면(기본값 제거 케이스) 나열된다 ──
  await raw.from('customers').update({ manager_appointment_type: null }).eq('id', customerId)
  await page.goto(`${BASE}/customers/${customerId}?tab=contacts`)
  await badge.waitFor({ timeout: 30000 })
  check('선임 형태 비우면 나열된다', (await badge.innerText()).includes('선임 형태'))

  // ── 2. 누르면 소방안전관리 패널로 내려간다 ──
  await badge.click()
  await page.waitForTimeout(600)
  const inView = await page.evaluate(() => {
    const el = document.getElementById('fire-safety-manager')
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.top < window.innerHeight
  })
  check('앵커 이동 — 패널이 화면 안에 들어온다', inView)

  // ── 3. 대조군: 전건 입력하면 배지가 사라진다 ──
  const { data: contact, error: cErr } = await raw.from('customer_contacts').insert({
    customer_id: customerId, role: '대표', name: '프로브대표', phone: '010-0000-0000',
  }).select('id').single()
  if (cErr) throw new Error(`관계인 생성 실패: ${cErr.message}`)
  const { error: uErr } = await raw.from('customers').update({
    manager_contact_id: contact!.id,
    manager_appointment_type: '업무대행감독',
    manager_edu_date: '2025-03-01',
    rep_role: '관리자',
    building_grade: '3급',
  }).eq('id', customerId)
  if (uErr) throw new Error(`고객 갱신 실패: ${uErr.message}`)

  await page.goto(`${BASE}/customers/${customerId}?tab=contacts`)
  await page.locator('text=관계인 정보').first().waitFor({ timeout: 30000 })
  // 배지 부재 판정은 공허 통과가 안 되도록 정체(관계인 정보 헤더 존재) 확인 뒤 count로 잰다
  check('전건 입력 시 배지가 사라진다', (await badge.count()) === 0)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (customerId) await cleanupCustomer(customerId)
  if (userId) await delUser(userId)
}

summary()
