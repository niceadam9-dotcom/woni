// R5-7③ 내용 대조 — 엑셀 인쇄물이 담던 것이 별지 4호에 다 들어오는가
//
// PDF 픽셀 비교는 판독 도구(poppler·pdfjs)가 이 PC에 없고, 사이드카 렌더러가 운영 Gotenberg와
// 달라 애초에 픽셀 동일성을 논할 수 없다. 그래서 **원본끼리** 대조한다 —
//   별지 4호 = getAnnexPreviewHtmlAction('report4')이 만드는 HTML (PDF의 입력 그대로)
//   엑셀     = 생성된 xlsx의 셀 (SheetJS)
// 이렇게 하면 "엑셀에만 있던 내용이 별지 4호에서 빠지는가"를 글자 단위로 판정할 수 있다.
// 남는 것은 칸 배치·인쇄 레이아웃뿐이고, 그건 스테이징에서 눈으로 볼 몫이다.
//
// 실행: npx tsx scripts/_probe-r57-content.mts <inspectionId>
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, launch, login, mkUser, delUser } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'
import * as XLSX from 'xlsx'
import { writeFileSync } from 'fs'

const INSP = process.argv[2]
if (!INSP) { console.error('사용법: npx tsx scripts/_probe-r57-content.mts <inspectionId>'); process.exit(1) }

const EMAIL = `r57c-${Date.now().toString(36)}@erp-test.com`
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const textOf = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim()

const ITEM_CODE = /^\s*\d{1,2}-[A-Z]-\d{3}\s*$/

try {
  const { data: insp } = await raw.from('inspections').select('id, customer_id').eq('id', INSP).maybeSingle()
  if (!insp) throw new Error(`점검 건을 찾을 수 없습니다: ${INSP}`)

  userId = await mkUser({ email: EMAIL, name: 'R57내용', employeeId: `E2E-R57C-${Date.now().toString(36)}` })
  const l = await launch(); browser = l.browser
  const page = l.page
  page.setDefaultTimeout(120000)
  const scripts = collectScripts(page)
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${INSP}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="workbench-stepbar"]')

  // ── 별지 4호 HTML ──
  const prevId = await findActionId(page, 'getAnnexPreviewHtmlAction', [...scripts])
  const prev = prevId ? parseFlight((await callAction(page, prevId, [INSP, 'report4'])).text) : null
  const html = prev?.html ?? ''
  check('별지 4호 HTML 확보', html.length > 2000, `${html.length}자 ${prev?.error ?? ''}`)
  const annexText = textOf(html)

  // ── 엑셀 워크북 ──
  const genId = await findActionId(page, 'generateOperationalReportAction', [...scripts])
  const gen = genId ? (await callAction(page, genId, [INSP])).text : ''
  const pathM = /"url":"([^"]+)"/.exec(gen)
  check('엑셀 생성', !!pathM, gen.slice(0, 160))
  let wb: XLSX.WorkBook | null = null
  if (pathM) {
    const url = pathM[1].replace(/\\u0026/g, '&')
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
    wb = XLSX.read(buf, { type: 'buffer' })
    check('엑셀 워크북 파싱', wb.SheetNames.length > 30, `${wb.SheetNames.length}시트`)
  }
  if (!wb) throw new Error('엑셀 워크북을 얻지 못했습니다')

  // ── ① 응답이 찍힌 점검항목이 별지 4호에도 있는가 ──
  const marked: Array<{ code: string; sheet: string; mark: string }> = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws?.['!ref']) continue
    const rg = XLSX.utils.decode_range(ws['!ref'])
    for (let r = rg.s.r; r <= rg.e.r; r++) {
      const a = ws[XLSX.utils.encode_cell({ r, c: 0 })]
      if (!a || typeof a.v !== 'string' || !ITEM_CODE.test(a.v)) continue
      const c = ws[XLSX.utils.encode_cell({ r, c: 2 })]
      const mk = typeof c?.v === 'string' ? c.v.trim() : ''
      if (mk === '○' || mk === 'X') marked.push({ code: a.v.trim(), sheet: name, mark: mk })
    }
  }
  check('엑셀에 결과가 찍힌 항목 존재', marked.length > 0, `${marked.length}건`)
  const missingInAnnex = marked.filter(m => !annexText.includes(m.code))
  check('결과 있는 항목이 전부 별지 4호에 실림',
    missingInAnnex.length === 0,
    missingInAnnex.slice(0, 10).map(m => `${m.code}(${m.sheet})`).join(', '))

  // ── ② 편입 12건이 문서까지 도달하는가 ──
  const NEW12 = ['2-H-018', '2-H-019', '2-H-021', '2-H-031', '3-K-022', '3-K-023',
    '3-K-031', '3-K-041', '3-L-001', '3-L-002', '13-G-031', '13-G-041']
  const respCodes = new Set((await raw.from('inspection_sheet_responses')
    .select('item_code').eq('inspection_id', INSP)).data?.map((r: { item_code: string }) => r.item_code) ?? [])
  const expect12 = NEW12.filter(c => respCodes.has(c))
  const got12 = expect12.filter(c => annexText.includes(c))
  check('편입 12건이 별지 4호에 실림', got12.length === expect12.length,
    `${got12.length}/${expect12.length} — 누락 ${expect12.filter(c => !got12.includes(c)).join(',')}`)

  // ── ③ 엑셀에만 있는 '블록' — 별지 4호에 대응이 없는 시트 찾기 ──
  // 항목 코드가 없는 시트(개요·현황·다수동·펌프성능 등)가 별지 4호에 대응 문구를 갖는지 본다.
  const ANCHORS: Array<[string, string]> = [
    ['개요', '소방시설등점검표'],
    ['펌프성능시험', '펌프성능시험'],
    ['현황', '소방시설등의 세부현황'],
  ]
  for (const [label, needle] of ANCHORS) {
    check(`엑셀 '${label}' 블록 → 별지 4호 대응`, annexText.includes(needle), needle)
  }

  // ── ④ 대조표 파일로 남긴다 ──
  const lines = [
    '# R5-7③ 내용 대조 — 엑셀 인쇄물 vs 별지 4호', '',
    `점검 건: ${INSP}`,
    `엑셀 시트 ${wb.SheetNames.length}개 · 결과가 찍힌 항목 ${marked.length}건`,
    `별지 4호 HTML ${html.length}자`, '',
    '## 결과 있는 항목의 별지 4호 수록',
    `- 전체 ${marked.length}건 중 수록 ${marked.length - missingInAnnex.length}건 · 누락 ${missingInAnnex.length}건`,
    ...(missingInAnnex.length ? missingInAnnex.map(m => `  - ❌ ${m.code} (엑셀 시트 ${m.sheet}, ${m.mark})`) : ['  - 누락 없음']),
    '', '## 편입 12건',
    `- 응답을 심은 ${expect12.length}건 중 별지 4호 수록 ${got12.length}건`,
    '', '## 엑셀 시트 목록',
    ...wb.SheetNames.map(n => `- ${n}`),
  ]
  writeFileSync('F:/AI/ERP/erp_goal/_대조PDF/content-diff.md', lines.join('\n'), 'utf8')
  console.log('\n대조표: F:/AI/ERP/erp_goal/_대조PDF/content-diff.md')
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
