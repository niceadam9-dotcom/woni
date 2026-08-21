// Tier 2 게이트 정합성 매트릭스 — 점검 유형 × 보고서 어포던스가 UI·데이터에서 일치하는지.
// 판정 축 = plan_type (소방계획서_6 W-4·W-22): 자체점검(special_*·null)=별지 9호 — 일반관리 자체점검 포함 /
// 정기(monthly)·레거시 event=외관점검표. UI가 그리는 것과 데이터 게이트가 어긋나지 않음을 검증.
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
  const inspSpecial    = await mkInsp('게이트E2E자체점검', '작동', null, '작동')                // 소방 자체 → 별지 9호
  const inspGenSpecial = await mkInsp('게이트E2E일반자체', '일반관리', 'special_작동', '작동')   // 일반 자체 → 별지 9호 (W-22 반전)
  const inspGenEvent   = await mkInsp('게이트E2E일반레거시', '일반관리', 'event', '작동')        // 레거시 event → 외관
  const inspMonthly    = await mkInsp('게이트E2E정기', '작동', 'monthly', '작동')               // 정기 → 외관(비자체)

  const l = await launch(); browser = l.browser; const page = l.page
  page.setDefaultTimeout(20000)
  await login(page, EMAIL)

  // 자체점검(소방·일반 공통): 별지 9호 생성 어포던스 O — 일반관리 자체점검도 동일 (W-22 반전)
  for (const [label, id] of [['소방 자체점검', inspSpecial], ['일반관리 자체점검', inspGenSpecial]] as const) {
    await page.goto(`${BASE}/inspections/${id}`)
    await page.waitForSelector('[data-testid="workbench-stepbar"]')
    // 별지 9호 생성은 작업대 ④ 칸에 있다(R6-2). 어포던스는 2026-08-20(d538280)부터 **문서 칩**이다 —
    // 전용 [별지 9호 생성] 버튼은 폐지되고 '칩으로 고르고 → [PDF 생성]'으로 바뀌었다.
    await page.click('[data-testid="workbench-stepbar"] button[data-step="submit9"]')
    await page.waitForSelector('text=제출 전제')
    check(`${label} → 별지 9호 생성 어포던스 노출`, await page.isVisible('[data-doc-chip="report9"]'))
    check(`${label} → 외관점검표 미노출`, !(await page.isVisible('text=외관점검 (별지 6호)')))
  }

  // 레거시 event(읽기 보존 경로): 외관점검표 O, 별지 9호 생성 X
  await page.goto(`${BASE}/inspections/${inspGenEvent}`)
  await page.waitForSelector('h1, h2')
  await page.waitForTimeout(800)
  check('레거시 event → 외관점검표 노출', await page.isVisible('text=외관점검표'))
  check('레거시 event → 별지 9호 생성 미노출(게이트)', !(await page.isVisible('[data-doc-chip="report9"]')))

  // 정기(monthly): 비자체점검 → 별지 9호 생성 미노출
  await page.goto(`${BASE}/inspections/${inspMonthly}`)
  await page.waitForSelector('h1, h2')
  await page.waitForTimeout(800)
  check('정기(monthly) → 별지 9호 생성 미노출(게이트)', !(await page.isVisible('[data-doc-chip="report9"]')))

  // 보고 절차 게이트 — R5-2·R6에서 '단계별 보고서' 2열 카드를 걷어내고 작업대 스텝바로 단일화했다.
  // 자체점검(소방·일반) = 6단계 / 레거시 event·정기 = ① 하나 + '보고 의무 없음' 안내
  for (const [label, id] of [['소방 자체점검', inspSpecial], ['일반관리 자체점검', inspGenSpecial]] as const) {
    await page.goto(`${BASE}/inspections/${id}`)
    await page.waitForSelector('[data-testid="workbench-stepbar"]')
    const n = await page.locator('[data-testid="workbench-stepbar"] button').count()
    check(`${label} → 보고 절차 6단계 표시`, n === 6 && !(await page.isVisible('text=보고 의무 없음')), `${n}단계`)
  }
  for (const [label, id] of [['레거시 event', inspGenEvent], ['정기(monthly)', inspMonthly]] as const) {
    await page.goto(`${BASE}/inspections/${id}`)
    await page.waitForSelector('[data-testid="workbench-stepbar"]')
    const n = await page.locator('[data-testid="workbench-stepbar"] button').count()
    check(`${label} → 보고 절차 비노출(안내 대체)`, n === 1 && await page.isVisible('text=보고 의무 없음'), `${n}단계`)
  }

  // 데이터 게이트: 비자체점검(레거시 event·정기)엔 report9 생성잡이 생기지 않는지 — 직접 job 없음 확인
  for (const [label, id] of [['레거시 event', inspGenEvent], ['정기', inspMonthly]] as const) {
    const { data: jobs } = await raw.from('fire_plan_gen_jobs').select('id').eq('inspection_id', id).in('report_type', ['report9', 'report10', 'report11'])
    check(`${label} → 별지 9/10/11호 잡 없음(데이터 게이트)`, (jobs ?? []).length === 0)
  }

  // 트리거 111 정합: 일반관리 자체점검 = 6단계 / 레거시 event = 1단계
  {
    const { data: s1 } = await raw.from('inspection_steps').select('id').eq('inspection_id', inspGenSpecial)
    check('일반관리 자체점검 → 6단계 생성(트리거 111)', (s1 ?? []).length === 6)
    const { data: s2 } = await raw.from('inspection_steps').select('id').eq('inspection_id', inspGenEvent)
    check('레거시 event → 1단계 생성(트리거 111)', (s2 ?? []).length === 1)
  }

} catch (e) {
  console.error('❌ 예외:', (e as Error).message)
  process.exitCode = 1
} finally {
  // summary()는 process.exit을 부른다 — try 안에서 부르면 이 정리가 통째로 건너뛰어져
  // 다음 실행이 "이미 등록된 이메일"로 죽는다. 정리 후 마지막에 부른다.
  if (browser) await browser.close()
  for (const c of custIds) await cleanupCustomer(c)
  const { raw: r } = await import('./_e2e-helpers.mjs')
  await r.from('profiles').delete().eq('id', userId)
  await r.auth.admin.deleteUser(userId).catch(() => {})
  summary()
}
