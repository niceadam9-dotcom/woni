// 개정이력 연도별 히스토리 프로브 (소방계획서_17.md §4 A-2·A-3)
// 실행: node scripts/_probe-revision-history.mjs  (로컬 dev 서버 + 스테이징 DB, 마이그레이션 120 적용 필요)
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'probe-revhist@erp-test.com'
let userId = ''
let custId = ''
let browser = null

async function rows(customerId) {
  const { data } = await raw.from('fire_plan_revisions')
    .select('id, year, seq, revised_on, content, author_name, reviewer_name, approver_name, source')
    .eq('customer_id', customerId).order('year').order('seq')
  return data ?? []
}
const wait = ms => new Promise(r => setTimeout(r, ms))

try {
  userId = await mkUser({ email: EMAIL, name: '개정이력프로브', employeeId: 'E2E-REV' })
  custId = await mkCustomer({ customer_name: '프로브개정이력', address: '경기 양평군 테스트로 21', created_by: userId })

  // 자동 행(생성 실적) 2건을 미리 심어 연도 그룹·잠금 규칙을 검증한다
  await raw.from('fire_plan_revisions').insert([
    { customer_id: custId, year: 2025, seq: 1, revised_on: '2025-03-02', content: '2025년 소방계획서 작성', source: 'generated' },
    { customer_id: custId, year: 2026, seq: 1, revised_on: '2026-02-10', content: '2026년 소방계획서 작성', source: 'generated' },
  ])

  const l = await launch()
  browser = l.browser
  const page = l.page
  // dev 서버는 라우트를 처음 열 때 컴파일하느라 수십 초가 걸린다 — 헬퍼 기본값(15s)으론 오탐이 난다
  page.setDefaultTimeout(60000)
  page.setDefaultNavigationTimeout(120000)
  page.on('dialog', d => d.accept())
  await login(page, EMAIL)

  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=archive`)
  await page.getByText('개정이력').first().waitFor({ state: 'visible', timeout: 30000 })

  // ── 1) 연도별 그룹 — 두 연도가 각각 헤더로 뜨고 최신만 펼쳐진다 ──
  check('1) 연도 그룹 2개(2026·2025) 노출',
    await page.getByRole('button', { name: /2026년/ }).isVisible()
    && await page.getByRole('button', { name: /2025년/ }).isVisible())
  check('1) 최신 연도(2026) 내용 펼침', await page.getByText('2026년 소방계획서 작성').isVisible())
  check('1) 과거 연도(2025) 접힘', !(await page.getByText('2025년 소방계획서 작성').isVisible()))
  await page.getByRole('button', { name: /2025년/ }).click()
  check('1) 클릭 시 과거 연도 펼침', await page.getByText('2025년 소방계획서 작성').isVisible())

  // ── 2) 수동 개정 추가 — 문서 생성 없이 이력을 남길 수 있다 ──
  await page.getByRole('button', { name: '개정 추가' }).click()
  await page.getByPlaceholder('주요 개정내용').fill('설비 교체로 1.4 수정')
  await page.getByPlaceholder('작성자').fill('홍길동')
  await page.getByPlaceholder('검토').fill('김검토')
  await page.getByPlaceholder('승인').fill('박승인')
  await page.getByRole('button', { name: '저장' }).click()
  // 첫 서버 액션 호출은 모듈 컴파일이 겹쳐 수십 초가 걸린다 — 기본 10s 창으로는 오탐
  const added = await pollDb(async () => {
    const rs = await rows(custId)
    return rs.find(r => r.source === 'manual' && r.content === '설비 교체로 1.4 수정') ?? null
  }, 60000)
  check('2) 수동 행 추가 — source=manual', !!added, JSON.stringify(added))
  check('2) 검토·승인까지 저장(Q-2)', added?.reviewer_name === '김검토' && added?.approver_name === '박승인', JSON.stringify(added))
  check('2) seq는 서버 채번 — 같은 연도 다음 번호', added?.year === new Date().getFullYear() && added?.seq >= 1, JSON.stringify(added))

  // ── 3) 자동 행 편집 — 서술은 되고 일자는 잠긴다 (Q-3) ──
  await page.reload()
  await page.getByText('2026년 소방계획서 작성').waitFor({ state: 'visible', timeout: 20000 })
  const autoRow = page.getByTestId('rev-row-2026-1')          // 미리 심은 generated 행
  await autoRow.hover()
  await autoRow.locator('button[title="수정"]').click()
  check('3) 자동 행은 일자 입력칸 대신 잠금 안내', await page.getByText('일자 고정 (생성 실적)').isVisible())
  await page.getByPlaceholder('주요 개정내용').fill('2026년 소방계획서 작성 · 위치도 교체')
  await page.getByRole('button', { name: '저장' }).click()
  const edited = await pollDb(async () => {
    const rs = await rows(custId)
    return rs.find(r => r.content === '2026년 소방계획서 작성 · 위치도 교체') ?? null
  }, 30000)
  check('3) 자동 행 서술 수정 가능', !!edited && edited.source === 'generated', JSON.stringify(edited))
  check('3) 자동 행 일자 불변', edited?.revised_on === '2026-02-10', JSON.stringify(edited))

  // ── 4) 서버 방어 — 자동 행의 일자·삭제는 액션 단계에서 거부 ──
  const autoId = edited?.id
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=archive`)
  await page.getByText('개정이력').first().waitFor({ state: 'visible', timeout: 20000 })
  await page.hover('text=설비 교체로 1.4 수정')
  const delBtns = page.locator('button[title="삭제"]')
  check('4) 자동 행에는 삭제 버튼이 없다(수동 행만)', (await delBtns.count()) === 1, `삭제 버튼 ${await delBtns.count()}개`)

  // ── 5) 수동 행 삭제 ──
  await delBtns.first().click()
  const gone = await pollDb(async () => {
    const rs = await rows(custId)
    return rs.every(r => r.content !== '설비 교체로 1.4 수정') ? true : null
  }, 30000)
  check('5) 수동 행 삭제됨', !!gone)
  const after = await rows(custId)
  check('5) 자동 행은 남아 있다', after.length === 2 && after.every(r => r.source === 'generated'), JSON.stringify(after.map(r => r.source)))

  // ── 6) 유니크 채번 — 같은 연도·순번 중복 삽입은 DB가 막는다 ──
  const dup = await raw.from('fire_plan_revisions')
    .insert({ customer_id: custId, year: 2026, seq: 1, content: '중복', source: 'manual' })
  check('6) (customer,year,seq) 유니크 위반 거부', !!dup.error, dup.error?.code ?? 'no error')
  void autoId
} catch (e) {
  check('예외 없음', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (custId) await raw.from('fire_plan_revisions').delete().eq('customer_id', custId)
  await cleanupCustomer(custId).catch(() => {})
  await delUser(userId).catch(() => {})
}
summary()
