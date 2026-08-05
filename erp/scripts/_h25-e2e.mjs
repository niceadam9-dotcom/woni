// H-25 고객 온보딩 흐름 E2E — 신규 등록(필수만) → 온보딩 배너 노출 → 딥링크(설비 대장·지도/사진)
//  → 배너 접기/닫기 → 등록 회귀(필수 누락 에러·필드 보존) 검증. 데이터 정리 포함.
import { raw, BASE, check, summary, mkUser, delUser, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'h25-e2e@sjfire.test'
let userId
const createdCustomerIds = []   // 폼으로 만들어진 고객 id
const NAME_PREFIX = 'H25온보딩고객_'

async function setup() {
  userId = await mkUser({ email: EMAIL, name: 'H25검증자', employeeId: 'H25-001', role: 'admin' })
}

async function cleanup() {
  // 폼 등록분 회수(고유 고객명 접두어) + 명시 id 병합 + 자식 정리
  const { data: rows } = await raw.from('customers').select('id').ilike('customer_name', `${NAME_PREFIX}%`)
  const ids = new Set([...createdCustomerIds, ...(rows ?? []).map(r => r.id)])
  for (const id of ids) {
    await raw.from('customer_contacts').delete().eq('customer_id', id)
    await raw.from('buildings').delete().eq('customer_id', id)
    await cleanupCustomer(id)
  }
  await delUser(userId)
}

async function run() {
  const { browser, page } = await launch()
  try {
    await login(page, EMAIL)

    // ══ 1) 신규 등록 화면 — 필수만 입력(회귀: 필수 누락 시 등록 버튼 비활성) ══
    await page.goto(`${BASE}/customers/new`)
    await page.waitForLoadState('networkidle')
    const submitBtn = page.getByRole('button', { name: '고객 등록' })
    await submitBtn.waitFor({ state: 'visible', timeout: 15000 })
    check('필수 누락 시 등록 버튼 비활성', await submitBtn.isDisabled())

    // 필수: 주소(수동)·고객명·점검계획일·대표 관계인 (점검유형 기본=종합)
    const uniqueName = `H25온보딩고객_${Date.now()}`
    await page.locator('input[placeholder*="동/호수"]').fill('경기도 양평군 테스트로 25')
    await page.locator('input[placeholder*="자동입력 또는 직접"]').fill(uniqueName)
    // 점검계획일 (DateInput 텍스트 입력 — 필수 섹션의 유일한 표시 date 입력, 선택 섹션 접힘)
    const planDate = page.locator('input[placeholder="YYYY-MM-DD"]:visible').first()
    await planDate.fill('20200514')   // 숫자만 → 자동 하이픈 포맷
    await page.locator('#contact-대표-name').fill('김대표')

    // 고객코드 자동생성 완료 대기 → 버튼 활성
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '고객 등록')
      return b && !b.disabled
    }, { timeout: 15000 })
    check('필수 충족 시 등록 버튼 활성', !(await submitBtn.isDisabled()))

    await submitBtn.click()
    // 등록 성공 → 온보딩 URL로 이동
    await page.waitForURL(u => /\/customers\/[0-9a-f-]{36}/.test(u.pathname) && u.search.includes('onboarding=1'), { timeout: 20000 })
    const custId = page.url().match(/\/customers\/([0-9a-f-]{36})/)[1]
    createdCustomerIds.push(custId)
    check('등록 성공 → onboarding=1 URL', page.url().includes('onboarding=1') && page.url().includes('tab=plan'))

    // ══ 2) 등록 필드 보존 회귀 (DB) ══
    const { data: cust } = await raw.from('customers').select('customer_name, plan_anchor_date, inspection_type').eq('id', custId).single()
    check('등록 필드 보존: 고객명', cust.customer_name === uniqueName, `got=${cust?.customer_name}`)
    check('등록 필드 보존: 점검계획일', cust.plan_anchor_date === '2020-05-14', `got=${cust?.plan_anchor_date}`)
    const { data: rep } = await raw.from('customer_contacts').select('name, role').eq('customer_id', custId).eq('role', '대표').maybeSingle()
    check('등록 필드 보존: 대표 관계인', rep?.name === '김대표', `got=${rep?.name}`)

    // ══ 3) 온보딩 배너 노출 ══
    await page.waitForLoadState('networkidle')
    const banner = page.getByText('고객 등록 완료 — 이어서 입력하면', { exact: false })
    await banner.waitFor({ state: 'visible', timeout: 15000 })
    check('온보딩 배너 노출', await banner.isVisible())
    // 4단계 체크리스트 라벨 확인
    check('배너: 설비 대장 항목', await page.getByText('설비 대장 — 소방시설·세부 제원').isVisible())
    check('배너: 지도·사진 항목', await page.getByText('지도·사진 — 표지 사진·위치도·피난안내도').isVisible())
    check('배너: 관계인 항목', await page.getByText('관계인 — 대표 확인·추가').isVisible())
    // 대표 관계인 있으므로 관계인 단계 done → done 개수 최소 1
    check('배너: 진행 카운트 노출 (n/4)', /\/4/.test(await page.locator('div').filter({ hasText: /^온보딩|고객 등록 완료/ }).first().innerText().catch(() => '')) || await page.getByText('/4').first().isVisible().catch(() => false))

    // ══ 4) 딥링크: 설비 대장 → 서식 1.4 이동 ══
    const facRow = page.locator('li').filter({ hasText: '설비 대장 — 소방시설' })
    await facRow.getByRole('button', { name: /입력하러|확인/ }).click()
    await page.waitForTimeout(600)
    // 서식 전체 모드 + 1.4 선택 → URL form=1.4
    check('설비 대장 딥링크 → form=1.4', page.url().includes('form=1.4'))

    // ══ 5) 딥링크: 지도·사진 → 자산 카드 스크롤 (⚡ 빠른 입력 노드로 복귀 후) ══
    // 토글 제거(2026-08-05) — 트리 최상단 '⚡ 빠른 입력' 노드로 돌아가 배너 재확인
    await page.getByRole('button', { name: '⚡ 빠른 입력' }).click()
    await page.waitForTimeout(400)
    const assetRow = page.locator('li').filter({ hasText: '지도·사진 — 표지' })
    check('빠른 입력 복귀 후 배너 유지', await assetRow.isVisible())
    await assetRow.getByRole('button', { name: /입력하러|확인/ }).click()
    await page.waitForTimeout(400)
    // 자산 카드(CustomerAssetsClient) 화면에 존재
    check('지도·사진 딥링크 대상(자산 카드) 존재', await page.locator('#onboarding-assets-anchor').isVisible())

    // ══ 6) 배너 접기(나중에) → 펼치기 ══
    await page.getByRole('button', { name: '나중에' }).click()
    await page.waitForTimeout(300)
    check('나중에 → 체크리스트 접힘', !(await page.getByText('설비 대장 — 소방시설·세부 제원').isVisible().catch(() => false)))
    await page.getByRole('button', { name: '펼치기' }).click()
    await page.waitForTimeout(300)
    check('펼치기 → 체크리스트 재노출', await page.getByText('설비 대장 — 소방시설·세부 제원').isVisible())

    // ══ 7) 배너 닫기 → 쿼리 제거·배너 사라짐 ══
    await page.getByRole('button', { name: '온보딩 배너 닫기' }).click()
    await page.waitForTimeout(400)
    check('닫기 → 배너 사라짐', !(await page.getByText('고객 등록 완료 — 이어서 입력하면', { exact: false }).isVisible().catch(() => false)))
    check('닫기 → URL onboarding 쿼리 제거', !page.url().includes('onboarding=1'))

    // ══ 8) 온보딩 없이 상세 진입 시 배너 미노출 (회귀) ══
    await page.goto(`${BASE}/customers/${custId}?tab=plan`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    check('onboarding 쿼리 없으면 배너 미노출', !(await page.getByText('고객 등록 완료 — 이어서 입력하면', { exact: false }).isVisible().catch(() => false)))

  } finally {
    await browser.close()
  }
}

async function main() {
  try {
    await setup()
    await run()
  } catch (e) {
    console.error('E2E 예외:', e)
    check('E2E 무예외', false, String(e))
  } finally {
    await cleanup().catch(e => console.error('정리 실패:', e))
  }
  summary()
}
main()
