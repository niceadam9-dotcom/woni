// 위임장 [보기] — 생성 전 미리보기 진입점 검증
// 실행: npx tsx scripts/_probe-delegation-view.mts   (dev 3000 필요, Gotenberg 불필요=즉석 HTML)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'delegation-view@sjfire.test'
let userId = ''

const run = async () => {
  const { data: insps } = await raw.from('inspections')
    .select('id, customer_id, inspection_start_date, plan_type')
    .or('plan_type.is.null,plan_type.like.special%')
    .order('inspection_start_date', { ascending: false }).limit(1)
  const insp = (insps ?? [])[0] as { id: string } | undefined
  if (!insp) throw new Error('자체점검 건이 없습니다.')
  console.log(`대상 점검 ${insp.id}`)

  userId = await mkUser({ email: EMAIL, name: '위임장보기', employeeId: 'DLV-001', role: 'admin' })
  const { browser, page } = await launch()
  try {
    await login(page, EMAIL)
    // dev 서버 재컴파일·RSC 늦은 커밋 대비 — 버튼이 보일 때까지 ④ 진입을 재시도
    const viewBtn = page.getByRole('button', { name: '위임장 보기' })
    for (let i = 0; i < 5; i++) {
      await page.goto(`${BASE}/inspections/${insp.id}`)
      await page.waitForLoadState('networkidle')
      const step4 = page.locator('[data-step="submit9"]').first()
      if (await step4.count() > 0) { await step4.click(); await page.waitForTimeout(800) }
      if (await viewBtn.count() > 0) break
      await page.waitForTimeout(1500)
    }
    check('[위임장 보기] 버튼 존재', await viewBtn.count() > 0, `count ${await viewBtn.count()}`)
    if (await viewBtn.count() === 0) { summary(); return }

    // 누르기 전에는 미리보기가 렌더되지 않아야 한다(닫힌 채 왕복 방지)
    const before = await page.locator('iframe[title^="위임장"]').count()
    check('열기 전에는 미리보기 미렌더', before === 0, `iframe ${before}`)

    await viewBtn.first().click()
    const frame = page.locator('iframe[title^="위임장"]').first()
    await frame.waitFor({ state: 'visible', timeout: 30000 })
    check('[보기] 클릭 → 위임장 미리보기 표시', await frame.count() > 0, '')

    // 미리보기 내용이 실제 위임장인지 — 서식 문구로 판정
    const body: string = await page.frameLocator('iframe[title^="위임장"]').locator('body').innerText()
    check('미리보기 본문이 위임장 서식', /위\s*임\s*장/.test(body), body.slice(0, 80).replace(/\n/g, ' '))
    check('위임 내용·유의사항 포함', /위임|점검결과|보고서/.test(body), body.slice(0, 80).replace(/\n/g, ' '))
    check('생성 없이 렌더(즉석 HTML)', body.length > 100, `len ${body.length}`)

    // 입력칸도 같은 영역에 있어야 한다(입력 → 미리보기 즉시 반영 구조)
    const details = page.locator('details', { hasText: '위임장 입력·미리보기' }).first()
    check('입력·미리보기가 같은 영역', await details.count() > 0, '')

    // [크게 보기] 오버레이 — 제목이 '위임장'으로 나와야 (ANNEX_PREVIEW_TITLES 확장분).
    // ⚠ 화면에 별지 9호 미리보기의 zoom 버튼도 있다 — 반드시 위임장 영역으로 좁힐 것
    const zoom = details.getByTestId('preview-zoom')
    if (await zoom.count() > 0) {
      await zoom.first().click()
      const ov = page.getByTestId('preview-zoom-overlay')
      await ov.waitFor({ state: 'visible', timeout: 10000 })
      const t = await ov.innerText()
      check('크게 보기 제목이 "위임장"', t.includes('위임장'), t.slice(0, 60))
      await page.keyboard.press('Escape')
    } else {
      check('크게 보기 버튼 존재', false, 'preview-zoom 없음')
    }
  } finally {
    await browser.close()
    await delUser(userId)
  }
  summary()
}

run().catch(e => { console.error(e); process.exit(1) })
