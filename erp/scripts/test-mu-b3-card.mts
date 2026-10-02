// B3 E2E — 1.10.3 카드의 분기·안전시설(+피난기구 종류)·확인사항 입력 → 저장 → DB multiUse → 소방계획서 PDF HTML
// 심은 고객·건물·소방계획서 폼을 끝에 지운다.
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = `e2e-b3-${Date.now()}@test.local`
let userId: string | null = null, customerId: string | null = null
let browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: 'B3카드E2E', employeeId: `B3-${Date.now() % 100000}` })
  customerId = await mkCustomer({ customer_name: `B3카드E2E ${Date.now() % 10000}`, address: '경기 양평군 테스트로 3', created_by: userId })
  const { error: bErr } = await raw.from('buildings').insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId })
  if (bErr) throw new Error(`건물 심기 실패: ${bErr.message}`)
  // 해당 상태로 시작 — 새 칸은 「해당」일 때만 보인다
  await raw.from('fire_plan_forms').upsert({ customer_id: customerId, sections: { multiUse: {
    applicable: true, categories: { 노래연습장: '1' }, bizName: 'B3업소', location: '', owner: '', phone: '', hours: '', users: '', capacity: '',
  } } }, { onConflict: 'customer_id' })

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${customerId}?tab=facilities&form=1.4`, { waitUntil: 'networkidle' })
  const card = page.locator('[data-testid="form14-multi-use"]')
  await card.waitFor()

  console.log('\n[1] 새 칸 세 줄이 보인다')
  check('1-1 안전점검 분기 줄', await card.getByTestId('mu-quarters').count() === 1)
  check('1-2 안전시설 줄(14칸)', await card.getByTestId('mu-facilities').locator('button').count() === 14)
  check('1-3 확인사항 9항목 × ○/×', await card.getByTestId('mu-checks').locator('button').count() === 18)

  console.log('\n[2] 체크 → 저장 → DB')
  await card.getByTestId('mu-quarters').getByRole('button', { name: '2분기(4~6월)' }).click()
  await card.getByTestId('mu-facilities').getByRole('button', { name: '피난기구', exact: true }).click()
  await card.getByTestId('mu-facilities').getByPlaceholder('종류(예: 완강기)').fill('구조대')
  await card.getByTestId('mu-facilities').getByRole('button', { name: '유도등', exact: true }).click()
  await card.getByTestId('mu-checks').getByRole('button', { name: '1번 적합' }).click()
  await card.getByTestId('mu-checks').getByRole('button', { name: '8번 부적합' }).click()
  await page.getByTestId('form14-multi-use-save').click()
  await page.waitForTimeout(2500)
  const { data: f } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).single()
  const mu = (f as { sections: { multiUse: Record<string, unknown> } }).sections.multiUse
  check('2-1 quarters = [2]', JSON.stringify(mu.quarters) === '[2]', JSON.stringify(mu.quarters))
  check('2-2 facilities = 피난기구·유도등', JSON.stringify(mu.facilities) === '["피난기구","유도등"]', JSON.stringify(mu.facilities))
  check('2-3 evacNote = 구조대', mu.evacNote === '구조대', String(mu.evacNote))
  check('2-4 checks = {1:O, 8:X}', JSON.stringify(mu.checks) === '{"1":"O","8":"X"}', JSON.stringify(mu.checks))
  check('2-5 기존 값(사업장명) 보존', mu.bizName === 'B3업소')

  console.log('\n[3] 같은 칸을 다시 누르면 풀린다(토글)')
  await card.getByTestId('mu-checks').getByRole('button', { name: '1번 적합' }).click()
  await page.getByTestId('form14-multi-use-save').click()
  await page.waitForTimeout(2500)
  const { data: f2 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).single()
  const mu2 = (f2 as { sections: { multiUse: Record<string, unknown> } }).sections.multiUse
  check('3-1 1번 결과가 지워진다', JSON.stringify(mu2.checks) === '{"8":"X"}', JSON.stringify(mu2.checks))

} catch (e) {
  check('예외 없이 완주', false, String(e))
} finally {
  if (customerId) { await raw.from('fire_plan_forms').delete().eq('customer_id', customerId); await raw.from('buildings').delete().eq('customer_id', customerId); await cleanupCustomer(customerId) }
  if (userId) await delUser(userId)
  if (browser) await browser.close()
}
summary()
