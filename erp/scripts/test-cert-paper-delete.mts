// ② 점검인력 배치신고 — 완료 표시 E2E (2026-09-07 개편: 업로드 표면 폐지)
//
// 대표가 협회에서 직접 신고하고 확인서도 직접 보관하므로 ERP는 파일을 받지 않는다.
// 종전 이 스위트는 [종이 보관 기록]·[업로드]·[삭제]를 고정했는데 그 표면이 전부 없어졌다 —
// 같은 **의도**(파일 없이도 ②가 완료되고, 되돌릴 수 있고, 근거가 24개월 뒤 사라지지 않는다)를
// 새 경로로 다시 고정한다.
//
// 고정하는 것:
//  · 체크 한 번으로 ②가 완료된다 — [사유 완료](예외 경로)를 쓰지 않는다
//  · 기록한 신고일이 화면에 그대로 보인다
//  · 해제하면 ②가 **다시 미완료**로 돌아간다(append-only라 철회 마커로 덮는다)
//  · 미래 날짜는 서버가 거부한다(하지 않은 일이 완료로 굳지 않게)
//  · 완료 표시가 **누락 경고에서도 빠진다** — 화면만 초록이고 보고서 센터가 독촉하면 안 된다
//  · 로그 보존 크론이 판정 근거 마커(+철회 마커)를 지우지 않는다
//  · 과거 업로드본이 있는 회차는 그대로 완료 유지(퇴행 금지)
//
// 실행: npx tsx scripts/test-cert-paper-delete.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'cert-paper-e2e@erp-test.com'
let userId = ''
let custId = ''
let cust2Id = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const STEP_DEFS = [
  { step_num: 1, name_ko: '자체점검', days: 0 },
  { step_num: 2, name_ko: '배치확인서 보고서 작성', days: 7 },
  { step_num: 3, name_ko: '관계인 보고서 제출', days: 14 },
  { step_num: 4, name_ko: '소방서 보고서 제출 및 이행계획서 등록', days: 21 },
  { step_num: 5, name_ko: '소방보수 완료', days: 28 },
  { step_num: 6, name_ko: '이행완료보고서 제출', days: 35 },
]

async function seedSteps(id: string, anchor: string) {
  const { data: ex } = await raw.from('inspection_steps').select('step_num').eq('inspection_id', id)
  if (ex && ex.length > 0) return
  await raw.from('inspection_steps').insert(STEP_DEFS.map(d => {
    const dt = new Date(anchor + 'T12:00:00'); dt.setDate(dt.getDate() + d.days)
    return { inspection_id: id, step_num: d.step_num, name_ko: d.name_ko, due_date: dt.toISOString().split('T')[0] }
  }))
}
async function step2Of(id: string): Promise<string> {
  const { data } = await raw.from('inspection_steps')
    .select('status').eq('inspection_id', id).eq('step_num', 2).single()
  return (data as { status: string } | null)?.status ?? '(없음)'
}
const step2Status = () => step2Of(inspId)

