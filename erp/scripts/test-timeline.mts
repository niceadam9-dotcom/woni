// §9-9 문서 타임라인 E2E — 단계 구성·업로드 슬롯·제출일 기록·패키지·15일 기한 크론
// 소방계획서_21 R6에서 세로 아코디언이 가로 스텝바 + 3칸 작업대로 바뀌었다.
// 검증하는 행동은 그대로이고 셀렉터만 작업대 기준으로 옮겼다(단계 이동은 스텝바 클릭).
// 실행: npx tsx scripts/test-timeline.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const EMAIL = 'timeline2-e2e@erp-test.com'
let userId = ''
let custA = ''  // 특별점검 (plan_type null)
let custB = ''  // 정기(monthly)
let inspA = ''
let inspB = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const tmpPdf = join(tmpdir(), 'e2e-cert.pdf')

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '타임라인E2E', employeeId: 'E2E-TML' })
  // 아래 3)이 이 고객에 2차 점검을 만든다 — 153 트리거는 **종합 대상 고객만** 2차를 허용하므로
  // 픽스처도 종합 대상이어야 한다 (mkCustomer 기본값은 작동/작동, 소방계획서_33 S5-3)
  custA = await mkCustomer({ customer_name: '타임라인E2E특별', created_by: userId,
    inspection_type: '종합', inspection_sub_type: '종합' })
  custB = await mkCustomer({ customer_name: '타임라인E2E정기', created_by: userId })
  // 특별점검 — 종료 = 12일 전 → 보고기한 = D+3 (크론 D-3 규칙 대상)
  const { data: iA, error: eA } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-12), inspection_end_date: kstShift(-12),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`특별점검 생성 실패: ${eA.message}`)
  inspA = iA!.id
  // 정기 — plan_type monthly
  const { data: iB, error: eB } = await raw.from('inspections').insert({
    customer_id: custB, inspection_type: '작동', sequence_num: 1, plan_type: 'monthly',
    inspection_start_date: kstShift(0), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eB) throw new Error(`정기점검 생성 실패: ${eB.message}`)
  inspB = iB!.id

  writeFileSync(tmpPdf, '%PDF-1.4 e2e cert dummy')

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) 자체점검 — 스텝바 ①~⑥ 상시 표시 (D-4: 불량 없음 → ⑤⑥ 해당없음 흐림) ──
  const stepbar = page.locator('[data-testid="workbench-stepbar"]')
  const goStep = async (step: string) => { await stepbar.locator(`button[data-step="${step}"]`).click() }

  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  check('작업대 렌더(자체점검)', true)
  check('① 점검표 행', await page.isVisible('text=① 점검표'))
  check('② 점검인력 배치확인서 행(용어 통일)', await page.isVisible('text=② 점검인력 배치확인서'))
  check('③ 관계인 보고·협의 행(§4-E-1 용어)', await page.isVisible('text=③ 관계인 보고·협의'))
  check('④ 소방서 제출 행 + D-3 뱃지', await page.isVisible('text=D-3'))
  check('⑤⑥ 상시 표시 — 해당없음 흐림(불량 0건)', await page.isVisible('text=해당없음 — 불량 0건'))
  check('진행률 헤더(해당없음 분모 제외 = 0/4)', await page.isVisible('text=0/4 단계 완료'))

  await goStep('submit9')
  await page.waitForSelector('text=제출 전제')
  check('④ 전제 체크 흡수(§9-6⑦)', (await page.locator('text=/^[✓⚠] /').count()) > 0)

  await goStep('ownerReport')
  await page.waitForSelector('text=수신 정보')
  check('③ 발송 버튼 비활성(송달 동의 없음)', await page.locator('button:has-text("생성물 이메일 발송")').isDisabled())

  // ② 배치확인서 업로드 (② 칸의 파일 input)
  await goStep('cert')
  await page.waitForSelector('text=배치확인서 업로드')
  await page.locator('input[type="file"]').first().setInputFiles(tmpPdf)
  await page.waitForSelector('text=배치확인서 업로드됨')
  check('② 업로드 완료 메시지', true)
  const { data: objs } = await raw.storage.from('fire-plans').list(`${custA}/inspections/${inspA}`)
  check('② storage cert_ 파일', (objs ?? []).some((o: { name: string }) => /^cert_\d+\.pdf$/.test(o.name)))

  // ④ 제출 패키지 (cert만 존재 — 포함/누락 안내)
  await goStep('submit9')
  await page.waitForSelector('button:has-text("제출 패키지")')
  await page.click('button:has-text("제출 패키지")')
  await page.waitForSelector('text=패키지 다운로드')
  check('④ 패키지 생성(포함: 배치확인서)', await page.isVisible('text=배치확인서'))

  // ④ 제출일 기록 → 뱃지 소멸 + DB
  const submitPane = page.locator('section:has-text("별지 9·10호 생성·제출")').first()
  await submitPane.locator('input[placeholder="YYYY-MM-DD"]').first().fill(kstShift(0))
  await submitPane.locator('button:has-text("기록")').first().click()
  // ⚠ 앱 문구는 `✅ 제출일 {날짜} 기록됨`(inspection-workbench.tsx:272)이다. 종전 단언 '제출 기록됨'은
  //    de0c670(2026-08-14)에서 문구가 바뀐 뒤 따라오지 않아 **어떤 상태에서도 매치될 수 없었다**
  //    (리포지토리에 '제출 기록'이라는 문자열 자체가 없다). 날짜가 끼므로 부분 문구로 잡는다.
  await page.waitForSelector('text=/제출일 .* 기록됨/')
  const { data: subA } = await raw.from('inspections').select('report9_submitted_at').eq('id', inspA).single()
  check('④ DB report9_submitted_at', subA?.report9_submitted_at === kstShift(0), JSON.stringify(subA))
  // 스텝바 ④가 완료로 바뀐다 — 15일 보고기한 D-3 배지는 소멸
  await stepbar.locator('button[data-step="submit9"] >> text=/완료/').waitFor({ timeout: 30000 })
  check('④ 보고기한 배지 소멸(제출 완료)', !(await page.isVisible('text=/기한 초과|D-3 ⚠/')))

  // 불량 추가 → ⑤⑥ 표시
  await raw.from('inspection_defects').insert({
    inspection_id: inspA, defect_name: '타임라인E2E불량', severity: '보통', action_end: kstShift(10),
  })
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=⑤ 보수·증빙')
  check('⑤⑥ 활성(불량 발생)', await page.isVisible('text=⑥ 이행완료 (별지 11호)'))
  check('⑤⑥ 해당없음 문구 소멸', !(await page.isVisible('text=해당없음 — 불량 0건')))
  check('진행률 분모 확장(2/6 단계 완료 — cert·제출 완료 반영)', await page.isVisible('text=2/6 단계 완료'))
  // ⑥ 기한 = 이행기간 종료일 → 스텝바 D-day로 표시
  check('⑥ 기한 = 이행기간 종료일(D-10)',
    (await stepbar.locator('button[data-step="submit11"]').innerText()).includes('D-10'),
    await stepbar.locator('button[data-step="submit11"]').innerText())

  await goStep('repair')
  await page.waitForSelector('[data-testid="defect-grid"]')
  check('⑤ 전/후 사진 쌍 진행률(H-28)', await page.isVisible('text=/0\\/1쌍 완료/'))
  check('⑤ 선택 증빙 표기(R10-a)', await page.isVisible('text=(사진·계약서는 선택)'))

  // ⑤ 계약서 업로드 — ⑤ 칸에는 hwp 허용 input이 계약서 하나뿐이다(② cert 칸은 다른 단계)
  await page.waitForSelector('button:has-text("계약서 업로드")')
  await page.locator('input[type="file"][accept*="hwp"]').last().setInputFiles(tmpPdf)
  await page.waitForSelector('text=계약서 업로드됨')
  const { data: objs2 } = await raw.storage.from('fire-plans').list(`${custA}/inspections/${inspA}`)
  check('⑤ storage contract_ 파일', (objs2 ?? []).some((o: { name: string }) => /^contract_\d+\.pdf$/.test(o.name)))

  // ── 2) 정기(monthly) — ① 하나만 + 외관점검표 체계 ──
  await page.goto(`${BASE}/inspections/${inspB}`)
  await page.waitForSelector('text=외관점검표 (일반용)')
  check('정기 — 외관점검표 섹션 표시(§9-9a)', true)
  check('정기 — EXT 시트 목록', await page.isVisible('button:has-text("소화기구 및 자동소화장치")'))
  check('정기 — 별지 9호 타임라인 미노출', !(await page.isVisible('text=④ 소방서 제출')))

  // ── 3) 크론 — 별지 9호 15일 기한 (D-3 대상 = 제출일 기록 전 상태 필요 → 새 점검 건) ──
  // 2차는 작동점검이다 (소방계획서_33 D33-1) — 종전 '종합'은 새 규약과 모순된다
  const { data: iC } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 2,
    inspection_start_date: kstShift(-12), inspection_end_date: kstShift(-12),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  const inspC = iC!.id
  const secret = (readFileSync('F:/AI/ERP/erp/.env.local', 'utf8').match(/^CRON_SECRET=(.+)$/m)?.[1] ?? '').trim()
  const res = await fetch(`${BASE}/api/cron/defect-action-notify`, { headers: { Authorization: `Bearer ${secret}` } }).then(r => r.json())
  check('크론 응답 ok', res.ok === true, JSON.stringify(res))
  const { data: notis } = await raw.from('notifications')
    .select('type, title').eq('reference_id', inspC).eq('type', 'report_submit_due')
  check('크론 — 별지9호 D-3 알림 발송', (notis ?? []).length > 0, JSON.stringify(notis))
  const { data: notisA } = await raw.from('notifications')
    .select('id').eq('reference_id', inspA).eq('type', 'report_submit_due')
  check('크론 — 제출일 기록 건은 제외(소멸)', (notisA ?? []).length === 0)
  // 멱등
  const res2 = await fetch(`${BASE}/api/cron/defect-action-notify`, { headers: { Authorization: `Bearer ${secret}` } }).then(r => r.json())
  check('크론 재발화 ok', res2.ok === true)
  const { data: notis2 } = await raw.from('notifications').select('id').eq('reference_id', inspC).eq('type', 'report_submit_due')
  check('크론 멱등(중복 없음)', (notis2 ?? []).length === (notis ?? []).length)

  await raw.from('notifications').delete().eq('reference_id', inspC)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  try { unlinkSync(tmpPdf) } catch { /* ignore */ }
  for (const [cid, iid] of [[custA, inspA], [custB, inspB]] as Array<[string, string]>) {
    if (!cid) continue
    // 해당 고객의 모든 점검 건 부속 정리 (inspection_reports 등 FK — cleanupCustomer가 못 지우는 것 포함)
    const { data: allInsps } = await raw.from('inspections').select('id').eq('customer_id', cid)
    for (const i of (allInsps ?? []) as Array<{ id: string }>) {
      await raw.from('notifications').delete().eq('reference_id', i.id)
      await raw.from('report_deliveries').delete().eq('inspection_id', i.id)
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
      await raw.from('inspection_sheet_responses').delete().eq('inspection_id', i.id)
      await raw.from('inspection_reports').delete().eq('inspection_id', i.id)
      await raw.from('inspection_participants').delete().eq('inspection_id', i.id)
      const { data: files } = await raw.storage.from('fire-plans').list(`${cid}/inspections/${i.id}`)
      const paths = ((files ?? []) as Array<{ name: string }>).map(o => `${cid}/inspections/${i.id}/${o.name}`)
      if (paths.length) await raw.storage.from('fire-plans').remove(paths)
    }
    await cleanupCustomer(cid)
  }
  if (userId) await delUser(userId)
}
summary()
