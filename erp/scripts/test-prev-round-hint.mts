// 지난 회차 불러오기 제안 배너 E2E (2026-09-07, A안)
//
// 왜 만들었나: 새 회차는 **항상 빈 상태로 시작한다**(자동 승계 없음 — 점검 없이 작성된 값이
// 기본값이 되면 허위 기재를 조장한다, 소방계획서_20 §6-6). 반복 입력을 줄이는 유일한 길이
// [지난 회차 결과 불러오기]인데, 버튼을 모르면 605항목을 처음부터 찍는다. 배너가 그 사실을 알린다.
//
// 이 검사가 지키는 것은 '배너가 뜬다'가 아니라 **배너가 권한 대로 실제로 된다**이다:
//  · 권하는 회차(라벨)와 복사가 집는 회차가 같은가 — 갈리면 "권해놓고 실패하는 버튼"이 된다
//  · 뜨면 안 되는 자리에서 안 뜨는가(입력 시작됨 / 지난 회차 없음 / 지난 회차가 껍데기)
//
// 실행: npx tsx scripts/test-prev-round-hint.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'prev-hint-e2e@erp-test.com'
let userId = ''
let custA = ''      // 지난 회차 있음 — 배너 기대
let custB = ''      // 지난 회차 없음 — 배너 부재(대조군)
let custC = ''      // 이번 회차에 입력이 있는 상태 — 안전장치 ①(보존) 축
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const HINT = '[data-testid="sheet-entry-prev-hint"]'
const F_INPUT = '소화기구 및 자동소화장치'

/** inspections.year는 inspection_start_date의 생성 컬럼이다(002_fire_safety.sql:109) —
 *  '지난 해 완료 회차'는 날짜로만 만들 수 있다(year를 직접 넣으면 insert가 거절된다) */
function ymd(yearShift: number, monthDay = '03-10'): string {
  const y = new Date(Date.now() + 9 * 3600_000).getFullYear() + yearShift
  return `${y}-${monthDay}`
}

async function mkInspection(customerId: string, opts: {
  date: string; seq: number; status: string
}): Promise<string> {
  const { data, error } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '종합', sequence_num: opts.seq, plan_type: 'special_종합',
    inspection_start_date: opts.date, status: opts.status,
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`inspections insert 실패: ${error.message}`)
  return data!.id
}