try {
  userId = await mkUser({ email: EMAIL, name: '배치신고E2E', employeeId: 'E2E-CPD' })
  custId = await mkCustomer({ customer_name: '배치신고E2E고객', created_by: userId })

  const { data: ins } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id
  await seedSteps(inspId, kstShift(-1))

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  /** ② 칸 열기 — 스텝바 라벨이 「배치신고」로 바뀌었다(doc-requirements DOC_TERMS) */
  const gotoCert = async () => {
    await page.goto(`${BASE}/inspections/${inspId}`)
    await page.waitForLoadState('networkidle')
    const tab = page.getByRole('button', { name: /배치신고/ }).first()
    if (await tab.count() > 0) await tab.click()
    await page.waitForTimeout(600)
  }

  console.log('\n[1] 초기 — ②는 미완료, 체크는 꺼져 있고 업로드 표면은 **없다**')
  await gotoCert()
  check('1-1 ② 초기 미완료', (await step2Status()) !== 'completed', await step2Status())
  const toggle = page.getByTestId('cert-reported-toggle').locator('input')
  check('1-2 완료 체크박스 노출', await toggle.count() > 0)
  check('1-3 초기엔 체크 해제 상태', (await toggle.isChecked()) === false)
  check('1-4 신고일 입력칸 노출', await page.getByTestId('cert-reported-date-input').count() > 0)
  // ★ 폐지 확인 — 이게 이번 개편의 요구사항 그 자체다
  check('★1-5 [업로드] 없음', await page.locator('button:has-text("업로드")').count() === 0)
  check('★1-6 [신고 정보 복사] 없음', await page.locator('button:has-text("신고 정보 복사")').count() === 0)
  check('★1-7 [종이 보관 기록] 없음', await page.getByTestId('cert-paper-open').count() === 0)
  check('★1-8 [삭제] 없음', await page.getByTestId('cert-delete').count() === 0)
  check('★1-9 협회 안내 링크는 남아 있다(사용자 유지 결정)',
    await page.locator('a[href*="kfma.kr"]').count() > 0)

  console.log('\n[2] 체크 한 번으로 ②가 완료된다 (사유 완료 없이)')
  const theDate = kstShift(-1)
  await page.getByTestId('cert-reported-date-input').fill(theDate)
  await toggle.check()
  await page.waitForTimeout(1800)
  check('2-1 ② 완료로 전환', (await step2Status()) === 'completed', await step2Status())

  const { data: marks } = await raw.from('activity_logs')
    .select('action, metadata').eq('entity_id', inspId).eq('action', 'cert_reported')
  check('2-2 신고 완료 마커 기록', (marks ?? []).length === 1, `${(marks ?? []).length}건`)
  const meta = (marks?.[0] as { metadata: Record<string, unknown> } | undefined)?.metadata
  check('2-3 신고일 저장', String(meta?.date ?? '') === theDate, `${String(meta?.date)} (기대 ${theDate})`)
  const { data: forced } = await raw.from('activity_logs')
    .select('id').eq('entity_id', inspId).eq('action', 'step_force_complete')
  check('2-4 사유 완료(예외 경로)는 쓰지 않았다', (forced ?? []).length === 0)

  console.log('\n[3] 기록한 신고일이 화면에 보인다')
  await gotoCert()
  check('3-1 체크가 켜진 상태로 복원', (await page.getByTestId('cert-reported-toggle').locator('input').isChecked()) === true)
  check('3-2 신고일 표시', ((await page.getByTestId('cert-reported-date').textContent()) ?? '').includes(theDate),
    (await page.getByTestId('cert-reported-date').textContent()) ?? '')

  console.log('\n[4] ★ 누락 경고에서도 빠진다 — 화면만 초록이면 반쪽이다')
  await raw.from('inspections').update({ status: 'completed', inspection_end_date: kstShift(-1) }).eq('id', inspId)
  const { findMissingCerts } = await import('../src/lib/doc-status')
  const missing = await findMissingCerts(raw, { sinceDays: 30, limit: 100 })
  check('★4-1 신고 완료 회차는 배치신고 누락 목록에 없다',
    !missing.some((m: { inspectionId: string }) => m.inspectionId === inspId),
    `${missing.length}건 중 포함 여부`)

  console.log('\n[5] 해제하면 ②가 다시 미완료로 돌아간다')
  await raw.from('inspections').update({ status: 'in_progress' }).eq('id', inspId)
  await gotoCert()
  page.once('dialog', d => d.accept())
  await page.getByTestId('cert-reported-toggle').locator('input').uncheck()
  await page.waitForTimeout(1800)
  check('5-1 ② 미완료로 복귀', (await step2Status()) !== 'completed', await step2Status())
  const { data: undo } = await raw.from('activity_logs')
    .select('id').eq('entity_id', inspId).eq('action', 'cert_reported_undo')
  check('5-2 철회 마커가 덧붙는다(append-only)', (undo ?? []).length === 1, `${(undo ?? []).length}건`)
  await raw.from('inspections').update({ status: 'completed', inspection_end_date: kstShift(-1) }).eq('id', inspId)
  const missing2 = await findMissingCerts(raw, { sinceDays: 30, limit: 100 })
  check('5-3 철회하면 누락 목록에 **다시** 뜬다(덮개가 걷힌다)',
    missing2.some((m: { inspectionId: string }) => m.inspectionId === inspId))
  await raw.from('inspections').update({ status: 'in_progress' }).eq('id', inspId)

  console.log('\n[6] 미래 날짜는 서버가 거부한다')
  // ⚠ 서버 액션 모듈('use server')은 스크립트에서 import할 수 없다(server-only 사슬) — UI로 넣고
  //    화면에 뜨는 거부 메시지로 판정한다. 가드는 서버에 있고 여기선 그 발화만 본다.
  await gotoCert()
  await page.getByTestId('cert-reported-date-input').fill(kstShift(3))
  await page.getByTestId('cert-reported-toggle').locator('input').check()
  await page.waitForTimeout(1500)
  check('6-1 미래 날짜 거부 메시지', await page.getByText(/아직 오지 않은 날짜/).count() > 0)
  check('6-2 ②는 여전히 미완료', (await step2Status()) !== 'completed', await step2Status())

  console.log('\n[7] 과거 업로드본이 있는 회차는 완료가 유지된다 (퇴행 금지)')
  cust2Id = await mkCustomer({ customer_name: '배치신고E2E고객2', created_by: userId })
  const { data: ins2, error: ins2Err } = await raw.from('inspections').insert({
    customer_id: cust2Id, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (ins2Err || !ins2) throw new Error(`2차 점검 생성 실패: ${ins2Err?.message}`)
  const insp2 = ins2.id
  await seedSteps(insp2, kstShift(-1))
  // 업로드 창구가 없어졌으므로 **스토리지에 직접** 심는다 — 과거 데이터 재현이 목적이다
  const up = await raw.storage.from('fire-plans')
    .upload(`${cust2Id}/inspections/${insp2}/cert_1700000000000.pdf`,
      Buffer.from('%PDF-1.4 legacy'), { contentType: 'application/pdf', upsert: true })
  check('7-1 과거 파일 심기 성공', !up.error, up.error?.message ?? '')
  // 단계 재판정을 태운다 — 화면 진입이 syncSteps를 부른다
  await page.goto(`${BASE}/inspections/${insp2}`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)
  check('★7-2 파일이 있으면 ②는 완료 유지', (await step2Of(insp2)) === 'completed', await step2Of(insp2))
  const tab2 = page.getByRole('button', { name: /배치신고/ }).first()
  if (await tab2.count() > 0) await tab2.click()
  await page.waitForTimeout(600)
  check('7-3 과거 업로드본 안내 노출', await page.getByTestId('cert-legacy-note').count() > 0)

  await raw.storage.from('fire-plans').remove([`${cust2Id}/inspections/${insp2}/cert_1700000000000.pdf`])
  await raw.from('inspection_steps').delete().eq('inspection_id', insp2)
  await raw.from('inspections').delete().eq('id', insp2)

  console.log('\n[8] 로그 보존 크론이 판정 근거 마커를 지키는가 (24개월 함정)')
  await raw.from('activity_logs').update({ created_at: '2020-01-01T00:00:00Z' })
    .eq('entity_id', inspId).in('action', ['cert_reported', 'cert_reported_undo'])
  const secret = process.env.CRON_SECRET
    ?? (await import('fs')).readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split('\n').find((l: string) => l.startsWith('CRON_SECRET='))?.split('=')[1]?.trim()
  const res = await fetch(`${BASE}/api/cron/purge-activity-logs?dry_run=1`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  const body = await res.json() as Record<string, unknown>
  const sampled = JSON.stringify(body)
  check('8-1 크론 응답 정상', res.status === 200, `${res.status} ${sampled.slice(0, 120)}`)
  check('8-2 신고 완료 마커는 만료 대상이 아니다', !sampled.includes('cert_reported'), sampled.slice(0, 200))
} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 400))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('activity_logs').delete().eq('entity_id', inspId)
    await raw.from('inspection_steps').delete().eq('inspection_id', inspId)
    await raw.from('inspections').delete().eq('id', inspId)
  }
  if (custId) await cleanupCustomer(custId)
  if (cust2Id) await cleanupCustomer(cust2Id)
  if (userId) await delUser(userId)
  summary()
}
