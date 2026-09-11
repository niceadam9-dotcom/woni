// 불량 0건 회차의 ④⑤⑥ **즉시 감춤** (소방계획서_48 — 2026-09-11 사용자 확정 「즉시 감춤으로 통일」).
//
//   불량(✕ ∪ 불량내역)이 0이면 작업대·달력·목록·사이드바·모바일이 **같은 표시 축**(visibleStepNums)으로
//   ④⑤⑥을 그리지 않는다. 게이트는 없다 — 점검표를 아직 안 채운 새 회차도 처음부터 3단계다.
//
// 🚨 이 파일은 **계약이 뒤집힌 자리**다. 2026-09-10 판(6 → 4 → 3)은 두 게이트를 전제했다:
//    ① 점검표를 채워야 ⑤⑥이 사라지고 ② 별지 9호를 제출해야 ④가 접힌다. 48차수가 그 둘을
//    폐지했으므로 종전 단언(「점검표 전 — 6단계 그대로」·`submit9-collapsed`/`submit9-expand`)은
//    **낡은 계약**이다. 지우지 않고 **새 계약으로 갈아끼운다** — 축이 사라지면 다음 변경이 눈먼다.
//
// 🚨 그리고 이 검사가 원래 존재한 이유는 그대로다: `test-gate-consistency`가 「6단계가 보이는가」만
//    물어 **줄어드는 쪽(양성 경로)이 한 번도 실행되지 않았다.** 그래서 여기서는 같은 회차를 굴리며
//    3 → 6 → 3을 차례로 단언한다(음성·양성·복귀). 한쪽만 물으면 「늘 감춘다」도, 「한 번도 안
//    감춘다」도 초록으로 빠져나간다.
//
// 🎯 마지막 블록이 이 차수에서 가장 비싼 단언이다 — **표시가 줄어도 의무는 안 줄어든다**.
//    별지 9호는 불량 유무와 무관한 법정 의무라(시행규칙 제23조제2항), 화면이 3/3 100%를 그려도
//    `inspections.status`는 completed가 되면 안 된다. 완료 판정의 분모는 여전히 activeStepNums다.
//
// ⚠ 양성 표본을 먼저 선단언한다 — 픽스처 저장이 실패하면 아래 단언들이 "안 바뀌었다"가 아니라
//   "바뀔 조건이 아니었다"로 조용히 통과한다.
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
  const statusOf = async () => {
    const { data } = await raw.from('inspections').select('status').eq('id', inspId).single()
    return (data?.status ?? '') as string
  }

  // ── ① 새 회차(점검표 전) — 처음부터 3단계 ────────────────────────────────────────
  // 🚨 종전 계약은 여기서 「6단계 그대로」였다(미측정을 합격으로 읽지 않는다). 사용자가 그 게이트를
  //    폐지했으므로 지금은 3단계가 옳다 — 불량이 생기면 ②에서 6으로 **되돌아오는지**가 안전망이다.
  await open()
  {
    const n = await barCount()
    check('새 회차 — 처음부터 ①②③ 3단계(게이트 없는 즉시 감춤)', n === 3, `${n}단계`)
    check('새 회차 — ④ 감춰짐', !(await hasStep('submit9')))
    check('새 회차 — ⑤ 감춰짐', !(await hasStep('repair')))
    check('새 회차 — ⑥ 감춰짐', !(await hasStep('submit11')))
    // 분모도 보이는 것으로 센다 — 3개가 보이는데 4/4라고 말하면 화면과 숫자가 어긋난다
    check('새 회차 — 진행률 분모가 3', await page.isVisible('text=/\\d\\/3 단계 완료/'))
    // 종전 회색 「해당없음」 행의 문구가 남으면 행만 지운 반쪽이다
    check('새 회차 — 「불량이 생기면 활성화」 안내가 없다',
      !(await page.isVisible('text=불량이 생기면 활성화')))
    // 감춰도 문서로 가는 길은 남아야 한다 — 합격 회차야말로 별지 9호를 제출해야 한다
    check('새 회차 — [별지서식] 창구는 남는다', await page.isVisible('text=별지서식'))
  }

  // ── ② 양성 — ✕ 응답이 하나 생기면 6단계로 복귀 ─────────────────────────────────
  // 이 블록이 없으면 「④⑤⑥을 늘 감춘다」는 변이가 ①만으로 초록이 된다.
  {
    const { error: xErr } = await raw.from('inspection_sheet_responses').insert({
      inspection_id: inspId, item_code: '1-A-001', result: 'X', month: 0,
    } as never)
    check('양성 표본 — ✕ 응답 저장 성공(아래 단언의 전제)', !xErr, xErr?.message ?? '')

    await open()
    const n = await barCount()
    check('✕ 1건 — ①~⑥ 6단계로 복귀', n === 6, `${n}단계`)
    check('✕ 1건 — ④ 복귀', await hasStep('submit9'))
    check('✕ 1건 — ⑤ 복귀', await hasStep('repair'))
    check('✕ 1건 — ⑥ 복귀', await hasStep('submit11'))
    check('✕ 1건 — 진행률 분모가 6', await page.isVisible('text=/\\d\\/6 단계 완료/'))
  }

  // ── ③ 음성 복귀 — ✕를 ○로 정정하면 다시 3단계 ──────────────────────────────────
  // 한 방향만 보면 「한 번 6이 되면 영영 6」이 초록으로 빠져나간다(표시 축은 되돌아와야 한다).
  {
    const { error: fixErr } = await raw.from('inspection_sheet_responses')
      .update({ result: 'O' } as never).eq('inspection_id', inspId).eq('item_code', '1-A-001')
    check('양성 표본 — ✕ → ○ 정정 성공(아래 단언의 전제)', !fixErr, fixErr?.message ?? '')

    await open()
    const n = await barCount()
    check('정정 후 — 다시 3단계(표시 축이 되돌아온다)', n === 3, `${n}단계`)
    check('정정 후 — ④ 다시 감춰짐', !(await hasStep('submit9')))
  }

  // ── ④ 🎯 의무 축 무손상 — 화면 3/3 100%인데 DB는 completed가 아니다 ───────────────
  // ①은 응답으로, ②③은 사유 완료 마커로 채운다(제품 경로 `forceCompleteStepAction`과 같은 형태).
  // 그러면 **보이는 3단계가 전부 완료**라 작업대는 100%를 그린다. 그러나 완료 판정의 분모는
  // activeStepNums(=①②③④)이므로 별지 9호 미제출인 이 회차는 completed가 되면 안 된다.
  // 여기가 붉어지면 「감춘다」가 「안 해도 된다」로 번져 법정 보고가 조용히 건너뛰어진 것이다.
  {
    const { error: mErr } = await raw.from('activity_logs').insert([2, 3].map(n => ({
      actor_id: userId, action: 'step_force_complete',
      entity_type: 'inspection', entity_id: inspId,
      metadata: { step_num: n, reason: 'E2E 의무 축 대조 — 보이는 단계를 전부 채운다' },
    })) as never)
    check('양성 표본 — ②③ 사유 완료 마커 저장 성공(아래 단언의 전제)', !mErr, mErr?.message ?? '')

    await open()           // 상세 진입이 syncInspectionSteps를 발화시킨다
    const n = await barCount()
    check('의무 축 — 보이는 단계는 여전히 3개', n === 3, `${n}단계`)
    check('의무 축 — 화면은 3/3 단계 완료를 그린다(전제)',
      await page.isVisible('text=/3\\/3 단계 완료/'))

    const st = await statusOf()
    check('🎯 의무 축 — 화면이 100%여도 inspections.status는 completed가 아니다 (별지 9호 미제출)',
      st !== 'completed', `status=${st}`)

    // 표시에서 감췄을 뿐 **행은 남는다** — 지우면 과거가 파괴되고 크론 분모도 사라진다
    const { data: rows } = await raw.from('inspection_steps')
      .select('step_num, status').eq('inspection_id', inspId).in('step_num', [4, 5, 6])
    check('의무 축 — ④⑤⑥ 행은 DB에 그대로 남아 있다', (rows ?? []).length === 3, `${(rows ?? []).length}행`)
    check('의무 축 — 그중 ④는 미완료다',
      ((rows ?? []) as Array<{ step_num: number; status: string }>)
        .find(r => r.step_num === 4)?.status !== 'completed')
  }

} catch (e) {
  console.error('❌ 예외:', (e as Error).message)
  // 🚨 `process.exitCode = 1`만으로는 **안 된다** — finally의 summary()가 `process.exit(_fail > 0 ? 1 : 0)`을
  //    불러 이 값을 덮는다. 셋업 중 예외가 나면 "0 통과 / 0 실패"로 **초록**이 되어 test-all이 PASS로 읽는다
  //    (2026-09-11 변이 실험 중 실측: 제품을 깨뜨려 화면이 안 뜨는데 이 스위트가 통과했다).
  //    실패로 세어 둔다 — 끝까지 못 갔으면 통과가 아니다.
  check('예외 없이 끝까지 실행됐다', false, (e as Error).message)
} finally {
  // summary()는 process.exit을 부른다 — try 안에서 부르면 이 정리가 통째로 건너뛰어진다
  if (browser) await browser.close()
  for (const c of custIds) await cleanupCustomer(c)
  const { raw: r } = await import('./_e2e-helpers.mjs')
  await r.from('profiles').delete().eq('id', userId)
  await r.auth.admin.deleteUser(userId).catch(() => {})
  summary()
}
