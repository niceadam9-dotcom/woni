/** 판정자 G-A — S0-1 / S0-1b 독립 축 ①: 원본 .xls를 **BIFF8 레코드 바이트**로 직접 읽는다.
 *
 *  왜: 구현자·역대 판정자는 원본 .xls의 병합수·인쇄여백을 전부 SheetJS(`!merges`/`!margins`)로
 *  읽었다. 그러면 "1586 → 1586"·"여백이 원본과 일치"의 **양변이 같은 파서**를 통과한 값이라
 *  SheetJS가 무엇을 놓쳐도 초록이다. 여기서는 파서를 쓰지 않고 파일 바이트에서
 *    - MERGEDCELLS(0x00E5): len == 2 + 8*count, count 합 = 병합 총수
 *    - SETUP(0x00A1, len 34): +16 numHdr(f64) · +24 numFtr(f64)  ← header/footer 여백(inch)
 *    - LEFT/RIGHT/TOP/BOTTOMMARGIN(0x0026~0x0029, len 8): f64 inch
 *  를 직접 긁는다. 읽기 전용.
 *
 *  결과는 UTF-8 JSON으로 기록한다(PS 5.1 콘솔 한글 깨짐 회피).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'

const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
const OUT = 'F:/AI/ERP/erp/.judge27g/a-biff.json'

const buf = readFileSync(SRC)

// ── MERGEDCELLS 0x00E5 ────────────────────────────────────────────────
const merges: number[] = []
for (let i = 0; i + 6 <= buf.length; i++) {
  if (buf[i] !== 0xe5 || buf[i + 1] !== 0x00) continue
  const len = buf.readUInt16LE(i + 2)
  if (len < 10 || len > 8226) continue
  if (i + 4 + len > buf.length) continue
  const count = buf.readUInt16LE(i + 4)
  if (len !== 2 + 8 * count) continue            // 자기정합 — 우연 일치 배제
  // 참조들이 정상 범위인지(row<65536, col<256) 추가 검증
  let ok = true
  for (let k = 0; k < count; k++) {
    const o = i + 6 + k * 8
    const r1 = buf.readUInt16LE(o), r2 = buf.readUInt16LE(o + 2)
    const c1 = buf.readUInt16LE(o + 4), c2 = buf.readUInt16LE(o + 6)
    if (r1 > r2 || c1 > c2 || c2 > 255) { ok = false; break }
  }
  if (!ok) continue
  merges.push(count)
  i += 3 + len
}
const biffMergeTotal = merges.reduce((a, b) => a + b, 0)

// ── SETUP 0x00A1 (len 34) — numHdr/numFtr ─────────────────────────────
type Setup = { off: number; hdr: number; ftr: number; paper: number; scale: number }
const setups: Setup[] = []
for (let i = 0; i + 38 <= buf.length; i++) {
  if (buf[i] !== 0xa1 || buf[i + 1] !== 0x00) continue
  if (buf.readUInt16LE(i + 2) !== 34) continue
  const paper = buf.readUInt16LE(i + 4)
  const scale = buf.readUInt16LE(i + 6)
  const hdr = buf.readDoubleLE(i + 4 + 16)
  const ftr = buf.readDoubleLE(i + 4 + 24)
  if (!(paper >= 0 && paper < 120) || !(scale > 0 && scale <= 400)) continue
  if (!(hdr >= 0 && hdr < 5) || !(ftr >= 0 && ftr < 5)) continue
  setups.push({ off: i, hdr, ftr, paper, scale })
  i += 37
}

// ── LEFT/RIGHT/TOP/BOTTOM MARGIN 0x0026~0x0029 (len 8) ────────────────
const marginRecs: Record<string, number[]> = { left: [], right: [], top: [], bottom: [] }
const NAME: Record<number, string> = { 0x26: 'left', 0x27: 'right', 0x28: 'top', 0x29: 'bottom' }
for (let i = 0; i + 12 <= buf.length; i++) {
  const id = buf[i]
  if (buf[i + 1] !== 0x00 || !(id in NAME)) continue
  if (buf.readUInt16LE(i + 2) !== 8) continue
  const v = buf.readDoubleLE(i + 4)
  if (!(v >= 0 && v < 5)) continue
  marginRecs[NAME[id]].push(v)
  i += 11
}

// ── 대조: SheetJS가 읽은 값 (같은 결론에 도달하는가) ──────────────────
const wb = XLSX.read(buf, { cellStyles: true })
const sjMergeTotal = wb.SheetNames.reduce((n, s) => n + ((wb.Sheets[s]['!merges'] ?? []).length), 0)
const sjMargins: Record<string, unknown> = {}
for (const s of wb.SheetNames) sjMargins[s] = (wb.Sheets[s] as Record<string, unknown>)['!margins'] ?? null

const uniq = (a: number[]) => [...new Set(a.map(v => Number(v.toFixed(6))))].sort((x, y) => x - y)

const result = {
  file: SRC,
  bytes: buf.length,
  biff: {
    mergedCellsRecords: merges.length,
    mergeTotal: biffMergeTotal,
    setupRecords: setups.length,
    headerValues: uniq(setups.map(s => s.hdr)),
    footerValues: uniq(setups.map(s => s.ftr)),
    headerHistogram: Object.fromEntries(
      uniq(setups.map(s => s.hdr)).map(v => [v, setups.filter(s => Number(s.hdr.toFixed(6)) === v).length])),
    footerHistogram: Object.fromEntries(
      uniq(setups.map(s => s.ftr)).map(v => [v, setups.filter(s => Number(s.ftr.toFixed(6)) === v).length])),
    marginRecordCounts: Object.fromEntries(Object.entries(marginRecs).map(([k, v]) => [k, v.length])),
    marginValues: Object.fromEntries(Object.entries(marginRecs).map(([k, v]) => [k, uniq(v)])),
  },
  sheetjs: {
    sheetCount: wb.SheetNames.length,
    sheetNames: wb.SheetNames,
    mergeTotal: sjMergeTotal,
    margins: sjMargins,
  },
  agree: {
    mergeTotal: biffMergeTotal === sjMergeTotal,
  },
}
writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8')
console.log('WROTE', OUT)
console.log('biff mergeTotal =', biffMergeTotal, ' sheetjs mergeTotal =', sjMergeTotal, ' agree =', result.agree.mergeTotal)
console.log('biff setup records =', setups.length, ' header uniq =', JSON.stringify(uniq(setups.map(s => s.hdr))), ' footer uniq =', JSON.stringify(uniq(setups.map(s => s.ftr))))
process.exit(0)
