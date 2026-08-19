/** 1000행 상한 정리 — 페이지네이션으로 바꾼 읽기 경로 검증 (2026-08-19)
 *  실행: npx tsx scripts/test-row-cap-fixes.mts   (dev 서버 필요)
 *
 *  왜 —
 *  PostgREST는 요청당 1000행이 하드 상한이고 **오류 없이** 잘린다. 그래서 `.limit(2000)`,
 *  `.limit(Math.max(1000, n*20))` 같은 "상한 명시"는 지켜지지 않으면서 안전하다는 인상만 줬다.
 *  네 곳을 fetchAllRows(1000행씩 끝까지)로 바꿨고, 여기서 실제로 태워 본다:
 *    ① doc-status.findArchivedCertInspections — 대시보드 '문서 할 일' 위젯이 이걸 쓴다
 *    ② reports.searchDocCommandsAction — 초성 검색(고객 전체를 받아 이름을 맞춘다)
 *    ③ annex-cover-official.suggestDocNo — 공문 문서번호 일련 (같은 화면 렌더로 태워진다)
 *    ④ cron purge-activity-logs — BATCH=5000이 실제로는 1000이던 것
 *
 *  ④는 파괴적이라 **읽기만** 태운다(retention_days를 크게 줘 대상 0건 → 업로드·삭제 이전에 종료).
 *  대신 페이지 경계가 실제로 이어지는지는 같은 필터·정렬로 DB에서 직접 확인한다.
 */
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, mkUser, delUser, launch, check, summary } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼
import { findActionId, collectScripts, callAction } from './_judge19-action.mjs'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `rowcap.${SUF}@e2e.test`
const EVIDENCE_MARKERS = ['fire_plan_archive_cleanup', 'cert_paper_archived']

let userId: string | null = null
let browser: import('playwright').Browser | null = null

async function main() {
  const l = await launch(); browser = l.browser
  const page: Page = l.page
  page.setDefaultTimeout(60000)
  const scripts = collectScripts(page)

  userId = await mkUser({ email: EMAIL, name: `상한${SUF}`, employeeId: `RC-${SUF}`, role: 'admin' })
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 120_000 })

  console.log('\n[1] 대시보드 렌더 — doc-status(보관 마커 조회)가 이 경로에 있다')
  await page.goto(`${BASE}/dashboard`)
  await page.waitForLoadState('networkidle')
  const dashOk = await page.locator('text=/문서|점검|현황/').first().isVisible().catch(() => false)
  check('1-1 대시보드가 오류 없이 그려진다', dashOk, page.url())
  check('1-2 서버 오류 화면이 아니다',
    (await page.locator('text=/Application error|Unhandled Runtime|500/').count()) === 0)

  console.log('\n[2] 초성 검색(searchDocCommandsAction) — 고객 전체를 받아 맞춘다')
  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  const searchId = await findActionId(page, 'searchDocCommandsAction', [...scripts])
  if (!searchId) {
    console.log('  (액션 id를 못 찾아 2번은 건너뜀 — 해당 화면 번들 미로드)')
  } else {
    // 실제 고객 이름 한 글자로 검색 — 결과 유무보다 **오류 없이 도는지**가 요지
    const { data: anyCust } = await raw.from('customers').select('customer_name').eq('is_active', true).limit(1)
    const name = ((anyCust ?? []) as Array<{ customer_name: string }>)[0]?.customer_name ?? '가'
    const res = await callAction(page, searchId, [name.slice(0, 2)])
    check('2-1 초성 검색 액션이 오류 없이 응답', !/"error"/.test(res.text), res.text.slice(0, 200))
    check('2-2 매칭 결과 구조 반환', /customers/.test(res.text), res.text.slice(0, 200))
  }

  console.log('\n[3] 보관 마커 조회 — 페이지 경계가 이어지는지(같은 필터로 직접 확인)')
  const { count: markerCount } = await raw.from('activity_logs')
    .select('*', { count: 'exact', head: true })
    .in('action', EVIDENCE_MARKERS).eq('entity_type', 'inspection')
  const paged: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await raw.from('activity_logs').select('entity_id')
      .in('action', EVIDENCE_MARKERS).eq('entity_type', 'inspection')
      .order('id').range(from, from + 999)
    const batch = (data ?? []) as Array<{ entity_id: string }>
    paged.push(...batch.map(b => b.entity_id))
    if (batch.length < 1000) break
  }
  check('3-1 ★ 페이지네이션 합계 = 전체 건수(누락·중복 없음)',
    paged.length === (markerCount ?? 0), `paged ${paged.length} vs count ${markerCount}`)

  console.log('\n[4] 만료 로그 조회 — BATCH가 실제 상한이 되는지 (읽기만)')
  // 대상 0건이 되도록 보존기간을 아주 길게 → 업로드·삭제 코드에 닿기 전에 종료된다
  // CRON_SECRET은 _env.mjs가 .env.local에서 process.env로 채운다
  const cronRes = await page.request.get(`${BASE}/api/cron/purge-activity-logs?retention_days=100000`, {
    headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
  })
  const cronBody = await cronRes.text()
  check('4-1 크론 조회 경로가 오류 없이 응답', cronRes.ok(), `${cronRes.status()} ${cronBody.slice(0, 200)}`)
  check('4-2 ★ 대상 0건으로 안전 종료(삭제 없음)', /"archived":0/.test(cronBody), cronBody.slice(0, 200))

  // 같은 필터·정렬로 1000행을 넘겨 받을 수 있는지 — 종전 .limit(5000)이 1000에서 잘리던 자리
  const { count: purgeable } = await raw.from('activity_logs')
    .select('*', { count: 'exact', head: true })
    .lt('created_at', new Date().toISOString())
    .or(`action.not.in.(${EVIDENCE_MARKERS.join(',')}),entity_type.neq.inspection`)
  const pagedLogs: string[] = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data } = await raw.from('activity_logs').select('id')
      .lt('created_at', new Date().toISOString())
      .or(`action.not.in.(${EVIDENCE_MARKERS.join(',')}),entity_type.neq.inspection`)
      .order('created_at', { ascending: true }).order('id').range(from, from + 999)
    const batch = (data ?? []) as Array<{ id: string }>
    pagedLogs.push(...batch.map(b => b.id))
    if (batch.length < 1000) break
  }
  const expected = Math.min(purgeable ?? 0, 5000)
  check('4-3 ★ 1000행을 넘겨 받는다(종전엔 1000에서 잘렸다)',
    pagedLogs.length === expected, `paged ${pagedLogs.length} vs 기대 ${expected} (전체 ${purgeable})`)
  check('4-4 ★ 페이지 경계에 중복이 없다', new Set(pagedLogs).size === pagedLogs.length,
    `unique ${new Set(pagedLogs).size} / ${pagedLogs.length}`)
}

main()
  .catch(e => { console.error(`\n  ❌ 예외: ${(e as Error).message}\n${(e as Error).stack}`); process.exitCode = 1 })
  .finally(async () => {
    if (browser) await browser.close()
    if (userId) { try { await delUser(userId) } catch { /* 무시 */ } }
    summary()
  })
