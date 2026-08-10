// H-23 별지 9·10·11호 작성 화면(3단 패턴) E2E — annex-compose-panel + ③ annex_inputs 병합
// 실행: npx tsx scripts/test-annex-compose.mts  (로컬 dev 서버 + 스테이징 DB, 112 적용 + GOTENBERG_URL 필요)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'annex-compose-e2e@erp-test.com'
let userId = ''
let customerId = ''
let inspectionId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
function kdate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

const SUBMIT_DATE = kstShift(3)
const TOTAL_PERIOD = '2026년 9월 1일 ~ 2026년 9월 30일'
const SUMMARY = 'E2E계획요약-감지기 교체 일괄 시공'

try {
  userId = await mkUser({ email: EMAIL, name: '별지작성E2E', employeeId: 'E2E-ANNEX' })
  customerId = await mkCustomer({ customer_name: '별지작성E2E고객', address: '경기 양평군 테스트로 23', created_by: userId })
  // 자체점검 건 (plan_type null = special) + 불량 1건(이행계획 보유)
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-2), inspection_end_date: kstShift(-2),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspectionId = insp!.id
  await raw.from('inspection_defects').insert({
    inspection_id: inspectionId, defect_name: 'E2E불량-감지기 미작동', severity: '보통',
    action_plan: '감지기 교체', action_start: kstShift(5), action_end: kstShift(20),
  })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) 점검 상세 → 타임라인 ④ [10호 작성] → 패널 오픈 ──
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('text=문서 타임라인')
  check('타임라인 ④에 [10호 작성] 진입점', await page.isVisible('button:has-text("10호 작성")'))
  check('타임라인 ④에 [9호 작성] 진입점', await page.isVisible('button:has-text("9호 작성")'))
  check('타임라인 ⑥에 [11호 작성] 진입점', await page.isVisible('button:has-text("11호 작성")'))
  await page.click('button:has-text("10호 작성")')
  const panel = page.locator('[data-annex-panel="report10"]')
  await panel.waitFor()
  check('작성 패널 오픈 (별지 10호)', await panel.locator('text=별지 10호 작성').isVisible())

  // 1단 — 자동 채움 검토
  await panel.locator('section >> text=자동 채움 검토').first().waitFor()
  check('1단 [자동] 배지·원본 안내', await panel.locator('text=이행조치 사항 표·총 이행기간(자동 산출)').isVisible())
  check('2단 [입력] 필드 노출', await panel.locator('textarea[aria-label="계획 내용 요약"]').isVisible())

  // ── 2) 2단 고유 값 입력 → 저장 ──
  await panel.locator('input[aria-label="제출일"]').fill(SUBMIT_DATE)
  await panel.locator('input[aria-label="총 이행기간 (수동 보정)"]').fill(TOTAL_PERIOD)
  await panel.locator('input[aria-label="총 일수 (수동 보정)"]').fill('30')
  await panel.locator('textarea[aria-label="계획 내용 요약"]').fill(SUMMARY)
  await panel.locator('input[aria-label="공사업체 메모"]').fill('E2E공사업체(주)')
  check('미저장(dirty) 표시', await panel.getByText('미저장', { exact: true }).isVisible())
  await panel.locator('button:has-text("저장")').click()
  await panel.locator('text=저장됨').waitFor()
  const { data: saved } = await raw.from('annex_inputs')
    .select('fields').eq('inspection_id', inspectionId).eq('annex_no', 'report10').single()
  const f = (saved?.fields ?? {}) as Record<string, string>
  check('DB annex_inputs 저장', f.reportDate === SUBMIT_DATE && f.totalPeriod === TOTAL_PERIOD
    && f.totalDays === '30' && f.summary === SUMMARY && f.contractor === 'E2E공사업체(주)', JSON.stringify(f))

  // ── 3) 패널 재오픈 → 이전 ③ 입력 유지 (§4-A-2b 재생성 대응) ──
  await panel.locator('button[aria-label="닫기"]').click()
  await panel.waitFor({ state: 'detached' })
  await page.click('button:has-text("10호 작성")')
  const panel2 = page.locator('[data-annex-panel="report10"]')
  await panel2.locator('input[aria-label="제출일"]').waitFor()
  check('재오픈 — 제출일 유지', (await panel2.locator('input[aria-label="제출일"]').inputValue()) === SUBMIT_DATE)
  check('재오픈 — 총 이행기간 유지', (await panel2.locator('input[aria-label="총 이행기간 (수동 보정)"]').inputValue()) === TOTAL_PERIOD)
  check('재오픈 — 요약 유지', (await panel2.locator('textarea[aria-label="계획 내용 요약"]').inputValue()) === SUMMARY)

  // ── 4) 3단 미리보기 — iframe srcDoc에 ③ 값 반영 (H-4) ──
  await panel2.locator('button:has-text("미리보기")').click()
  const iframe = panel2.locator('iframe')
  await iframe.waitFor()
  const srcDoc = (await iframe.getAttribute('srcdoc')) ?? ''
  check('미리보기 — ③ 제출일(kdate) 반영', srcDoc.includes(kdate(SUBMIT_DATE)), kdate(SUBMIT_DATE))
  check('미리보기 — ③ 총 이행기간 보정 반영', srcDoc.includes(TOTAL_PERIOD))
  check('미리보기 — ③ 요약 = 표 첫 행', srcDoc.includes(SUMMARY))
  check('미리보기 — ② 불량 계획 자동 행 유지', srcDoc.includes('감지기 교체'))
  check('미리보기 — 법정 문구 보존', srcDoc.includes('소방시설등의 자체점검 결과 이행계획서'))

  // ── 5) [PDF 생성] → 잡 done + storage 파일 + ③ 값 포함 ──
  await panel2.locator('button:has-text("PDF 생성")').click()
  await panel2.locator('text=PDF 생성 완료').waitFor({ timeout: 60000 })
  const { data: job } = await raw.from('fire_plan_gen_jobs')
    .select('status, report_type, missing').eq('inspection_id', inspectionId)
    .order('created_at', { ascending: false }).limit(1).single()
  check('잡 done (report10)', job?.status === 'done' && job?.report_type === 'report10', JSON.stringify(job))
  const { data: objs } = await raw.storage.from('fire-plans').list(`${customerId}/inspections/${inspectionId}`)
  const names = ((objs ?? []) as Array<{ name: string }>).map(o => o.name)
  const htmlName = names.find(n => /^report10_\d+\.html$/.test(n))
  const pdfName = names.find(n => /^report10_\d+\.pdf$/.test(n))
  check('storage report10 HTML+PDF', !!htmlName && !!pdfName, names.join(','))
  if (htmlName) {
    const { data: blob } = await raw.storage.from('fire-plans')
      .download(`${customerId}/inspections/${inspectionId}/${htmlName}`)
    const html = await (blob as Blob).text()
    check('생성 HTML — ③ 제출일 반영', html.includes(kdate(SUBMIT_DATE)))
    check('생성 HTML — ③ 총 이행기간·요약 반영', html.includes(TOTAL_PERIOD) && html.includes(SUMMARY))
    check('생성 HTML — 미입력 하이라이트 없음(PDF 경로)', !html.includes('class="missing"'))
  }
  if (pdfName) {
    const { data: pblob } = await raw.storage.from('fire-plans')
      .download(`${customerId}/inspections/${inspectionId}/${pdfName}`)
    const buf = new Uint8Array(await (pblob as Blob).arrayBuffer())
    check('PDF 매직바이트·크기', buf.length > 5000
      && String.fromCharCode(...buf.slice(0, 5)) === '%PDF-', `size=${buf.length}`)
  }

  // ── 6) 11호 작성 — note(완료 보고 문구) 렌더 + 9호 작성 — 비고 (액션 경유 미리보기 검증) ──
  await raw.from('inspection_defects').update({
    action_taken: '감지기 교체 완료', action_completed_at: kstShift(0),
  }).eq('inspection_id', inspectionId)
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('text=문서 타임라인')
  await page.click('button:has-text("11호 작성")')
  const p11 = page.locator('[data-annex-panel="report11"]')
  await p11.locator('textarea[aria-label="완료 보고 문구"]').waitFor()
  await p11.locator('input[aria-label="제출일"]').fill(SUBMIT_DATE)
  await p11.locator('textarea[aria-label="완료 보고 문구"]').fill('E2E완료문구-전항목 이행 완료함')
  await p11.locator('button:has-text("미리보기")').click()
  const if11 = p11.locator('iframe')
  await if11.waitFor()
  const src11 = (await if11.getAttribute('srcdoc')) ?? ''
  check('11호 미리보기 — ③ 완료 보고 문구(서명 위 1줄)', src11.includes('비고: E2E완료문구-전항목 이행 완료함'))
  check('11호 미리보기 — ③ 제출일 반영', src11.includes(kdate(SUBMIT_DATE)))
  check('11호 미리보기 — ② 완료 행 자동', src11.includes('감지기 교체 완료'))
  await p11.locator('button[aria-label="닫기"]').click()
  await p11.waitFor({ state: 'detached' })

  await page.click('button:has-text("9호 작성")')
  const p9 = page.locator('[data-annex-panel="report9"]')
  await p9.locator('textarea[aria-label="비고·보완 문구"]').waitFor()
  check('9호 패널 — 1단 미비 목록 표시', await p9.locator('text=미비 항목').isVisible())
  await p9.locator('input[aria-label="보고일"]').fill(SUBMIT_DATE)
  await p9.locator('textarea[aria-label="비고·보완 문구"]').fill('E2E비고-소화기 위치 보완 권고')
  await p9.locator('button:has-text("미리보기")').click()
  const if9 = p9.locator('iframe')
  await if9.waitFor()
  const src9 = (await if9.getAttribute('srcdoc')) ?? ''
  check('9호 미리보기 — ③ 비고(1쪽 유의사항 위)', src9.includes('비고: E2E비고-소화기 위치 보완 권고'))
  check('9호 미리보기 — ③ 보고일 반영', src9.includes(kdate(SUBMIT_DATE)))
  check('9호 미리보기 — 법정 서식 제목 보존', src9.includes('소방시설등 자체점검 실시결과 보고서'))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (customerId) {
    if (inspectionId) {
      await raw.from('annex_inputs').delete().eq('inspection_id', inspectionId)
      await raw.from('fire_plan_gen_jobs').delete().eq('inspection_id', inspectionId)
      await raw.from('inspection_defects').delete().eq('inspection_id', inspectionId)
      const { data: files } = await raw.storage.from('fire-plans').list(`${customerId}/inspections/${inspectionId}`)
      const paths = ((files ?? []) as Array<{ name: string }>).map(o => `${customerId}/inspections/${inspectionId}/${o.name}`)
      if (paths.length) await raw.storage.from('fire-plans').remove(paths)
    }
    await cleanupCustomer(customerId)
  }
  await delUser(userId)
  summary()
}
