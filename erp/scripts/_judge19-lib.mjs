/** [독립 판정] 소방계획서_19 B-7 (L-D-4) — savePlanTextAction version 오증가 교정 실주행
 *  실행: node scripts/_judge19-lib.mjs   (dev 서버 :3000 + 스테이징 DB, 마이그레이션 119)
 *  _judge-lib-a.mjs의 L-D-4 구간을 판정용으로 재실행한다(항목 접두어 [JUDGE19], 실데이터 0행 확인 후 시드).
 *  기대: rename → version 불변 / body 변경 → +1 / 동일 body 재등록 → **version 불변**(종전 반증분 해소)
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'judge19-lib@erp-test.com'
const SCEN = '[JUDGE19] 판정 시나리오 v1 — 지하 전기실 화재 상정, 초기소화·통보·피난 유도 순차 대응'
const SCEN_TA = 'textarea[placeholder="유형 프리셋을 불러온 뒤 고객 상황에 맞게 수정하세요."]'
let userId = '', cid = '', browser = null

const sortKeys = v => Array.isArray(v) ? v.map(sortKeys)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v
const ss = v => JSON.stringify(sortKeys(v))

try {
  const { count } = await raw.from('plan_text_library').select('id', { count: 'exact', head: true })
  console.log(`[사전] plan_text_library 실데이터 ${count}행 — [JUDGE19] 접두어만 시드/삭제한다`)
  await raw.from('plan_text_library').delete().like('title', '%[JUDGE19]%')

  userId = await mkUser({ email: EMAIL, name: '판정19라이브', employeeId: 'JUDGE19-L' })
  cid = await mkCustomer({ customer_name: 'JUDGE19라이브고객', address: '경기 양평군 판정로 21', created_by: userId })
  const { error: sErr } = await raw.from('fire_plan_forms').upsert({
    customer_id: cid,
    sections: {
      training: {
        headcount: { worker: '9' }, eduMonths: [4], drillMonths: [10],
        scenario: SCEN, scenarioType: '상가형',
        details: [{ name: '[JUDGE19] 공통 소방교육', at: '2026-05-01', place: '대회의실', target: '전 직원', kind: '교육', form: '강의', materials: '', plan: '연 2회' }],
        records: [],
      },
    },
  }, { onConflict: 'customer_id' })
  if (sErr) throw new Error(`서식 저장 실패: ${sErr.message}`)

  const l = await launch(); browser = l.browser
  const page = l.page
  page.setDefaultTimeout(120000)
  let promptText = ''
  page.on('dialog', d => { if (d.type() === 'prompt') d.accept(promptText); else d.accept() })
  await login(page, EMAIL)
  const pollUi = async (fn, ms = 20000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { try { if (await fn()) return true } catch { /* retry */ } await new Promise(r => setTimeout(r, 400)) }
    return false
  }

  // dev 서버가 재컴파일·재기동 중이면 라우트가 일시적으로 404/연결거부를 준다(타 세션이 같은 서버를 쓰는 중) —
  // 200 될 때까지 조건 폴링(고정 대기 금지 규약과 동일 취지)
  for (let i = 0; i < 20; i++) {
    try {
      const r = await page.goto(`${BASE}/customers/${cid}?tab=plan&form=1.11`)
      if (r && r.status() === 200) break
      console.log(`   (라우트 HTTP ${r?.status()} — 재시도 ${i + 1})`)
    } catch (e) {
      console.log(`   (연결 실패 — 재시도 ${i + 1}: ${String(e.message).slice(0, 60)})`)
    }
    await new Promise(res => setTimeout(res, 3000))
  }
  await page.waitForSelector('text=1.11.3 훈련 시나리오')
  await pollUi(async () => (await page.inputValue(SCEN_TA)) === SCEN)
  promptText = '[JUDGE19] 훈련A'
  await page.click('[data-testid="libtext-save-training"]')
  await page.waitForSelector(`text=✅ '[JUDGE19] 훈련A' 등록됨`)
  const lib = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('id, version, body')
      .eq('title', '[JUDGE19] 훈련A').eq('section_key', 'training').maybeSingle()
    return data
  })
  if (!lib) throw new Error('등록 항목 미생성')
  check('등록 직후 version=1', lib.version === 1, String(lib.version))

  // ── rename → version 미증가 ──
  await page.click('[data-testid="libtext-open-training"]')
  await page.waitForSelector('[data-testid="libtext-list-training"] button:has-text("[JUDGE19] 훈련A")')
  await page.click('[data-testid="libtext-list-training"] button[title="이름변경"]', { force: true })
  await page.fill('[data-testid="libtext-list-training"] input', '[JUDGE19] 훈련A개명')
  await page.click('[data-testid="libtext-list-training"] button:has-text("확인")')
  const renamed = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('title, version').eq('id', lib.id).single()
    return data?.title === '[JUDGE19] 훈련A개명' ? data : null
  })
  check('B-7b rename → title만 갱신·version 불변', !!renamed && renamed.version === lib.version, JSON.stringify(renamed))

  // ── body 변경 덮어쓰기 → version +1 ──
  await page.click('button:has-text("공장형")')
  await pollUi(async () => (await page.inputValue(SCEN_TA)) !== SCEN)
  promptText = '[JUDGE19] 훈련A개명'
  await page.click('[data-testid="libtext-save-training"]')
  await page.waitForSelector(`text=✅ '[JUDGE19] 훈련A개명' 등록됨`)
  const bumped = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('version, updated_at, body').eq('id', lib.id).single()
    return data?.version === lib.version + 1 ? data : null
  })
  check('B-7b 실제 body 변경 → version +1', !!bumped, JSON.stringify({ v: bumped?.version }))

  // ── 동일 body 재등록 → version 불변(핵심) ──
  const before = bumped ?? (await raw.from('plan_text_library').select('version, updated_at, body').eq('id', lib.id).single()).data
  await page.click('[data-testid="libtext-save-training"]')
  const same = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('version, updated_at, body').eq('id', lib.id).single()
    return data && data.updated_at !== before.updated_at ? data : null
  }, 20000)
  check('덮어쓰기 실행됨(updated_at 갱신)', !!same, JSON.stringify({ before: before.updated_at, after: same?.updated_at }))
  check('B-7a 동일 body 재등록 → body 동일', !!same && ss(same.body) === ss(before.body))
  check('B-7 [종전 반증 해소] 동일 body 재등록 → **version 불변**',
    !!same && same.version === before.version, JSON.stringify({ before: before.version, after: same?.version }))

  // ── 한 번 더 재등록해도 계속 불변(누적 증가 없음) ──
  await page.click('[data-testid="libtext-save-training"]')
  const again = await pollDb(async () => {
    const { data } = await raw.from('plan_text_library').select('version, updated_at').eq('id', lib.id).single()
    return data && data.updated_at !== same?.updated_at ? data : null
  }, 20000)
  check('반복 재등록에도 version 불변', !!again && again.version === before.version, JSON.stringify(again))
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 400))
} finally {
  if (browser) await browser.close().catch(() => {})
  await raw.from('plan_text_library').delete().like('title', '%[JUDGE19]%')
  if (cid) {
    await raw.from('plan_text_applied').delete().eq('customer_id', cid)
    await raw.from('fire_plan_forms').delete().eq('customer_id', cid)
    await cleanupCustomer(cid).catch(e => console.error('고객 정리 실패:', e.message))
  }
  await delUser(userId)
  const { count } = await raw.from('plan_text_library').select('id', { count: 'exact', head: true })
  const { data: lc } = await raw.from('customers').select('id').like('customer_name', 'JUDGE19%')
  console.log(`[정리 확인] plan_text_library ${count}행(사전과 동일해야 함) · JUDGE19 고객 잔존 ${(lc ?? []).length}건`)
  summary()
}
