// 11-6 E2E — 다른 고객 섹션 단위 복사 (1.6 기타시설·1.11 훈련)
// 실행: npx tsx scripts/test-section-copy.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'section-copy-e2e@erp-test.com'
let userId = ''
let srcId = ''
let dstId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '복사E2E', employeeId: 'E2E-CPY' })
  srcId = await mkCustomer({ customer_name: '복사원본E2E', created_by: userId })
  dstId = await mkCustomer({ customer_name: '복사대상E2E', created_by: userId })
  // 같은 용도 건물 (같은 용도 우선 정렬 검증 겸)
  for (const cid of [srcId, dstId]) {
    await raw.from('buildings').insert({
      customer_id: cid, building_name: '본관', is_active: true, created_by: userId, purpose: '업무시설',
    })
  }
  // 원본 고객 섹션 입력
  await raw.from('fire_plan_forms').upsert({
    customer_id: srcId,
    sections: {
      etcFacility: {
        electric: { kw: '150', kva: '200', location: '지하1층 전기실', qty: '1', generator: true, generatorNote: '디젤 50kW', note: '' },
        gas: { kind: 'LPG', location: '주방', usage: '취사', regulator: true, shutoff: true, shutoffLocation: '주방 입구' },
        hazmat: { none: true, note: '' },
      },
      training: { headcount: { worker: '10', resident: '', brigade: '5' }, eduMonths: [5, 11], drillMonths: [5, 11], details: [], scenario: '', scenarioType: '', records: [] },
    },
    updated_by: userId,
  })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // 1.6 복사
  await page.goto(`${BASE}/customers/${dstId}?tab=plan&sub=ch1`)
  await page.click('button:has-text("1.6 기타시설")')
  await page.waitForSelector('button:has-text("다른 고객에서 복사")')
  check('1.6 복사 버튼 표시', true)
  await page.click('button:has-text("다른 고객에서 복사")')
  await page.waitForSelector('text=복사원본E2E')
  check('후보 목록에 원본 고객(같은 용도)', true)
  await page.click('button:has-text("복사원본E2E")')
  await page.waitForSelector('text=다른 고객에서 복사됨')
  check('복사 완료 메시지', true)
  check('화면 즉시 반영(수전 용량 150)', await page.isVisible('input[value="150"]'))
  check('화면 즉시 반영(LPG)', await page.isVisible('input[value="LPG"]'))

  const { data: dstForm } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', dstId).single()
  const s = (dstForm?.sections ?? {}) as Record<string, Record<string, unknown>>
  check('DB 저장(etcFacility)', (s.etcFacility?.electric as Record<string, string>)?.kw === '150', JSON.stringify(s.etcFacility))

  // 1.11 복사
  await page.click('button:has-text("1.11 훈련·교육")')
  await page.waitForSelector('button:has-text("다른 고객에서 복사")')
  await page.click('button:has-text("다른 고객에서 복사")')
  await page.waitForSelector('text=복사원본E2E')
  await page.click('button:has-text("복사원본E2E")')
  await page.waitForSelector('text=다른 고객에서 복사됨')
  const { data: dstForm2 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', dstId).single()
  const s2 = (dstForm2?.sections ?? {}) as Record<string, Record<string, unknown>>
  check('DB 저장(training 5·11월)', JSON.stringify(s2.training?.eduMonths) === '[5,11]', JSON.stringify(s2.training))
  check('기존 섹션 유지(etcFacility 보존)', (s2.etcFacility?.electric as Record<string, string>)?.kw === '150')

  // 11-3: 1.5 용도 기본값 원클릭 (업무시설 → 상가형)
  await page.click('button:has-text("1.5 피난·방화")')
  await page.waitForSelector('button:has-text("용도 기본값 (상가형)")')
  check('1.5 용도 기본값 버튼', true)
  await page.click('button:has-text("용도 기본값 (상가형)")')
  await page.click('button:has-text("1.5 저장")')
  await page.waitForTimeout(1500)
  const { data: dstForm3 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', dstId).single()
  const ef = ((dstForm3?.sections ?? {}) as Record<string, Record<string, unknown>>).evacFire ?? {}
  check('1.5 기본값 저장(방화구획 면적별)', ef.compartment === 'area', JSON.stringify(ef))
  check('1.5 기본값 저장(직통계단 2)', (ef.stairs as Record<string, string>)?.['직통계단'] === '2')
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const cid of [srcId, dstId]) {
    if (!cid) continue
    await raw.from('fire_plan_forms').delete().eq('customer_id', cid)
    await raw.from('buildings').delete().eq('customer_id', cid)
    await cleanupCustomer(cid)
  }
  if (userId) await delUser(userId)
}
summary()
