/* V-2 — 현1 G열 상세 줄이 어느 단계에서 사라지는가. 축을 셋으로 가른다.
 *   ① 원천 .xls (SheetJS 읽기)
 *   ② LibreOffice 변환 직후 .xlsx  ← 빌드 ①단계와 동일한 변환만
 *   ③ 최종 자산 report-workbook.xlsx (빌드 전 단계 통과 후)
 * ②에 있고 ③에 없으면 빌드 단계가 지운 것, ②에도 없으면 변환이 잃는 것,
 * ①에만 있고 ②에 없으면 SheetJS 읽기와 LibreOffice 해석이 다른 것이다.
 *
 * 실행: cd F:\AI\ERP\erp; node scripts/_probe-s15-v2-convstage.mjs
 */
import { readFileSync, mkdtempSync, existsSync, copyFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import XLSX from 'xlsx'

const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const REFS = ['B16', 'G16', 'G17', 'G19', 'B21', 'G21', 'B22', 'G22', 'B26']

// ── ① 원천
const s1 = XLSX.read(readFileSync(SRC), { cellStyles: true }).Sheets['현1']
const v1 = (r) => { const c = s1[r]; return c ? String(c.v ?? '').replace(/\s+/g, ' ').trim() : null }

// ── ② LibreOffice 변환 직후
const dir = mkdtempSync(join(tmpdir(), 'conv-'))
copyFileSync(SRC, join(dir, 'src.xls'))
execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'xlsx', '--outdir', dir, join(dir, 'src.xls')],
  { timeout: 900_000, windowsHide: true, stdio: 'pipe' })
const conv = join(dir, 'src.xlsx')
if (!existsSync(conv)) throw new Error('LibreOffice 변환 실패')

async function cellsOf(path) {
  const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(path)))
  const wbx = await zip.file('xl/workbook.xml').async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
  const tgt = new Map()
  for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) tgt.set(m[1], m[2])
  let part = null
  for (const m of wbx.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    if (m[1] === '현1') part = `xl/${tgt.get(m[2]).replace(/^\/?xl\//, '')}`
  }
  if (!part) return null
  const x = await zip.file(part).async('string')
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  const sf = zip.file('xl/sharedStrings.xml')
  const sst = sf ? [...(await sf.async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(y => unesc(y[1])).join('')) : []
  const map = new Map()
  for (const c of x.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const inner = c[3] ?? ''
    const inline = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join('')
    let t = inline
    if (!t && /\bt="s"/.test(c[2])) { const i = /<v>(\d+)<\/v>/.exec(inner); if (i) t = sst[Number(i[1])] ?? '' }
    map.set(c[1], t)
  }
  return map
}

const c2 = await cellsOf(conv)
const c3 = await cellsOf('templates/report-workbook.xlsx')

const show = (m, r) => m == null ? '(시트없음)' : (m.has(r) ? (m.get(r) || '(빈 셀)') : '(셀 없음)')
console.log('ref  | ①원천(.xls)                          | ②LO변환직후                 | ③최종자산')
console.log('-----+--------------------------------------+-----------------------------+---------------')
for (const r of REFS) {
  console.log(`${r.padEnd(5)}| ${String(v1(r) ?? '(없음)').slice(0, 36).padEnd(36)} | ${show(c2, r).slice(0, 27).padEnd(27)} | ${show(c3, r).slice(0, 15)}`)
}
console.log(`\n②변환본 현1 셀 수: ${c2 ? c2.size : '-'} · ③최종 현1 셀 수: ${c3 ? c3.size : '-'}`)
