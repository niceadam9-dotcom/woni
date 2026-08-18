// H-23 별지 9·10·11호 ③ 고유값 입력 E2E — annex_inputs 병합·미리보기·PDF 반영
// 소방계획서_21 R6-6에서 3단 슬라이드 패널을 걷어내고 작업대 칸에 인라인으로 옮겼다.
// 필드 정의(annex-fields.tsx)·저장 액션은 그대로라 검증 대상은 같고 진입 경로만 바뀌었다.
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
// 총 이행기간은 시작·종료 두 칸으로 입력하고 "YYYY-MM-DD ~ YYYY-MM-DD"로 저장된다(문서 출력 시 한국어 날짜로 변환)
const PERIOD_START = '2026-09-01'
const PERIOD_END = '2026-09-30'
const TOTAL_PERIOD = `${PERIOD_START} ~ ${PERIOD_END}`
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

  // ── 1) 점검 상세 → 작업대 ⑤ 칸의 10호 ③ 고유값 (R6-6 인라인) ──
  const goStep = async (step: string) => {
    await page.click(`[data-testid="workbench-stepbar"] button[data-step="${step}"]`)
  }
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  await goStep('repair')
  const panel = page.locator('[data-annex-fields="report10"]')
  await panel.waitFor({ timeout: 60000 })
  check('⑤ 칸에 10호 ③ 고유값 인라인', true)
  check('슬라이드 패널 미사용(R6-6)', (await page.locator('[data-annex-panel]').count()) === 0)
  check('자동 산출 안내 — 원본은 불량 표', await page.isVisible('text=/비우면 자동 계산값/'))
  check('[입력] 필드 노출', await panel.locator('textarea[aria-label="계획 내용 요약"]').isVisible())

  // ── 2) ③ 고유 값 입력 → 칸을 벗어나면 저장 ──
  await panel.locator('input[aria-label="제출일"]').fill(SUBMIT_DATE)
  await panel.locator('input[aria-label="총 이행기간 (수동 보정) 시작일"]').fill(PERIOD_START)
  await panel.locator('input[aria-label="총 이행기간 (수동 보정) 종료일"]').fill(PERIOD_END)
  await panel.locator('input[aria-label="총 일수 (수동 보정)"]').fill('30')
  await panel.locator('textarea[aria-label="계획 내용 요약"]').fill(SUMMARY)
  await panel.locator('input[aria-label="공사업체 메모"]').fill('E2E공사업체(주)')
  await page.click('text=조치 계획 입력')   // blur → 저장
  await panel.locator('text=저장됨').waitFor({ timeout: 30000 })
  // 칸마다 저장이 따로 날아간다 — 마지막 칸의 왕복까지 기다린다
  let f: Record<string, string> = {}
  for (let i = 0; i < 20; i++) {
    const { data: saved } = await raw.from('annex_inputs')
      .select('fields').eq('inspection_id', inspectionId).eq('annex_no', 'report10').maybeSingle()
    f = (saved?.fields ?? {}) as Record<string, string>
    if (f.contractor && f.summary && f.totalPeriod === TOTAL_PERIOD) break
    await new Promise(r => setTimeout(r, 500))
  }
  check('DB annex_inputs 저장', f.reportDate === SUBMIT_DATE && f.totalPeriod === TOTAL_PERIOD
    && f.totalDays === '30' && f.summary === SUMMARY && f.contractor === 'E2E공사업체(주)', JSON.stringify(f))

  // ── 3) 재진입 → 이전 ③ 입력 유지 (§4-A-2b 재생성 대응) ──
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  await goStep('repair')
  const panel2 = page.locator('[data-annex-fields="report10"]')
  await panel2.locator('input[aria-label="제출일"]').waitFor({ timeout: 60000 })
  check('재진입 — 제출일 유지', (await panel2.locator('input[aria-label="제출일"]').inputValue()) === SUBMIT_DATE)
  check('재진입 — 총 이행기간 유지',
    (await panel2.locator('input[aria-label="총 이행기간 (수동 보정) 시작일"]').inputValue()) === PERIOD_START
    && (await panel2.locator('input[aria-label="총 이행기간 (수동 보정) 종료일"]').inputValue()) === PERIOD_END)
  check('재진입 — 요약 유지', (await panel2.locator('textarea[aria-label="계획 내용 요약"]').inputValue()) === SUMMARY)

  // ── 4) 실시간 미리보기 — iframe srcDoc에 ③ 값 반영 (H-4 / R6-4) ──
  const iframe = page.locator('iframe[title="별지 10호 미리보기"]')
  await iframe.waitFor({ timeout: 60000 })
  await page.waitForFunction(`(() => {
    const el = document.querySelector('iframe[title="별지 10호 미리보기"]')
    return !!el && (el.getAttribute('srcdoc') || '').includes(${JSON.stringify(SUMMARY)})
  })()`, undefined, { timeout: 60000 })
  const srcDoc = (await iframe.getAttribute('srcdoc')) ?? ''
  check('미리보기 — ③ 제출일(kdate) 반영', srcDoc.includes(kdate(SUBMIT_DATE)), kdate(SUBMIT_DATE))
  // 문서에는 "○년 ○월 ○일" 형식으로 나온다
  check('미리보기 — ③ 총 이행기간 보정 반영',
    srcDoc.includes(kdate(PERIOD_START)) && srcDoc.includes(kdate(PERIOD_END)),
    `${kdate(PERIOD_START)} ~ ${kdate(PERIOD_END)}`)
  check('미리보기 — ③ 요약 = 표 첫 행', srcDoc.includes(SUMMARY))
  check('미리보기 — ② 불량 계획 자동 행 유지', srcDoc.includes('감지기 교체'))
  check('미리보기 — 법정 문구 보존', srcDoc.includes('소방시설등의 자체점검 결과 이행계획서'))

  // ── 5) [PDF 생성] → 잡 done + storage 파일 + ③ 값 포함 ──
  // PDF 변환은 Gotenberg가 있어야 한다 — 없는 환경에서는 이 구간만 건너뛰고 그 사실을 남긴다(조용히 통과시키지 않는다)
  await page.locator('button:has-text("10호 PDF 생성")').click()
  const genMsg = (await page.locator('p:has-text("생성 완료"), p:has-text("❌")').first()
    .textContent({ timeout: 120000 }).catch(() => '(메시지 없음)')) ?? ''
  if (genMsg.includes('GOTENBERG_URL 미설정')) {
    console.log('  ⚠ PDF 생성 구간 건너뜀 — GOTENBERG_URL 미설정 환경 (스테이징에서 재확인 필요)')
  } else {
    check('PDF 생성 완료 메시지', genMsg.includes('생성 완료'), genMsg)
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
      check('생성 HTML — ③ 총 이행기간·요약 반영',
        html.includes(kdate(PERIOD_START)) && html.includes(kdate(PERIOD_END)) && html.includes(SUMMARY))
      check('생성 HTML — 미입력 하이라이트 없음(PDF 경로)', !html.includes('class="missing"'))
    }
    if (pdfName) {
      const { data: pblob } = await raw.storage.from('fire-plans')
        .download(`${customerId}/inspections/${inspectionId}/${pdfName}`)
      const buf = new Uint8Array(await (pblob as Blob).arrayBuffer())
      check('PDF 매직바이트·크기', buf.length > 5000
        && String.fromCharCode(...buf.slice(0, 5)) === '%PDF-', `size=${buf.length}`)
    }
  }

  // ── 6) 11호 작성 — note(완료 보고 문구) 렌더 + 9호 작성 — 비고 (액션 경유 미리보기 검증) ──
  await raw.from('inspection_defects').update({
    action_taken: '감지기 교체 완료', action_completed_at: kstShift(0),
  }).eq('inspection_id', inspectionId)
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  await goStep('submit11')
  const p11 = page.locator('[data-annex-fields="report11"]')
  await p11.locator('textarea[aria-label="완료 보고 문구"]').waitFor({ timeout: 60000 })
  await p11.locator('input[aria-label="제출일"]').fill(SUBMIT_DATE)
  await p11.locator('textarea[aria-label="완료 보고 문구"]').fill('E2E완료문구-전항목 이행 완료함')
  await page.click('text=전·후 사진 쌍')   // blur → 저장
  await p11.locator('text=저장됨').waitFor({ timeout: 30000 })
  await page.waitForFunction(`(() => {
    const el = document.querySelector('iframe[title="별지 11호 미리보기"]')
    return !!el && (el.getAttribute('srcdoc') || '').includes('E2E완료문구')
  })()`, undefined, { timeout: 60000 })
  const src11 = (await page.locator('iframe[title="별지 11호 미리보기"]').getAttribute('srcdoc')) ?? ''
  check('11호 미리보기 — ③ 완료 보고 문구(서명 위 1줄)', src11.includes('비고: E2E완료문구-전항목 이행 완료함'))
  check('11호 미리보기 — ③ 제출일 반영', src11.includes(kdate(SUBMIT_DATE)))
  check('11호 미리보기 — ② 완료 행 자동', src11.includes('감지기 교체 완료'))

  await goStep('submit9')
  const p9 = page.locator('[data-annex-fields="report9"]')
  await p9.locator('textarea[aria-label="비고·보완 문구"]').waitFor({ timeout: 60000 })
  const missingShown = await page.locator('text=/미입력 \\d+곳|빈칸 없음/').first()
    .waitFor({ timeout: 60000 }).then(() => true).catch(() => false)
  check('④ 미비 항목 안내(전제·미입력)', missingShown)
  await p9.locator('input[aria-label="보고일"]').fill(SUBMIT_DATE)
  await p9.locator('textarea[aria-label="비고·보완 문구"]').fill('E2E비고-소화기 위치 보완 권고')
  await page.click('text=제출 전제')   // blur → 저장
  await p9.locator('text=저장됨').waitFor({ timeout: 30000 })
  await page.locator('iframe[title="별지 9호 미리보기"] >> nth=0').waitFor({ timeout: 60000 })
  await page.click('text=새로고침')
  await page.waitForFunction(`(() => {
    const el = document.querySelector('iframe[title="별지 9호 미리보기"]')
    return !!el && (el.getAttribute('srcdoc') || '').includes('E2E비고')
  })()`, undefined, { timeout: 60000 })
  const src9 = (await page.locator('iframe[title="별지 9호 미리보기"]').getAttribute('srcdoc')) ?? ''
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
