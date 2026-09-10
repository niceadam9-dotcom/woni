// 모두 합격 회차의 단계 접기·감추기 (2026-09-10 사용자 지시).
//
//   ⑤⑥  점검표를 다 채웠고 불량이 0이면 **아예 그리지 않는다**(종전엔 회색 「해당없음」 행이 남아
//         '아직 할 일이 있다'처럼 읽혔다).
//   ④    같은 조건에서 **접힌 한 줄**이 되고, 소방서 제출일이 기록되면 스텝바에서도 사라진다.
//
// 🚨 이 검사가 존재하는 이유. `test-gate-consistency`는 「6단계가 그대로 보이는가」만 물어서
//    **줄어드는 쪽(양성 경로)이 한 번도 실행되지 않았다.** 실제로 첫 구현은 점검표를 안 채운
//    새 회차까지 4단계로 줄여 버렸는데, 그 결함은 음성 단언에서만 잡혔고 양성은 아무도 안 봤다.
//    그래서 여기서는 **같은 회차를 세 상태로 굴리며** 6 → 4 → 3을 차례로 단언한다.
//
// ⚠ 양성 표본을 먼저 선단언한다 — 응답 저장이 실패하면 ①이 미완이라 6단계가 그대로 나오고,
//   그러면 아래 단언들이 "줄지 않았다"가 아니라 "줄일 조건이 아니었다"로 조용히 통과한다.
//
// 실행: (dev 또는 prod build 기동 후) npx tsx scripts/test-allpass-step-collapse.mts
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'allpass-collapse-e2e@erp-test.com'
let userId = ''
const custIds: string[] = []
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const kst = (days: number) => new Date(Date.now() + 9 * 3600_000 + days * 86400_000).toISOString().split('T')[0]

const BAR = '[data-testid="workbench-stepbar"]'

