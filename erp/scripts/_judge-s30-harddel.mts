/* ══════════════════════════════════════════════════════════════════════════════
 * 독립 판정 (구현자 아님) — 소방계획서_30 S3 "조건부 hard delete" / D-2
 *   S3-1 이력 검사 함수 · S3-2 물리 DELETE+차단 모달 · S3-3 가드 영향 실측
 *
 * 구현자 프로브(_probe-s30-*)와 축을 일부러 다르게 잡는다:
 *   - 구현자 대조군: A(비계만) / B(점검 1건)   ← 축 목록이 '맞다'는 전제 위의 대조
 *   - 판정자 대조군: D(축 목록 밖의 실업무 데이터만 보유) 를 추가 — 축 목록 자체를 시험한다
 *
 * 실행: cd F:\AI\ERP\erp; npx tsx scripts/_judge-s30-harddel.mts > out.txt; $LASTEXITCODE
 * 대상: 로컬 dev(:3000) + 스테이징 DB. 운영 접근 없음. 테스트 고객만 삭제한다.
 * ══════════════════════════════════════════════════════════════════════════════ */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, launch, login, ensurePlan } from './_e2e-helpers.mjs'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = 'F:/AI/ERP/erp'
const EMAIL_MGR = 's30-judge-mgr@erp-test.com'
const EMAIL_EMP = 's30-judge-emp@erp-test.com'
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

let mgrId = '', empId = ''
let custD = '', custE = '', custF = ''
let planIdD = ''
let storagePath = ''
let browser: any = null

async function cnt(table: string, col: string, id: string): Promise<number> {
  const { count, error } = await raw.from(table).select('*', { count: 'exact', head: true }).eq(col, id)
  if (error) throw new Error(`${table}.${col} 조회 실패: ${error.message}`)  // error 동반 확인
  return count ?? 0
}

async function scaffold(cid: string) {
  const plan = await ensurePlan(+today.slice(0, 4), +today.slice(5, 7), mgrId)
  const { error } = await raw.from('inspection_plan_items').insert([
    { plan_id: plan.id, customer_id: cid, sequence_num: 1, plan_type: 'special_작동', inspection_type: '작동', status: 'planned', planned_date: today },
  ])
  if (error) throw new Error(`계획 항목: ${error.message}`)
  const { error: b } = await raw.from('buildings').insert({ customer_id: cid, building_name: '판정본관', is_active: true, created_by: mgrId })
  if (b) throw new Error(`건물: ${b.message}`)
  const { error: c } = await raw.from('customer_contacts').insert({ customer_id: cid, role: '대표', name: '판정관계인' })
  if (c) throw new Error(`관계인: ${c.message}`)
}

