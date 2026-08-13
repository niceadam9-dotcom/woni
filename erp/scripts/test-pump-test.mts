// 소방계획서_21 R5-9 — 펌프성능시험 실측치 E2E (마이그레이션 131 필요)
// 입력 → DB 저장 · 자동 판정 · 수동 보정 우선 · 빈 값이면 행 삭제 ·
// 별지 4호 미리보기에 실측치와 법정 문구가 실림 · 표가 없는 설비에는 패널 미노출
// 실행: npx tsx scripts/test-pump-test.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼 — 서버 액션 직접 호출(별지 4호는 UI 미리보기 진입점이 없다)
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'

const EMAIL = `pump-${Date.now().toString(36)}@erp-test.com`
let userId = '', custId = '', inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const dbRow = async (sheetNo: number, kind: string) => {
  const { data } = await raw.from('inspection_pump_tests')
    .select('shutoff_flow, shutoff_press, rated_flow, rated_press, over_flow, over_press, set_start_press, set_stop_press, judge1, judge2, judge3')
    .eq('inspection_id', inspId).eq('sheet_no', sheetNo).eq('pump_kind', kind).maybeSingle()
  return data as Record<string, number | string | null> | null
}
/** 저장은 blur마다 따로 날아간다 — 기대값이 보일 때까지 기다린다 */
const waitRow = async (sheetNo: number, kind: string, pred: (r: Record<string, number | string | null> | null) => boolean) => {
  for (let i = 0; i < 24; i++) {
    const r = await dbRow(sheetNo, kind)
    if (pred(r)) return r
    await new Promise(res => setTimeout(res, 500))
  }
  return await dbRow(sheetNo, kind)
}

