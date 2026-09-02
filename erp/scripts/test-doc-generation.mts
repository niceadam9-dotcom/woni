/** 소방계획서_7 H-16: 문서 생성 회귀 E2E — SDK 제거 후 6문서가 서버 HTML→Gotenberg PDF 경로로 생성되는지 고정.
 *
 *  신 경로(소방계획서_7 H-5~H-8·H-13, SDK·워커 미경유):
 *   · 자체점검 건  → requestReport9Action(report9/report4/report10/report11): assemble→render→convertHtmlToPdf
 *                    → storage {cust}/inspections/{insp}/{type}_<stamp>.pdf + fire_plan_gen_jobs status=done
 *   · 외관 건      → requestReport9Action('exterior') 동일 경로 → exterior_<stamp>.pdf
 *   · 계획서       → generateFirePlanNow(액션 requestFirePlanHwpAction): → {cust}/{year}/generated_web_<stamp>.pdf
 *                    + fire_plans pdf_status=ready
 *
 *  전부 서버 동기라 클릭 즉시 완료. 스크립트는 스테이징 사이트 UI를 Playwright로 클릭(액션 직접 호출 불가).
 *  실행: $env:TEST_BASE_URL='https://staging.sjfire.co.kr'; npx tsx scripts/test-doc-generation.mts
 *  전제: .env.local = 대상 사이트와 같은 DB(스테이징) · 대상 서버에 GOTENBERG_URL 구성.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium, type Browser, type Page } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const BUCKET = 'fire-plans'
const YEAR = new Date().getFullYear()
const KST = () => new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]
const EMAIL = 'doc-gen-e2e@erp-test.com'
const PW = 'DocGen1!'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

let userId = ''
const custIds: string[] = []
let browser: Browser | null = null

/** storage에서 {prefix}/{re} 매칭 최신 파일을 내려받아 %PDF 매직·크기>10KB 검증 */
async function verifyPdf(label: string, prefix: string, re: RegExp): Promise<void> {
  const { data: objects } = await raw.storage.from(BUCKET).list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } })
  const names = (objects ?? []).map((o: { name: string }) => o.name)
  const pdf = names.filter(n => re.test(n)).sort().reverse()[0]
  check(`${label}: PDF 생성물 존재`, !!pdf, `목록=[${names.join(', ')}]`)
  if (!pdf) return
  const { data: blob, error } = await raw.storage.from(BUCKET).download(`${prefix}/${pdf}`)
  if (error || !blob) { check(`${label}: PDF 다운로드`, false, error?.message ?? '없음'); return }
  const buf = new Uint8Array(await blob.arrayBuffer())
  const magic = new TextDecoder().decode(buf.slice(0, 5))
  check(`${label}: 매직 %PDF · 크기>10KB`, magic.startsWith('%PDF') && buf.length > 10_240, `magic=${magic} size=${buf.length}`)
}

/** 특정 report_type 잡이 done 으로 기록됐는지 (완료 기록 — 폴링 UI·문서 현황이 읽는 축) */
async function jobDone(inspectionId: string, reportType: string): Promise<boolean> {
  const { data } = await raw.from('fire_plan_gen_jobs')
    .select('status').eq('inspection_id', inspectionId).eq('report_type', reportType)
    .order('created_at', { ascending: false }).limit(1)
  return (data?.[0] as { status?: string } | undefined)?.status === 'done'
}

/** 생성 버튼 클릭 → 서버 동기 완료 폴링 (잡 done + PDF 파일) */
async function clickAndWait(
  page: Page, label: string, buttonText: string, inspectionId: string, reportType: string, prefix: string, re: RegExp,
): Promise<void> {
  // :text-is — '10호 PDF 생성'·'11호 PDF 생성'이 'PDF 생성'을 포함하므로 부분일치면 여러 개가 걸린다
  await page.click(`button:text-is("${buttonText}")`)
  const ok = await pollUntil(async () => (await jobDone(inspectionId, reportType))
    && ((await raw.storage.from(BUCKET).list(prefix, { limit: 100 })).data ?? []).some((o: { name: string }) => re.test(o.name)), 60_000)
  check(`${label}: 잡 done + 파일 생성`, ok)
  await verifyPdf(label, prefix, re)
}

