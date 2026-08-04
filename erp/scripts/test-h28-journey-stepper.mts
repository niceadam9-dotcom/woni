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

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) 자체점검 여정 스텝퍼 렌더 ──
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=문서 타임라인')
  check('타임라인(여정 스텝퍼) 렌더', true)
  check('① 점검표 행', await page.isVisible('text=① 점검표'))
  check('② 점검인력 배치확인서 행', await page.isVisible('text=② 점검인력 배치확인서'))
  check('③ 관계인 보고·협의 행(§4-E-1 문구)', await page.isVisible('text=③ 관계인 보고·협의'))
  check('④ 소방서 제출 행', await page.isVisible('text=④ 소방서 제출'))

  // 2열 카드(InspectionDetailClient/ReportsClient) 제거 확인 — 자체점검은 스텝퍼로 흡수
  check('구 6단계 체크리스트 카드 제거', !(await page.isVisible('text=업무 체크리스트')))
  check('구 단계별 보고서 2열 카드 제거', !(await page.isVisible('h2:has-text("단계별 보고서")')))

  // 다음 할 일 배너 = ② 배치확인서 (①만 완료)
  check('다음 할 일 배너', await page.isVisible('text=다음 할 일:'))
  const banner = await page.locator('div:has-text("다음 할 일:")').first().innerText()
  check('배너가 ② 배치확인서 지시', banner.includes('배치확인서'), banner)

  // 완료 단계(①) 접힘 — 상세 문구("응답 없음"/"응답 N건")는 접힌 상태라 숨김
  check('① 완료 단계 접힘(상세 숨김)', !(await page.isVisible('text=위 점검표 입력에서 작성해주세요')))
  check('① 완료일 요약 표시', await page.isVisible('text=/완료 \\d{4}-\\d{2}-\\d{2}/'))

  // 첫 미완료(②) 자동 펼침 — 배치확인서 업로드 안내 노출
  check('② 자동 펼침(업로드 안내 노출)', await page.isVisible('text=협회 발급본 업로드 필요'))

  // 단계 마감 D-day 뱃지 (스텝 due_date 흡수)
  check('단계 마감 D-day 뱃지 표시', await page.isVisible('text=/단계 마감/'))

  // 단계 완료 버튼 = 첫 미완료(②)에만
  const completeButtons = await page.locator('button:has-text("단계 완료")').count()
  check('단계 완료 버튼 = 1개(첫 미완료만)', completeButtons === 1, `count=${completeButtons}`)

  // ① 클릭 시 펼침 (접힌 완료 단계 토글) — 응답 있음이라 "응답 N건 입력됨" 노출
  await page.locator('button:has-text("① 점검표")').first().click()
  await page.waitForTimeout(300)
  check('① 클릭 → 상세 펼침', await page.isVisible('text=/응답 \\d+건 입력됨/'))

  // ── 2) 단계 완료 처리(회귀) — ② 완료 → DB status ──
  await page.locator('button:has-text("단계 완료")').first().click()
  await page.waitForSelector('text=단계를 완료 처리했습니다', { timeout: 15000 })
  const { data: step2 } = await raw.from('inspection_steps')
    .select('status').eq('inspection_id', inspA).eq('step_num', 2).single()
  check('② 단계 완료 처리 → DB completed', step2?.status === 'completed', JSON.stringify(step2))

  // ── 3) ⑤ 전/후 갤러리 — 불량 1건(전 사진 세팅) → 쌍 카드 ──
  await raw.from('inspection_defects').insert({
    inspection_id: inspA, defect_name: 'H28불량', severity: '보통',
    photo_url: 'https://example.com/before.jpg', action_end: kstShift(10),
  })
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=⑤ 보수·증빙')
  // ⑤는 미완료(불량 조치 전)이라 자동 펼침 상태 — 클릭하면 오히려 접히므로 그대로 검증
  check('⑤ 전/후 갤러리 진행률 문구', await page.isVisible('text=/전\\/후 사진 \\d+\\/\\d+쌍 완료/'))
  check('⑤ 불량 쌍 카드(불량명)', await page.isVisible('text=H28불량'))
  check('⑤ 후 사진 추가 슬롯(전 사진 있음→후 대기)', await page.isVisible('text=후 사진 추가'))
  check('⑥ 이행완료 행', await page.isVisible('text=⑥ 이행완료'))

  // ── 4) 별지 4호 생성 버튼(① 펼침부) — ①는 완료→접힘, 클릭해 펼침 ──
  await page.locator('button:has-text("① 점검표")').first().click()
  await page.waitForTimeout(300)
  check('별지 4호 생성 버튼', await page.isVisible('button:has-text("별지 4호 생성")'))

  // ── 5) 정기 건 = 타임라인 ① 하나(스텝퍼 미노출) ──
  await page.goto(`${BASE}/inspections/${inspB}`)
  await page.waitForSelector('text=외관점검표 (일반용)')
  check('정기 — 외관점검표 섹션', true)
  check('정기 — 6단계 스텝퍼 미노출(④ 소방서 제출 없음)', !(await page.isVisible('text=④ 소방서 제출')))
  check('정기 — 현행 2열 유지(업무 체크리스트 카드 존재)', await page.isVisible('text=업무 체크리스트'))
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