try {
  // 131 선행 확인 — 없으면 통과로 위장하지 않고 즉시 실패시킨다
  const probe = await raw.from('inspection_pump_tests').select('id').limit(1)
  if (probe.error) throw new Error(`마이그레이션 131 미적용: ${probe.error.message}`)

  userId = await mkUser({ email: EMAIL, name: '펌프E2E', employeeId: `E2E-PUMP-${Date.now().toString(36)}` })
  custId = await mkCustomer({ customer_name: '펌프E2E고객', address: '경기 양평군 테스트로 9', created_by: userId })
  // 자체점검(plan_type null) — STD 시트라 옥내소화전(2)·스프링클러(3)·간이스프링클러(4)가 대상
  const { data: insp, error } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-1), inspection_end_date: kstShift(-1),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  inspId = insp!.id

  const l = await launch(); browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  const scriptUrls = collectScripts(page)
  await login(page, EMAIL)

  // ── 1) 작업대 ① 안에 펌프성능시험 패널 ──
  await page.goto(`${BASE}/inspections/${inspId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  const panel = page.locator('[data-testid="pump-test-panel"]')
  await panel.waitFor({ timeout: 60000 })
  check('① 점검표 칸에 펌프성능시험 패널', await panel.isVisible())
  check('법정 서식 표제 노출', await page.isVisible('text=※ 펌프성능시험'))
  check('설비 탭 — 옥내소화전', await panel.locator('button:has-text("옥내소화전설비")').isVisible())
  // 탭은 패널 안에서만 센다 — 점검표 시트 목록에도 같은 이름의 버튼이 있다
  const tabNames = await panel.locator('button').filter({ hasText: /설비$/ }).allInnerTexts()
  // 법정 8개(2·3·4·5·6·7·8·13) 중 STD 시트가 실재하는 것만 탭에 뜬다.
  // 종전 단언은 6개로 굳어 있었고 그 숫자가 틀렸다 — 5(화재조기진압)·13(옥외소화전) 누락(V21-1).
  check('표가 붙는 설비만 탭에 있음(법정 8개 중 DB 보유분)',
    tabNames.every(t => ['옥내소화전설비', '스프링클러설비', '간이스프링클러설비', '화재조기진압용 스프링클러설비',
      '물분무소화설비', '미분무소화설비', '포소화설비', '옥외소화전설비'].includes(t.trim())),
    tabNames.join(','))
  check('옥외소화전설비 탭 노출 — V21-1 해소(132 CHECK 확장분)',
    tabNames.some(t => t.trim() === '옥외소화전설비'), tabNames.join(','))

  // ── 2) 실측치 입력 → DB 저장 ──
  const fill = async (label: string, v: string) => {
    await panel.locator(`input[aria-label="${label}"]`).fill(v)
  }
  await fill('옥내소화전설비 주펌프 토출압 (MPa) 정격운전', '1.0')
  await fill('옥내소화전설비 주펌프 토출압 (MPa) 체절운전', '1.3')
  await fill('옥내소화전설비 주펌프 토출압 (MPa) 150% 운전', '0.7')
  await fill('옥내소화전설비 주펌프 토출량 (ℓ/min) 정격운전', '130')
  await fill('옥내소화전설비 주펌프 기동압력', '0.6')
  await page.click('text=※ 펌프성능시험')   // blur
  const r = await waitRow(2, '주', x => x?.rated_press === 1 && x?.over_press === 0.7 && x?.set_start_press === 0.6)
  check('실측치 DB 저장 — 정격 토출압', Number(r?.rated_press) === 1.0, JSON.stringify(r))
  check('실측치 DB 저장 — 체절 토출압', Number(r?.shutoff_press) === 1.3, JSON.stringify(r))
  check('실측치 DB 저장 — 150% 토출압', Number(r?.over_press) === 0.7)
  check('실측치 DB 저장 — 정격 토출량', Number(r?.rated_flow) === 130)
  check('설정압력(기동) 저장', Number(r?.set_start_press) === 0.6)

  // ── 3) 자동 판정 — ①은 140% 이하(1.3 ≤ 1.4)라 O, ③은 65% 이상(0.7 ≥ 0.65)이라 O ──
  check('① 자동 판정 O 표시(140% 이하)', await page.isVisible('text=자동 O'))
  check('② 규정치 없음 안내(자동 판정 안 함)', await page.isVisible('text=/명판·설계치/'))

  // ── 4) 수동 보정이 자동값을 이긴다 ──
  await page.locator('button[aria-label="1. 체절운전 시 토출압은 정격토출압의 140% 이하일 것 X"]').click()
  const r2 = await waitRow(2, '주', x => x?.judge1 === 'X')
  check('수동 보정 저장(judge1=X)', r2?.judge1 === 'X', JSON.stringify(r2))

  // ── 5) 별지 4호에 실측치·법정 문구가 실린다 ──
  // 별지 4호는 UI 미리보기 진입점이 없다(생성은 Gotenberg 필요). 그래서 **같은 서버 액션**을
  // 로그인 세션으로 직접 호출한다 — 코드 경로는 UI와 동일하고 파일도 만들지 않는다(_judge19 관례).
  const html4 = await (async () => {
    const id = await findActionId(page, 'getAnnexPreviewHtmlAction', [...scriptUrls])
    if (!id) return null
    const res = await callAction(page, id, [inspId, 'report4'])
    return parseFlight(res.text)
  })()
  if (html4?.html) {
    check('별지 4호에 펌프성능시험 표', html4.html.includes('펌프성능시험'), html4.error ?? '')
    check('별지 4호에 실측치(체절 1.3 · 150% 0.7)', html4.html.includes('1.3') && html4.html.includes('0.7'))
    check('별지 4호에 법정 판정 문구(140%)', html4.html.includes('140% 이하'))
    check('별지 4호에 설정압력 블록', html4.html.includes('기동'))
    check('수동 보정값이 문서에 반영(judge1=X)', /140% 이하일 것 \( X \)/.test(html4.html),
      html4.html.slice(html4.html.indexOf('140% 이하'), html4.html.indexOf('140% 이하') + 60))
  } else {
    check('별지 4호 렌더 확인 — 액션 호출', false, `액션 id 추출 실패 또는 빈 응답 (${html4?.error ?? 'no id'})`)
  }

  // ── 6) 값을 전부 지우면 행이 사라진다 (측정 안 함과 공란을 구분하기 위해) ──
  await page.click('[data-testid="workbench-stepbar"] button[data-step="checklist"]')
  await panel.waitFor({ timeout: 60000 })
  for (const label of ['옥내소화전설비 주펌프 토출압 (MPa) 정격운전', '옥내소화전설비 주펌프 토출압 (MPa) 체절운전',
    '옥내소화전설비 주펌프 토출압 (MPa) 150% 운전', '옥내소화전설비 주펌프 토출량 (ℓ/min) 정격운전',
    '옥내소화전설비 주펌프 기동압력']) {
    await panel.locator(`input[aria-label="${label}"]`).fill('')
  }
  // 판정 보정도 해제 — 남아 있으면 행이 유지되는 게 정상이므로 함께 지운다
  await page.locator('button[aria-label="1. 체절운전 시 토출압은 정격토출압의 140% 이하일 것 X"]').click()
  await page.click('text=※ 펌프성능시험')
  const gone = await waitRow(2, '주', x => x === null)
  check('전부 비우면 행 삭제(측정 안 함과 공란 구분)', gone === null, JSON.stringify(gone))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_pump_tests').delete().eq('inspection_id', inspId)
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
  }
  await cleanupCustomer(custId)
  await delUser(userId)
  summary()
}
