// R5-7③ 시각 서식 대조 — 같은 점검 건으로 별지 4호 PDF와 37시트 엑셀 PDF를 나란히 뽑는다
//
// 엑셀 폐지(R5-6)의 마지막 선행 조건. 항목 집합 대조(R5-7①②)는 끝났고, 남은 것은
// "엑셀 인쇄물에만 있던 칸 배치·레이아웃이 별지 4호로 넘어오며 사라지지 않는가"다.
// Gotenberg 사이드카(scripts/local-gotenberg.mjs)가 들어와 로컬에서도 뽑을 수 있게 됐다.
//
// ⚠ 사이드카는 Playwright Chromium·LibreOffice라 운영 Gotenberg와 픽셀 단위로 같지 않다.
//    여기서 보는 것은 **내용·쪽 구성**이고, 최종 레이아웃 확인은 스테이징 몫이다.
//
// 실행: npx tsx scripts/_probe-r57-visual.mts   (dev 서버 + 사이드카 3010 필요)
// 산출: F:/AI/ERP/erp_goal/_대조PDF/{annex4,excel}.pdf
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼
import { findActionId, collectScripts, callAction } from './_judge19-action.mjs'
import { mkdirSync, writeFileSync } from 'fs'

const OUT = 'F:/AI/ERP/erp_goal/_대조PDF'
const EMAIL = `r57-${Date.now().toString(36)}@erp-test.com`
let userId = '', custId = '', inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const kst = (d = 0) => {
  const x = new Date(Date.now() + 9 * 3600_000)
  x.setDate(x.getDate() + d)
  return x.toISOString().split('T')[0]
}

