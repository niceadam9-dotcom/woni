// 소방계획서_20 S1 프로브 — 업로드 후 refreshRound가 해당 회차만 갱신하고
// 다른 회차의 미리보기 캐시를 살려두는지(=전면 reload가 아닌지) 확인
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

// 실패 시 잔여 계정이 남아 재실행이 막히므로 실행마다 유니크 이메일
const EMAIL = `annex-refresh-probe-${Date.now().toString(36)}@test.local`
const CUR = new Date().getFullYear()
let userId, customerId, inspA, inspB, browser
try {
  userId = await mkUser({ email: EMAIL, name: '회차갱신프로브', employeeId: `E2E-RR-${Date.now().toString(36)}` })
  customerId = await mkCustomer({ customer_name: '회차갱신프로브사', address: '서울 중구 세종대로 110', created_by: userId })
  // 자체점검 2회차 — 최신(1차 아님) 회차와 과거 회차를 만들어 '부분 갱신'을 관찰
  // year는 inspection_start_date에서 생성되는 컬럼(002 GENERATED) — 직접 넣으면 거부된다.
  // 작동은 sequence_num=1만 허용이라 회차 2건은 연도로 가른다(최신=올해 1차, 과거=작년 1차)
  for (const [year, ref] of [[CUR, 'B'], [CUR - 1, 'A']]) {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: customerId, sequence_num: 1, inspection_type: '작동',
      plan_type: 'special_작동', status: 'in_progress',
      inspection_start_date: `${year}-03-05`, assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    if (ref === 'A') inspA = data.id; else inspB = data.id
  }

  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)

  // 서버 액션 호출 수를 센다 — 전면 reload면 getCustomerRoundsAction이, 부분 갱신이면 getRoundDocsAction이 돈다
  let postCalls = 0
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes(`/customers/${customerId}`)) postCalls++ })

  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=annex`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${CUR}년 1차`)
  check('회차 2건 표시', await page.isVisible(`text=${CUR - 1}년 1차`))

  // 최신(올해 1차) 회차는 자동 펼침 — 배치확인서 업로드로 refreshRound 경로를 태운다
  const before = postCalls
  // 숨은 input에 직접 파일을 넣는다(버튼은 ref.click()이라 filechooser가 뜨지 않음)
  await page.locator('div:has(> span:text-is("배치확인서"))').first()
    .locator('input[type=file]')
    .setInputFiles({ name: 'cert_probe.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%probe\n') })
  await page.waitForSelector('text=✅ 업로드됨', { timeout: 60000 })
  check('업로드 성공 메시지', true)

  // 갱신 결과가 화면에 반영됐는가 (해당 회차 행이 ✓로) — refreshRound는 서버 왕복이라 고정 대기 대신 조건 대기
  let rowText = ''
  for (let i = 0; i < 30; i++) {
    rowText = await page.locator('div:has(> span:text-is("배치확인서"))').first().innerText()
    if (rowText.includes('✓')) break
    await page.waitForTimeout(500)
  }
  check('업로드한 회차 행이 갱신됨(✓ 표시)', rowText.includes('✓'), rowText.replace(/\s+/g, ' ').slice(0, 120))

  // DB 확인 — 실제로 그 회차(2차)에 붙었는가
  const { data: objs } = await raw.storage.from('fire-plans').list(`${customerId}/inspections/${inspB}`)
  check('스토리지 — 최신 회차에 cert 업로드', (objs ?? []).some(o => /^cert_/.test(o.name)), JSON.stringify((objs ?? []).map(o => o.name)))
  const { data: objsA } = await raw.storage.from('fire-plans').list(`${customerId}/inspections/${inspA}`)
  check('다른 회차(작년)는 무변화', ((objsA ?? []).length === 0), JSON.stringify((objsA ?? []).map(o => o.name)))
  check('서버 액션 호출 발생(부분 갱신 경로 실행)', postCalls > before, `before=${before} after=${postCalls}`)
} catch (e) {
  check('프로브 실행', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const iid of [inspA, inspB]) {
    if (!iid) continue
    const { data: objs } = await raw.storage.from('fire-plans').list(`${customerId}/inspections/${iid}`)
    if (objs?.length) await raw.storage.from('fire-plans').remove(objs.map(o => `${customerId}/inspections/${iid}/${o.name}`))
  }
  await cleanupCustomer(customerId)
  await delUser(userId)
  summary()
}
