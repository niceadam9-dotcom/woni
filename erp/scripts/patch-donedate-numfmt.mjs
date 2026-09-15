// 자산 패치 CLI — 갑지 템플릿 `완료보고서!I19~I22`(이행조치 일자)에 날짜 서식을 보장한다.
//
// 규칙·내력은 **`src/lib/xlsx-donedate-numfmt.ts` 머리주석이 정본**이다(여기 베껴 적지 않는다).
// 이 파일은 그 순수 함수를 zip에 물려 주는 껍데기다 — 빌더(build-workbook-full)도 같은 함수를 쓴다.
//
// 실행: node scripts/patch-donedate-numfmt.mjs [파일] [--apply]   (기본 드라이런)
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { patchDoneDateNumFmt, DONEDATE_SHEET } from '../src/lib/xlsx-donedate-numfmt.ts'

const FILE = process.argv.find(a => a.endsWith('.xlsx')) ?? 'templates/report-workbook-full.xlsx'
const APPLY = process.argv.includes('--apply')

const zip = await JSZip.loadAsync(readFileSync(FILE))
const wbXml = await zip.file('xl/workbook.xml').async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string')
const stylesXml = await zip.file('xl/styles.xml').async('string')

const sheets = [...wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(m => ({ name: m[1], rid: m[2] }))
const relMap = new Map([...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const sh = sheets.find(s => s.name === DONEDATE_SHEET)
if (!sh) { console.error(`❌ 시트 「${DONEDATE_SHEET}」 없음`); process.exit(2) }
const sheetPath = 'xl/' + relMap.get(sh.rid).replace(/^\/?xl\//, '')
const sheetXml = await zip.file(sheetPath).async('string')

const out = patchDoneDateNumFmt(stylesXml, sheetXml)
const r = out.result
console.log(`${FILE}  ${APPLY ? '=== APPLY ===' : '(드라이런)'}`)
console.log(`  기준 날짜 서식 numFmtId=${r.dateFmtId ?? '(없음)'}`)
console.log(`  바꿀 칸 ${r.changed.length}개: ${r.changed.join(', ') || '(없음)'}`)
console.log(`  이미 날짜라 건너뜀: ${r.skipped.join(', ') || '(없음)'}`)
for (const n of r.notes) console.log(`  ⚠ ${n}`)
if (r.dateFmtId == null) process.exit(2)
if (r.changed.length === 0) { console.log('\n바꿀 것이 없습니다(멱등 — 이미 전부 날짜 서식).'); process.exit(0) }
if (!APPLY) { console.log('\n드라이런 — 적용하려면 --apply'); process.exit(0) }

zip.file('xl/styles.xml', out.stylesXml)
zip.file(sheetPath, out.sheetXml)
writeFileSync(FILE, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log(`\n✅ 적용 — ${r.changed.length}칸 · cellXfs ${r.xfsBefore} → ${r.xfsAfter}`)