try {
  const health = await fetch('http://localhost:3010/health').then(r => r.json()).catch(() => null)
  check('사이드카 가동 — chromium·libreoffice', !!health && health.chromium && health.libreoffice, JSON.stringify(health))

  userId = await mkUser({ email: EMAIL, name: 'R57대조', employeeId: `E2E-R57-${Date.now().toString(36)}` })
  custId = await mkCustomer({ customer_name: 'R57대조고객', address: '경기 양평군 테스트로 57', created_by: userId })
  const { data: insp, error } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kst(-1), inspection_end_date: kst(-1),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  inspId = insp!.id

  // 편입 12건을 포함해 응답을 심는다 — 부속 설비별 점검표는 ○/× 응답이 있는 항목만 싣는다.
  // 응답이 없으면 "편입했는데 문서에 안 나온다"를 구분할 수 없다.
  const NEW12 = ['2-H-018', '2-H-019', '2-H-021', '2-H-031',
    '3-K-022', '3-K-023', '3-K-031', '3-K-041', '3-L-001', '3-L-002',
    '13-G-031', '13-G-041']
  const { data: someItems } = await raw.from('inspection_sheet_items')
    .select('item_code').like('item_code', '2-%').limit(12)
  const codes = [...NEW12, ...(someItems ?? []).map((r: { item_code: string }) => r.item_code)]
  await raw.from('inspection_sheet_responses').insert(
    codes.map((c, i) => ({ inspection_id: inspId, item_code: c, result: i % 7 === 3 ? 'X' : 'O' })))
  // 펌프 실측치도 넣어 별지 4호 펌프 표가 그려지게 한다
  await raw.from('inspection_pump_tests').insert({
    inspection_id: inspId, sheet_no: 2, pump_kind: '주',
    shutoff_flow: 0, shutoff_press: 1.3, rated_flow: 130, rated_press: 1.0,
    over_flow: 195, over_press: 0.7, set_start_press: 0.6, set_stop_press: 0.9,
  })

  const l = await launch(); browser = l.browser
  const page = l.page
  page.setDefaultTimeout(120000)
  const scripts = collectScripts(page)
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="workbench-stepbar"]')

  mkdirSync(OUT, { recursive: true })

  // ── ① 별지 4호 PDF — requestReport9Action('report4')이 Storage에 쓴다 ──
  const genId = await findActionId(page, 'requestReport9Action', [...scripts])
  check('별지 4호 생성 액션 id 추출', !!genId)
  if (genId) {
    const res = await callAction(page, genId, [inspId, 'report4'])
    // ⚠ RSC flight 응답에는 dev 청크 문자열이 섞여 "error"가 우연히 들어간다 —
    //    액션 반환 객체의 error만 봐야 한다(초기 단언이 이걸로 오탐했다).
    const errObj = /:\{"error":"([^"]+)"/.exec(res.text)
    check('별지 4호 PDF 생성', res.status === 200 && !errObj, errObj?.[1] ?? res.text.slice(0, 120))
    const { data: files } = await raw.storage.from('fire-plans').list(`${custId}/inspections/${inspId}`)
    const pdf = ((files ?? []) as Array<{ name: string }>).find(f => /^report4_\d+\.pdf$/.test(f.name))
    check('별지 4호 PDF 파일 존재', !!pdf, ((files ?? []) as Array<{ name: string }>).map(f => f.name).join(','))
    if (pdf) {
      const { data: blob } = await raw.storage.from('fire-plans')
        .download(`${custId}/inspections/${inspId}/${pdf.name}`)
      const buf = Buffer.from(await (blob as Blob).arrayBuffer())
      writeFileSync(`${OUT}/annex4.pdf`, buf)
      check('별지 4호 PDF 유효(매직바이트·크기)', buf.length > 5000 && buf.subarray(0, 5).toString() === '%PDF-', `${buf.length}B`)
    }
  }

  // ── ② 37시트 엑셀 PDF — printOperationalReportAction이 base64로 돌려준다 ──
  // ⚠ 2026-08-13 R5-6으로 **엑셀 생성이 폐지**돼 이 절은 더 이상 돌지 않는다.
  //    대조를 다시 하려면 폐지 커밋을 revert해야 한다(Storage 템플릿은 일부러 남겨 뒀다).
  //    폐지 근거였던 내용 대조 결과는 erp_goal/_대조PDF/content-diff.md에 있다.
  const prtId = await findActionId(page, 'printOperationalReportAction', [...scripts])
  if (!prtId) {
    console.log('  ⏭  엑셀 PDF 절 건너뜀 — R5-6으로 생성 폐지됨(폐지 커밋 revert 시 복구)')
  }
  if (prtId) {
    const res = await callAction(page, prtId, [inspId])
    // base64가 크면 RSC가 별도 텍스트 청크(`N:T<길이16진>,<본문>`)로 빼고 객체에는 `$N` 참조만 남긴다.
    // 그래서 "pdfBase64":"…" 직접 매칭은 실패한다 — 청크에서 PDF 시그니처(JVBERi)로 찾는다.
    const m = /"pdfBase64":"([A-Za-z0-9+/=]+)"/.exec(res.text)
      ?? /(?:^|\n)[0-9a-f]+:T[0-9a-f]+,(JVBERi[A-Za-z0-9+/=]+)/.exec(res.text)
    if (m) {
      const buf = Buffer.from(m[1], 'base64')
      writeFileSync(`${OUT}/excel.pdf`, buf)
      check('엑셀 PDF 유효(매직바이트·크기)', buf.length > 5000 && buf.subarray(0, 5).toString() === '%PDF-', `${buf.length}B`)
    } else {
      check('엑셀 PDF 생성', false, res.text.slice(0, 300))
    }
  }

  console.log(`\n산출물: ${OUT}/annex4.pdf · ${OUT}/excel.pdf`)
  console.log(`점검 건: ${inspId} (정리하지 않고 남긴다 — 재대조용)`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  // ⚠ 점검 건·고객은 남긴다. 대조는 사람이 PDF를 열어 봐야 끝나므로 여기서 지우면 재현이 안 된다.
  //    정리는 _probe-r57-visual-clean.mjs 또는 수동으로.
  console.log(`\n[정리 안 함] 고객 ${custId} · 사용자 ${userId} — 대조 끝나면 지울 것`)
  summary()
}
