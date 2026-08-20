// 소방계획서_15 독립 판정 프로브(별지 실생성) — A9-1·A9-3·A4-2·A4-1(Q-2)
// 실행: node이 아니라  npx tsx scripts/_judge-soban15-annex.mjs  (로컬 dev 서버 :3000 + 스테이징 DB)
// 방식: 테스트 고객+점검+시트 응답(O/X/N)+세부제원+1.7 선임자+company_profile 임시 등록번호 시드 →
//       점검 별지 트리 [전체 미리보기] 모달(iframe srcdoc = getAnnexPreviewHtmlAction 실주행)에서
//       별지 9호·4호 HTML을 추출해 단언. 종료 시 테스트 데이터 삭제·company_profile 원복.
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'judge-soban15-annex@erp-test.com'
const CODE_RE = /^\d{1,2}-[A-Z]-\d{3}$/
let userId = ''
let customerId = ''
let buildingId = ''
let inspId = ''
let browser = null
let companyBackup = []

function kstShift(days) {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
const CUR_YEAR = Number(kstShift(-1).slice(0, 4))

try {
  // ── 시드 ──
  userId = await mkUser({ email: EMAIL, name: '판정15별지', employeeId: 'JUDGE-S15A' })
  customerId = await mkCustomer({ customer_name: '판정15별지고객', address: '경기 양평군 판정로 99', created_by: userId })
  await raw.from('customer_contacts').insert({ customer_id: customerId, role: '대표', name: '홍대표', phone: '010-1111-2222' })
  const { data: bld, error: bErr } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true, created_by: userId, purpose: '업무시설',
  }).select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  buildingId = bld.id
  await raw.from('fire_facilities').insert({
    building_id: buildingId, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true,
  })

  // A9-1 — 1.7 선임현황(대표와 다른 사람 + 보조 행)
  const { error: fpErr } = await raw.from('fire_plan_forms').upsert({
    customer_id: customerId,
    sections: {
      managers: [
        { role: '관리자', affiliation: '자체', name: '김선임', selectedAt: '2026-01-02', eduAt: '', duty: '총괄' },
        { role: '보조자', affiliation: '자체', name: '박보조', selectedAt: '', eduAt: '', duty: '' },
      ],
    },
  }, { onConflict: 'customer_id' })
  if (fpErr) throw new Error(`서식 저장 실패: ${fpErr.message}`)

  // A9-3 — 세부제원 3-8 전실 특별피난계단 2개소
  const { error: spErr } = await raw.from('customer_facility_specs').insert({
    customer_id: customerId, building_id: null, section_key: 's38_activity',
    spec: { smoke_lobby: { stair_count: 2 } },
  })
  if (spErr) throw new Error(`세부제원 저장 실패: ${spErr.message}`)

  // A4-2 — company_profile 임시 등록번호(전 행 null 확인됨) — finally 원복
  const { data: comps } = await raw.from('company_profile').select('id, management_reg_no')
  companyBackup = comps ?? []
  for (const c of companyBackup) {
    const { error } = await raw.from('company_profile').update({ management_reg_no: '2026-77' }).eq('id', c.id)
    if (error) throw new Error(`company_profile 임시 갱신 실패: ${error.message}`)
  }

  // 점검(자체점검 작동) + 시트 응답
  const { data: ins, error: iErr } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = ins.id

  // 시트 1(소화기구): O·X·N + 무응답 1 / 시트 2(다른 설비): N만 → 설비별 점검표에 미출현해야 함
  const { data: sheet1 } = await raw.from('inspection_sheets')
    .select('id, sheet_name').eq('version', 'v2025').ilike('sheet_name', '%소화기구%').limit(1).maybeSingle()
  if (!sheet1) throw new Error('v2025 소화기구 시트 없음 — 스테이징 카탈로그 확인')
  const { data: items1raw } = await raw.from('inspection_sheet_items')
    .select('item_code, item_name, order_num').eq('sheet_id', sheet1.id).order('order_num').limit(20)
  const items1 = (items1raw ?? []).filter(i => CODE_RE.test(i.item_code)).slice(0, 4)
  if (items1.length < 4) throw new Error(`소화기구 점검번호 항목 4개 미만 (${items1.length})`)
  const [itO, itX, itN, itNone] = items1
  const { data: sheet2 } = await raw.from('inspection_sheets')
    .select('id, sheet_name').eq('version', 'v2025').neq('id', sheet1.id).ilike('sheet_name', '%유도등%').limit(1).maybeSingle()
  const { data: items2raw } = sheet2
    ? await raw.from('inspection_sheet_items').select('item_code').eq('sheet_id', sheet2.id).order('order_num').limit(10)
    : { data: [] }
  const it2N = (items2raw ?? []).filter(i => CODE_RE.test(i.item_code))[0] ?? null

  const respRows = [
    { inspection_id: inspId, item_code: itO.item_code, result: 'O', updated_by: userId },
    { inspection_id: inspId, item_code: itX.item_code, result: 'X', updated_by: userId },
    { inspection_id: inspId, item_code: itN.item_code, result: 'N', updated_by: userId },
  ]
  if (it2N) respRows.push({ inspection_id: inspId, item_code: it2N.item_code, result: 'N', updated_by: userId })
  const { error: rErr } = await raw.from('inspection_sheet_responses').insert(respRows)
  if (rErr) throw new Error(`응답 시드 실패: ${rErr.message}`)
  console.log(`[시드 완료] O=${itO.item_code} X=${itX.item_code} N=${itN.item_code} 무응답=${itNone.item_code} 타시트N=${it2N?.item_code ?? '(없음)'}`)

  // ── UI — 별지 트리 [전체 미리보기] 모달 (getAnnexPreviewHtmlAction 실주행) ──
  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(120000) // dev 콜드 컴파일 대비 (소방계획서_17 교훈)
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=annex`)
  await page.waitForSelector(`text=${CUR_YEAR}년 1차`)
  await page.locator('text=🔍 전체 미리보기').first().click()
  await page.waitForSelector('text=— 전체 미리보기')
  await page.waitForFunction(() => {
    const f = document.querySelector('#fp-report9 iframe')
    return !!f && (f.getAttribute('srcdoc') || '').length > 1000
  }, undefined, { timeout: 120000 })
  await page.waitForFunction(() => {
    const f = document.querySelector('#fp-report4 iframe')
    return !!f && (f.getAttribute('srcdoc') || '').length > 1000
  }, undefined, { timeout: 120000 })
  const html9 = await page.evaluate(() => document.querySelector('#fp-report9 iframe')?.getAttribute('srcdoc') ?? '')
  const html4 = await page.evaluate(() => document.querySelector('#fp-report4 iframe')?.getAttribute('srcdoc') ?? '')
  console.log(`[미리보기 확보] 9호 ${html9.length}자 / 4호 ${html4.length}자`)

  console.log('\n— A9-1: 별지9호 2쪽 소방안전관리자 = 1.7 선임자')
  check('성명 = 김선임(1.7 1순위, 대표 아님)', html9.includes('성명: 김선임, 전화번호:'))
  check('보조 행 제외(박보조 아님)', !html9.includes('성명: 박보조'))
  check('동일인 아님 → 전화 공란(타인 전화 미기재)', !html9.includes('성명: 김선임, 전화번호: 010-1111-2222'),
    '선임자 칸에 대표 전화가 인쇄됨')
  check('관계인(대표) 칸은 홍대표·전화 유지', html9.includes('홍대표') && html9.includes('010-1111-2222'))

  console.log('\n— A9-3: 별지9호 2쪽 특별피난계단')
  check('[√]특별피난계단 (2  개소)', html9.includes('[√]특별피난계단 (2  개소)'),
    html9.match(/특별피난계단[^<]*/)?.[0] ?? '(계단 행 미발견)')

  console.log('\n— A4-2: 별지4호 2쪽 관리업 등록번호')
  check('(제 2026-77 호) 인쇄', html4.includes('제 2026-77 호'), html4.match(/소방시설관리업체[^<]*/)?.[0] ?? '')

  console.log('\n— A4-1(Q-2): 별지4호 부속 설비별 점검표 — O/× 발췌 수록')
  check('부속 제목·생략 안내문', html4.includes('설비별 점검표') && html4.includes('해당없음(／)·미점검 항목은 생략'))
  check(`O 항목 ${itO.item_code} 수록`, html4.includes(itO.item_code))
  check(`X 항목 ${itX.item_code} 수록(×)`, html4.includes(itX.item_code))
  // class는 'center'로 시작하되 표식이 더 붙을 수 있다('mk' = 오버라이드 편집 금지, lib/doc-overrides)
  check('○·× 마크 존재', /<td class="center[^"]*">○<\/td>/.test(html4) && /<td class="center[^"]*">×<\/td>/.test(html4))
  check(`N 항목 ${itN.item_code} 미수록`, !html4.includes(itN.item_code))
  check(`무응답 항목 ${itNone.item_code} 미수록`, !html4.includes(itNone.item_code))
  if (it2N) check(`O/X 전무 설비(타 시트 N만, ${it2N.item_code}) 미출현`, !html4.includes(it2N.item_code))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const c of companyBackup) {
    await raw.from('company_profile').update({ management_reg_no: c.management_reg_no }).eq('id', c.id)
  }
  if (companyBackup.length) console.log('\n[원복] company_profile.management_reg_no 원래 값 복원')
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('annex_inputs').delete().eq('inspection_id', inspId)
    await raw.from('fire_plan_gen_jobs').delete().eq('inspection_id', inspId)
  }
  if (customerId) {
    await raw.from('customer_facility_specs').delete().eq('customer_id', customerId)
    if (buildingId) await raw.from('fire_facilities').delete().eq('building_id', buildingId)
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await raw.from('fire_plan_forms').delete().eq('customer_id', customerId)
    await raw.from('customer_contacts').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
    console.log('[정리] 테스트 고객·점검·응답 삭제 완료')
  }
  await delUser(userId)
  summary()
}
