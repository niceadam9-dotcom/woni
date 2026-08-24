/** 전 67시트에서 **표본 고객의 답**을 전수 열거 — 덮개를 3시트에서 전 시트로 넓히기 위한 목록.
 *
 *  판정 B·C가 교차로 잡은 것: 덮개가 '정보·보고서·다수동일때' 3시트 하드코딩이라 나머지 64시트의
 *  체크된 마크가 영구히 안 보였다. 여기서 **앵커에 없는 √ 리터럴**과 그 파생 캐시를 전부 센다.
 *  분류: 항상 나가는 시트인가(도너 제거 대상 밖인가)도 함께 본다. */
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'
import { ANCHORS, MARK_CHECKED_RE, MARK_RE } from '../src/lib/xlsx-anchors.ts'
import { allDonorSheets, DONOR_TOC_SHEET } from '../src/lib/xlsx-donors.ts'

const wb = XLSX.read(readFileSync('templates/report-workbook-full.xlsx'), { cellFormula: true })
const anchored = new Set(ANCHORS.map(a => `${a.sheet}!${a.cell}`))
const donors = new Set(allDonorSheets())
const always = (s: string) => !donors.has(s) || s === DONOR_TOC_SHEET

const out: string[] = []
out.push(`### 시트 ${wb.SheetNames.length} · 도너(조건부) ${donors.size} · 항상 나감 ${wb.SheetNames.filter(always).length}`)

type Row = { sheet: string; cell: string; text: string; formula?: string }
const checkedLit: Row[] = [], checkedFml: Row[] = [], emptyMarkOnly: Row[] = []
for (const s of wb.SheetNames) {
  const ws = wb.Sheets[s]
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue
    const c = ws[k] as XLSX.CellObject
    const t = String(c.v ?? '')
    if (!MARK_RE.test(t)) continue
    const row: Row = { sheet: s, cell: k, text: t, formula: c.f }
    if (MARK_CHECKED_RE.test(t)) (c.f ? checkedFml : checkedLit).push(row)
    else emptyMarkOnly.push(row)
  }
}
out.push(`\n### 체크된 √ — 리터럴 ${checkedLit.length}칸 · 수식 캐시 ${checkedFml.length}칸 · 빈 마크만 ${emptyMarkOnly.length}칸`)

out.push('\n## [A] 앵커 없는 체크 리터럴 (= 표본 답이 그대로 인쇄된다)')
const bare = checkedLit.filter(r => !anchored.has(`${r.sheet}!${r.cell}`))
for (const r of bare) out.push(`  ${always(r.sheet) ? '항상' : '조건부'} ${r.sheet}!${r.cell} = ${JSON.stringify(r.text.slice(0, 100))}`)
out.push(`  → ${bare.length}칸 (항상 나감 ${bare.filter(r => always(r.sheet)).length})`)

out.push('\n## [B] 앵커로 덮인 체크 리터럴 (정상)')
out.push(`  ${checkedLit.length - bare.length}칸: ${checkedLit.filter(r => anchored.has(`${r.sheet}!${r.cell}`)).map(r => `${r.sheet}!${r.cell}`).join(' ')}`)

out.push('\n## [C] 체크 √를 든 수식 캐시 (원천 리터럴을 고치면 폐포가 따라온다)')
for (const r of checkedFml.slice(0, 40)) out.push(`  ${r.sheet}!${r.cell} f=${r.formula} v=${JSON.stringify(r.text.slice(0, 40))}`)
out.push(`  → ${checkedFml.length}칸`)

// 판정 마크 캐시('○' 양호 / '/' 해당없음)
const oCells: string[] = [], slashCells: string[] = []
for (const s of wb.SheetNames) {
  const ws = wb.Sheets[s]
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue
    const c = ws[k] as XLSX.CellObject
    const t = String(c.v ?? '').trim()
    if (t === '○') oCells.push(`${s}!${k}`)
    else if (t === '/' || t === '／') slashCells.push(`${s}!${k}`)
  }
}
out.push(`\n## [D] 판정 캐시 — '○'(양호) ${oCells.length}칸 · '/'(해당없음) ${slashCells.length}칸`)
out.push(`  ○: ${oCells.join(' ')}`)

// 자유 텍스트 표본 소견·위치
out.push('\n## [E] 표본 자유 텍스트(마크 아님) — 소견·실명·개소')
const FREE = ['이상없음', '별첨참조', '해당없음', '직원실']
for (const s of wb.SheetNames) {
  const ws = wb.Sheets[s]
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue
    const c = ws[k] as XLSX.CellObject
    const t = String(c.v ?? '')
    if (!FREE.some(f => t.includes(f))) continue
    out.push(`  ${always(s) ? '항상' : '조건부'} ${s}!${k} ${c.f ? `FML f=${c.f}` : 'LIT'} = ${JSON.stringify(t.slice(0, 70))}`)
  }
}

writeFileSync('scripts/_enum-sample-answers.txt', out.join('\n'), 'utf8')
console.log(`리터럴 ${bare.length} · 수식캐시 ${checkedFml.length} · ○ ${oCells.length} · / ${slashCells.length}`)
