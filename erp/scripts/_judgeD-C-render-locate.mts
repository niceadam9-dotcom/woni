/** 판정자 C — "×가 실제로 **그려졌는가**"를 구조로 판정.
 *  _probe-d11-render.mts [3][4]는 문서 전체의 마크 개수 하한이라 주입 0건에서도 초록이다(실증 완료).
 *  여기서는 **그 항목의 문구가 있는 렌더 행**에 마크가 함께 있는가를 본다 — 행 결속이 축이다.
 *  실행: npx tsx scripts/_judgeD-C-render-locate.mts <wb.html 경로> */
import { readFileSync } from 'node:fs'
import XLSX from 'xlsx'
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'
import { donorCellForItem } from '../src/lib/xlsx-donor-inject'
import { resultMark } from '../src/lib/doc-templates/base'

const HTML = process.argv[2]
const INSP = '98e3a13b-881d-4e20-9e42-b68c7c3b88f4'
let pass = 0, fail = 0
const ck = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${d ? ' — ' + d : ''}`) } }

const html = readFileSync(HTML, 'utf8')
const rows = html.match(/<tr[\s\S]*?<\/tr>/g) ?? []
console.log(`렌더 행 ${rows.length}개`)
const rowText = rows.map(r => r.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())

const wb = XLSX.read(readFileSync('F:/AI/ERP/_d11-live.xlsx'))
const cv = (s: string, c: string) => String((wb.Sheets[s]?.[c] as XLSX.CellObject | undefined)?.v ?? '').trim()

const { data: rs } = await raw.from('inspection_sheet_responses').select('item_code, result, month').eq('inspection_id', INSP).limit(2000)
const responses = (rs ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; month: number }>
const sheets = new Set(wb.SheetNames)

/** 그 행에서 가장 긴 텍스트(=점검항목 문구)를 뽑는다 */
const itemTextOf = (sheet: string, cell: string) => {
  const row = cell.replace(/^[A-Z]+/, '')
  const sh = wb.Sheets[sheet]
  let best = ''
  for (const k of Object.keys(sh)) {
    if (k.startsWith('!')) continue
    if (k.replace(/^[A-Z]+/, '') !== row) continue
    const v = String((sh[k] as XLSX.CellObject).v ?? '').trim()
    if (v.length > best.length && !/^[○×\/／]$/.test(v)) best = v
  }
  return best
}

const probeOne = (code: string, want: string, tag: string) => {
  const loc = donorCellForItem(code)
  if (!loc || !sheets.has(loc.sheet)) { console.log(`  (건너뜀) ${code} 시트 미동봉`); return }
  const txt = itemTextOf(loc.sheet, loc.cell)
  const key = txt.replace(/\s+/g, ' ').slice(0, 30)
  if (key.length < 6) { console.log(`  (건너뜀) ${code} 행 문구가 너무 짧다 «${key}»`); return }
  const hits = rowText.filter(t => t.includes(key))
  const withMark = hits.filter(t => t.includes(want))
  ck(`[${tag}] ${code} ${loc.sheet}!${loc.cell} — 문구 «${key.slice(0, 20)}…» 행 ${hits.length}개 중 '${want}' 동반 ${withMark.length}개`,
    hits.length > 0 && withMark.length > 0, `hits=${hits.length} withMark=${withMark.length}`)
}

console.log('\n=== 불량 3건: 항목 문구가 있는 렌더 행에 × 가 함께 있는가 ===')
for (const r of responses.filter(x => x.result === 'X')) probeOne(r.item_code, '×', 'X')

console.log('\n=== 음성 대조: 같은 방식으로 O·N 표본이 제 마크를 갖는가 ===')
const os = responses.filter(r => r.result === 'O' && donorCellForItem(r.item_code) && sheets.has(donorCellForItem(r.item_code)!.sheet)).slice(0, 3)
for (const r of os) probeOne(r.item_code, resultMark('O'), 'O')
const ns = responses.filter(r => r.result === 'N' && donorCellForItem(r.item_code) && sheets.has(donorCellForItem(r.item_code)!.sheet)).slice(0, 2)
for (const r of ns) probeOne(r.item_code, resultMark('N'), 'N')

console.log('\n=== 반증 축: 셀 값과 렌더 행이 어긋나는 표본이 있는가(무작위 20) ===')
const landed = responses.filter(r => { const l = donorCellForItem(r.item_code); return l && sheets.has(l.sheet) })
let bad = 0, checked = 0
for (const r of landed.slice(0, 40)) {
  const l = donorCellForItem(r.item_code)!
  const txt = itemTextOf(l.sheet, l.cell).replace(/\s+/g, ' ').slice(0, 30)
  if (txt.length < 6) continue
  checked++
  const hits = rowText.filter(t => t.includes(txt))
  if (!hits.some(t => t.includes(cv(l.sheet, l.cell)))) { bad++; if (bad <= 3) console.log(`     불일치: ${r.item_code} ${l.sheet}!${l.cell}='${cv(l.sheet, l.cell)}' 문구«${txt.slice(0, 18)}»`) }
}
ck(`표본 ${checked}건 중 렌더 행 마크 불일치 ${bad}건`, bad === 0, String(bad))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
