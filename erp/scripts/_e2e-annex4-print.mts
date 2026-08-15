// 소방계획서_22 실데이터 E2E — 별지 4호 인쇄 규칙(S1·S2·S3·S4·S6·S12·S14) + 원클릭 번들(S13)
// 시나리오: 전 설비 설치(최대 분량) + 1-B 전량 ／ + 무응답 공란 + 다중이용업(STD-32 응답 → MU 롤업)
// → 작업대에서 별지 4호 생성(실 서버 액션 경로) → storage HTML·PDF 검증 → 번들 패널로 공문·표지 생성 → 병합 200
// 실행: npx tsx scripts/_e2e-annex4-print.mts  (dev 서버 3000 + local-gotenberg 3010 필요)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'
import { SHEET_FACILITY_MAP } from '../src/lib/sheet-facility-map.ts'

const EMAIL = 'annex4-print-e2e@sjfire.test'
const BUCKET = 'fire-plans'
let userId = '', custId = '', buildingId = '', inspId = ''

async function setup() {
  userId = await mkUser({ email: EMAIL, name: '인쇄E2E', employeeId: 'A4P-001', role: 'admin' })
  custId = await mkCustomer({
    customer_name: '인쇄E2E빌딩', address: '경기도 양평군 테스트로 22', fire_station: '양평소방서',
    use_approval_date: '2018-05-01', created_by: userId,
  })
  const { data: bld, error: bErr } = await raw.from('buildings').insert({
    customer_id: custId, building_name: '본관', purpose: '업무시설', is_active: true, permit_date: '2017-01-10',
    total_area: 2500, building_area: 800, floors_above: 7, floors_below: 2, main_structure: '철근콘크리트', created_by: userId,
  }).select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  buildingId = bld!.id
  await raw.from('customer_contacts').insert({ customer_id: custId, role: '대표', name: '김대표', phone: '010-2222-3333' })

  // 전 설비 설치 — SHEET_FACILITY_MAP 값 전체(맵 등재 21시트 전부 매칭 → 최대 분량, S1-8 실측 대용 상한)
  const codes = [...new Set(Object.values(SHEET_FACILITY_MAP).flat())]
  const { error: fErr } = await raw.from('fire_facilities').insert(
    codes.map(c => ({ building_id: buildingId, facility_code: c, category: '설비', installed: true })))
  if (fErr) throw new Error(`설비 생성 실패: ${fErr.message}`)

  // 다중이용업 — 서식 1.10.3 multiUse 업종 1건 (Q-10 판별 축)
  const { error: formErr } = await raw.from('fire_plan_forms').insert({
    customer_id: custId, sections: { multiUse: { applicable: true, categories: { '노래연습장업': '2' } } },
  })
  if (formErr) throw new Error(`서식 생성 실패: ${formErr.message}`)

  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', plan_type: 'special_작동',
    status: 'completed', sequence_num: 1,
    inspection_start_date: '2026-08-10', inspection_end_date: '2026-08-10', inspection_days: 1,
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = insp!.id

  // 응답 — S1(○·×·／·공란)·S14(MU 롤업) 시나리오
  const rows: Array<{ item_code: string; result: 'O' | 'X' | 'N' }> = [
    { item_code: '1-A-001', result: 'O' },
    { item_code: '1-A-002', result: 'X' },
    // 1-B 15개 전량 ／ — image-73·74 재현(판정 주체는 점검자, Q-8)
    ...['001', '002', '003', '004', '005', '006', '011', '012', '013', '021', '022', '023', '031', '032', '033']
      .map(s => ({ item_code: `1-B-${s}`, result: 'N' as const })),
    // 1-A-003~008 무응답 = 공란 (Q-5) — 삽입하지 않음
    // STD-32 → MU 롤업: MU-001←O, MU-016←X, MU-004←／, MU-002는 무응답(공란 유지)
    { item_code: '32-A-001', result: 'O' },
    { item_code: '32-G-001', result: 'X' },
    { item_code: '32-B-011', result: 'N' },
  ]
  const { error: rErr } = await raw.from('inspection_sheet_responses').insert(
    rows.map(r => ({ inspection_id: inspId, item_code: r.item_code, result: r.result, updated_by: userId })))
  if (rErr) throw new Error(`응답 생성 실패: ${rErr.message}`)
}

