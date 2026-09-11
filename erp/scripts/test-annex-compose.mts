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
/** 달력일 더하기 — 위젯이 쓰는 `legalActionRange`와 같은 UTC 기준(로컬 생성자를 쓰면 TZ로 갈린다) */
function addDaysISO(iso: string, n: number): string {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10)
}

const SUBMIT_DATE = kstShift(3)
// 총 이행기간은 시작·종료 두 칸으로 입력하고 "YYYY-MM-DD ~ YYYY-MM-DD"로 저장된다(문서 출력 시 한국어 날짜로 변환)
const PERIOD_START = '2026-09-01'
const PERIOD_END = '2026-09-30'
const TOTAL_PERIOD = `${PERIOD_START} ~ ${PERIOD_END}`
/** 종료일을 손으로 고치면 총 일수가 **실기간을 따른다**(자기모순 인쇄 방지).
 *  🚨 2026-09-11 — **양끝 포함**으로 통일했다: 09-01~09-30은 29가 아니라 **30**이다.
 *    인쇄 직전 `manualActionPeriod`가 늘 양끝 포함으로 다시 세므로, 저장값이 29면
 *    문서에는 30이 찍혀 「(총 N일)」이 기간과 어긋난다 — 그 어긋남이 종전 결함이었다. */
const TOTAL_DAYS = '30'
const SUMMARY = 'E2E계획요약-감지기 교체 일괄 시공'

