/* 운영 자산의 「현황」 시트를 사람이 볼 수 있게 뽑는다 (소방계획서_32 S15 ②).
 *
 * 왜: dv 목록이 [○,×,/]인 것은 기계로 확인했다. 남은 것은 사람이 실제 서식을 보는 일인데,
 * 그 전에 **무엇을 봐야 하는지**를 좁혀 주는 게 낫다 — 판정칸이 어디고 무엇이 들어 있는지.
 * 드롭다운 자체는 렌더되지 않으므로(Excel UI 기능) HTML/PDF로는 '칸의 위치와 현재 값'까지만 보인다.
 *
 * 실행: cd F:\AI\ERP\erp; node scripts/_probe-prod-hyunhwang-render.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync, copyFileSync, readdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import XLSX from 'xlsx'

const SRC = 'F:/AI/ERP/_prod-asset.xlsx'
const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
if (!existsSync(SRC)) throw new Error(`${SRC} 없음 — 운영에서 docker cp + scp로 받아올 것`)

// ── 1) 판정칸 좌표와 현재 값 (기계 축) ──────────────────────────────────
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(SRC)))
const wbx = await zip.file('xl/workbook.xml').async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
const tgt = new Map()
for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) tgt.set(m[1], m[2])
let part = null
for (const m of wbx.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  if (m[1] === '현황') part = `xl/${tgt.get(m[2]).replace(/^\/?xl\//, '')}`
}
const x = await zip.file(part).async('string')
const dv = [...x.matchAll(/<dataValidation\b([^>]*)>[\s\S]*?<formula1>([\s\S]*?)<\/formula1>/g)]
console.log(`「현황」 파트 ${part} · dataValidation ${dv.length}건`)
for (const m of dv) {
  const sq = /sqref="([^"]*)"/.exec(m[1])?.[1] ?? '?'
  const list = m[2].replace(/&quot;/g, '"')
  const err = /errorStyle="([^"]*)"/.exec(m[1])?.[1] ?? '-'
  console.log(`  목록 ${list}  errorStyle=${err}`)
  console.log(`     적용 범위: ${sq}`)
}

// ── 2) 현황 시트만 남겨 렌더 (사람이 볼 것) ─────────────────────────────
// 전 시트를 렌더하면 72쪽이라 찾기 어렵다 — 현황만 남긴다. 원본은 건드리지 않는다.
const dir = mkdtempSync(join(tmpdir(), 'hh-'))
const cut = join(dir, 'hyunhwang.xlsx')
{
  const z2 = await JSZip.loadAsync(new Uint8Array(readFileSync(SRC)))
  // SheetJS로 시트만 골라 새 워크북을 만들면 서식이 죽는다(이 저장소 규약) — 대신 원본을 그대로
  // 쓰고 LibreOffice에 시트 지정 변환을 맡기는 대신, 통째 PDF를 뽑고 현황 쪽만 안내한다.
  copyFileSync(SRC, cut)
  void z2
}
execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, cut],
  { timeout: 900_000, windowsHide: true, stdio: 'pipe' })
const pdf = join(dir, 'hyunhwang.pdf')
if (!existsSync(pdf)) throw new Error('PDF 변환 실패')
const bytes = readFileSync(pdf)
const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
const OUT = 'F:/AI/ERP/_prod-현황.pdf'
writeFileSync(OUT, bytes)
console.log(`\nPDF ${pages}쪽 → ${OUT}`)

// 현황이 몇 번째 시트인지 = PDF에서 대략 어디쯤인지
const names = XLSX.read(readFileSync(SRC), { bookSheets: true }).SheetNames
console.log(`시트 순서상 「현황」은 ${names.indexOf('현황') + 1}번째 / ${names.length}장`)
console.log(`\n사람이 볼 것: 위 '적용 범위'의 칸을 Excel에서 열어 드롭다운을 펼치면 ○ · × · / 세 값이 나와야 한다.`)
console.log(`(드롭다운은 Excel UI 기능이라 PDF·HTML 렌더에는 나타나지 않는다 — 목록 내용은 위에서 기계로 확인했다.)`)
readdirSync(dir).forEach(f => void f)