async function cleanup() {
  const prefix = `${custId}/inspections/${inspId}`
  const { data: objs } = await raw.storage.from(BUCKET).list(prefix, { limit: 100 })
  if (objs?.length) await raw.storage.from(BUCKET).remove(objs.map(o => `${prefix}/${o.name}`))
  if (inspId) {
    await raw.from('annex_inputs').delete().eq('inspection_id', inspId)
    await raw.from('fire_plan_gen_jobs').delete().eq('inspection_id', inspId)
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
  }
  if (custId) await raw.from('fire_plan_forms').delete().eq('customer_id', custId)
  if (buildingId) {
    await raw.from('fire_facilities').delete().eq('building_id', buildingId)
    await raw.from('buildings').delete().eq('id', buildingId)
  }
  if (custId) await raw.from('customer_contacts').delete().eq('customer_id', custId)
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}

async function run() {
  const { browser, page } = await launch()
  try {
    await login(page, EMAIL)
    await page.goto(`${BASE}/inspections/${inspId}`)
    await page.waitForLoadState('networkidle')

    // ④ 스텝으로 이동 → [별지 4호] 생성 (실 서버 액션 requestReport9Action 경로)
    await page.getByText('④ 소방서 제출', { exact: false }).first().click()
    const btn4 = page.getByRole('button', { name: '별지 4호' })
    await btn4.waitFor({ state: 'visible', timeout: 15000 })
    const t0 = Date.now()
    await btn4.click()
    const job4 = await pollDb(async () => {
      const { data } = await raw.from('fire_plan_gen_jobs').select('status')
        .eq('inspection_id', inspId).eq('report_type', 'report4')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      return data?.status === 'done' ? data : null
    }, 150000)
    const genMs = Date.now() - t0
    check('별지 4호 생성 done (실 조립 경로)', job4?.status === 'done', `status=${job4?.status}`)
    console.log(`    [S1-8] 생성 소요(맵 등재 전 시트 최대 분량): ${(genMs / 1000).toFixed(1)}s (timeout 120s 대비)`)
    check('S1-8: 120초 안에 생성', genMs < 120000, `${(genMs / 1000).toFixed(1)}s`)

    // ── storage HTML — 실 데이터 조립 결과 검증 ──
    const prefix = `${custId}/inspections/${inspId}`
    const { data: objs } = await raw.storage.from(BUCKET).list(prefix, { limit: 100 })
    const html4 = (objs ?? []).find(o => /^report4_\d+\.html$/.test(o.name))
    const pdf4 = (objs ?? []).find(o => /^report4_\d+\.pdf$/.test(o.name))
    check('storage HTML+PDF 존재', !!html4 && !!pdf4)
    if (!html4) throw new Error('HTML 없음 — 이후 검증 불가')
    const html = await (await raw.storage.from(BUCKET).download(`${prefix}/${html4.name}`))!.data!.text()

    // S3/S6 — 목차: 설치 축 전 시트 + 31 강제 + 32(multiUse) — 목차와 본문 동일 집합
    check('S6: 목차 쪽', html.includes('목  차'))
    for (const line of ['1. 소화기구 및 자동소화장치 점검표', '2. 옥내소화전설비 점검표', '31. 기타사항 점검표', '32. 다중이용업소 점검표']) {
      check(`S3: 목차·본문 「${line.slice(0, 14)}…」`, (html.match(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length >= 2, '목차+본문 2회 이상')
    }
    // S1 — ／ 복원·공란·발췌 문구 삭제
    const row = (code: string) => {
      const i = html.indexOf(`>${code}<`)
      return i < 0 ? '' : html.slice(i, html.indexOf('</tr>', i))
    }
    check('S1-7: 1-B-031~033 전량 ／ 인쇄', ['1-B-031', '1-B-032', '1-B-033'].every(c => row(c).includes('>/<')))
    check('S1: 1-A-002 ×', row('1-A-002').includes('>×<'))
    check('S1: 무응답 1-A-003 행 존재·결과 공란', row('1-A-003').length > 0 && /class="center"><\/td>/.test(row('1-A-003')))
    check('S1: 발췌 안내 문구 없음', !html.includes('점검항목만 수록'))
    // S2 — ● 불릿 / 134 그룹 축(그룹 헤더·대괄호 소제목)
    check('S2: ● 불릿(1-A-009 설치수량)', row('1-A-009').includes('● 설치수량 적정 여부'))
    check('23-Q16/134: 그룹 헤더 1-A', html.includes('1-A. 소화기구(소화기, 자동확산소화기, 간이소화용구)'))
    check('23-Q16/134: 대괄호 소제목', html.includes('[가스·분말·고체에어로졸 자동소화장치]'))
    // S12/S4 — 설비별 쪽번호·각주 반복
    check('S12: 설비별 독립 쪽번호 존재', /\(1쪽 중 1쪽\)/.test(html))
    const tailCount = (html.match(/해당없는 항목은 “\/”로 표시한다/g) ?? []).length
    // ' 점검표</h1>'는 별지 4호 1쪽 제목(소방시설등 점검표)에도 1회 걸린다 — 부속 시트 수 = 매치 − 1
    const sheetTitleCount = (html.match(/ 점검표<\/h1>/g) ?? []).length - 1
    check('S4: 각주가 설비 수만큼 반복', tailCount === sheetTitleCount && tailCount >= 20, `각주 ${tailCount} / 부속 시트 ${sheetTitleCount}`)
    // S14 — MU 16칸 롤업 (별지 4호 2쪽 안전시설등 결과표)
    const muRow = (label: string) => {
      const i = html.indexOf(label)
      return i < 0 ? '' : html.slice(i, i + 400)
    }
    check('S14: MU-001 소화기 ← ○(32-A-001 롤업)', muRow('소화기 또는 자동확산소화기').includes('○'))
    check('S14: MU-016 방염 ← ×(32-G-001 롤업)', muRow('방염대상물품').includes('×'))
    check('S14: MU-004 가스누설 ← ／(32-B-011 롤업)', muRow('가스누설경보기').includes('/'))

    // PDF 쪽수(대략) — 페이지 넘침·분량 파악
    const pdfBuf = Buffer.from(await (await raw.storage.from(BUCKET).download(`${prefix}/${pdf4.name}`))!.data!.arrayBuffer())
    const pageCount = (pdfBuf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
    console.log(`    [S12-4] PDF 크기 ${(pdfBuf.length / 1024).toFixed(0)}KB · 쪽수(추정) ${pageCount}`)
    check('S12-4: 부속 포함 대분량 PDF 생성', pageCount > 20, `${pageCount}쪽`)

    // ── S13 — 원클릭 번들: 체크리스트 → 필요분 생성(공문·표지·9호) → 병합 200 ──
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.getByText('④ 소방서 제출', { exact: false }).first().click()
    await page.getByTestId('bundle-panel-toggle').click()
    await page.getByTestId('bundle-checklist').waitFor({ state: 'visible', timeout: 20000 })
    const clText = await page.getByTestId('bundle-checklist').innerText()
    check('S13-4: 체크리스트 — 공문·표지 미생성 표시', clText.includes('제출 공문') && clText.includes('보고서 표지') && clText.includes('미생성'))
    check('S13-4: 체크리스트 — 별지 4호 최신 ✓', /점검표.*최신|✓/.test(clText))
    const t1 = Date.now()
    await page.getByTestId('bundle-generate').click()
    const jobsDone = await pollDb(async () => {
      const { data } = await raw.from('fire_plan_gen_jobs').select('report_type, status').eq('inspection_id', inspId)
      const done = new Set((data ?? []).filter((j: { status: string }) => j.status === 'done').map((j: { report_type: string }) => j.report_type))
      return ['official', 'cover', 'report9'].every(t => done.has(t)) ? done : null
    }, 180000)
    console.log(`    [S13-2] 번들 필요분 병렬 생성 소요: ${((Date.now() - t1) / 1000).toFixed(1)}s`)
    check('S13-2: 공문·표지·9호 병렬 생성 done', !!jobsDone)

    // 병합 라우트 — 공문→표지→본문 순 병합(순서는 TYPE_ORDER 단위 테스트가 아니라 200+PDF 확인)
    const res = await page.request.get(`${BASE}/inspections/${inspId}/bundle`)
    const ct = res.headers()['content-type'] ?? ''
    check('S13/번들 라우트 200 + PDF', res.status() === 200 && ct.includes('pdf'), `status=${res.status()} ct=${ct}`)

    // 공문 문서번호 자동 제안(Q-14) — 생성된 공문 HTML에 '{약칭} {YYMM}-{n}' 패턴
    const { data: objs2 } = await raw.storage.from(BUCKET).list(prefix, { limit: 100 })
    const htmlOf = (objs2 ?? []).find(o => /^official_\d+\.html$/.test(o.name))
    if (htmlOf) {
      const offHtml = await (await raw.storage.from(BUCKET).download(`${prefix}/${htmlOf.name}`))!.data!.text()
      check('S7/Q-14: 공문 문서번호 자동 제안 렌더', /\d{4}-\d+/.test(offHtml))
      check('S5-10/S7-1: 점검종류 가변(작동점검)', offHtml.includes('작동점검'))
    } else check('공문 HTML 존재', false)
  } finally {
    await browser.close()
  }
}

try {
  await setup()
  await run()
} catch (e) {
  check('E2E 실행', false, e instanceof Error ? e.message : String(e))
} finally {
  await cleanup()
  summary()
}
