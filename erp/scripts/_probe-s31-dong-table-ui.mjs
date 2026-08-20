// 3-1 동별 수량 표 — 실제 화면 프로브 (2026-08-20 요청 ①②③)
//   ① 체크한 종류의 칸만 활성 — 미체크 칸은 입력 자체가 안 된다
//   ② 동을 추가해도 합계가 난다 (자동 합산)
//   ③ 동명 + 수량 6 + 비고가 **한 줄**에 들어간다
//   ④ 저장 → DB에 동별 행 배열로 남는다
// 실행: node scripts/_probe-s31-dong-table-ui.mjs   (로컬 dev 서버 + 스테이징 DB)
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'probe-s31table@erp-test.com'
let userId = '', customerId = '', buildingId = ''
let browser = null
const wait = ms => new Promise(r => setTimeout(r, ms))

try {
  userId = await mkUser({ email: EMAIL, name: '표프로브', employeeId: 'E2E-S31TBL' })
  customerId = await mkCustomer({ customer_name: '동별표프로브고객', address: '경기 양평군 테스트로 31', created_by: userId })
  const { data: bld } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true, created_by: userId,
  }).select('id').single()
  buildingId = bld.id
  await raw.from('fire_facilities').insert({
    building_id: buildingId, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true,
  })

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', d => d.accept())      // 체크 해제 확인창
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.4`)
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  await page.click('button:has-text("설비 대장")')
  await page.locator('summary:has-text("설비 대장")').scrollIntoViewIfNeeded()
  await page.locator('summary:has-text("설비 대장")').click()
  await page.waitForSelector('[data-spec-section="s31_extinguisher"]')

  const sec = page.locator('[data-spec-section="s31_extinguisher"]')
  await sec.locator('button:has-text("3-1")').click()
  await sec.locator('button:has-text("동별 수량")').first().click()
  const table = page.locator('[data-testid="rowtable-s31_extinguisher-dong_rows"]')
  await table.waitFor()
  check('3-1이 한 블록(동별 수량 · 합계)으로 열린다', await table.isVisible())
  check('종전 자유 기입 블록(동별 내역)은 사라졌다',
    (await sec.locator('button:has-text("동별 내역")').count()) === 0)

  const cell = (row, label) => page.getByLabel(`${row}행 ${label}`)
  const total = key => page.locator(`[data-testid="rowtable-total"] [data-total="${key}"]`).textContent()

  console.log('\n── ① 체크한 종류의 칸만 활성 ──')
  check('아무것도 체크 안 한 처음 — 분말 칸은 비활성', await cell(1, '소화기(분말)').isDisabled())
  check('아무것도 체크 안 한 처음 — 확산 칸도 비활성', await cell(1, '자동확산소화기').isDisabled())
  check('동명·비고는 체크와 무관하게 항상 활성',
    !(await cell(1, '동명').isDisabled()) && !(await cell(1, '비고').isDisabled()))
  // 비활성 칸에 실제로 입력이 안 되는가 — disabled 속성만이 아니라 값이 안 들어가는 것까지
  await cell(1, '소화기(분말)').fill('9').catch(() => {})
  check('비활성 칸은 타이핑해도 값이 들어가지 않는다', (await cell(1, '소화기(분말)').inputValue()) === '')

  await sec.locator('button:has-text("소화기(분말)")').first().click()
  await sec.locator('button:has-text("자동확산소화기")').first().click()
  check('체크한 분말 칸이 활성으로 바뀐다', !(await cell(1, '소화기(분말)').isDisabled()))
  check('체크한 확산 칸이 활성으로 바뀐다', !(await cell(1, '자동확산소화기').isDisabled()))
  check('체크 안 한 투척용 칸은 그대로 비활성', await cell(1, '간이소화용구(투척용)').isDisabled())

  console.log('\n── ③ 한 줄 레이아웃 ──')
  const boxes = []
  for (const lb of ['동명', '소화기(분말)', '소화기(기타)', '간이소화용구(투척용)', '간이소화용구(기타)', '자동확산소화기', '자동소화장치', '비고']) {
    boxes.push(await cell(1, lb).boundingBox())
  }
  const ys = boxes.map(b => Math.round(b.y))
  check('동명 + 수량 6 + 비고 8칸이 모두 같은 줄(y 동일)', new Set(ys).size === 1, `y: ${ys.join(',')}`)
  const tblBox = await table.boundingBox()
  check('표가 가로 스크롤 없이 패널 폭에 들어간다',
    boxes[7].x + boxes[7].width <= tblBox.x + tblBox.width + 2,
    `마지막 칸 끝 ${Math.round(boxes[7].x + boxes[7].width)} / 표 끝 ${Math.round(tblBox.x + tblBox.width)}`)

  console.log('\n── ② 동을 추가해도 합계가 난다 ──')
  await cell(1, '동명').fill('A동')
  await cell(1, '소화기(분말)').fill('10')
  await cell(1, '자동확산소화기').fill('4')
  check('한 동만 있을 때 합계 = 그 행', (await total('qty_ext_powder')).trim() === '10')
  await page.click('button:has-text("동 추가")')
  check('행이 2개로 늘었다', (await page.getByLabel('2행 동명').count()) === 1)
  await page.getByLabel('2행 동명').fill('B동')
  await cell(2, '소화기(분말)').fill('2')
  await cell(2, '자동확산소화기').fill('2')
  check('동 추가 후 분말 합계 10+2=12', (await total('qty_ext_powder')).trim() === '12')
  check('동 추가 후 확산 합계 4+2=6', (await total('qty_auto_diffuse')).trim() === '6')
  check('입력이 없는 종류의 합계는 0이 아니라 빈칸', (await total('qty_ext_other')).trim() === '')

  console.log('\n── ④ 저장 · 왕복 ──')
  await page.locator('[data-testid="specs-save"]').click()   // 패널 푸터의 통합 [저장](소방계획서_12 U3)
  const saved = await (async () => {
    for (let i = 0; i < 30; i++) {
      const { data } = await raw.from('customer_facility_specs').select('spec')
        .eq('customer_id', customerId).eq('section_key', 's31_extinguisher').maybeSingle()
      const rows = data?.spec?.summary?.dong_rows
      if (Array.isArray(rows) && rows.length === 2) return data.spec
      await wait(500)
    }
    return null
  })()
  check('DB에 동별 행 2개가 배열로 저장된다', !!saved, '저장 대기 초과')
  if (saved) {
    const r = saved.summary.dong_rows
    check('행 값이 그대로 — A동 분말 10 / B동 분말 2',
      r[0].dong === 'A동' && r[0].qty_ext_powder === 10 && r[1].dong === 'B동' && r[1].qty_ext_powder === 2,
      JSON.stringify(r))
    check('수량은 숫자로 저장(문자열이면 합계가 문자열 이어붙이기가 된다)',
      typeof r[0].qty_ext_powder === 'number')
    check('합계는 저장하지 않는다(동별 합이 유일한 출처)',
      saved.summary.qty_ext_powder === undefined)
    check('구 자유 기입 블록(by_dong)은 저장되지 않는다', saved.by_dong === undefined)
  }
  await page.reload()
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  await page.click('button:has-text("설비 대장")')
  await page.locator('summary:has-text("설비 대장")').scrollIntoViewIfNeeded()
  await page.locator('summary:has-text("설비 대장")').click()
  await sec.locator('button:has-text("3-1")').click()
  await sec.locator('button:has-text("동별 수량")').first().click()
  await table.waitFor()
  check('새로고침 후에도 2개 동이 그대로', (await cell(2, '동명').inputValue()) === 'B동')
  check('새로고침 후 합계도 그대로 12', (await total('qty_ext_powder')).trim() === '12')

  console.log('\n── ⑤ 체크를 해제하면 그 열의 값도 함께 사라진다 (설치 안 한 수량이 인쇄되면 안 된다) ──')
  await sec.locator('button:has-text("자동확산소화기")').first().click()   // 해제 (confirm 자동 수락)
  await wait(300)
  check('해제한 열의 입력이 비활성으로 돌아간다', await cell(1, '자동확산소화기').isDisabled())
  check('해제한 열의 값이 지워진다', (await cell(1, '자동확산소화기').inputValue()) === '')
  check('해제한 열의 합계도 사라진다', (await total('qty_auto_diffuse')).trim() === '')
  check('다른 열(분말)은 건드리지 않는다', (await total('qty_ext_powder')).trim() === '12')

  await sec.locator('button:has-text("자동확산소화기")').first().click()   // 다시 체크(스크린샷용)
  await cell(1, '자동확산소화기').fill('4')
  await cell(2, '자동확산소화기').fill('2')
  await sec.screenshot({ path: '../erp_goal/_shot-s31-dong-table.png' })
  console.log('\n  📸 erp_goal/_shot-s31-dong-table.png')
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 400))
} finally {
  if (browser) await browser.close()
  if (buildingId) await raw.from('fire_facilities').delete().eq('building_id', buildingId)
  if (customerId) {
    await raw.from('customer_facility_specs').delete().eq('customer_id', customerId)
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
  }
  if (userId) await delUser(userId)
  summary()
}
