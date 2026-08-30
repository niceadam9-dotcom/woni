/** 일괄 확정 검증 (2026-08-13) — 점검일 없는 항목을 [확정]으로 누르면
 *  ① 오늘 날짜가 들어가고 ② 상태가 확정으로 바뀌고 ③ 담당 미배정이면 확정자로 배정되는가.
 *  실데이터를 건드리지 않으려고 **테스트 고객·항목을 새로 만들어 그 한 건만 선택**한다.
 *  실행: node scripts/_probe-bulk-confirm.mjs   (dev 서버 필요) */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-bulkconfirm@test.local'
const KST_TODAY = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

let userId, custId, itemId, browser
try {
  userId = await mkUser({ email: EMAIL, name: 'E2E일괄확정', employeeId: 'E2E-BC', role: 'admin' })
  custId = await mkCustomer({ customer_name: 'E2E일괄확정고객', created_by: userId, plan_anchor_date: '2026-08-05' })

  const now = new Date(Date.now() + 9 * 3600_000)
  const year = now.getFullYear(), month = now.getMonth() + 1
  const { data: plan } = await raw.from('inspection_plans').select('id').eq('year', year).eq('month', month).maybeSingle()
  if (!plan) throw new Error(`${year}-${month} 계획이 없다`)

  // 점검일 없음 + 담당 미배정 + planned — 사용자가 겪은 그 상태 그대로
  const { data: item, error } = await raw.from('inspection_plan_items').insert({
    plan_id: plan.id, customer_id: custId,
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    sequence_num: 1, plan_type: 'special_작동',
    status: 'planned', scheduled_date: null, assigned_employee_id: null,
  }).select('id').single()
  if (error) throw new Error(`항목 생성 실패: ${error.message}`)
  itemId = item.id
  check('전제 — 점검일 없음·담당 미배정·계획 상태로 생성', true)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(30000)
  await login(page, EMAIL)

  await page.goto(`${BASE}/inspection-plans?year=${year}&month=${month}&status=planned`, { waitUntil: 'domcontentloaded' })
  await page.getByText('E2E일괄확정고객').first().waitFor({ state: 'visible', timeout: 40000 })

  // 그 고객 행의 체크박스만 선택 (실데이터 11건은 건드리지 않는다)
  const row = page.locator('tr', { hasText: 'E2E일괄확정고객' }).first()
  await row.locator('input[type=checkbox]').click()
  check('행 선택 → 하단 확정 바 노출', await page.getByText('선택됨').first().isVisible())

  // 안내 문구: 오늘 날짜로 확정된다고 알려주는가
  const notice = await page.getByText(new RegExp(`점검일 없는 .*건은 오늘\\(${KST_TODAY}\\)로 확정`)).count()
  check('안내 — "점검일 없는 N건은 오늘 날짜로 확정" 표시', notice > 0)

  await page.getByRole('button', { name: /\d+건 확정/ }).click()

  // 확정 = 점검 자동 시작(actions.ts:347, 2026-07-23 확정)이라 6단계가 다 차면 completed까지 간다.
  // 여기서 볼 것은 '계획에서 벗어났는가'다.
  const after = await pollDb(async () => {
    const { data } = await raw.from('inspection_plan_items')
      .select('status, scheduled_date, assigned_employee_id, inspection_id').eq('id', itemId).maybeSingle()
    return data && data.status !== 'planned' ? data : null
  }, 60000)

  check('① 상태가 계획 → 확정(이후 자동 진행)으로 변경',
    after?.status === 'confirmed' || after?.status === 'completed', `실제=${after?.status}`)
  check('② 점검일에 오늘(한국시간) 날짜 저장', after?.scheduled_date === KST_TODAY, `실제=${after?.scheduled_date} 기대=${KST_TODAY}`)
  check('③ 담당 미배정 → 확정자로 배정', after?.assigned_employee_id === userId, `실제=${after?.assigned_employee_id}`)

  // 화면에도 오늘 날짜가 조회되는가 (사용자 요구: "점검일에 오늘 날짜가 조회되어야")
  // 점검 자동 생성은 상태 갱신 직후에 이어진다 — 따로 기다린다
  const started = await pollDb(async () => {
    const { data } = await raw.from('inspection_plan_items').select('inspection_id').eq('id', itemId).maybeSingle()
    return data?.inspection_id ? data : null
  }, 40000)
  check('⑥ 확정 시 점검 자동 생성(기존 설계, 2026-07-23)', !!started?.inspection_id, `inspection_id=${started?.inspection_id ?? '없음'}`)

  for (const st of ['all']) {
    await page.goto(`${BASE}/inspection-plans?year=${year}&month=${month}&status=${st}`, { waitUntil: 'domcontentloaded' })
    // Next 클라이언트 라우터 캐시가 확정 직전 페이로드를 돌려줄 수 있다 — 하드 리로드로 무시한다
    await page.reload({ waitUntil: 'domcontentloaded' })
    const row2 = page.locator('tr', { hasText: 'E2E일괄확정고객' }).first()
    // 목록이 299행이라 서버 렌더가 늦다 — 고정 대기 대신 행이 붙을 때까지 폴링(플레이크 방지)
    let found = false
    for (let i = 0; i < 30 && !found; i += 1) {
      found = await row2.count() > 0
      if (!found) await page.waitForTimeout(1000)
    }
    if (!found) {
      const rowCount = await page.locator('tbody tr').count()
      // ⚠ 종전엔 'button.bg-\\[\\#7b68ee\\]'였다 — 29 토큰 코드모드가 지운 클래스라 진단 문구가
      //   늘 '?'로 나왔다(소방계획서_37 R-b). 활성 칩은 inspection-plans-client.tsx의 'bg-brand text-white'.
      //   CSS 클래스 선택자는 **토큰 단위**라 'bg-brand-tint'에 안 걸린다(JS includes와 다른 점).
      const chip = await page.locator('button.bg-brand').first().innerText().catch(() => '?')
      const { data: cur } = await raw.from('inspection_plan_items')
        .select('status, scheduled_date, inspection_id, plan_id').eq('id', itemId).maybeSingle()
      check(`④ [${st}] 목록에 행 노출`, false,
        `표시행=${rowCount} 활성칩='${String(chip).replace(/\s+/g, ' ')}' DB상태=${JSON.stringify(cur)}`)
      continue
    }
    const rowText = (await row2.innerText()).replace(/\s+/g, ' ')
    check(`④ [${st}] 점검일 칸에 오늘(${KST_TODAY}) 표시`, rowText.includes(KST_TODAY), `행: ${rowText.slice(0, 140)}`)
    check(`⑤ [${st}] 상태 '확정' 표시`, rowText.includes('확정'), `행: ${rowText.slice(0, 140)}`)
  }
} catch (e) {
  check('예외 없음', false, String(e?.message ?? e))
} finally {
  if (browser) await browser.close().catch(() => {})
  // PostgREST 빌더에는 .catch가 없다(이 리포 고질) — try로 감싼다
  if (itemId) { try { await raw.from('inspection_plan_items').delete().eq('id', itemId) } catch { /* 정리 실패 무시 */ } }
  await cleanupCustomer(custId).catch(() => {})
  await delUser(userId).catch(() => {})
}
summary()