async function pollUntil(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try { if (await fn()) return true } catch { /* 재시도 */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30_000 })
}

async function mkCustomer(fields: Record<string, unknown>): Promise<string> {
  const { data, error } = await raw.from('customers').insert({
    customer_code: `TEST-DOCGEN-${Math.random().toString(36).slice(2, 8)}`,
    is_active: true, created_by: userId, assigned_employee_id: userId,
    contract_date: `${YEAR}-01-05`, ...fields,
  }).select('id').single()
  if (error) throw new Error(`고객 생성 실패: ${error.message}`)
  custIds.push(data!.id)
  return data!.id as string
}

try {
  console.log(`\n[셋업] 대상 사이트: ${BASE} · DB: ${env.NEXT_PUBLIC_SUPABASE_URL}`)
  // ── 관리자 계정 ──
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({
    id: userId, name: 'TEST문서생성', role: 'admin', is_active: true,
    employee_id: 'E2E-DOCGEN', email: EMAIL, license_no: '소방-E2E-001', license_grade: '1급',
  })

  const today = KST()

  // ── 고객 A: 자체점검 건 (isSpecial=true → 별지 4·9·10·11호 대상) ──
  const custA = await mkCustomer({
    customer_name: 'TEST문서생성-자체점검A',
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    address: '세종특별자치시 자체점검로 10', fire_station: '세종소방서', use_approval_date: `${YEAR - 5}-03-01`,
    email_delivery_consent: true, report_email: 'ownerA@example.com', plan_anchor_date: `${YEAR}-06-10`,
    building_grade: '2급', manager_selected_at: `${YEAR - 1}-01-10`, insurance_joined: false,
    op_hours_weekday: '09:00~18:00', headcount_worker: 10,
  })
  await raw.from('customer_contacts').insert({ customer_id: custA, role: '대표', name: '김대표', phone: '010-1111-2222' })
  const { data: bldA, error: bldErr } = await raw.from('buildings').insert({
    customer_id: custA, is_active: true, created_by: userId, building_name: '본관', purpose: '업무시설',
    total_area: 3200, building_area: 800, floors_above: 5, floors_below: 1, height: 21,
    main_structure: '철근콘크리트조', roof_structure: '슬래브', permit_date: `${YEAR - 5}-01-01`,
    receiver_location: '1층 방재실',
  }).select('id').single()
  if (bldErr || !bldA) throw new Error(`건물A 생성 실패: ${bldErr?.message}`)
  // 설치 시설 (별지 9호 3쪽 롤업·별지 4호 세부현황 대상)
  const { error: facErr } = await raw.from('fire_facilities').insert([
    { building_id: bldA.id, category: '소화설비', facility_code: '소화기구', installed: true },
    { building_id: bldA.id, category: '소화설비', facility_code: '옥내소화전설비', installed: true },
  ])
  if (facErr) throw new Error(`시설A 생성 실패: ${facErr.message}`)

  const { data: inspA, error: inspAErr } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: today, inspection_end_date: today, inspection_days: 1,
    status: 'in_progress', assigned_employee_id: userId, created_by: userId, is_initial: false,
  }).select('id').single()
  if (inspAErr || !inspA) throw new Error(`점검A 생성 실패: ${inspAErr?.message}`)
  const inspAid = inspA.id as string

  // 점검표 응답 — 양호(O) 몇 개 + 불량(X) 1건 (8쪽 불량 세부·3쪽 롤업)
  await raw.from('inspection_sheet_responses').upsert([
    { inspection_id: inspAid, item_code: 'A-01', result: 'O', updated_by: userId },
    { inspection_id: inspAid, item_code: 'A-02', result: 'O', updated_by: userId },
    { inspection_id: inspAid, item_code: 'A-03', result: 'X', memo: '소화기 압력 미달', updated_by: userId },
  ], { onConflict: 'inspection_id,item_code' })

  // 불량 1건 — 이행계획(→10호) + 조치완료(→11호) 대상이 되도록 전부 채움
  await raw.from('inspection_defects').insert({
    inspection_id: inspAid, defect_code: 'A-03', defect_name: '소화기 압력 미달', severity: '보통',
    action_plan: '소화기 전량 교체', action_start: today, action_end: today,
    action_taken: '소화기 12본 신규 교체 완료', action_completed_at: today,
  })

  // ── 고객 B: 외관 건 (isSpecial=false → 외관점검표 대상) ──
  const custB = await mkCustomer({
    customer_name: 'TEST문서생성-외관B',
    inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: null,
    address: '세종특별자치시 외관로 20',
  })
  await raw.from('customer_contacts').insert({ customer_id: custB, role: '대표', name: '박관계', phone: '010-3333-4444' })
  await raw.from('buildings').insert({ customer_id: custB, is_active: true, created_by: userId, building_name: '본관', purpose: '근린생활시설' }).select('id')
  const { data: inspB, error: inspBErr } = await raw.from('inspections').insert({
    customer_id: custB, inspection_type: '일반관리', sequence_num: 1, plan_type: 'event',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (inspBErr || !inspB) throw new Error(`점검B 생성 실패: ${inspBErr?.message}`)
  const inspBid = inspB.id as string
  // 외관점검 시트 응답 (X{섹션}-{행}) — 응답 3건, 불량 1건
  await raw.from('inspection_sheet_responses').upsert([
    { inspection_id: inspBid, item_code: 'X1-01', result: 'O', updated_by: userId },
    { inspection_id: inspBid, item_code: 'X1-02', result: 'X', memo: '표지 훼손', updated_by: userId },
    { inspection_id: inspBid, item_code: 'X2-01', result: 'N', updated_by: userId },
  ], { onConflict: 'inspection_id,item_code' })

  // ── Playwright ──
  browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
  page.setDefaultTimeout(30_000)
  await login(page)
  check('로그인 성공', true)

  const prefA = `${custA}/inspections/${inspAid}`
  const prefB = `${custB}/inspections/${inspBid}`

  // ── 1) 자체점검 A 상세 — 별지 9·10·11호 생성 (작업대 ④⑤⑥ 칸 버튼) ──
  await page.goto(`${BASE}/inspections/${inspAid}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  check('A: 작업대 렌더(자체점검)', true)
  const goStep = async (step: string) => {
    await page.click(`[data-testid="workbench-stepbar"] button[data-step="${step}"]`)
    await page.waitForTimeout(300)
  }

  await goStep('submit9')
  // ④ 칸은 2026-08-20(d538280)부터 '문서 칩으로 고르고 → [PDF 생성]'이다 — 전용 [별지 9호 생성]은 폐지.
  // 칩은 스위치일 뿐 생성 동작이 없으므로, 눌러서 3칸을 별지 9호로 맞춘 뒤 생성 버튼을 누른다.
  await page.click('[data-doc-chip="report9"]')
  await clickAndWait(page, '별지 9호', 'PDF 생성', inspAid, 'report9', prefA, /^report9_\d+\.pdf$/)
  await goStep('repair')
  await clickAndWait(page, '별지 10호', '10호 PDF 생성', inspAid, 'report10', prefA, /^report10_\d+\.pdf$/)
  await goStep('submit11')
  await clickAndWait(page, '별지 11호', '11호 PDF 생성', inspAid, 'report11', prefA, /^report11_\d+\.pdf$/)

  // 별지 4호 — ① 칸(원천)과 ④ 칸(제출 직전 확인) 양쪽에 있다
  await goStep('checklist')
  await clickAndWait(page, '별지 4호', '별지 4호 생성', inspAid, 'report4', prefA, /^report4_\d+\.pdf$/)

  // ── 2) 외관 B 상세 — 외관점검표 생성 ──
  await page.goto(`${BASE}/inspections/${inspBid}`)
  await page.waitForSelector('text=외관점검표 (일반용)')
  check('B: 외관점검표 섹션 렌더', true)
  await clickAndWait(page, '외관점검표', '외관점검표 생성', inspBid, 'exterior', prefB, /^exterior_\d+\.pdf$/)

  // ── 3) 소방계획서 — 즉석 PDF 라우트 (2026-09-02 보관함 폐지) ──
  //  종전 [개정 발행](fire_plans 행 + generated_web_*.pdf 업로드)은 폐지됐다 — ERP는 계획서
  //  파일을 저장하지 않는다. 확인하려는 것은 두 가지: ① 라우트가 현재 데이터로 진짜 PDF를
  //  즉석 생성하는가(%PDF 매직), ② 그 과정에서 아무것도 **저장되지 않는가**(행 0 유지).
  await page.goto(`${BASE}/customers/${custA}?tab=plan&form=archive`)
  const viewBtn = page.locator('button:has-text("현재 내용")').first()
  const viewVisible = await viewBtn.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false)
  check('계획서: 조회·개정이력에 [현재 내용] 노출', viewVisible)
  if (!viewVisible) await page.screenshot({ path: 'scripts/_docgen-fireplan-debug.png', fullPage: true })
  check('계획서: [개정 발행] 폐지 확인', !(await page.isVisible('button:has-text("개정 발행")')))
  // 즉석 PDF — 페이지 세션 쿠키를 공유하는 request 컨텍스트로 라우트를 직접 친다
  const pdfRes = await page.request.get(`${BASE}/customers/${custA}/fire-plan/pdf`, { timeout: 130_000 })
  const pdfBody = pdfRes.ok() ? await pdfRes.body() : Buffer.alloc(0)
  check('계획서: 즉석 PDF 라우트 200 + %PDF 매직',
    pdfRes.ok() && pdfBody.subarray(0, 4).toString('latin1') === '%PDF',
    `status=${pdfRes.status()} bytes=${pdfBody.length}`)
  // 저장 없음 — fire_plans 행이 생기지 않았고 storage에도 generated_web_*이 새로 없다
  const { data: planRows } = await raw.from('fire_plans').select('id').eq('customer_id', custA)
  check('계획서: 저장 없음(fire_plans 0행 유지)', (planRows ?? []).length === 0, `rows=${(planRows ?? []).length}`)

  await browser.close(); browser = null
} catch (e) {
  fail++
  console.error('\n❌ 테스트 중단:', (e as Error).message)
} finally {
  if (browser) await browser.close()
  // ── 정리: 계정·고객A/B·연결 inspection·storage·잡·fire_plans 전부 삭제 ──
  for (const cid of custIds) {
    const inspIds = ((await raw.from('inspections').select('id').eq('customer_id', cid)).data ?? []).map((r: { id: string }) => r.id)
    if (inspIds.length) {
      for (const t of ['inspection_sheet_responses', 'inspection_defects', 'fire_plan_gen_jobs', 'inspection_steps', 'inspection_logs', 'report_deliveries']) {
        await raw.from(t).delete().in('inspection_id', inspIds)
      }
      // 점검 폴더 storage 파일 제거
      for (const iid of inspIds) {
        const prefix = `${cid}/inspections/${iid}`
        const { data: objs } = await raw.storage.from(BUCKET).list(prefix, { limit: 200 })
        const paths = (objs ?? []).map((o: { name: string }) => `${prefix}/${o.name}`)
        if (paths.length) await raw.storage.from(BUCKET).remove(paths)
      }
    }
    // 계획서 storage ({cust}/{year}) + fire_plans + 잡(고객 단위)
    for (const y of [YEAR - 1, YEAR, YEAR + 1]) {
      const prefix = `${cid}/${y}`
      const { data: objs } = await raw.storage.from(BUCKET).list(prefix, { limit: 200 })
      const paths = (objs ?? []).map((o: { name: string }) => `${prefix}/${o.name}`)
      if (paths.length) await raw.storage.from(BUCKET).remove(paths)
    }
    await raw.from('fire_plan_gen_jobs').delete().eq('customer_id', cid)
    await raw.from('fire_plans').delete().eq('customer_id', cid)
    await raw.from('fire_facilities').delete().in('building_id',
      (((await raw.from('buildings').select('id').eq('customer_id', cid)).data ?? []) as Array<{ id: string }>).map(b => b.id))
    await raw.from('buildings').delete().eq('customer_id', cid)
    await raw.from('customer_contacts').delete().eq('customer_id', cid)
    await raw.from('inspection_plan_items').delete().eq('customer_id', cid)
    await raw.from('inspections').delete().eq('customer_id', cid)
    await raw.from('activity_logs').delete().in('entity_id', [cid, ...inspIds])
    await raw.from('customers').delete().eq('id', cid)
  }
  if (userId) {
    await raw.from('profiles').delete().eq('id', userId)
    await raw.auth.admin.deleteUser(userId).catch(() => {})
  }
  console.log('\n[정리] 완료')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
