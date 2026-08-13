// 로컬 Gotenberg 대체 서버 검증 — 앱과 **같은 경로**(src/lib/pdf.ts)로 부른다.
// 사이드카가 흉내만 내고 실제로는 앱이 쓸 수 없으면 의미가 없으므로, 프로브가 직접 fetch하지 않고
// convertHtmlToPdf·convertXlsxToPdf를 그대로 호출한다.
// 실행: node --import tsx scripts/_probe-local-gotenberg.mjs   (서버가 떠 있어야 한다)
import { config } from 'dotenv'
import * as XLSX from 'xlsx'
config({ path: '.env.local' })

let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) } }

const base = process.env.GOTENBERG_URL
ok('.env.local에 GOTENBERG_URL이 설정돼 있다', !!base, String(base))

const pdfMod = await import('../src/lib/pdf.ts')
const { convertHtmlToPdf, convertXlsxToPdf, gotenbergHealthy } = pdfMod.default ?? pdfMod

ok('gotenbergHealthy()가 true — 앱이 변환 가능으로 판정한다', await gotenbergHealthy())

// ① HTML → PDF (별지 서식·소방계획서 본문이 쓰는 경로)
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 12mm }
body { font-family: 'Malgun Gothic', sans-serif }
table { border-collapse: collapse; width: 100% } td, th { border: 1px solid #333; padding: 4px }
</style></head><body><h1>소방시설등 자체점검 실시결과 보고서</h1>
<table><tr><th>대상물</th><td>로컬 변환 시험</td></tr><tr><th>점검일</th><td>2026-08-13</td></tr></table>
<img src="dot.png" width="40"><p>한글 렌더링 확인 — 별지 제9호서식</p></body></html>`
const dot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const htmlPdf = await convertHtmlToPdf(html, [{ name: 'dot.png', data: new Uint8Array(dot), mime: 'image/png' }], { marginMode: 'none' })
ok('HTML → PDF 변환이 성공한다', htmlPdf.length > 1000, `${htmlPdf.length}B`)
ok('결과가 진짜 PDF다(%PDF- 시그니처)', Buffer.from(htmlPdf.slice(0, 5)).toString() === '%PDF-')
// 한글이 이미지로 뭉개지지 않고 텍스트로 들어갔는지 — 폰트 미탑재 시 여기서 걸린다
const raw = Buffer.from(htmlPdf).toString('latin1')
ok('폰트가 임베드됐다(FontFile 존재) — 한글이 빈칸으로 나오지 않는다', /FontFile[23]?/.test(raw))

// ② xlsx → PDF (엑셀 37시트 대조가 쓰는 경로 — R5-7)
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['항목코드', '점검결과'], ['1-A-001', 'O']]), '점검표')
const xlsx = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
const xlsxPdf = await convertXlsxToPdf(xlsx, 'sheet.xlsx', { landscape: true })
ok('xlsx → PDF 변환이 성공한다', xlsxPdf.length > 1000, `${xlsxPdf.length}B`)
ok('xlsx 결과도 진짜 PDF다', Buffer.from(xlsxPdf.slice(0, 5)).toString() === '%PDF-')

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
