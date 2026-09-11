// 소방계획서_7 H-28 — 점검 상세 여정 스텝퍼 통합 E2E
// 실행: npx tsx scripts/test-h28-journey-stepper.mts   (로컬 dev + 스테이징 DB)
// 검증: 스텝퍼 렌더 · 완료 단계 접힘 · 첫 미완료 자동 펼침 · 다음 할 일 배너 ·
//       단계 완료 처리(회귀) · ⑤ 전/후 갤러리(전 사진 세팅→쌍 카드) · 별지 4호 생성 버튼 · 정기 건 1단계.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'h28-stepper-e2e@erp-test.com'
let userId = ''
let custA = ''  // 자체점검 (plan_type null)
let custB = ''  // 정기(monthly)
let inspA = ''
let inspB = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const STEP_DEFS = [
  { step_num: 1, name_ko: '점검일',                                days: 0 },
  { step_num: 2, name_ko: '배치확인서 보고서 작성',                days: 7 },
  { step_num: 3, name_ko: '관계인 보고서 제출',                    days: 14 },
  { step_num: 4, name_ko: '소방서 보고서 제출 및 이행계획서 등록', days: 21 },
  { step_num: 5, name_ko: '소방보수 완료',                        days: 28 },
  { step_num: 6, name_ko: '이행완료보고서 제출',                  days: 35 },
]

async function seedSteps(inspectionId: string, startDate: string, completedThrough: number) {
  // inspection_steps는 점검 생성 시 트리거로 자동 생성됨 — 상태·마감일만 갱신
  const { data: existing } = await raw.from('inspection_steps')
    .select('step_num').eq('inspection_id', inspectionId)
  if (!existing || existing.length === 0) {
    // 트리거가 없으면 직접 생성
    const rows = STEP_DEFS.map(def => {
      const d = new Date(startDate + 'T12:00:00'); d.setDate(d.getDate() + def.days)
      return { inspection_id: inspectionId, step_num: def.step_num, name_ko: def.name_ko, due_date: d.toISOString().split('T')[0] }
    })
    const { error } = await raw.from('inspection_steps').insert(rows)
    if (error) throw new Error(`step seed 실패: ${error.message}`)
  }
  for (const def of STEP_DEFS) {
    const d = new Date(startDate + 'T12:00:00'); d.setDate(d.getDate() + def.days)
    const done = def.step_num <= completedThrough
    await raw.from('inspection_steps').update({
      due_date: d.toISOString().split('T')[0],
      status: done ? 'completed' : 'pending',
      completed_at: done ? new Date().toISOString() : null,
    }).eq('inspection_id', inspectionId).eq('step_num', def.step_num)
  }
}

