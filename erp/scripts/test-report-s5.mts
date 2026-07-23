// 소방계획서_5 S5 E2E — P-1 연차 일괄 발행 마법사 + P-2 주간 문서 브리핑 크론 (P-3는 워커 — Python 검증으로 갈음)
// 실행: npx tsx scripts/test-report-s5.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import { readFileSync } from 'fs'

const EMAIL = 'report-s5-e2e@erp-test.com'
let userId = ''
let custA = ''
let inspA = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const NAME_A = '보고서S5자체점검'

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '보고서S5E2E', employeeId: 'E2E-S5' })
  custA = await mkCustomer({ customer_name: NAME_A, created_by: userId, inspection_type: '작동', inspection_sub_type: '작동' })
  const { data: iA, error: eA } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-12), inspection_end_date: kstShift(-12),
    status: 'completed', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`점검 생성 실패: ${eA.message}`)
  inspA = iA!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── P-1 연차 일괄 발행 마법사 ──
  await page.goto(`${BASE}/reports?form=annual`)
  await page.waitForSelector('h2:has-text("연차 일괄 발행")')
  check('P-1 마법사 렌더', true)
  await page.waitForSelector('text=대상 고객')
  check('P-1 대상 집계 표시(대상 고객)', await page.isVisible('text=대상 고객'))
  check('P-1 미발행 집계 표시', await page.isVisible('text=미발행'))
  check('P-1 발행 연도 선택', await page.isVisible('select'))
  check('P-1 일괄 발행 버튼', await page.isVisible('button:has-text("일괄 발행")') || await page.isVisible('button:has-text("미발행 없음")'))

  // ── P-2 주간 문서 브리핑 크론 ──
  const secret = (readFileSync('F:/AI/ERP/erp/.env.local', 'utf8').match(/^CRON_SECRET=(.+)$/m)?.[1] ?? '').trim()
  const res = await fetch(`${BASE}/api/cron/weekly-doc-briefing`, { headers: { Authorization: `Bearer ${secret}` } }).then(r => r.json())
  check('P-2 크론 응답 ok', res.ok === true, JSON.stringify(res))
  check('P-2 요약 집계 필드', res.summary && typeof res.summary.weekDone === 'number' && typeof res.summary.missingCerts === 'number', JSON.stringify(res.summary))
  check('P-2 알림 발송 수 필드', typeof res.notified === 'number')
  // 인증 가드
  const bad = await fetch(`${BASE}/api/cron/weekly-doc-briefing`, { headers: { Authorization: 'Bearer WRONG' } })
  check('P-2 인증 가드(401)', bad.status === 401)

  // 브리핑 알림 정리
  await raw.from('notifications').delete().eq('type', 'weekly_doc_briefing').gte('created_at', `${kstShift(0)}T00:00:00+09:00`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custA) {
    const { data: allInsps } = await raw.from('inspections').select('id').eq('customer_id', custA)
    for (const i of (allInsps ?? []) as Array<{ id: string }>) {
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
      await raw.from('fire_plan_gen_jobs').delete().eq('inspection_id', i.id)
    }
    await cleanupCustomer(custA)
  }
  if (userId) await delUser(userId)
}
summary()