try {
  userId = await mkUser({ email: EMAIL, name: '합격접기', employeeId: 'E2E-AC', role: 'admin' })
  const cid = await mkCustomer({
    customer_name: '모두합격접기E2E', created_by: userId,
    inspection_type: '작동', inspection_sub_type: '작동', inspection_category: '소방안전관리',
  })
  custIds.push(cid)
  const { data: ins, error } = await raw.from('inspections').insert({
    customer_id: cid, inspection_type: '작동', sequence_num: 1, plan_type: null,
    inspection_start_date: kst(-5), inspection_end_date: kst(-5),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  const inspId = ins!.id as string

  const l = await launch(); browser = l.browser; const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)

  const barCount = async () => page.locator(`${BAR} button`).count()
  const hasStep = async (k: string) => (await page.locator(`${BAR} button[data-step="${k}"]`).count()) > 0
  const open = async () => {
    await page.goto(`${BASE}/inspections/${inspId}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(BAR)
  }

  // ── ① 점검표 전(아직 아무것도 안 쟀다) — 줄이면 안 된다 ──────────────────────────
  // 불량 0건은 맞지만 '합격'이 아니라 '미측정'이다. 이 구간을 줄이면 4단계짜리 점검처럼 보인다.
  await open()
  {
    const n = await barCount()
    check('점검표 전 — 6단계 그대로(미측정을 합격으로 읽지 않는다)', n === 6, `${n}단계`)
    check('점검표 전 — ⑤가 아직 보인다', await hasStep('repair'))
    check('점검표 전 — ⑥이 아직 보인다', await hasStep('submit11'))
  }

  // ── ② 점검표 모두 합격(○만, ✕ 0) — ⑤⑥ 사라지고 ④는 접힌다 ─────────────────────
  const { error: rErr } = await raw.from('inspection_sheet_responses').insert({
    inspection_id: inspId, item_code: '1-A-001', result: 'O', month: 0,
  } as never)
  // 🚨 양성 표본 선단언 — 이게 실패하면 ①이 미완이라 6단계가 그대로 나오고, 아래 단언들이
  //    "안 줄었다"가 아니라 "줄일 조건이 아니었다"로 조용히 초록이 된다.
  check('양성 표본 — 합격 응답 저장 성공(아래 단언의 전제)', !rErr, rErr?.message ?? '')

  await open()
  {
    const n = await barCount()
    check('모두 합격 — ①②③④ 4단계만', n === 4, `${n}단계`)
    check('모두 합격 — ⑤ 사라짐(회색으로 남지 않는다)', !(await hasStep('repair')))
    check('모두 합격 — ⑥ 사라짐', !(await hasStep('submit11')))
    check('모두 합격 — ④는 남는다(별지 9호는 법정 의무)', await hasStep('submit9'))
    // 종전 회색 행의 문구가 화면 어디에도 남지 않았는가 — 행만 지우고 문구가 남으면 반쪽이다
    check('모두 합격 — 「불량이 생기면 활성화」 안내가 없다',
      !(await page.isVisible('text=불량이 생기면 활성화')))
  }

  // ── ③ ④ 접힘 → [열기] → 3칸 ────────────────────────────────────────────────
  {
    await page.click(`${BAR} button[data-step="submit9"]`)
    const collapsed = await page.waitForSelector('[data-testid="submit9-collapsed"]', { timeout: 30000 })
      .then(() => true).catch(() => false)
    check('④ 기본은 접힌 한 줄', collapsed)
    // 접힌 동안에는 3칸이 안 펼쳐진다 — 접기가 '보이기만 다른 것'이 되지 않게
    check('④ 접힌 동안 3칸 미노출', !(await page.isVisible('text=제출 전제')))

    await page.click('[data-testid="submit9-expand"]')
    const opened = await page.waitForSelector('text=제출 전제', { timeout: 30000 })
      .then(() => true).catch(() => false)
    check('④ [열기] → 3칸 펼침', opened)
    // 🚨 접기가 문서 생성 창구를 죽이지 않았는가 — 합격 회차야말로 별지 9호를 내야 한다
    check('④ 펼치면 별지 9호 생성 칩이 있다', await page.isVisible('[data-doc-chip="report9"]'))
    check('④ 펼치면 소방서 제출일 칸이 있다', await page.isVisible('text=소방서 제출일'))
  }

  // ── ④ 제출일 기록 → ④도 사라진다 ────────────────────────────────────────────
  {
    const { error: sErr } = await raw.from('inspections')
      .update({ report9_submitted_at: kst(0) } as never).eq('id', inspId)
    check('양성 표본 — 제출일 기록 성공(아래 단언의 전제)', !sErr, sErr?.message ?? '')

    await open()
    const n = await barCount()
    check('제출 후 — ①②③ 3단계만(④도 사라진다)', n === 3, `${n}단계`)
    check('제출 후 — ④ 사라짐', !(await hasStep('submit9')))
    // 분모가 같이 줄어야 화면과 숫자가 어긋나지 않는다. 3개가 보이는데 4/4라고 말하면 안 된다.
    check('제출 후 — 진행률 분모가 3', await page.isVisible('text=/\\d\\/3 단계 완료/'))
    // 사라져도 문서로 가는 길은 남아야 한다(제출일 정정·재생성)
    check('제출 후 — [별지서식] 링크는 남는다', await page.isVisible('text=별지서식'))
  }

} catch (e) {
  console.error('❌ 예외:', (e as Error).message)
  process.exitCode = 1
} finally {
  // summary()는 process.exit을 부른다 — try 안에서 부르면 이 정리가 통째로 건너뛰어진다
  if (browser) await browser.close()
  for (const c of custIds) await cleanupCustomer(c)
  const { raw: r } = await import('./_e2e-helpers.mjs')
  await r.from('profiles').delete().eq('id', userId)
  await r.auth.admin.deleteUser(userId).catch(() => {})
  summary()
}
