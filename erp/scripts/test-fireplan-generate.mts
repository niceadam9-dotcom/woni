// 소방계획서_21 R2-12 — 계획서 생성·조회 재편 E2E (#2 "조회를 파일에서 분리")
// 실행: node scripts/test-fireplan-generate.mts        (dev :3000 + 스테이징 DB)
//
// 이 재편의 약속은 셋이다.
//   ① 조회는 파일을 만들지 않는다        — previewFirePlanHtmlAction (Gotenberg 미호출)
//   ② 인쇄는 차수를 올리지 않는다        — ensureLatestFirePlanPdfAction (mode: 'reissue')
//   ③ 제출본은 갱신되지 않는다          — submitted_at 있으면 동결
//
// 환경 의존 때문에 절마다 실행 가능 여부가 다르다. **돌지 못한 절은 SKIP으로 명시**하고
// 절대 통과로 세지 않는다(과대 표기 방지 — erp_goal/Json_Rule.md).
//   · GOTENBERG_URL 미설정  → 실제 PDF 생성(개정 발행·인쇄 갱신) 불가
//   · 마이그레이션 127 미적용 → fire_plans.source_hash 없음 → 해시 비교·동결 경로 진입 불가
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'

const EMAIL = 'fireplan-gen-e2e@erp-test.com'
const YEAR = new Date().getFullYear()
const BUCKET = 'fire-plans'

let userId = ''
let custId = ''
let bldId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const skips: string[] = []
const skip = (name: string, why: string) => { skips.push(`${name} — ${why}`); console.log(`  ⏭  SKIP ${name} — ${why}`) }

/** fire_plans 행 수 (파일 생성 여부 판정의 1차 지표) */
const planCount = async () =>
  ((await raw.from('fire_plans').select('id').eq('customer_id', custId)).data ?? []).length
/** 이 고객의 storage 객체 수 — 미리보기가 파일을 남기지 않는지 확인 */
async function storageCount(): Promise<number> {
  let n = 0
  for (const prefix of [`${custId}`, `${custId}/${YEAR}`]) {
    const { data } = await raw.storage.from(BUCKET).list(prefix, { limit: 200 })
    n += (data ?? []).filter((o: { id?: string | null }) => o.id).length   // 폴더 항목(id=null) 제외
  }
  return n
}

