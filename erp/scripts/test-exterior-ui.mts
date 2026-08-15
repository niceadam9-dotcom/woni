// 외관점검표(§9-8d) E2E — 일반관리 점검: EXT 시트 노출 → 응답 → 생성 요청 → 워커 처리 → 생성물 확인
// 실행: npx tsx scripts/test-exterior-ui.mts   (로컬 dev + 스테이징 DB + 워커 상주)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'exterior-e2e@erp-test.com'
let userId = ''
let custId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '외관E2E', employeeId: 'E2E-EXT' })
  custId = await mkCustomer({
    customer_name: '외관E2E일반관리', created_by: userId,
    inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: null,
    address: '세종시 외관로 1',
  })
  await raw.from('customer_contacts').insert({ customer_id: custId, role: '대표', name: '박관계', phone: '010-2222-3333' })

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  // W-4(소방계획서_6) 이후 외관/정기 판정은 plan_type 축 단독 — 일반관리는 event로 생성된다(당일 1회성).
  // plan_type 없이 만들면 자체점검으로 분류돼 외관점검표 섹션 자체가 렌더되지 않는다.
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '일반관리', sequence_num: 1, plan_type: 'event',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = insp!.id

  // 외관점검 시트 응답 3건 (섹션 1 — ○/×/／) — EX-4(125) 이후 유니크 축은 (inspection_id,item_code,month)
  const month = now.getMonth() + 1
  const { error: rErr } = await raw.from('inspection_sheet_responses').upsert([
    { inspection_id: inspId, item_code: 'X1-01', result: 'O', month, updated_by: userId },
    { inspection_id: inspId, item_code: 'X1-02', result: 'X', memo: '표지 훼손', month, updated_by: userId },
    { inspection_id: inspId, item_code: 'X1-03', result: 'N', month, updated_by: userId },
  ], { onConflict: 'inspection_id,item_code,month' })
  if (rErr) throw new Error(`응답 주입 실패: ${rErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/inspections/${inspId}`)
  await page.waitForSelector('text=외관점검표 (일반용)')
  check('외관점검표 섹션 렌더', true)
  check('부제(2년 보관)', await page.isVisible('text=작성 후 2년 보관'))
  check('① 외관점검 응답 (3건)', await page.isVisible('text=응답 3건 · 불량 1건'))
  check('② 점검자 배정', await page.isVisible('text=점검자 외관E2E'))
  check('③ 관계인 등록', await page.isVisible('text=소방안전관리자란에 대표 관계인 기재'))
  check('별지 9호 섹션 미노출(일반관리)', !(await page.isVisible('text=실시결과 보고서 (별지 9호)')))
  check('점검표 헤더 = 외관점검(별지 6호)', await page.isVisible('text=외관점검 (별지 6호)'))
  check('EXT 시트 버튼(소화기구)', await page.isVisible('button:has-text("소화기구 및 자동소화장치")'))
  check('EXT 시트 버튼(전기시설)', await page.isVisible('button:has-text("전기시설")'))

  // 시트 열기 — 구분(facility_type) 그룹·기존 응답 로드
  await page.click('button:has-text("소화기구 및 자동소화장치")')
  await page.waitForSelector('text=거주자 등이 손쉽게 사용할 수 있는 장소에 설치되어 있는지 여부')
  check('EXT 항목 로드', true)
  check('구분 그룹 헤더(자동확산소화기)', await page.isVisible('text=자동확산소화기'))
  // 23 개편: 시트는 포털 드로어로 뜬다 — [← 설비 목록] 대신 ✕로 닫는다(뒤 버튼이 백드롭에 가리므로 필수)
  await page.click('[data-testid="sheet-drawer-close"]')
  await page.waitForSelector('[data-testid="sheet-drawer"]', { state: 'detached' })

  // 생성 → 서버 동기 생성(H-7·H-8: HTML→Gotenberg PDF, 워커 폐지) → 생성물
  await page.click('button:has-text("외관점검표 생성")')
  await page.waitForSelector('text=생성 완료', { timeout: 90000 })
  check('생성 완료 메시지', true)
  const job = await pollDb(async () => {
    const { data } = await raw.from('fire_plan_gen_jobs')
      .select('id, status, missing, error').eq('inspection_id', inspId).eq('report_type', 'exterior')
      .order('created_at', { ascending: false }).limit(1)
    const j = data?.[0]
    return j && (j.status === 'done' || j.status === 'failed') ? j : null
  }, 90000)
  check('잡 완료(done)', job?.status === 'done', JSON.stringify(job))
  if (job?.status === 'done') {
    const { data: objects } = await raw.storage.from('fire-plans').list(`${custId}/inspections/${inspId}`)
    const names = (objects ?? []).map((o: { name: string }) => o.name)
    check('생성물 exterior_*.html', names.some((n: string) => /^exterior_\d+\.html$/.test(n)), names.join(','))
    check('생성물 exterior_*.pdf', names.some((n: string) => /^exterior_\d+\.pdf$/.test(n)))
    check('누락 목록에 응답없음 아님', !(job.missing ?? []).some((m: string) => m.includes('응답 없음')), JSON.stringify(job.missing))
    // 화면 갱신 후 생성물 목록 — 원시 파일명이 아니라 라벨+[PDF]·[미리보기]로 렌더된다(GeneratedDocList).
    // '받기'는 hwp/pdf/html이 전무한 그룹의 폴백이라 여기선 안 나온다.
    await page.goto(`${BASE}/inspections/${inspId}`)
    await page.waitForSelector('button[title="바로 보기·인쇄"]')
    check('생성물 목록 — PDF 열람 버튼', true)
    check('생성물 목록 — 미리보기(HTML)', await page.isVisible('button:has-text("미리보기")'))
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('fire_plan_gen_jobs').delete().eq('inspection_id', inspId)
    const { data: objects } = await raw.storage.from('fire-plans').list(`${custId}/inspections/${inspId}`)
    const paths = (objects ?? []).map((o: { name: string }) => `${custId}/inspections/${inspId}/${o.name}`)
    if (paths.length) await raw.storage.from('fire-plans').remove(paths)
  }
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
summary()
