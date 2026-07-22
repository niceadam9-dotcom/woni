// 11-2 E2E — 연차발행: 서식 자동 승계 + 개정이력 입력 '연차 갱신' 자동 기록
// 실행: npx tsx scripts/test-annual-carryover.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'annual-e2e@erp-test.com'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '연차E2E', employeeId: 'E2E-ANN' })
  custId = await mkCustomer({ customer_name: '연차발행E2E', created_by: userId })

  // 전년(2025) 계획서 — 더미 PDF 업로드 + ready 행
  const pdfPath = `${custId}/2025/e2e-test.pdf`
  const { error: upErr } = await raw.storage.from('fire-plans')
    .upload(pdfPath, Buffer.from('%PDF-1.4 e2e dummy'), { contentType: 'application/pdf' })
  if (upErr) throw new Error(`PDF 업로드 실패: ${upErr.message}`)
  const { error: pErr } = await raw.from('fire_plans').insert({
    customer_id: custId, year: 2025, title: '2025년 소방계획서', revision: 1,
    pdf_name: '2025년 소방계획서.pdf', pdf_path: pdfPath, pdf_status: 'ready', uploaded_by: userId,
  })
  if (pErr) throw new Error(`계획서 행 생성 실패: ${pErr.message}`)

  // 서식 입력 — 전년도 개정이력 입력 + 임의 섹션(승계 확인용)
  await raw.from('fire_plan_forms').upsert({
    customer_id: custId,
    sections: {
      revision: { revisionDate: '2025-01-05', revisionNote: '2025년 소방계획서 작성' },
      zones: [{ floor: '1층', usage: '사무실' }],
    },
    updated_by: userId,
  })

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', d => d.accept())
  await login(page, EMAIL)

  await page.goto(`${BASE}/customers/${custId}?tab=plan&sub=archive`)
  await page.waitForSelector('button[title="다음 연도로 연차발행 (파일 복제)"]')
  check('보관함·연차발행 버튼', true)
  await page.click('button[title="다음 연도로 연차발행 (파일 복제)"]')
  await page.waitForTimeout(3000)

  const { data: plans } = await raw.from('fire_plans')
    .select('year, revision, note, pdf_path').eq('customer_id', custId).order('year')
  const rows = (plans ?? []) as Array<{ year: number; revision: number; note: string | null; pdf_path: string | null }>
  const y26 = rows.find(r => r.year === 2026)
  check('2026년 계획서 발행', !!y26, JSON.stringify(rows))
  check('발행 노트(연차발행)', (y26?.note ?? '').includes('연차발행'), y26?.note ?? '')
  check('파일 복제 경로', (y26?.pdf_path ?? '').includes('/2026/'))

  const { data: form } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', custId).single()
  const sections = (form?.sections ?? {}) as { revision?: { revisionDate?: string; revisionNote?: string }; zones?: unknown[] }
  check('개정이력 입력 = 연차 갱신 자동 기록', (sections.revision?.revisionNote ?? '').includes('2026년 연차 갱신'), JSON.stringify(sections.revision))
  check('다른 섹션(zones) 승계 유지', Array.isArray(sections.zones) && sections.zones.length === 1)

  // 화면 반영 — 개정이력 입력 칸에 연차 갱신 문구
  await page.goto(`${BASE}/customers/${custId}?tab=plan&sub=archive`)
  check('개정 내용 입력칸에 연차 갱신 반영', await page.isVisible('input[value*="연차 갱신"], textarea:has-text("연차 갱신")')
    || (await page.locator('text=연차 갱신').count()) > 0)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) {
    const { data: objs } = await raw.storage.from('fire-plans').list(`${custId}/2025`)
    const { data: objs2 } = await raw.storage.from('fire-plans').list(`${custId}/2026`)
    const paths = [
      ...((objs ?? []) as Array<{ name: string }>).map(o => `${custId}/2025/${o.name}`),
      ...((objs2 ?? []) as Array<{ name: string }>).map(o => `${custId}/2026/${o.name}`),
    ]
    if (paths.length) await raw.storage.from('fire-plans').remove(paths)
    await raw.from('fire_plans').delete().eq('customer_id', custId)
    await raw.from('fire_plan_forms').delete().eq('customer_id', custId)
    await cleanupCustomer(custId)
  }
  if (userId) await delUser(userId)
}
summary()
