// 소방계획서_5 R0-11 — 클릭 수 목표표 E2E (4-0 UX 규약: 최소 클릭 동선 회귀 가드)
// 목표표(설계 §4-0): 9호 확인 = 타이핑+1클릭 / 배치확인서 업로드 진입 = 0~2 / 완료 후 생성 = 0~1(자동 토글) / 역링크 = 1클릭
// 결정적으로 측정 가능한 동선만 실측(클릭 카운터). 생성물 PDF 시딩이 필요한 실파일 열람은 구조(후보·버튼 노출)로 검증.
// 실행: npx tsx scripts/test-click-budget.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'click-budget-e2e@erp-test.com'
let userId = ''
let custA = ''  // 자체점검(작동) 완료 — 9호 미생성·배치확인서 미업로드
let inspA = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const NAME_A = '클릭예산E2E자체점검'

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '클릭예산E2E', employeeId: 'E2E-CB' })
  custA = await mkCustomer({ customer_name: NAME_A, created_by: userId, inspection_type: '작동', inspection_sub_type: '작동' })

  // custA — 자체점검 완료(종료 12일 전 → 별지 9호 D-3), cert·9호 없음
  const { data: iA, error: eA } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-12), inspection_end_date: kstShift(-12),
    status: 'completed', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`자체점검 생성 실패: ${eA.message}`)
  inspA = iA!.id

  const l = await launch()
  browser = l.browser
  const page = l.page

  // 클릭 카운터 — page.click 호출을 래핑해 실측
  let clicks = 0
  const origClick = page.click.bind(page)
  ;(page as unknown as { click: typeof origClick }).click = async (sel: string, opts?: unknown) => {
    clicks++
    return origClick(sel, opts as never)
  }
  const resetClicks = () => { clicks = 0 }

  await login(page, EMAIL)

  // ── 예산 1) 9호 확인 진입 = 타이핑 + 1클릭 (문서 현황 열기) ──
  await page.goto(`${BASE}/reports`)
  await page.waitForSelector('h1:has-text("보고서 센터")')
  const searchSel = 'input[placeholder*="고객명을 검색하세요"]'
  await page.fill(searchSel, NAME_A)               // 타이핑(클릭 아님)
  await page.waitForSelector(`text=${NAME_A} — 문서 현황 열기`)
  resetClicks()
  await page.click(`button:has-text("${NAME_A} — 문서 현황 열기")`)   // 1클릭
  await page.waitForSelector(`h2:has-text("${NAME_A}")`)
  check('예산1 9호 확인 진입 = 타이핑+1클릭 (문서 현황 도달)', clicks <= 1, `실측 ${clicks}클릭`)
  check('예산1 URL 동기화(?form=docs&cust=)', page.url().includes('form=docs') && page.url().includes(`cust=${custA}`))

  // ── 예산 2) 역링크(R0-10) = 문서 현황 ↔ 고객 소방계획서 탭 상호 진입 ──
  // 문서 현황 → 고객 소방계획서 탭(R15-c 순방향은 기존), 역방향은 고객 탭·타임라인에 '보고서 센터에서 보기 →'
  await page.goto(`${BASE}/customers/${custA}?tab=plan`)
  const revLinkSel = `a[href="/reports?form=docs&cust=${custA}"]:has-text("보고서 센터에서 보기")`
  check('예산2 R0-10 역링크 — 고객 소방계획서 탭에 "보고서 센터에서 보기"', (await page.locator(revLinkSel).count()) >= 1)
  resetClicks()
  await page.click(revLinkSel)                     // 1클릭 교차 이동
  await page.waitForSelector('h1:has-text("보고서 센터")')
  check('예산2 역링크 = 1클릭으로 보고서 센터 문서 현황 도달',
    clicks <= 1 && page.url().includes('form=docs') && page.url().includes(`cust=${custA}`), `실측 ${clicks}클릭 / ${page.url()}`)

  // ── 예산 2-b) 점검 타임라인 역링크 ──
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('h2:has-text("문서 타임라인")')
  check('예산2-b R0-10 역링크 — 점검 타임라인에 "보고서 센터에서 보기"',
    (await page.locator(`a[href="/reports?form=docs&cust=${custA}"]:has-text("보고서 센터에서 보기")`).count()) >= 1)

  // ── 예산 3) 배치확인서 업로드 진입 = 0~2클릭 (자동완성 미업로드 후보 → 업로드 도달) ──
  await page.goto(`${BASE}/reports`)
  await page.fill(searchSel, NAME_A)
  await page.waitForSelector('text=미업로드')
  check('예산3 업로드 진입 — 자동완성 "배치확인서 ⚠ 미업로드" 후보 노출(0~2클릭 내)', await page.isVisible('text=미업로드'))

  // ── 예산 4) 완료 후 별지 9호 생성 = 0~1클릭 (R0-7 자동 생성 토글 + 후속 제안 배너) ──
  // 완료 시 자동 생성 토글이 노출되면(직원/담당 canComplete) 완료→생성이 0클릭, 꺼짐이면 배너 [별지 9호 생성] 1클릭
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('h2:has-text("6단계 업무 체크리스트")')
  check('예산4 R0-7 — "완료 시 9호 자동 생성" 토글 노출(0클릭 자동화 경로)',
    await page.isVisible('text=완료 시 9호 자동 생성'))

  summary()
} catch (e) {
  console.error('❌ 테스트 예외:', (e as Error).message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  await cleanupCustomer(custA)
  const { raw: r } = await import('./_e2e-helpers.mjs')
  await r.from('profiles').delete().eq('id', userId)
  await r.auth.admin.deleteUser(userId).catch(() => {})
}
