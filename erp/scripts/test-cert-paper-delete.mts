// ② 배치확인서 — 종이 보관 기록(제안1) + 업로드 파일 삭제(제안2) E2E
// 실행: npx tsx scripts/test-cert-paper-delete.mts   (로컬 dev + 스테이징 DB)
//
// 고정하는 것:
//  · 종이로만 받은 경우 [사유 완료](예외 경로)를 쓰지 않고도 ②가 완료된다 — 마커가 증거다
//  · 기록한 수령일·보관 위치가 화면에 그대로 보인다
//  · 업로드 → 완료, **삭제 → 다시 미완료** (업로드 경로와 대칭 — 지웠는데 완료로 남으면 안 된다)
//  · 로그 보존 크론이 판정 근거 마커를 지우지 않는다(24개월 뒤 완료가 되살아나던 함정)
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

/** ② 단계의 DB 상태 */
async function step2Status(): Promise<string> {
  const { data } = await raw.from('inspection_steps')
    .select('status').eq('inspection_id', inspId).eq('step_num', 2).single()
  return (data as { status: string } | null)?.status ?? '(없음)'
}

try {
  userId = await mkUser({ email: EMAIL, name: '배치확인서E2E', employeeId: 'E2E-CPD' })
  custId = await mkCustomer({ customer_name: '배치확인서E2E고객', created_by: userId })

  const { data: ins } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id

  const { data: exSteps } = await raw.from('inspection_steps').select('step_num').eq('inspection_id', inspId)
  if (!exSteps || exSteps.length === 0) {
    await raw.from('inspection_steps').insert(STEP_DEFS.map((d: { step_num: number; name_ko: string; days: number }) => {
      const dt = new Date(kstShift(-1) + 'T12:00:00'); dt.setDate(dt.getDate() + d.days)
      return { inspection_id: inspId, step_num: d.step_num, name_ko: d.name_ko, due_date: dt.toISOString().split('T')[0] }
    }))
  }

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  const gotoCert = async () => {
    await page.goto(`${BASE}/inspections/${inspId}`)
    await page.waitForLoadState('networkidle')
    // ② 단계 선택 — 작업대 스텝바에서 배치확인서 단계를 연다
    const tab = page.getByRole('button', { name: /배치확인서/ }).first()
    if (await tab.count() > 0) await tab.click()
    await page.waitForTimeout(600)
  }

  console.log('\n[1] 초기 상태 — ②는 미완료, 종이 기록 버튼이 보인다')
  await gotoCert()
  check('1-1 ② 초기 미완료', (await step2Status()) !== 'completed', await step2Status())
  const paperOpenBtn = page.getByTestId('cert-paper-open')
  check('1-2 [종이 보관 기록] 버튼 노출', await paperOpenBtn.count() > 0)
  check('1-3 업로드 전이라 [삭제] 없음', await page.getByTestId('cert-delete').count() === 0)

  console.log('\n[2] 제안1 — 종이 보관 기록으로 ②가 완료된다 (사유 완료 없이)')
  await paperOpenBtn.click()
  await page.getByTestId('cert-paper-location').fill('사무실 캐비닛 A')
  await page.getByTestId('cert-paper-save').click()
  await page.waitForTimeout(1500)
  check('2-1 ② 완료로 전환', (await step2Status()) === 'completed', await step2Status())

  const { data: marks } = await raw.from('activity_logs')
    .select('action, metadata').eq('entity_id', inspId).eq('action', 'cert_paper_archived')
  check('2-2 종이 보관 마커 기록', (marks ?? []).length === 1, `${(marks ?? []).length}건`)
  const meta = (marks?.[0] as { metadata: Record<string, unknown> } | undefined)?.metadata
  check('2-3 보관 위치 저장', String(meta?.location ?? '') === '사무실 캐비닛 A', String(meta?.location))
  check('2-4 사유 완료 마커는 쓰지 않았다', await (async () => {
    const { data } = await raw.from('activity_logs')
      .select('id').eq('entity_id', inspId).eq('action', 'step_force_complete')
    return (data ?? []).length === 0
  })())

  console.log('\n[3] 기록한 내용이 화면에 보인다')
  await gotoCert()
  const paperText = await page.getByText(/종이 보관 중/).count()
  check('3-1 "종이 보관 중" 표시', paperText > 0)
  check('3-2 보관 위치 표시', await page.getByText(/사무실 캐비닛 A/).count() > 0)

  console.log('\n[4] 제안2 — 업로드 후 삭제하면 ②가 다시 미완료로 돌아간다')
  // 업로드 (파일 선택기 대신 input에 직접 주입)
  await page.setInputFiles('input[type="file"][accept*=".pdf"]', {
    name: 'cert-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test'),
  })
  await page.waitForTimeout(2000)
  await gotoCert()
  check('4-1 업로드 후 [삭제] 노출', await page.getByTestId('cert-delete').count() > 0)

  page.once('dialog', d => d.accept())          // confirm 수락
  await page.getByTestId('cert-delete').click()
  await page.waitForTimeout(2500)

  const { data: files } = await raw.storage.from('fire-plans').list(`${custId}/inspections/${inspId}`)
  const certLeft = (files ?? []).filter((f: { name: string }) => /^cert_\d+\./i.test(f.name)).length
  check('4-2 스토리지에서 파일 제거', certLeft === 0, `남은 ${certLeft}건`)

  // ⚠ 이 회차엔 종이 보관 마커가 아직 남아 있으므로 ②는 완료 유지가 **정답**이다
  check('4-3 종이 기록이 남아 있어 ②는 완료 유지', (await step2Status()) === 'completed', await step2Status())

  console.log('\n[5] 종이 기록이 없는 회차는 삭제 시 미완료로 되돌아간다')
  // 같은 고객·같은 해에 특별점검을 또 만들면 UNIQUE에 걸린다 — 별도 고객으로 분리
  cust2Id = await mkCustomer({ customer_name: '배치확인서E2E고객2', created_by: userId })
  const { data: ins2, error: ins2Err } = await raw.from('inspections').insert({
    customer_id: cust2Id, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (ins2Err || !ins2) throw new Error(`2차 점검 생성 실패: ${ins2Err?.message}`)
  const insp2 = ins2.id
  const { data: ex2 } = await raw.from('inspection_steps').select('step_num').eq('inspection_id', insp2)
  if (!ex2 || ex2.length === 0) {
    await raw.from('inspection_steps').insert(STEP_DEFS.map((d: { step_num: number; name_ko: string; days: number }) => {
      const dt = new Date(kstShift(-1) + 'T12:00:00'); dt.setDate(dt.getDate() + d.days)
      return { inspection_id: insp2, step_num: d.step_num, name_ko: d.name_ko, due_date: dt.toISOString().split('T')[0] }
    }))
  }
  await page.goto(`${BASE}/inspections/${insp2}`)
  await page.waitForLoadState('networkidle')
  const tab2 = page.getByRole('button', { name: /배치확인서/ }).first()
  if (await tab2.count() > 0) await tab2.click()
  await page.waitForTimeout(500)
  await page.setInputFiles('input[type="file"][accept*=".pdf"]', {
    name: 'cert-test2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test2'),
  })
  await page.waitForTimeout(2500)
  const st2After = await raw.from('inspection_steps')
    .select('status').eq('inspection_id', insp2).eq('step_num', 2).single()
  check('5-1 업로드로 ② 완료', (st2After.data as { status: string } | null)?.status === 'completed',
    String((st2After.data as { status: string } | null)?.status))

  await page.reload(); await page.waitForLoadState('networkidle')
  const tab2b = page.getByRole('button', { name: /배치확인서/ }).first()
  if (await tab2b.count() > 0) await tab2b.click()
  await page.waitForTimeout(500)
  page.once('dialog', d => d.accept())
  await page.getByTestId('cert-delete').click()
  await page.waitForTimeout(2500)
  const st2Del = await raw.from('inspection_steps')
    .select('status').eq('inspection_id', insp2).eq('step_num', 2).single()
  check('5-2 삭제 후 ② 미완료로 복귀', (st2Del.data as { status: string } | null)?.status !== 'completed',
    String((st2Del.data as { status: string } | null)?.status))

  await raw.from('inspection_steps').delete().eq('inspection_id', insp2)
  await raw.from('inspections').delete().eq('id', insp2)

  console.log('\n[6] 로그 보존 크론이 판정 근거 마커를 지키는가 (24개월 함정)')
  // 마커를 아주 오래된 것으로 위조해 dry-run 대상에 들어가는지 본다
  await raw.from('activity_logs').update({ created_at: '2020-01-01T00:00:00Z' })
    .eq('entity_id', inspId).eq('action', 'cert_paper_archived')
  const secret = process.env.CRON_SECRET
    ?? (await import('fs')).readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split('\n').find((l: string) => l.startsWith('CRON_SECRET='))?.split('=')[1]?.trim()
  const res = await fetch(`${BASE}/api/cron/purge-activity-logs?dry_run=1`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  const body = await res.json() as { ok?: boolean; sample?: Array<{ action: string }>; archived?: number; error?: string }
  const sampled = JSON.stringify(body)
  check('6-1 크론 응답 정상', res.status === 200, `${res.status} ${sampled.slice(0, 120)}`)
  check('6-2 종이 보관 마커는 만료 대상이 아니다', !sampled.includes('cert_paper_archived'),
    sampled.slice(0, 200))

} catch (e) {
  check(`예외: ${(e as Error).message}`, false)
  console.log((e as Error).stack)
} finally {
  if (browser) await browser.close()
  try {
    await raw.from('activity_logs').delete().eq('entity_id', inspId)
    await raw.from('inspection_steps').delete().eq('inspection_id', inspId)
    await raw.from('inspections').delete().eq('id', inspId)
    if (custId) await cleanupCustomer(custId)
    if (cust2Id) await cleanupCustomer(cust2Id)
    if (userId) await delUser(userId)
  } catch (e) {
    console.log(`  (정리 경고: ${(e as Error).message})`)
  }
  summary()
}
