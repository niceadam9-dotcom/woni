// 위임장 생성 버튼 실동작 검증 — 작업대 [위임장] 클릭 → PDF 생성·저장까지
// 실행: npx tsx scripts/_probe-delegation-generate.mts   (dev 3000 + gotenberg 3010 필요)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'delegation-gen@sjfire.test'
let userId = ''

const run = async () => {
  // 자체점검 건 아무거나 (조립 프로브가 쓴 것과 같은 축)
  const { data: insps } = await raw.from('inspections')
    .select('id, customer_id, inspection_start_date, plan_type')
    .or('plan_type.is.null,plan_type.like.special%')
    .order('inspection_start_date', { ascending: false }).limit(1)
  const insp = (insps ?? [])[0] as { id: string; customer_id: string; inspection_start_date: string } | undefined
  if (!insp) throw new Error('자체점검 건이 없습니다.')
  console.log(`대상 점검 ${insp.id} (${insp.inspection_start_date})`)

  const prefix = `${insp.customer_id}/inspections/${insp.id}`
  const before = ((await raw.storage.from('fire-plans').list(prefix, { limit: 1000 })).data ?? [])
    .filter((f: { name: string }) => /^delegation_\d+\.pdf$/.test(f.name)).length

  userId = await mkUser({ email: EMAIL, name: '위임장E2E', employeeId: 'DLG-001', role: 'admin' })
  const { browser, page } = await launch()
  const errors: string[] = []
  page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m: { type: () => string; text: () => string }) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  try {
    await login(page, EMAIL)
    await page.goto(`${BASE}/inspections/${insp.id}`)
    await page.waitForLoadState('networkidle')

    // ④ 소방서 제출 단계로 이동 — 생성 버튼 묶음이 이 단계에 있다
    const step4 = page.locator('[data-step="submit9"]').first()
    if (await step4.count() > 0) { await step4.click(); await page.waitForTimeout(600) }

    const btn = page.getByRole('button', { name: '위임장', exact: true })
    check('[위임장] 버튼 존재', await btn.count() > 0, `count ${await btn.count()}`)
    if (await btn.count() === 0) { summary(); return }

    const disabled = await btn.first().isDisabled()
    check('[위임장] 버튼 활성 (재생성 차단 해제 확인)', !disabled, disabled ? '비활성 — regenBlocked/권한 확인 필요' : '')
    if (disabled) { summary(); return }

    await btn.first().click()
    // 생성은 Gotenberg 왕복 — 넉넉히 대기하며 결과 메시지를 본다
    let msg = ''
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000)
      const t = await page.locator('body').innerText()
      const m = /(✅[^\n]*|❌[^\n]*)/.exec(t)
      if (m) { msg = m[1]; if (m[1].startsWith('❌') || /생성|완료/.test(m[1])) break }
    }
    console.log(`  화면 메시지: ${msg || '(없음)'}`)
    check('생성 실패 메시지 없음', !msg.startsWith('❌'), msg)

    // 저장소에 실제 PDF가 늘었는지 — 화면 문구가 아니라 산출물로 판정
    let after = before
    for (let i = 0; i < 30; i++) {
      const files = ((await raw.storage.from('fire-plans').list(prefix, { limit: 1000 })).data ?? [])
      after = files.filter((f: { name: string }) => /^delegation_\d+\.pdf$/.test(f.name)).length
      if (after > before) break
      await page.waitForTimeout(1000)
    }
    check('위임장 PDF 신규 생성', after > before, `before ${before} → after ${after}`)

    const errs = errors.filter(e => !/favicon|hydrat/i.test(e))
    check('브라우저 오류 없음', errs.length === 0, errs.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
    await delUser(userId)
  }
  summary()
}

run().catch(e => { console.error(e); process.exit(1) })