try {
  // ── 시드 ──────────────────────────────────────────────────────────────────
  userId = await mkUser({ email: EMAIL, name: '계획서생성E2E', employeeId: 'E2E-FPG' })
  custId = await mkCustomer({
    customer_name: 'FPGE2E계획서생성', address: '경기 양평군 시험로 21',
    created_by: userId, fire_station: '양평소방서', assigned_employee_id: userId,
  })
  const { data: b, error: be } = await raw.from('buildings').insert({
    customer_id: custId, building_name: '본관', is_active: true, created_by: userId,
    purpose: '근린생활시설', total_area: 1200, floors_above: 5, floors_below: 1,
  }).select('id').single()
  if (be) throw new Error(`건물 생성 실패: ${be.message}`)
  bldId = (b as { id: string }).id
  await raw.from('customer_contacts').insert({
    customer_id: custId, role: '대표', name: '홍길동', phone: '010-1111-2222',
  })
  console.log(`[시드] 고객=${custId.slice(0, 8)}`)

  // ── 로그인 · 액션 id 확보 ─────────────────────────────────────────────────
  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  page.on('dialog', d => d.accept().catch(() => {}))
  const scriptUrls = collectScripts(page)
  await login(page, EMAIL)

  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForLoadState('networkidle')

  const previewId = await findActionId(page, 'previewFirePlanHtmlAction', scriptUrls)
  const ensureId = await findActionId(page, 'ensureLatestFirePlanPdfAction', scriptUrls)
  check('액션 id 확보 — previewFirePlanHtmlAction', !!previewId, String(previewId))
  check('액션 id 확보 — ensureLatestFirePlanPdfAction', !!ensureId, String(ensureId))

  // 환경 판정
  const hasGotenberg = !!process.env.GOTENBERG_URL
  const colChk = await raw.from('fire_plans').select('id, source_hash').limit(1)
  const hasHashCol = !colChk.error
  console.log(`[환경] GOTENBERG_URL=${hasGotenberg ? '설정' : '미설정'} · fire_plans.source_hash=${hasHashCol ? '있음' : '없음(마이그레이션 127 미적용)'}`)

  // ══════════ ① 조회는 파일을 만들지 않는다 ══════════
  console.log('\n— ① 현재 내용 미리보기 (파일 0)')
  const plansBefore = await planCount()
  const storeBefore = await storageCount()

  const p1 = parseFlight((await callAction(page, previewId, [custId, YEAR, ''])).text)
  check('미리보기 HTML 반환', !p1.error && p1.html.length > 500, p1.error || `${p1.html.length}자`)
  check('미리보기에 고객명이 병합됨', p1.html.includes('FPGE2E계획서생성'),
    p1.html.slice(0, 0) + (p1.html.includes('FPGE2E계획서생성') ? 'ok' : '미포함'))

  check('★ fire_plans 행이 늘지 않는다 (조회 ≠ 생성)', await planCount() === plansBefore,
    `${plansBefore} → ${await planCount()}`)
  check('★ storage 파일이 늘지 않는다', await storageCount() === storeBefore,
    `${storeBefore} → ${await storageCount()}`)

  // ── 서식을 고치면 다시 펼칠 때 최신이 나온다 ──
  // ⚠ 이 절은 한때 아무것도 검증하지 않았다(독립 검증 지적) — 앱이 읽지 않는 키
  //   `1.1.buildingNameOverride`에 표식을 넣고, 표식이 HTML에 있는지는 보지 않은 채
  //   "에러 없고 500자 넘음"만 단언했다. 수정이 반영되든 안 되든 통과하는 허수였다.
  //   그래서 **앱이 실제로 읽는 키**(evacPlan.assembly — fire-plan-generate.ts에서 집결지로 렌더,
  //   기본값 '1층 주차장')로 바꾸고 **표식이 HTML에 실렸는지**를 직접 단언한다.
  console.log('\n— ① 서식 수정 즉시 반영')
  const MARK = `E2E집결지${Date.now().toString().slice(-6)}`
  await raw.from('fire_plan_forms').upsert({
    customer_id: custId, sections: { evacPlan: { assembly: MARK } }, updated_by: userId,
  })
  const p2 = parseFlight((await callAction(page, previewId, [custId, YEAR, ''])).text)
  check('수정 후에도 미리보기 정상', !p2.error && p2.html.length > 500, p2.error || `${p2.html.length}자`)
  check('★ 고친 값이 미리보기에 즉시 반영된다', p2.html.includes(MARK), `표식 ${MARK} 미포함`)
  check('★ 수정 전 HTML과 달라진다', p1.html !== p2.html,
    `p1=${p1.html.length}자 p2=${p2.html.length}자`)
  check('★ 두 번째 미리보기도 파일을 만들지 않는다', await planCount() === plansBefore && await storageCount() === storeBefore,
    `plans=${await planCount()} store=${await storageCount()}`)

  // ══════════ ②③ 갱신·동결 — 대상 행이 필요하다 ══════════
  console.log('\n— ②③ 인쇄 갱신 / 제출본 동결')
  if (!hasHashCol) {
    skip('②-1 해시가 같으면 재생성하지 않는다', '마이그레이션 127 미적용 (fire_plans.source_hash 없음)')
    skip('②-2 인쇄가 차수를 올리지 않는다', '마이그레이션 127 미적용 + GOTENBERG_URL 미설정')
    skip('③ 제출본 동결', '마이그레이션 127 미적용 — ensureLatest가 source_hash를 SELECT해 진입 자체가 불가')
  } else {
    // 대상 행 시드 — 생성(Gotenberg) 없이 행만 만들어 규칙을 검증한다
    const { data: seed } = await raw.from('fire_plans').insert({
      customer_id: custId, year: YEAR, title: `${YEAR}년 소방계획서`,
      pdf_name: 'seed.pdf', pdf_path: `${custId}/${YEAR}/generated_web_seed.pdf`,
      html_path: `${custId}/${YEAR}/generated_web_seed.html`, pdf_status: 'ready',
      revision: 1, note: '자동 생성 (표준양식 웹 템플릿)', source_hash: 'SEED_STALE_HASH',
      uploaded_by: userId,
    }).select('id').single()
    const planId = (seed as { id: string }).id

    // ③ 제출본 동결 — submitted_at을 채우면 해시가 낡았어도 갱신되지 않아야 한다
    await raw.from('fire_plans').update({ submitted_at: '2026-03-15' }).eq('id', planId)
    const frozen = parseFlight((await callAction(page, ensureId, [planId])).text) as unknown as Record<string, unknown>
    const froRaw = (await callAction(page, ensureId, [planId])).text
    check('★ 제출본은 frozen으로 반환 — 갱신 경로로 가지 않는다', /"frozen":true/.test(froRaw), froRaw.slice(-160))
    const { data: afterFreeze } = await raw.from('fire_plans').select('pdf_path, source_hash').eq('id', planId).single()
    check('★ 제출본 pdf_path 불변', (afterFreeze as { pdf_path: string }).pdf_path.includes('generated_web_seed'),
      JSON.stringify(afterFreeze))
    check('★ 제출본 source_hash 불변(재조립조차 하지 않음)',
      (afterFreeze as { source_hash: string }).source_hash === 'SEED_STALE_HASH', JSON.stringify(afterFreeze))
    void frozen

    // ②-1 해시가 같으면 재생성하지 않는다 — 제출 해제 후, 실제 조립 해시를 넣어 둔다
    await raw.from('fire_plans').update({ submitted_at: null }).eq('id', planId)
    if (!hasGotenberg) {
      skip('②-1 해시가 같으면 재생성하지 않는다', 'GOTENBERG_URL 미설정 — 정답 해시를 얻으려면 1회 생성이 필요')
      skip('②-2 인쇄가 차수를 올리지 않는다', 'GOTENBERG_URL 미설정 — reissue가 PDF를 만들어야 한다')
    } else {
      const before = await raw.from('fire_plans').select('id, revision').eq('customer_id', custId)
      const r1 = (await callAction(page, ensureId, [planId])).text
      check('②-2 낡은 해시 → 갱신 수행(refreshed:true)', /"refreshed":true/.test(r1), r1.slice(-160))
      const after = await raw.from('fire_plans').select('id, revision').eq('customer_id', custId)
      check('★ 갱신이 행을 늘리지 않는다',
        (after.data ?? []).length === (before.data ?? []).length, `${(before.data ?? []).length} → ${(after.data ?? []).length}`)
      // ⚠ 종전에는 라벨만 '차수 불변'이고 실제로는 행 수만 봤다(독립 검증 지적).
      //   revision을 SELECT해 놓고 비교하지 않았다 — 차수가 올라가도 통과했을 것이다.
      const revOf = (rows: Array<{ id: string; revision: number }> | null) =>
        Object.fromEntries((rows ?? []).map(r => [r.id, r.revision]))
      const revB = revOf(before.data as Array<{ id: string; revision: number }>)
      const revA = revOf(after.data as Array<{ id: string; revision: number }>)
      check('★ 갱신이 차수를 올리지 않는다(reissue = 파일만 교체)',
        Object.keys(revB).every(id => revA[id] === revB[id]),
        `${JSON.stringify(revB)} → ${JSON.stringify(revA)}`)
      const r2 = (await callAction(page, ensureId, [planId])).text
      check('②-1 두 번째 호출은 해시가 같아 재생성하지 않는다(refreshed:false)', /"refreshed":false/.test(r2), r2.slice(-160))
    }
    await raw.from('fire_plans').delete().eq('id', planId)
  }

  // ══════════ 개정 발행 ══════════
  // ②는 "인쇄가 차수를 올리지 않는다"였다. 그 반대편 — **사람이 확정할 때는 차수가 오른다** — 을
  // 여기서 본다. 둘을 같이 봐야 "언제 올라가고 언제 안 올라가는가"가 규칙으로 고정된다.
  console.log('\n— [개정 발행] 새 행 + 차수 +1 + 이력 1행')
  if (!hasGotenberg) {
    skip('개정 발행 — 새 행 + revision +1 + 개정이력 1행', 'GOTENBERG_URL 미설정 (컨테이너는 스테이징·운영뿐)')
  } else {
    const genId = await findActionId(page, 'requestFirePlanHwpAction', [...scriptUrls])
    if (!genId) {
      skip('개정 발행', 'requestFirePlanHwpAction 액션 id 추출 실패')
    } else {
      const revsOf = async () => (await raw.from('fire_plan_revisions')
        .select('id').eq('customer_id', custId).eq('year', YEAR)).data?.length ?? 0
      const plansOf = async () => (await raw.from('fire_plans')
        .select('id, revision').eq('customer_id', custId).eq('year', YEAR)).data ?? []

      // 1차 발행 — 이 고객·연도의 첫 계획서
      const p0 = await plansOf(), r0 = await revsOf()
      const g1 = (await callAction(page, genId, [[custId], YEAR, ''])).text
      check('개정 발행 — 1차 요청 성공', /"requested":1/.test(g1), g1.slice(-200))
      const p1r = await plansOf()
      check('개정 발행 — 행이 생긴다', p1r.length === p0.length + 1, `${p0.length} → ${p1r.length}`)

      // 2차 발행 — 같은 고객·연도를 다시 확정하면 **새 행 + 차수 +1**
      const g2 = (await callAction(page, genId, [[custId], YEAR, ''])).text
      check('개정 발행 — 2차 요청 성공', /"requested":1/.test(g2), g2.slice(-200))
      const p2r = await plansOf()
      check('개정 발행 — 새 행이 또 생긴다(덮어쓰지 않는다)', p2r.length === p1r.length + 1,
        `${p1r.length} → ${p2r.length}`)
      const maxRev = Math.max(...p2r.map((x: { revision: number }) => x.revision ?? 1))
      const prevMax = Math.max(...p1r.map((x: { revision: number }) => x.revision ?? 1))
      check('개정 발행 — 차수 +1', maxRev === prevMax + 1, `${prevMax} → ${maxRev}`)
      check('개정 발행 — 개정이력이 쌓인다', await revsOf() > r0, `${r0} → ${await revsOf()}`)
    }
  }

} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 600))
} finally {
  if (browser) await browser.close().catch(() => {})
  // 정리 — 생성물·행·시드
  if (custId) {
    const { data: paths } = await raw.storage.from(BUCKET).list(`${custId}/${YEAR}`, { limit: 200 })
    const keys = (paths ?? []).filter((o: { id?: string | null }) => o.id).map((o: { name: string }) => `${custId}/${YEAR}/${o.name}`)
    if (keys.length) await raw.storage.from(BUCKET).remove(keys)
    await raw.from('fire_plan_revisions').delete().eq('customer_id', custId)
    await raw.from('fire_plans').delete().eq('customer_id', custId)
    await raw.from('fire_plan_forms').delete().eq('customer_id', custId)
    await raw.from('customer_contacts').delete().eq('customer_id', custId)
    if (bldId) await raw.from('buildings').delete().eq('id', bldId)
    await cleanupCustomer(custId).catch((e: Error) => console.error('고객 정리 실패:', e.message))
  }
  await delUser(userId)
  const { data: left } = await raw.from('customers').select('id').like('customer_name', 'FPGE2E%')
  console.log('[정리 확인] 잔존 고객:', (left ?? []).length)
  if (skips.length) {
    console.log(`\n⏭  건너뛴 절 ${skips.length}건 (통과로 세지 않음):`)
    for (const s of skips) console.log(`   · ${s}`)
  }
  summary()
}