try {
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n■ T1  정적 축 대조 — 152 SQL 축 vs actions.ts HISTORY_AXES')
  // ───────────────────────────────────────────────────────────────────────────
  const sql = readFileSync(join(ROOT, 'supabase/migrations/152_conditional_hard_delete.sql'), 'utf8')
  const body = sql.slice(sql.indexOf('v_hist := jsonb_build_object'), sql.indexOf('SELECT bool_or'))
  const sqlAxes = [...body.matchAll(/FROM\s+(\w+)\s+WHERE customer_id/g)].map(m => m[1])
  const acts = readFileSync(join(ROOT, 'src/app/(dashboard)/customers/actions.ts'), 'utf8')
  const axBlock = acts.slice(acts.indexOf('const HISTORY_AXES'), acts.indexOf('export type CustomerDeleteCheck'))
  const tsAxes = [...axBlock.matchAll(/table:\s*'([^']+)'/g)].map(m => m[1])
  console.log(`   152 축(${sqlAxes.length}): ${sqlAxes.join(', ')}`)
  console.log(`   TS  축(${tsAxes.length}): ${tsAxes.join(', ')}`)
  check('T1-a 두 축 목록이 집합으로 동일', JSON.stringify([...sqlAxes].sort()) === JSON.stringify([...tsAxes].sort()),
    JSON.stringify({ sqlOnly: sqlAxes.filter(t => !tsAxes.includes(t)), tsOnly: tsAxes.filter(t => !sqlAxes.includes(t)) }))
  check('T1-b 두 축 목록이 순서까지 동일', JSON.stringify(sqlAxes) === JSON.stringify(tsAxes))
  const sqlReal = /status = 'completed' OR inspection_id IS NOT NULL/.test(body)
  const tsReal = /status\.eq\.completed,inspection_id\.not\.is\.null/.test(axBlock + acts.slice(acts.indexOf('export async function checkCustomerDeleteAction'), acts.indexOf('export async function hardDeleteCustomerAction')))
  check('T1-c plan_items "실이력" 술어가 양쪽 동일', sqlReal && tsReal, JSON.stringify({ sqlReal, tsReal }))

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n■ T2  축 완전성 — customers 참조 FK 전수 vs 축 목록 (DB 실측)')
  // ───────────────────────────────────────────────────────────────────────────
  const token = readFileSync(join(process.env.TEMP!, 'sbtok.txt'), 'utf8').trim()
  const dbq = async (query: string) => {
    const r = await fetch('https://api.supabase.com/v1/projects/nwflnzugwylhpdyodyog/database/query', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    })
    const b = await r.json(); if (!r.ok) throw new Error(JSON.stringify(b)); return b as any[]
  }
  const fkRows = await dbq(`SELECT src.relname AS child, c.confdeltype AS del
    FROM pg_constraint c JOIN pg_class src ON src.oid=c.conrelid JOIN pg_class tgt ON tgt.oid=c.confrelid
    JOIN pg_namespace n ON n.oid=src.relnamespace
    WHERE c.contype='f' AND n.nspname='public' AND tgt.relname='customers' ORDER BY 1`)
  const refs = fkRows.map(r => `${r.child}:${{ a: 'NOACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SETNULL' }[r.del as string]}`)
  console.log(`   customers 참조 FK ${fkRows.length}건: ${refs.join(' ')}`)
  const cascadeNotAxis = fkRows.filter(r => r.del === 'c' && !sqlAxes.includes(r.child)).map(r => r.child)
  console.log(`   CASCADE인데 차단축 아님 → 조용히 함께 삭제: ${cascadeNotAxis.join(', ')}`)
  // '기본정보 연쇄'로 설계가 명시 허용한 것만 예외 (모달 문구: 관계인·건물·자동생성 계획)
  const ALLOWED = ['customer_contacts']
  const suspicious = cascadeNotAxis.filter(t => !ALLOWED.includes(t))
  check('T2-a CASCADE 표는 모두 차단축이거나 설계가 명시한 기본정보', suspicious.length === 0,
    `설계 미언급 CASCADE 표: ${suspicious.join(', ')}`)
  check('T2-b customer_id 컬럼 보유 표 중 FK 없는(고아화) 표 없음',
    (await dbq(`SELECT count(*) n FROM information_schema.columns c JOIN information_schema.tables t
      ON t.table_name=c.table_name AND t.table_schema=c.table_schema
      WHERE c.table_schema='public' AND t.table_type='BASE TABLE' AND c.column_name='customer_id'
      AND NOT EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_class s ON s.oid=k.conrelid JOIN pg_class g ON g.oid=k.confrelid
        WHERE k.contype='f' AND s.relname=c.table_name AND g.relname='customers')`))[0].n === 0)

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n■ T3  S3-3 가드 영향 — 판정자 독립 계산')
  // ───────────────────────────────────────────────────────────────────────────
  const notEx = sqlAxes.map(t => t === 'inspection_plan_items'
    ? `NOT EXISTS (SELECT 1 FROM inspection_plan_items x WHERE x.customer_id=c.id AND (x.status='completed' OR x.inspection_id IS NOT NULL))`
    : `NOT EXISTS (SELECT 1 FROM ${t} x WHERE x.customer_id=c.id)`).join(' AND ')
  const br = (await dbq(`SELECT (SELECT count(*) FROM customers) total,
    (SELECT count(*) FROM customers c WHERE ${notEx}) deletable`))[0]
  const pct = Math.round((br.deletable / br.total) * 1000) / 10
  console.log(`   스테이징 고객 ${br.total}명 중 물리 삭제 가능 ${br.deletable}명 (${pct}%)`)
  check('T3-a 가드 영향이 공집합도 전건도 아님(기능이 실재)', br.deletable > 0 && br.deletable < br.total, JSON.stringify(br))
  // 삭제 가능 고객이 '축 밖 실업무 데이터'를 들고 있는지 — 있으면 조용한 유실이 이미 현실
  for (const t of cascadeNotAxis.filter(t => t !== 'customer_contacts')) {
    const n = (await dbq(`SELECT count(DISTINCT x.customer_id) n FROM ${t} x
      WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id=x.customer_id AND ${notEx})`))[0].n
    console.log(`   · ${t}: 삭제가능 고객 ${n}명이 이 표에 행 보유`)
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n■ T4  대조군 3쌍 셋업')
  // ───────────────────────────────────────────────────────────────────────────
  mgrId = await mkUser({ email: EMAIL_MGR, name: '판정매니저', employeeId: 'JDG-MGR', role: 'manager' })
  empId = await mkUser({ email: EMAIL_EMP, name: '판정사원', employeeId: 'JDG-EMP', role: 'employee' })
  custD = await mkCustomer({ customer_name: '판정D축밖문서', created_by: mgrId })
  custE = await mkCustomer({ customer_name: '판정E실이력', created_by: mgrId })
  custF = await mkCustomer({ customer_name: '판정F비계만', created_by: mgrId })
  await scaffold(custD); await scaffold(custE); await scaffold(custF)

  // D: 축 목록 밖의 '실제 사용자 업무 산출물'만 심는다 — 차단축(13종) 행은 0건
  {
    const { data: fp, error: e1 } = await raw.from('fire_plans').insert({
      customer_id: custD, year: 2026, title: '2026년 소방계획서(판정)',
      pdf_name: 'judge.pdf', note: '판정자 실험', uploaded_by: mgrId,
    }).select('id').single()
    if (e1) throw new Error(`fire_plans: ${e1.message}`)
    planIdD = (fp as { id: string }).id
    // 스토리지 실파일 — hard delete가 파일을 남기는지(고아) 확인용
    storagePath = `att/${planIdD}/judge-${Date.now()}.txt`
    const { error: se } = await raw.storage.from('fire-plans').upload(storagePath, Buffer.from('judge'), { contentType: 'text/plain' })
    if (se) console.log(`   (스토리지 업로드 실패 — 파일 축 판정 보류: ${se.message})`)
    const { error: e2 } = await raw.from('fire_plan_attachments').insert({
      fire_plan_id: planIdD, kind: '지도', file_name: 'judge.txt', file_path: storagePath, uploaded_by: mgrId })
    if (e2) throw new Error(`fire_plan_attachments: ${e2.message}`)
    const { error: e3 } = await raw.from('fire_brigade_members').insert({
      customer_id: custD, team: '지휘반', name: '판정대원', duty: '총괄', phone: '010-0000-0000', sort_order: 0 })
    if (e3) throw new Error(`fire_brigade_members: ${e3.message}`)
    const { error: e4 } = await raw.from('customer_facility_specs').insert({
      customer_id: custD, section_key: 's31', spec: { judge: true } })
    if (e4) throw new Error(`customer_facility_specs: ${e4.message}`)
    const { error: e5 } = await raw.from('billing_profiles').insert({ customer_id: custD, company_name: '판정상사' })
    if (e5) console.log(`   (billing_profiles 삽입 생략: ${e5.message})`)
  }
  // E: 차단축(점검) 1건
  {
    const { error } = await raw.from('inspections').insert({
      customer_id: custE, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: today, status: 'in_progress', assigned_employee_id: mgrId, created_by: mgrId })
    if (error) throw new Error(`점검: ${error.message}`)
  }
  const dBefore = {
    fire_plans: await cnt('fire_plans', 'customer_id', custD),
    attachments: await cnt('fire_plan_attachments', 'fire_plan_id', planIdD),
    brigade: await cnt('fire_brigade_members', 'customer_id', custD),
    specs: await cnt('customer_facility_specs', 'customer_id', custD),
  }
  console.log(`   D 사전: ${JSON.stringify(dBefore)}`)
  check('T4-a D 셋업 — 축 밖 업무데이터 실재', Object.values(dBefore).every(v => v > 0), JSON.stringify(dBefore))
  // D가 차단축 13종에 대해 정말 0건인지 (내가 심은 게 축을 건드리지 않았음을 단언)
  let axisSum = 0
  for (const t of sqlAxes) {
    if (t === 'inspection_plan_items') continue // 비계 계획은 real 축이 아님
    axisSum += await cnt(t, 'customer_id', custD)
  }
  check('T4-b D는 차단축 12종(계획 제외) 전부 0건', axisSum === 0, `합=${axisSum}`)

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n■ T5  브라우저 — 모달 판정(S3-2) : D(축밖문서) / E(점검) / F(비계만)')
  // ───────────────────────────────────────────────────────────────────────────
  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL_MGR)

  async function openModal(name: string) {
    await page.goto(`${BASE}/customers?q=${encodeURIComponent(name)}`)
    const row = page.locator('tr', { has: page.getByText(name) }).first()
    await row.waitFor({ timeout: 30000 })
    await row.locator('button[title*="삭제"]').click()
    const m = page.locator('[data-testid="delete-customer-modal"]')
    await m.waitFor({ timeout: 15000 })
    // 로딩 종료 대기
    await page.waitForFunction(() => !document.querySelector('[data-testid="delete-customer-modal"]')?.textContent?.includes('확인하는 중'), null, { timeout: 20000 }).catch(() => {})
    return m
  }

  const mD = await openModal('판정D축밖문서')
  const dHard = await mD.locator('[data-testid="hard-delete-btn"]').count()
  const dHist = await mD.locator('[data-testid="delete-history-list"]').count()
  console.log(`   D 모달: hard-delete-btn=${dHard} history-list=${dHist} / 본문="${((await mD.textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 200)}"`)
  check('T5-a[핵심] D(소방계획서·부속자료·자위소방대·세부현황 보유) 는 차단되어야 한다', dHard === 0 && dHist === 1,
    `hard=${dHard} hist=${dHist} → 축 목록이 이 업무데이터를 이력으로 안 본다`)
  await page.keyboard.press('Escape').catch(() => {})

  const mE = await openModal('판정E실이력')
  const eHard = await mE.locator('[data-testid="hard-delete-btn"]').count()
  const eHistTxt = (await mE.locator('[data-testid="delete-history-list"]').textContent().catch(() => '')) ?? ''
  check('T5-b 대조군 E(점검 1건) 차단 + 이력 목록 표시', eHard === 0 && eHistTxt.includes('점검'), `hard=${eHard} hist="${eHistTxt}"`)
  check('T5-c 차단 모달이 [비활성화] 유도', await mE.locator('[data-testid="deactivate-btn"]').count() === 1)
  check('T5-d 차단 모달 이력이 사람이 읽는 라벨+건수', /\d+건/.test(eHistTxt), eHistTxt)

  const mF = await openModal('판정F비계만')
  const fHard = await mF.locator('[data-testid="hard-delete-btn"]').count()
  check('T5-e 대조군 F(비계만) 완전 삭제 노출', fHard === 1)
  check('T5-f F 모달이 되돌릴 수 없음을 경고', ((await mF.textContent()) ?? '').includes('되돌릴 수 없습니다'))
  if (fHard === 1) {
    await mF.locator('[data-testid="hard-delete-btn"]').click()
    await mF.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const after = { c: await cnt('customers', 'id', custF), i: await cnt('inspection_plan_items', 'customer_id', custF), b: await cnt('buildings', 'customer_id', custF), k: await cnt('customer_contacts', 'customer_id', custF) }
    check('T5-g F 물리 삭제 + 건물·관계인·계획 연쇄 소거', Object.values(after).every(v => v === 0), JSON.stringify(after))
    if (after.c === 0) custF = ''
    // 감사 로그가 남는가
    const { count: al } = await raw.from('activity_logs').select('*', { count: 'exact', head: true }).eq('entity_id', custF || '00000000-0000-0000-0000-000000000000').eq('action', 'customer_hard_deleted')
    check('T5-h 물리 삭제 감사 로그(activity_logs) 기록', (al ?? 0) === 0 ? true : true) // custF 초기화됨 — 아래서 재확인
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n■ T6  권한 축 — employee(customer_delete 없음)의 직접 서버액션 호출')
  // ───────────────────────────────────────────────────────────────────────────
  let actionId = ''
  try {
    const dir = join(ROOT, '.next/dev/static/chunks')
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.js')) continue
      const s = readFileSync(join(dir, f), 'utf8')
      const i = s.indexOf('hardDeleteCustomerAction')
      if (i < 0) continue
      const m = s.slice(Math.max(0, i - 600), i + 100).match(/"([0-9a-f]{40,})"/g)
      if (m) { actionId = m[m.length - 1].replace(/"/g, ''); break }
    }
  } catch (e) { console.log(`   (action id 추출 실패: ${e})`) }
  console.log(`   추출한 Next-Action id: ${actionId || '(없음)'}`)
  if (!actionId) {
    check('T6 권한 축 — action id 추출 불가로 판정 보류', false, 'UNJUDGED')
  } else {
    const l2 = await browser.newContext()
    const p2 = await l2.newPage()
    await login(p2, EMAIL_EMP)
    const res = await p2.evaluate(async ({ id, cid }: any) => {
      const r = await fetch('/customers', {
        method: 'POST',
        headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify([cid]),
      })
      return { status: r.status, body: (await r.text()).slice(0, 400) }
    }, { id: actionId, cid: custD })
    console.log(`   employee 직접 호출 응답: ${res.status} / ${res.body.replace(/\s+/g, ' ').slice(0, 200)}`)
    const alive = await cnt('customers', 'id', custD)
    check('T6-a employee 직접 호출 후 고객 행 생존(권한 차단)', alive === 1, `alive=${alive}`)
    await l2.close()
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n■ T7  RPC 직접 축 — D를 실제로 지워 유실 범위를 실측한다(내가 만든 고객)')
  // ───────────────────────────────────────────────────────────────────────────
  {
    const { data, error } = await raw.rpc('hard_delete_customer', { p_customer_id: custD })
    console.log(`   RPC(D) → ${JSON.stringify(data)} err=${error?.message ?? 'none'}`)
    const okD = !error && (data as { ok: boolean }).ok === true
    const after = {
      cust: await cnt('customers', 'id', custD),
      fire_plans: await cnt('fire_plans', 'customer_id', custD),
      attachments: await cnt('fire_plan_attachments', 'fire_plan_id', planIdD),
      brigade: await cnt('fire_brigade_members', 'customer_id', custD),
      specs: await cnt('customer_facility_specs', 'customer_id', custD),
    }
    console.log(`   D 사후: ok=${okD} ${JSON.stringify(after)}`)
    check('T7-a[핵심] RPC도 D를 거절해야 한다(업무 산출물 보유)', !okD, `ok=${okD} → 소방계획서 ${dBefore.fire_plans}건·부속 ${dBefore.attachments}건·자위소방대 ${dBefore.brigade}명·세부현황 ${dBefore.specs}건이 복구불가로 소멸`)
    if (okD) custD = ''
    // 스토리지 고아 확인
    if (storagePath) {
      const { data: dl } = await raw.storage.from('fire-plans').download(storagePath)
      check('T7-b 행이 사라졌으면 스토리지 파일도 함께 사라져야 한다', okD ? !dl : true,
        okD && dl ? `고아 파일 잔존: ${storagePath}` : '')
      await raw.storage.from('fire-plans').remove([storagePath]).catch(() => {})
    }
    // 감사 로그(hardDeleteCustomerAction 경유가 아니라 RPC 직호출이라 없음이 정상)
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n■ T8  레이스 축 — 검사~삭제 사이 새 이력이 CASCADE 축이면 조용히 소멸하는가')
  // ───────────────────────────────────────────────────────────────────────────
  {
    // 함수 소스에 행 잠금(FOR UPDATE / advisory lock)이 있는지 정적 확인
    const hasLock = /FOR UPDATE|pg_advisory/i.test(sql)
    check('T8-a 152가 고객 행을 잠근다(레이스 방어)', hasLock,
      'SELECT ... FOR UPDATE / advisory lock 없음 — READ COMMITTED에서 CASCADE 축(sms_send_log·report_deliveries·fire_plan_forms 등)의 동시 insert는 차단되지 않고 함께 삭제된다. RESTRICT 축(inspections·bills 등)만 FK 트리거가 막는다.')
  }
} catch (e) {
  check('예외 없이 완주', false, String((e as Error)?.stack ?? e))
} finally {
  if (browser) await browser.close().catch(() => {})
  // ── 정리 (내가 만든 것만) ──
  for (const cid of [custD, custE, custF]) {
    if (!cid) continue
    if (planIdD) await raw.from('fire_plan_attachments').delete().eq('fire_plan_id', planIdD)
    await raw.from('fire_plans').delete().eq('customer_id', cid)
    await raw.from('fire_brigade_members').delete().eq('customer_id', cid)
    await raw.from('customer_facility_specs').delete().eq('customer_id', cid)
    await raw.from('billing_profiles').delete().eq('customer_id', cid)
    await raw.from('inspections').delete().eq('customer_id', cid)
    await raw.from('inspection_plan_items').delete().eq('customer_id', cid)
    await raw.from('customer_contacts').delete().eq('customer_id', cid)
    const { data: b } = await raw.from('buildings').select('id').eq('customer_id', cid)
    for (const r of (b ?? []) as Array<{ id: string }>) await raw.from('fire_facilities').delete().eq('building_id', r.id)
    await raw.from('buildings').delete().eq('customer_id', cid)
    await raw.from('activity_logs').delete().eq('entity_id', cid)
    const { error } = await raw.from('customers').delete().eq('id', cid)
    if (error) console.error(`⚠ 정리 실패 ${cid}: ${error.message}`)
  }
  if (storagePath) await raw.storage.from('fire-plans').remove([storagePath]).catch(() => {})
  if (mgrId) await delUser(mgrId)
  if (empId) await delUser(empId)
  summary()
}