try {
  userId = await mkUser({ email: EMAIL, name: '지난회차배너E2E', employeeId: 'E2E-PRH' })

  // ── 시드: 고객 A(지난 회차 있음) / 고객 B(첫 회차라 지난 회차 없음) ──
  for (const [slot, name] of [['A', '지난회차배너A'], ['B', '지난회차배너B'], ['C', '지난회차배너C']] as const) {
    const cid = await mkCustomer({ customer_name: name, created_by: userId })
    if (slot === 'A') custA = cid; else if (slot === 'B') custB = cid; else custC = cid
    const { data: bld } = await raw.from('buildings')
      .insert({ customer_id: cid, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
    await raw.from('fire_facilities').insert([
      { building_id: bld!.id, category: '소화설비', facility_code: F_INPUT, installed: true },
    ])
  }

  const { data: sheets } = await raw.from('inspection_sheets').select('id, sheet_code, sheet_name').eq('version', 'v2025')
  const shInput = (sheets ?? []).find((s: { sheet_name: string }) => s.sheet_name === F_INPUT)
  check('시드 — 소화기구 시트 실재', !!shInput, shInput?.sheet_code ?? '(없음)')
  const { data: items } = await raw.from('inspection_sheet_items')
    .select('item_code').eq('sheet_id', shInput!.id).order('order_num')
  const codes = [...new Set((items ?? []).map((i: { item_code: string }) => i.item_code))]
  check('시드 — 복사할 항목 확보', codes.length >= 4, `${codes.length}개`)

  // 고객 A: 작년 1차(완료, 응답 있음) → 올해 1차(빈 회차, 배너 기대)
  const prevId = await mkInspection(custA, { date: ymd(-1), seq: 1, status: 'completed' })
  const curId = await mkInspection(custA, { date: ymd(0), seq: 1, status: 'in_progress' })
  // 지난 회차 응답 — ○ 2건 + ✕ 1건(메모 포함). ✕가 섞여야 '값만 복사'를 볼 수 있다
  const seeded = [
    { item_code: codes[0], result: 'O', memo: null },
    { item_code: codes[1], result: 'O', memo: null },
    { item_code: codes[2], result: 'X', memo: '작년 불량 메모' },
  ]
  const { error: seedErr } = await raw.from('inspection_sheet_responses').insert(
    seeded.map(s => ({ ...s, inspection_id: prevId, month: 0, updated_by: userId })))
  check('시드 — 지난 회차 응답 3건 기록', !seedErr, seedErr?.message ?? 'ok')

  // 고객 B: 올해 1차만(지난 완료 회차 없음)
  const soloId = await mkInspection(custB, { date: ymd(0), seq: 1, status: 'in_progress' })

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await login(page, EMAIL)

  // ── 1) ★ 빈 회차 + 지난 완료 회차 → 배너가 뜨고, 어느 회차인지 말한다 ──
  await page.goto(`${BASE}/inspections/${curId}/sheet`)
  await page.waitForSelector('text=점검표 입력 —')
  const hint = page.locator(HINT)
  check('★ 빈 회차 — 제안 배너 노출', await hint.isVisible())
  const hintTxt = ((await hint.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
  const prevYear = new Date(ymd(-1)).getFullYear()
  check('★ 배너가 출처 회차를 명시', hintTxt.includes(`${prevYear}년 1차`), hintTxt.slice(0, 120))
  // 안전장치 고지 — 배너가 '베껴도 된다'로 읽히면 안 된다(§6-6)
  check('배너가 실점검 대체 불가를 고지', hintTxt.includes('실제 점검을 대체하지 않습니다'), hintTxt.slice(0, 160))

  // ── 2) 대조군 — 지난 완료 회차가 없는 고객에선 안 뜬다 ──
  await page.goto(`${BASE}/inspections/${soloId}/sheet`)
  await page.waitForSelector('text=점검표 입력 —')
  check('대조군 — 지난 회차 없으면 배너 부재', !(await page.locator(HINT).isVisible()))

  // ── 3) ★ 배너의 [불러오기] = 버튼과 같은 결과 — 권한 회차가 실제로 복사된다 ──
  await page.goto(`${BASE}/inspections/${curId}/sheet`)
  await page.waitForSelector('text=점검표 입력 —')
  page.once('dialog', d => d.accept())   // 확인 다이얼로그는 배너 경로에서도 그대로 뜬다
  await page.click('[data-testid="sheet-entry-prev-hint-copy"]')
  let copied: Array<{ item_code: string; result: string; memo: string | null }> = []
  for (let i = 0; i < 20; i++) {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('item_code, result, memo').eq('inspection_id', curId)
    copied = (data ?? []) as typeof copied
    if (copied.length >= seeded.length) break
    await page.waitForTimeout(300)
  }
  check('★ 배너 [불러오기] — 지난 회차 응답이 복사됨', copied.length === seeded.length, `${copied.length}/${seeded.length}건`)
  const copiedX = copied.find(r => r.item_code === codes[2])
  check('✕도 값 그대로 복사(메모 포함)', copiedX?.result === 'X' && copiedX?.memo === '작년 불량 메모',
    `${copiedX?.result} / ${copiedX?.memo ?? '(없음)'}`)
  // ② 불량내역 자동 등록 없음 — 복사 경로의 안전장치(현장 확인 후 수동 등록)
  const { count: defectCount } = await raw.from('inspection_defects')
    .select('*', { count: 'exact', head: true }).eq('inspection_id', curId)
  check('✕ 복사해도 불량내역 자동 등록 없음', (defectCount ?? 0) === 0, `${defectCount ?? 0}건`)
  // ③ 감사 기록 — 되돌리기가 없는 대량 입력이라 흔적이 남아야 한다
  const { data: logs } = await raw.from('activity_logs')
    .select('metadata').eq('action', 'sheet_copy_previous').eq('entity_id', curId)
  check('복사 실행이 activity_logs에 남음', (logs ?? []).length > 0, `${(logs ?? []).length}건`)
  const srcLabel = (logs ?? [])[0]?.metadata?.source_label ?? ''
  check('★ 감사 로그 출처 = 배너가 권한 회차', srcLabel === `${prevYear}년 1차`, `로그 "${srcLabel}" / 배너 "${prevYear}년 1차"`)

  // ── 3b) ★ 복사 결과 안내가 실제로 보인다 (2026-09-07 회귀 방지) ──
  //  종전엔 copyPrevious가 openRow를 void로 띄워, openRow의 setNotice('')가 안내보다 늦게 도착해
  //  "N개 불러옴 · 불량 N건은 확인 후 [등록] 필요"가 한 번도 안 보였다. 복사 결과와 **다음 할 일**을
  //  알리는 유일한 문구다 — 이 검사가 그 조용한 소멸을 못 박는다
  await page.waitForSelector('text=항목을 불러왔습니다', { timeout: 20000 })
  const noticeTxt = ((await page.locator('text=항목을 불러왔습니다').first().textContent()) ?? '').replace(/\s+/g, ' ').trim()
  check('★ 복사 결과 안내가 남아 있다', noticeTxt.includes('불러왔습니다'), noticeTxt.slice(0, 140))
  check('★ 안내가 ✕ 후속조치를 지시', noticeTxt.includes('[등록] 필요'), noticeTxt.slice(0, 140))

  // ── 4) ★ 입력이 시작되면 배너는 스스로 사라진다 ──
  check('★ 복사 직후 배너 소멸(같은 화면)', !(await page.locator(HINT).isVisible()))
  await page.goto(`${BASE}/inspections/${curId}/sheet`)
  await page.waitForSelector('text=점검표 입력 —')
  check('★ 재진입해도 배너 부재(응답 있음)', !(await page.locator(HINT).isVisible()))

  // ── 4b) ★ 안전장치 ① — 이번 회차에 이미 입력한 값은 복사가 덮지 않는다 ──
  //  이 축은 종전 `_probe-annex-autosave.mjs`가 지키고 있었는데, 소방계획서_28이 입력을
  //  별지 트리에서 전용 페이지로 옮기면서 그 프로브가 통째로 죽었다(트리는 이제 시트명을
  //  <span>으로 그려 클릭 대상이 없다 — plan-annex-sheet-tree.tsx:159). 여기로 흡수한다.
  //  배너가 아니라 **툴바 버튼** 경로다 — 이미 입력이 있으면 배너는 안 뜨지만 버튼은 살아 있어야 한다.
  //  2차(seq=2)는 종합 대상 고객에게만 허용된다는 DB 가드가 있어 고객을 따로 쓴다(전부 1차)
  const prevC = await mkInspection(custC, { date: ymd(-1), seq: 1, status: 'completed' })
  await raw.from('inspection_sheet_responses').insert(
    seeded.map(s => ({ ...s, inspection_id: prevC, month: 0, updated_by: userId })))
  const keepId = await mkInspection(custC, { date: ymd(0, '09-10'), seq: 1, status: 'in_progress' })
  // codes[2]는 지난 회차에 X다 — 이번 회차의 O를 X로 덮으면 실점검 결과가 뒤집힌다
  await raw.from('inspection_sheet_responses').insert(
    [{ inspection_id: keepId, item_code: codes[2], result: 'O', month: 0, updated_by: userId }])
  await page.goto(`${BASE}/inspections/${keepId}/sheet`)
  await page.waitForSelector('text=점검표 입력 —')
  check('입력이 있으면 배너 부재(버튼은 존치)', !(await page.locator(HINT).isVisible()))
  check('툴바 [지난 회차 결과 불러오기]는 남아 있다',
    await page.locator('button:has-text("지난 회차 결과 불러오기")').isVisible())
  page.once('dialog', d => d.accept())
  await page.click('button:has-text("지난 회차 결과 불러오기")')
  await page.waitForSelector('text=항목을 불러왔습니다', { timeout: 20000 })
  const { data: keepRows } = await raw.from('inspection_sheet_responses')
    .select('item_code, result').eq('inspection_id', keepId)
  const kept = (keepRows ?? []).find((r: { item_code: string }) => r.item_code === codes[2])
  check('★ 기존 입력 보존 — 지난 회차 ✕가 이번 회차 ○를 덮지 않음', kept?.result === 'O', `${kept?.result ?? '(없음)'}`)
  // 보존 1건 + 복사 2건 = 3 — '보존'이 '복사 안 함'으로 퇴화하면 여기서 걸린다
  check('★ 나머지 미입력 항목은 채워짐', (keepRows ?? []).length === seeded.length,
    `${(keepRows ?? []).length}건 (기대 ${seeded.length})`)

  // ── 5) 대조군 — 지난 회차가 '껍데기'(완료지만 응답 0건)면 권하지 않는다 ──
  //     권해놓고 '저장된 점검표 응답이 없습니다'로 실패하는 배너를 만들지 않기 위한 축
  const emptyPrev = await mkInspection(custB, { date: ymd(-1), seq: 1, status: 'completed' })
  await page.goto(`${BASE}/inspections/${soloId}/sheet`)
  await page.waitForSelector('text=점검표 입력 —')
  check('대조군 — 지난 회차가 응답 0건이면 배너 부재', !(await page.locator(HINT).isVisible()), `출처 후보 ${emptyPrev.slice(0, 8)}`)
} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (custA) await cleanupCustomer(custA)
  if (custB) await cleanupCustomer(custB)
  if (custC) await cleanupCustomer(custC)
  if (userId) await delUser(userId)
  summary()
}
