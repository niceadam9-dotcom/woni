// Tier 2 게이트 정합성 매트릭스 — 점검 유형 × 보고서 어포던스가 UI·데이터에서 일치하는지.
// 자체점검(특별)=별지 9호 / 일반관리·정기(monthly)=외관점검표. UI가 그리는 것과 데이터 게이트가 어긋나지 않음을 검증.
// 실행: (dev 또는 prod build 기동 후) npx tsx scripts/test-gate-consistency.mts
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'gate-consistency-e2e@erp-test.com'
let userId = ''
const custIds: string[] = []
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const kst = (days: number) => new Date(Date.now() + 9 * 3600_000 + days * 86400_000).toISOString().split('T')[0]

async function mkInsp(name: string, inspection_type: string, plan_type: string | null, sub: string | null) {
  const cid = await mkCustomer({ customer_name: name, created_by: userId, inspection_type, inspection_sub_type: sub,
    inspection_category: inspection_type === '일반관리' ? '일반관리' : '소방안전관리' })
  custIds.push(cid)
  const { data, error } = await raw.from('inspections').insert({
    customer_id: cid, inspection_type, sequence_num: 1, plan_type,
    inspection_start_date: kst(-5), inspection_end_date: kst(-5),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`${name} 점검 생성 실패: ${error.message}`)
  return data!.id as string
}

try {
  userId = await mkUser({ email: EMAIL, name: '게이트정합', employeeId: 'E2E-GC', role: 'admin' })
  const inspSpecial = await mkInsp('게이트E2E자체점검', '작동', null, '작동')      // 특별 → 별지 9호
  const inspGeneral = await mkInsp('게이트E2E일반관리', '일반관리', null, null)     // 일반 → 외관
  const inspMonthly = await mkInsp('게이트E2E정기', '작동', 'monthly', '작동')      // 정기 → 외관(비자체)

  const l = await launch(); browser = l.browser; const page = l.page
  page.setDefaultTimeout(20000)
  await login(page, EMAIL)

  // 특별점검: 별지 9호 생성 어포던스 O, 외관점검표 아님
  await page.goto(`${BASE}/inspections/${inspSpecial}`)
  await page.waitForSelector('text=문서 타임라인')
  check('특별점검 → 별지 9호 생성 어포던스 노출', await page.isVisible('text=별지 9호 생성'))

  // 일반관리: 외관점검표 O, 별지 9호 생성 X
  await page.goto(`${BASE}/inspections/${inspGeneral}`)
  await page.waitForSelector('h1, h2')
  await page.waitForTimeout(800)
  check('일반관리 → 외관점검표 노출', await page.isVisible('text=외관점검표'))
  check('일반관리 → 별지 9호 생성 미노출(게이트)', !(await page.isVisible('text=별지 9호 생성')))

  // 정기(monthly): 비자체점검 → 별지 9호 생성 미노출
  await page.goto(`${BASE}/inspections/${inspMonthly}`)
  await page.waitForSelector('h1, h2')
  await page.waitForTimeout(800)
  check('정기(monthly) → 별지 9호 생성 미노출(게이트)', !(await page.isVisible('text=별지 9호 생성')))

  // 데이터 게이트: 일반/정기 점검엔 report9 생성잡이 생기지 않는지(가드) — 직접 job 없음 확인
  for (const [label, id] of [['일반관리', inspGeneral], ['정기', inspMonthly]] as const) {
    const { data: jobs } = await raw.from('fire_plan_gen_jobs').select('id').eq('inspection_id', id).in('report_type', ['report9', 'report10', 'report11'])
    check(`${label} → 별지 9/10/11호 잡 없음(데이터 게이트)`, (jobs ?? []).length === 0)
  }

  summary()
} catch (e) {
  console.error('❌ 예외:', (e as Error).message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  for (const c of custIds) await cleanupCustomer(c)
  const { raw: r } = await import('./_e2e-helpers.mjs')
  await r.from('profiles').delete().eq('id', userId)
  await r.auth.admin.deleteUser(userId).catch(() => {})
}
