/** 판정자 C — 서림사 1건으로는 닿지 않는 축을 덮는다.
 *  _probe-d5-roundtrip은 서림사 응답만 쓴다 → 넓은 서식 4시트 중 **2장만** 살아남아
 *  C-1(점검항목 문구를 마크로 덮어쓰는 사고) 회귀 축이 절반만 걸린다.
 *  여기서는 **매핑 720코드 전부**에 합성 응답을 넣고 전 도너 시트를 대상으로 왕복한다.
 *  ⚠ SheetJS는 읽기 전용. 자산은 건드리지 않는다(메모리 바이트만).
 *  실행: npx tsx scripts/_judgeD-C-allcodes.mts */
import { readFileSync } from 'node:fs'
import XLSX from 'xlsx'
import { injectWorkbook } from '../src/lib/xlsx-inject'
import { planDonorInjection, donorCellForItem } from '../src/lib/xlsx-donor-inject'
import { allDonorSheets } from '../src/lib/xlsx-donors'
import { extractDonorItemMap } from '../src/lib/xlsx-donor-itemmap-extract'
import itemmap from '../src/lib/xlsx-donor-itemmap.json' with { type: 'json' }
import { resultMark } from '../src/lib/doc-templates/base'

let pass = 0, fail = 0
const ck = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${d ? ' — ' + d : ''}`) } }

const CELLS = itemmap.cells as unknown as Record<string, [string, string]>
const codes = Object.keys(CELLS)
console.log(`매핑 ${codes.length}코드 · 도너 시트 ${allDonorSheets().length}장`)

// 합성 응답 — 코드마다 O/X/N 돌려가며
const results: Array<'O' | 'X' | 'N'> = ['O', 'X', 'N']
const responses = codes.map((c, i) => ({ item_code: c, result: results[i % 3], month: 0 }))
const kept = new Set(allDonorSheets())
const plan = planDonorInjection(responses, kept)
ck(`[1] 720코드 전부 착지(landed ${plan.landed} / total ${plan.total})`, plan.landed === codes.length,
  `미착지 ${JSON.stringify(plan.notLanded).slice(0, 200)}`)

const template = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
const res = await injectWorkbook(template, plan.targets, {})
ck('[2] 주입 미발견 0', res.missed.length === 0, res.missed.slice(0, 6).join(','))

const before = XLSX.read(template)
const after = XLSX.read(res.bytes)
const cv = (wb: XLSX.WorkBook, s: string, c: string) => String((wb.Sheets[s]?.[c] as XLSX.CellObject | undefined)?.v ?? '').trim()

// 순방향 — 720칸 전부 기대 마크
const wrong: string[] = []
for (const r of responses) {
  const l = donorCellForItem(r.item_code)!
  if (cv(after, l.sheet, l.cell) !== resultMark(r.result)) wrong.push(`${l.sheet}!${l.cell} 기대'${resultMark(r.result)}' 실제'${cv(after, l.sheet, l.cell)}'`)
}
ck(`[3] 720칸 전부 기대 마크`, wrong.length === 0, wrong.slice(0, 5).join(' · '))

// C-1 회귀 — 넓은 서식 **4시트 전부**의 점검항목 문구(C열) 원문 보존
const wide = ['옥3', '스4', '옥외3', '다중1']
const brokenWide: string[] = []
for (const s of wide) {
  if (!before.Sheets[s]) { brokenWide.push(`${s}(시트 없음)`); continue }
  for (const k of Object.keys(before.Sheets[s]).filter(k => /^C\d+$/.test(k))) {
    const b = cv(before, s, k)
    if (b && b !== cv(after, s, k)) brokenWide.push(`${s}!${k}`)
  }
}
ck(`[4] 넓은 서식 4시트(${wide.join('·')}) C열 문구 원문 보존`, brokenWide.length === 0, brokenWide.slice(0, 6).join(','))

// 전 도너 시트에서 **주입 대상이 아닌 칸**이 하나도 변하지 않았는가(파괴 없음 전수)
const targetSet = new Set(plan.targets.map(t => `${t.sheet}!${t.cell}`))
const collateral: string[] = []
for (const s of allDonorSheets()) {
  if (!before.Sheets[s]) continue
  // ⚠ before의 키만 돌면 **원래 공란이던 칸에 값이 새로 생긴 것**을 못 본다 — 양쪽 합집합으로
  const keys = new Set([...Object.keys(before.Sheets[s] ?? {}), ...Object.keys(after.Sheets[s] ?? {})])
  for (const k of keys) {
    if (k.startsWith('!')) continue
    if (targetSet.has(`${s}!${k}`)) continue
    if (cv(before, s, k) !== cv(after, s, k)) collateral.push(`${s}!${k} '${cv(before, s, k).slice(0, 14)}'→'${cv(after, s, k).slice(0, 14)}'`)
  }
}
ck(`[5] 주입 대상 아닌 도너 칸 전수 무변경(부수 피해 0)`, collateral.length === 0, collateral.slice(0, 6).join(' · '))
console.log(`     대조한 도너 칸 ${allDonorSheets().reduce((n, s) => n + Object.keys(before.Sheets[s] ?? {}).filter(k => !k.startsWith('!')).length, 0)}개`)

// 검사 [1](커밋 맵 == 재도출) 의 순서 민감성 — 두 좌표를 바꾼 사본을 만들어 비교 로직이 잡는지
{
  const shuffled = Object.entries(CELLS).map(([c, v]) => `${c}=${v[0]}!${v[1]}`)
  const t = shuffled[10]; shuffled[10] = shuffled[11]; shuffled[11] = t
  const truth = Object.entries(CELLS).map(([c, v]) => `${c}=${v[0]}!${v[1]}`)
  const firstDiff = truth.findIndex((v, i) => v !== shuffled[i])
  ck('[6] 순서 대조 로직이 2좌표 교환을 잡는다(집합 비교였다면 못 본다)', firstDiff >= 0, String(firstDiff))
}

// 추출기 재도출 실패 0 (자산 무결성)
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exitCode = fail ? 1 : 0
void extractDonorItemMap