try {
  userId = await mkUser({ email: EMAIL, name: '별지작성E2E', employeeId: 'E2E-ANNEX' })
  customerId = await mkCustomer({ customer_name: '별지작성E2E고객', address: '경기 양평군 테스트로 23', created_by: userId })
  // 설비 대장 1건(2026-09-08 추가) — 「이행조치 계획사항」의 자동 문구는 **대장이 정본**이다.
  // 대장이 통째로 비면 조립이 그룹 판정을 포기하고(applicableGroups 미공급) 자동 문구를 쓰지 않는다
  // — 모르는 것을 「해당없음」으로 단정하지 않기 위해서다(소방계획서_41, 2026-09-08 사용자 확정).
  // 종전 픽스처는 대장이 없어 `?? []`의 '전 구분 미해당' 오독에 기대 초록이었다.
  const { data: bld, error: bErr } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId })
    .select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  const { error: fErr } = await raw.from('fire_facilities').insert({
    building_id: bld!.id, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true,
  })
  if (fErr) throw new Error(`시설 생성 실패: ${fErr.message}`)
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
  // ⚠ 클릭 한 번으로 끝내지 않는다 — 하이드레이션 전·재렌더 중의 클릭은 **조용히 무시**되고,
  //   그러면 아직 옛 차수인 화면에서 다음 칸을 기다리다 60초 타임아웃이 난다(2026-09-07 실측).
  //   전환은 aria-current="step"으로 확인하고, 안 됐으면 다시 누른다.
  const goStep = async (step: string) => {
    const btn = `[data-testid="workbench-stepbar"] button[data-step="${step}"]`
    for (let i = 0; i < 3; i++) {
      await page.click(btn)
      const ok = await page.waitForSelector(`${btn}[aria-current="step"]`, { timeout: 10000 })
        .then(() => true).catch(() => false)
      if (ok) return
    }
    throw new Error(`차수 전환 실패: ${step}`)
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
  // 2026-09-07 — 10호 ③ 값이 두 차수로 갈렸다: 문서 축(제출일·총 이행기간·총 일수)은 ④ 소방서 제출,
  // 작업 축(요약·업체·예산)은 ⑤. 두 자리가 **같은 annex_inputs 행**을 나눠 쓰므로 아래 §2-b가
  // '뒤에 저장한 쪽이 앞의 칸을 지우지 않는가'를 직접 판정한다(upsert는 통째 교체다).
  check('⑤에는 문서 축 칸이 없다(④로 이동)', (await panel.locator('input[aria-label="제출일"]').count()) === 0)

  // ── 2-a) ⑤ 작업 축 입력 → 칸을 벗어나면 저장 ──
  await panel.locator('textarea[aria-label="계획 내용 요약"]').fill(SUMMARY)
  await panel.locator('input[aria-label="공사업체 메모"]').fill('E2E공사업체(주)')
  await page.click('text=조치 계획 입력')   // blur → 저장
  await panel.locator('text=저장됨').waitFor({ timeout: 30000 })

  // ── 2-b) ④ 문서 축 입력 — 나중에 저장되는 쪽이 ⑤ 입력을 덮어쓰지 않아야 한다 ──
  await goStep('submit9')
  const panel10 = page.locator('[data-annex-fields="report10"]')
  await panel10.locator('input[aria-label="제출일"]').waitFor({ timeout: 60000 })
  check('④ 칸에 10호 문서 축 고유값', true)
  check('④에는 작업 축 칸이 없다(⑤에 남는다)',
    (await panel10.locator('textarea[aria-label="계획 내용 요약"]').count()) === 0)
  await panel10.locator('input[aria-label="제출일"]').fill(SUBMIT_DATE)

  /* ── 총 이행기간 위젯 — 어느 쪽을 먼저 건드려도 종료일이 정해진다 (2026-09-09) ──
   * 종전에는 시작·종료·총일수가 따로 놓여 기간과 일수가 어긋난 채 저장될 수 있었다.
   * 세 진입로를 **순서대로** 태워 규칙을 고정한다. */
  // 2026-09-11 — 드롭다운에서 **라디오**로 바뀌었다(사용자 지시). 계약은 그대로라 이름만 옮긴다:
  // 묶음은 여전히 testid `legal-period-select` 하나이고, 선택지마다 `legal-period-opt-*`가 붙는다.
  const daysSel = panel10.locator('[data-testid="legal-period-select"]')
  const dayOpt = (v: string) => panel10.locator(`[data-testid="legal-period-opt-${v}"]`)
  const startIn = panel10.locator('input[aria-label="총 이행기간 (수동 보정) 시작일"]')
  const endIn = panel10.locator('input[aria-label="총 이행기간 (수동 보정) 종료일"]')
  check('총 일수 칸은 별도 줄이 아니라 위젯 안 라디오다',
    (await panel10.locator('input[aria-label="총 일수 (수동 보정)"]').count()) === 0
    && (await daysSel.count()) === 1)
  // 🎯 라디오 전환의 핵심 — 법정 선택지 둘이 **펼치지 않아도 보인다**(select였을 땐 안 보였다)
  check('법정 기간 두 갈래가 펼치지 않고 보인다',
    (await dayOpt('10').count()) === 1 && (await dayOpt('20').count()) === 1
    && (await panel10.getByText('10일 수리·정비').count()) === 1
    && (await panel10.getByText('20일 철거·교체').count()) === 1)
  check('드롭다운(select)은 남아 있지 않다', (await daysSel.locator('select').count()) === 0)

  // ① 총일수를 **먼저** 고른다 → 시작일(비었으므로 제출일)에서 종료일이 정해진다
  await dayOpt('10').check()
  check('① 10일 라디오가 선택 상태', await dayOpt('10').isChecked())
  await endIn.locator('xpath=.').waitFor()
  check('① 10일 선택 → 시작일 = 제출일', (await startIn.inputValue()) === SUBMIT_DATE,
    await startIn.inputValue())
  /* 🚨 2026-09-11 계약 변경 — **시작일이 1일차**(양끝 포함 10일)라 종료일은 `+9`다.
   *   종전 기대치는 `+10`이었고, 그때는 화면 라디오가 「10일」인데 문서에는 「총 11일」이
   *   인쇄되고 있었다. 여기 상수를 베껴 적지 않고 `10 - 1`로 적어 **일수와 오프셋의 관계**를
   *   드러낸다 — 20일로 바뀌어도 같은 규칙이라는 것이 읽혀야 한다. */
  check('① 10일 선택 → 종료일 자동(시작일 포함 10일 = +9)',
    (await endIn.inputValue()) === addDaysISO(SUBMIT_DATE, 10 - 1),
    `${await endIn.inputValue()} (기대 ${addDaysISO(SUBMIT_DATE, 10 - 1)})`)

  // ② 시작일을 바꾸면 **종료일이 따라온다**(고른 일수 유지)
  await startIn.fill(PERIOD_START)
  check('② 시작일 변경 → 종료일 따라옴', (await endIn.inputValue()) === addDaysISO(PERIOD_START, 10 - 1),
    `${await endIn.inputValue()} (기대 ${addDaysISO(PERIOD_START, 10 - 1)})`)
  // 🎯 라디오가 「10일」에 머무는가 — 종료일이 바뀌어도 셈법이 같으면 선택이 풀리지 않는다.
  //    (span 계산에 `+1`을 빠뜨리면 여기서 **스스로 「직접 입력」으로 떨어진다**)
  check('② 그래도 라디오는 10일 그대로(양끝 포함 셈법 일치)', await dayOpt('10').isChecked())
  // 20일도 같은 규칙인가 — 10일만 물으면 `+9`를 상수로 박아도 초록이다
  await dayOpt('20').check()
  check('①-b 20일 선택 → 종료일 +19', (await endIn.inputValue()) === addDaysISO(PERIOD_START, 20 - 1),
    `${await endIn.inputValue()} (기대 ${addDaysISO(PERIOD_START, 20 - 1)})`)
  await dayOpt('10').check()

  // ③ 종료일을 손으로 고치면 「직접 입력」으로 떨어지고 총일수가 실기간을 따른다.
  //    라디오라 **양성·음성을 함께** 묻는다 — 직접 입력이 켜지는 것만 보면 10일이 함께 켜져
  //    있어도(두 개가 checked인 모순) 초록이다.
  await endIn.fill(PERIOD_END)
  check('③ 종료일 수동 수정 → 「직접 입력」으로 떨어진다',
    (await dayOpt('manual').isChecked()) && !(await dayOpt('10').isChecked()) && !(await dayOpt('20').isChecked()),
    `manual=${await dayOpt('manual').isChecked()} 10=${await dayOpt('10').isChecked()} 20=${await dayOpt('20').isChecked()}`)

  /* 🎯 원래 지적(image-22) — 좁은 2열 칸에서 시작·종료 달력이 **세로로 접히던** 자리다.
   *   같은 줄인지는 눈이 아니라 **y 좌표**로 판정한다. 접히면 종료일 y가 시작일보다 한 줄 아래다.
   *   ⚠ ④ 칸은 미리보기와 폭을 나눠 써서 좁다. 그래서 계약은 두 층이다:
   *     ① 시작~종료는 **어떤 폭에서도** 한 줄 (이게 지적받은 것)
   *     ② 총일수 select는 앞에 서되, 폭이 모자라면 윗줄로 물러난다(둘 사이에 끼지는 않는다) */
  const [bSel, bStart, bEnd] = await Promise.all([
    daysSel.boundingBox(), startIn.boundingBox(), endIn.boundingBox(),
  ])
  // 실측 좌표를 늘 찍는다 — 「한 줄인가」는 통과/실패보다 **몇 줄로 섰는가**가 읽혀야 한다
  console.log(`     [실측] select y=${bSel?.y} x=${bSel?.x} · 시작 y=${bStart?.y} x=${bStart?.x} · 종료 y=${bEnd?.y} x=${bEnd?.x}`)
  check('시작~종료가 한 줄(접히지 않는다)',
    !!bStart && !!bEnd && Math.abs(bStart.y - bEnd.y) < 4 && bStart.x < bEnd.x,
    `시작 (${bStart?.x}, ${bStart?.y}) · 종료 (${bEnd?.x}, ${bEnd?.y})`)
  // 총일수가 **맨 앞** — 같은 줄이면 왼쪽, 아니면 윗줄. 날짜 사이에 끼면 실패다
  const selFirst = !!bSel && !!bStart
    && (Math.abs(bSel.y - bStart.y) < 4 ? bSel.x < bStart.x : bSel.y < bStart.y)
  check('총일수 라디오가 날짜칸보다 앞(같은 줄이면 왼쪽, 아니면 윗줄)', selFirst,
    `select (${bSel?.x}, ${bSel?.y}) · 시작 (${bStart?.x}, ${bStart?.y})`)
  await page.click('text=소방서 제출일')   // blur → 저장
  await panel10.locator('text=저장됨').waitFor({ timeout: 30000 })
  // 칸마다 저장이 따로 날아간다 — 마지막 칸의 왕복까지 기다린다
  let f: Record<string, string> = {}
  for (let i = 0; i < 20; i++) {
    const { data: saved } = await raw.from('annex_inputs')
      .select('fields').eq('inspection_id', inspectionId).eq('annex_no', 'report10').maybeSingle()
    f = (saved?.fields ?? {}) as Record<string, string>
    // ⚠ **마지막에 저장되는 칸**을 조건에 넣어야 한다. ④/⑤로 갈리면서 마지막이 contractor(⑤)에서
    //   totalDays(④)로 바뀌었는데 조건을 안 고쳐 저장 전 DB를 읽고 단언했다(2026-09-07).
    if (f.contractor && f.summary && f.totalPeriod === TOTAL_PERIOD && f.totalDays === TOTAL_DAYS) break
    await new Promise(r => setTimeout(r, 500))
  }
  check('DB annex_inputs 저장 — 두 차수 입력이 한 행에 병합', f.reportDate === SUBMIT_DATE && f.totalPeriod === TOTAL_PERIOD
    && f.totalDays === TOTAL_DAYS && f.summary === SUMMARY && f.contractor === 'E2E공사업체(주)', JSON.stringify(f))
  // 🚨 저장 계약 무변경 — 위젯을 바꿔도 형식은 그대로여야 한다(문서 조립·갑지 엑셀이 이 형식을 읽는다)
  check('저장 형식 무변경 — "YYYY-MM-DD ~ YYYY-MM-DD" + 숫자 문자열',
    /^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/.test(f.totalPeriod ?? '') && /^\d+$/.test(f.totalDays ?? ''),
    `${f.totalPeriod} / ${f.totalDays}`)

  // ── 3) 재진입 → 이전 ③ 입력 유지 (§4-A-2b 재생성 대응) ──
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  await goStep('submit9')
  const panel2 = page.locator('[data-annex-fields="report10"]')
  await panel2.locator('input[aria-label="제출일"]').waitFor({ timeout: 60000 })
  check('재진입 — 제출일 유지', (await panel2.locator('input[aria-label="제출일"]').inputValue()) === SUBMIT_DATE)
  check('재진입 — 총 이행기간 유지',
    (await panel2.locator('input[aria-label="총 이행기간 (수동 보정) 시작일"]').inputValue()) === PERIOD_START
    && (await panel2.locator('input[aria-label="총 이행기간 (수동 보정) 종료일"]').inputValue()) === PERIOD_END)
  await goStep('repair')
  const panel2b = page.locator('[data-annex-fields="report10"]')
  await panel2b.locator('textarea[aria-label="계획 내용 요약"]').waitFor({ timeout: 60000 })
  check('재진입 — 요약 유지', (await panel2b.locator('textarea[aria-label="계획 내용 요약"]').inputValue()) === SUMMARY)

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
  // 2026-09-07 — 「이행조치 계획사항」은 설비 구분 7행 고정이고, 칸의 문구는 8쪽 불량내용과 같은
  // fold다(action_plan이 아니라 **불량명**). 코드 없는 수기 불량이라 '기타' 구분에 실린다.
  // ⚠ 구분 라벨은 **별도 셀**이다 — 2026-09-07 육안 후속(6011144)이 `<span class="grp-label">`을
  //   `<td class="grp-label">`로 바꿨는데 이 단언이 따라오지 않아 그날부터 빨강이었다(2026-09-08 교정).
  check('미리보기 — 설비 구분 7행', ['소화설비', '경보설비', '피난구조설비', '소화용수설비', '소화활동설비', '기타', '안전시설등']
    .every(g => srcDoc.includes(`<td class="grp-label">${g}</td>`)))
  check('미리보기 — ② 불량 자동 행 유지(기타 구분)', srcDoc.includes('E2E불량-감지기 미작동'))
  // 대장에 소화기구만 설치 → 소화설비=불량 없음이라 「이상없음」, 나머지 5구분은 「해당없음」.
  // 두 문구를 **함께** 요구한다(or로 느슨하게 두면 한쪽 축이 죽어도 초록이다).
  check('미리보기 — 불량 없는 구분은 자동 문구', srcDoc.includes('이상없음') && srcDoc.includes('해당없음'),
    `이상없음=${srcDoc.includes('이상없음')} 해당없음=${srcDoc.includes('해당없음')}`)
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
