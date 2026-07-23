// §9-9 문서 타임라인 E2E — 단계 구성·업로드 슬롯·제출일 기록·패키지·15일 기한 크론
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
  custA = await mkCustomer({ customer_name: '타임라인E2E특별', created_by: userId })
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

  // ── 1) 특별점검 — 타임라인 ①~④ (불량 없음 → ⑤⑥ 숨김) ──
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=문서 타임라인')
  check('타임라인 렌더(특별)', true)
  check('① 점검표 행', await page.isVisible('text=① 점검표'))
  check('② 배치확인서 행', await page.isVisible('text=② 배치확인서'))
  check('③ 관계인 보고 행', await page.isVisible('text=③ 관계인 보고'))
  check('④ 소방서 제출 행 + D-3 뱃지', await page.isVisible('text=D-3'))
  check('⑤⑥ 숨김(불량 없음)', !(await page.isVisible('text=⑤ 보수·증빙')))
  check('④ 전제 체크 흡수(§9-6⑦)', await page.isVisible('text=└ 전제:'))
  check('③ 발송 버튼 비활성(송달 동의 없음)', await page.locator('button:has-text("생성물 이메일 발송")').isDisabled())

  // ② 배치확인서 업로드 (타임라인 카드 내 첫 파일 input)
  const timeline = page.locator('div:has(> div > h2:has-text("문서 타임라인"))').first()
  await timeline.locator('input[type="file"]').first().setInputFiles(tmpPdf)
  await page.waitForSelector('text=배치확인서 업로드됨')
  check('② 업로드 완료 메시지', true)
  const { data: objs } = await raw.storage.from('fire-plans').list(`${custA}/inspections/${inspA}`)
  check('② storage cert_ 파일', (objs ?? []).some((o: { name: string }) => /^cert_\d+\.pdf$/.test(o.name)))

  // ④ 제출 패키지 (cert만 존재 — 포함/누락 안내)
  await page.click('button:has-text("제출 패키지")')
  await page.waitForSelector('text=패키지 다운로드')
  check('④ 패키지 생성(포함: 배치확인서)', await page.isVisible('text=배치확인서'))

  // ④ 제출일 기록 → 뱃지 소멸 + DB (타임라인 카드 내 첫 DateInput)
  await timeline.locator('input[placeholder="YYYY-MM-DD"]').first().fill(kstShift(0))
  await timeline.locator('button:has-text("제출일 기록")').first().click()
  await page.waitForSelector('text=제출일이 기록됐습니다')
  const { data: subA } = await raw.from('inspections').select('report9_submitted_at').eq('id', inspA).single()
  check('④ DB report9_submitted_at', subA?.report9_submitted_at === kstShift(0), JSON.stringify(subA))
  await page.waitForSelector(`text=제출 ${kstShift(0)}`)
  check('④ D-day → 제출 표시 전환', !(await page.isVisible('text=D-3')))

  // 불량 추가 → ⑤⑥ 표시
  await raw.from('inspection_defects').insert({
    inspection_id: inspA, defect_name: '타임라인E2E불량', severity: '보통', action_end: kstShift(10),
  })
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=⑤ 보수·증빙')
  check('⑤⑥ 표시(불량 발생)', await page.isVisible('text=⑥ 이행완료 (11호)'))
  check('⑤ 전후 사진 카운트', await page.isVisible('text=전후 사진 0/1쌍'))
  check('⑥ 기한 = 이행기간 종료일', await page.isVisible(`text=기한 ${kstShift(10)}`))

  // ⑤ 계약서 업로드 (타임라인 카드 내 두 번째 파일 input)
  const timeline2 = page.locator('div:has(> div > h2:has-text("문서 타임라인"))').first()
  await timeline2.locator('input[type="file"]').nth(1).setInputFiles(tmpPdf)
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
  const { data: iC } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '종합', sequence_num: 2,
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
