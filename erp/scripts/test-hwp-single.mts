// §7-5 출력 엔진 단일화 E2E — 생성 바 [계획서 생성] → 워커(HWP+미리보기+PDF) → 보관함 등록
// 실행: npx tsx scripts/test-hwp-single.mts   (로컬 dev + 스테이징 DB + 워커 상주)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'hwp-single-e2e@erp-test.com'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: 'HWP단일E2E', employeeId: 'E2E-HWP1' })
  custId = await mkCustomer({ customer_name: 'HWP단일E2E고객', address: '세종시 단일로 1', created_by: userId })
  await raw.from('buildings').insert({
    customer_id: custId, building_name: '본관', is_active: true, created_by: userId,
    purpose: '업무시설', total_area: 500, floors_above: 3, floors_below: 1,
  })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForSelector('button:has-text("계획서 생성 (HWP+PDF)")')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("계획서 생성 (HWP+PDF)")')
  await page.waitForSelector('text=생성 요청됨')
  check('생성 요청(HWP 단일 경로)', true)

  // 워커 처리 대기 — HWP+HTML 등록(1단계) 후 PDF 첨부(2단계)
  const plan = await pollDb(async () => {
    const { data } = await raw.from('fire_plans')
      .select('id, hwp_path, html_path, pdf_status, pdf_path, note')
      .eq('customer_id', custId).order('created_at', { ascending: false }).limit(1)
    return data?.[0]?.hwp_path ? data[0] : null
  }, 120000)
  check('워커 처리 — HWP 등록', !!plan?.hwp_path, JSON.stringify(plan))
  check('웹 미리보기(HTML) 등록', !!plan?.html_path)
  const pdfReady = await pollDb(async () => {
    const { data } = await raw.from('fire_plans').select('pdf_status, pdf_path').eq('id', plan!.id).single()
    return data?.pdf_status === 'ready' ? data : null
  }, 90000)
  check('PDF 첨부(ready)', !!pdfReady?.pdf_path, JSON.stringify(pdfReady))

  // 보관함 UI — [재생성] 버튼(HWP 워커)·업로드된 파일 표시
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=archive`)
  await page.waitForSelector('text=소방계획서')
  check('보관함 — 생성분 표시', await page.isVisible('text=표준양식 자동 생성') || await page.isVisible('text=소방계획서'))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) {
    const { data: plans } = await raw.from('fire_plans').select('id, pdf_path, hwp_path, html_path, odt_path').eq('customer_id', custId)
    const paths: string[] = []
    for (const p of (plans ?? []) as Array<Record<string, string | null>>) {
      for (const k of ['pdf_path', 'hwp_path', 'html_path', 'odt_path']) if (p[k]) paths.push(p[k]!)
    }
    if (paths.length) await raw.storage.from('fire-plans').remove(paths)
    await raw.from('fire_plans').delete().eq('customer_id', custId)
    await raw.from('fire_plan_gen_jobs').delete().eq('customer_id', custId)
    await raw.from('fire_plan_forms').delete().eq('customer_id', custId)
    await raw.from('buildings').delete().eq('customer_id', custId)
    await cleanupCustomer(custId)
  }
  if (userId) await delUser(userId)
}
summary()
