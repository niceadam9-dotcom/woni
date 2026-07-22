// 7-3b(최초 임포트 배너) + 11-5(누락 칩 딥링크) E2E
// 실행: npx tsx scripts/test-import-deeplink.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'import-e2e@erp-test.com'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '임포트E2E', employeeId: 'E2E-IMP' })
  custId = await mkCustomer({ customer_name: '임포트E2E고객', created_by: userId })

  // 구 웹 생성분 흔적 — generated_ pdf 행 + .form.json (수기 편집값 포함)
  const stamp = 1700000000000
  const pdfPath = `${custId}/2026/generated_${stamp}.pdf`
  const formJson = {
    zones: [{ zone: '1층', name: '사무실', area: '100', weekday: '5', holiday: '1', managerCo: '자체', contact: '010-1111-2222' }],
    hazards: [{ place: '보일러실', location: '지하1층', factors: ['전기적 요인'] }],
    evacRoutes: [{ floor: '전층', route: '중앙계단', guide: '홍길동', equip: '유도등' }],
    assembly: '정문 앞 공터',
    evacNote: 'E2E 피난 절차',
    revisionDate: '2026-01-10',
    revisionNote: 'E2E 최초 작성',
  }
  await raw.storage.from('fire-plans').upload(pdfPath, Buffer.from('%PDF-1.4 dummy'), { contentType: 'application/pdf' })
  await raw.storage.from('fire-plans').upload(pdfPath.replace(/\.pdf$/, '.form.json'),
    Buffer.from(JSON.stringify(formJson)), { contentType: 'application/json' })
  const { error: pErr } = await raw.from('fire_plans').insert({
    customer_id: custId, year: 2026, title: '2026년 소방계획서', revision: 1,
    pdf_name: '2026년 소방계획서.pdf', pdf_path: pdfPath, pdf_status: 'ready', uploaded_by: userId,
  })
  if (pErr) throw new Error(`계획서 행 생성 실패: ${pErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 7-3b 임포트 배너 ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForSelector('text=서식 입력으로 가져올 수 있습니다')
  check('임포트 배너 표시(최초 진입)', true)
  await page.click('button:has-text("가져오기")')
  await page.waitForSelector('text=이전 생성 데이터에서 가져왔습니다')
  check('가져오기 완료 메시지', true)

  const { data: form } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', custId).single()
  const s = (form?.sections ?? {}) as Record<string, unknown>
  const zones = (s.zones ?? []) as Array<Record<string, string>>
  check('zones 역매핑(workersWeekday)', zones[0]?.workersWeekday === '5' && zones[0]?.company === '자체', JSON.stringify(zones))
  const hazards = (s.hazards ?? []) as Array<Record<string, unknown>>
  check('hazards 역매핑(loc/risks)', hazards[0]?.loc === '지하1층' && Array.isArray(hazards[0]?.risks))
  const evac = (s.evacPlan ?? {}) as Record<string, unknown>
  check('evacPlan 역매핑(assembly)', evac.assembly === '정문 앞 공터')
  const rev = (s.revision ?? {}) as Record<string, string>
  check('revision 역매핑', rev.revisionNote === 'E2E 최초 작성')

  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForSelector('text=필수 완성도')
  check('배너 재노출 없음(1회 원칙)', !(await page.isVisible('text=서식 입력으로 가져올 수 있습니다')))

  // ── 11-5 누락 칩 딥링크 ──
  await page.waitForSelector('button:has-text("높이 ↗")')
  check('누락 칩 = 클릭 가능 버튼', true)
  await page.click('button:has-text("높이 ↗")')
  await page.waitForURL(u => u.searchParams.get('tab') === 'buildings')
  check('건물값 칩 → 건물·시설 탭 이동', true)

  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForSelector('button:has-text("수신기위치 ↗")')
  await page.click('button:has-text("수신기위치 ↗")')
  await page.waitForSelector('text=1.1 일반현황')
  check('1.1 필드 칩 → 서식 전체 1.1 전환', !(await page.isVisible('text=필수 완성도')))

  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForSelector('button:has-text("자위소방대 ↗")')
  await page.click('button:has-text("자위소방대 ↗")')
  await page.waitForTimeout(500)
  check('자위소방대 칩 → 2장 전환', (await page.locator('text=자위소방대').count()) > 0 && !(await page.isVisible('text=필수 완성도')))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) {
    const { data: objs } = await raw.storage.from('fire-plans').list(`${custId}/2026`)
    const paths = ((objs ?? []) as Array<{ name: string }>).map(o => `${custId}/2026/${o.name}`)
    if (paths.length) await raw.storage.from('fire-plans').remove(paths)
    await raw.from('fire_plans').delete().eq('customer_id', custId)
    await raw.from('fire_plan_forms').delete().eq('customer_id', custId)
    await cleanupCustomer(custId)
  }
  if (userId) await delUser(userId)
}
summary()