try {
  userId = await mkUser({ email: EMAIL, name: 'H28스텝퍼', employeeId: 'E2E-H28' })
  custA = await mkCustomer({ customer_name: 'H28자체점검', created_by: userId })
  custB = await mkCustomer({ customer_name: 'H28정기', created_by: userId })

  // 자체점검 — 종료 12일 전(④ 15일 기한 = D+3). ①만 완료 → 첫 미완료 = ② cert
  const { data: iA, error: eA } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-12), inspection_end_date: kstShift(-12),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`자체점검 생성 실패: ${eA.message}`)
  inspA = iA!.id
  await seedSteps(inspA, kstShift(-12), 1)  // ① 완료, ②~⑥ 미완료
  // ① 점검표 응답 세팅 → done1=true (여정 스텝퍼 접힘 판정은 업무 완료 플래그 기준)
  await raw.from('inspection_sheet_responses').insert([
    { inspection_id: inspA, item_code: 'A-01', result: 'O', updated_by: userId },
    { inspection_id: inspA, item_code: 'A-02', result: 'O', updated_by: userId },
  ])

  // 정기(monthly) — 타임라인 ① 하나
  const { data: iB, error: eB } = await raw.from('inspections').insert({
    customer_id: custB, inspection_type: '작동', sequence_num: 1, plan_type: 'monthly',
    inspection_start_date: kstShift(0), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eB) throw new Error(`정기점검 생성 실패: ${eB.message}`)
  inspB = iB!.id

  /* 🚨 선재 결함 교정(2026-09-11) — 이 픽스처엔 **불량이 0건**이었다. 소방계획서_48(`3365092`)이
     「불량 0건이면 ④⑤⑥을 전 표시 표면에서 감춘다」를 넣은 뒤로, 아래 ④ 단언(:96)과 ④ D-day
     단언(:110)이 **그 커밋 때부터 계속 빨강**이었다(이 파일이 함께 갱신되지 않았다).
     이 테스트가 보려는 것은 「스텝바가 6단계를 그리는가」이지 「불량 0건의 감춤 규칙」이 아니므로,
     ④가 보이는 전제를 픽스처에서 만든다 — 단언을 지우면 6단계 축이 통째로 눈먼다.
     ⚠ 아래 §3이 넣는 `H28불량`과 **다른 행**이다(그건 ⑤ 전/후 사진 축이라 사진 URL이 붙는다). */
  await raw.from('inspection_defects').insert({
    inspection_id: inspA, defect_name: 'H28전제불량(④⑤⑥ 표시 전제)', severity: '보통',
    action_end: kstShift(10),
  })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) 자체점검 작업대 스텝바 렌더 ──
  const stepbar = page.locator('[data-testid="workbench-stepbar"]')
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  check('작업대 스텝바 렌더', true)
  check('① 점검표 행', await page.isVisible('text=① 점검표'))
  check('② 점검인력 배치신고 행', await page.isVisible('text=② 점검인력 배치신고'))
  check('③ 관계인 보고·협의 행(§4-E-1 문구)', await page.isVisible('text=③ 관계인 보고·협의'))
  check('④ 소방서 제출 행', await page.isVisible('text=④ 소방서 제출'))

  // 2열 카드(InspectionDetailClient/ReportsClient) 제거 확인 — 자체점검은 작업대로 흡수
  check('구 6단계 체크리스트 카드 제거', !(await page.isVisible('text=업무 체크리스트')))
  check('구 단계별 보고서 2열 카드 제거', !(await page.isVisible('h2:has-text("단계별 보고서")')))

  // 진입 화면 = 첫 미완료 단계(② 배치신고). 종전 '다음 할 일 배너'를 자리로 대체(R6-1).
  // 2026-09-07 — 업로드 폐지로 '업로드 필요' 문구가 사라지고 완료 체크가 그 자리를 대신한다
  check('② 자동 선택(첫 미완료)', await page.getByTestId('cert-reported-toggle').count() > 0)
  // ① 완료 표기는 스텝바에 남는다 — 접힘/펼침이 아니라 상태 칩이다
  check('① 완료 표기(스텝바)',
    (await stepbar.locator('button[data-step="checklist"]').innerText()).includes('완료'),
    await stepbar.locator('button[data-step="checklist"]').innerText())
  check('④ 단계 마감 D-day 뱃지 표시',
    /D-\d+|초과/.test(await stepbar.locator('button[data-step="submit9"]').innerText()),
    await stepbar.locator('button[data-step="submit9"]').innerText())

  // 예외 완료(사유 필수)는 선택 단계에만 하나 — 증거가 생기면 자동 완료가 기본 경로다
  const completeButtons = await page.locator('button:has-text("사유 완료")').count()
  check('예외 완료 버튼 = 1개(선택 단계만)', completeButtons === 1, `count=${completeButtons}`)

  // ① 클릭 → 점검표 칸으로 전환
  // 🚨 2026-09-11 — ①이 2칸이 됐다(셋째 칸 「점검 인력·생성물」 제거: 참여자는 ②, 별지 4호는 ④ 칩,
  //    생성물은 ④·첫째 칸이 이미 들고 있었다). 종전엔 그 칸 제목 하나로 전환을 판정했는데,
  //    지금은 **남은 두 칸을 둘 다** 물어야 「①이 온전히 떴는가」가 된다.
  await stepbar.locator('button[data-step="checklist"]').click()
  await page.waitForSelector('text=점검표 입력')
  check('① 클릭 → 점검표 칸 전환(2칸 모두)',
    (await page.isVisible('text=점검표 입력')) && (await page.isVisible('text=/불량 내역/')))
  check('🚨 ① 셋째 칸(점검 인력·생성물)은 없어졌다', !(await page.isVisible('text=점검 인력·생성물')))

  // ── 2) 단계 완료 처리(회귀) — ② 예외 완료 → DB status ──
  await stepbar.locator('button[data-step="cert"]').click()
  await page.waitForSelector('text=점검인력 배치신고')
  page.once('dialog', d => d.accept('E2E 예외 완료 사유'))
  await page.locator('button:has-text("사유 완료")').first().click()
  await page.waitForSelector('text=사유와 함께 완료 처리했습니다', { timeout: 30000 })
  const { data: step2 } = await raw.from('inspection_steps')
    .select('status').eq('inspection_id', inspA).eq('step_num', 2).single()
  check('② 단계 완료 처리 → DB completed', step2?.status === 'completed', JSON.stringify(step2))

  // ── 3) ⑤ 불량 표 전/후 사진 칸 — 불량 1건(전 사진 세팅) ──
  await raw.from('inspection_defects').insert({
    inspection_id: inspA, defect_name: 'H28불량', severity: '보통',
    photo_url: 'https://example.com/before.jpg', action_end: kstShift(10),
  })
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=⑤ 보수·증빙')
  await stepbar.locator('button[data-step="repair"]').click()
  await page.waitForSelector('[data-testid="defect-grid"]')
  check('⑤ 전/후 사진 쌍 진행률 문구', await page.isVisible('text=/\\d+\\/\\d+쌍 완료/'))
  check('⑤ 불량 행(불량명)', await page.isVisible('text=H28불량'))
  check('⑤ 후 사진 슬롯(전 사진 있음→후 대기)', await page.isVisible('button[aria-label="후 사진 추가"]'))
  check('⑥ 이행완료 행', await page.isVisible('text=⑥ 이행완료'))

  /* ── 4) 별지 4호 생성 — 자리가 ①에서 ④ 칩으로 옮겨졌다(2026-09-11) ──
     종전 ① 칸의 [별지 4호 생성]은 **만들어봐야 내용을 아는** 버튼이었다. ④ 칩은 고르면 3칸이
     그 문서의 미리보기로 바뀌고 거기서 만든다(상위호환) — 그래서 ①의 버튼을 없앴다.
     🚨 「없어졌다」만 단언하면 기능이 통째로 사라져도 초록이다. **새 자리에서 실제로 만들 수
        있는가**를 함께 묻는다. */
  await stepbar.locator('button[data-step="checklist"]').click()
  await page.waitForSelector('text=점검표 입력')
  check('🚨 ①에는 [별지 4호 생성] 버튼이 없다', !(await page.isVisible('button:has-text("별지 4호 생성")')))
  await stepbar.locator('button[data-step="submit9"]').click()
  await page.waitForSelector('[data-doc-chip="report4"]', { timeout: 30000 })
  await page.click('[data-doc-chip="report4"]')
  await page.waitForSelector('[data-testid="annex-generate"]', { timeout: 30000 })
  check('🎯 별지 4호는 ④ 칩에서 만든다(새 자리가 살아 있다)',
    await page.isVisible('[data-testid="annex-generate"]'))

  // ── 5) 정기 건 = 스텝바 ① 하나 ──
  await page.goto(`${BASE}/inspections/${inspB}`)
  await page.waitForSelector('text=외관점검표 (일반용)')
  check('정기 — 외관점검표 섹션', true)
  check('정기 — 6단계 미노출(④ 소방서 제출 없음)', !(await page.isVisible('text=④ 소방서 제출')))
  // R5-2에서 월간 건의 2열 체크리스트(InspectionDetailClient)를 없애고 단계 표현을 작업대 하나로 모았다
  check('정기 — 2열 체크리스트 제거(작업대로 단일화)', !(await page.isVisible('text=업무 체크리스트')))
  check('정기 — 스텝바 ① 하나',
    (await page.locator('[data-testid="workbench-stepbar"] button').count()) === 1)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const cid of [custA, custB]) {
    if (!cid) continue
    const { data: allInsps } = await raw.from('inspections').select('id').eq('customer_id', cid)
    for (const i of (allInsps ?? []) as Array<{ id: string }>) {
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
      await raw.from('inspection_reports').delete().eq('inspection_id', i.id)
    }
    await cleanupCustomer(cid)
  }
  if (userId) await delUser(userId)
}
summary()
