/** 판정자 C — LO 없이 결정적으로 판정: 주입 **전** 워크북에 이미 × ／ ○ 가 몇 개 있는가.
 *  _probe-d11-render.mts [3][4]는 `count(마크) >= 기대착지수` 하한 비교다.
 *  주입 전 개수가 이미 그 하한을 넘으면, 주입이 0건이어도 초록이 난다(=이빨 없음).
 *  ⚠ SheetJS는 **읽기만** 한다. 실행: npx tsx scripts/_judgeD-C-marks.mts */
import { readFileSync } from 'node:fs'
import XLSX from 'xlsx'
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'
import { donorGroupsToKeep, allDonorSheets, DONOR_TOC_SHEET } from '../src/lib/xlsx-donors'
import { sheetMatchesFacilities } from '../src/lib/sheet-facility-map'
import { removeSheets } from '../src/lib/xlsx-sheet-surgery'

const CUST = 'c98d316f-21ba-463b-9493-62dacdf44f56'
const { data: ff, error } = await raw.from('fire_facilities')
  .select('facility_code, buildings!inner(customer_id)').eq('buildings.customer_id', CUST).eq('installed', true)
if (error) throw new Error(String(error.message))
const installed = [...new Set((ff as Array<{ facility_code: string }>).map(f => f.facility_code))]

const template = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
const kept = new Set(donorGroupsToKeep(k => sheetMatchesFacilities(k, installed), false).flatMap(g => g.sheets))
const cut = await removeSheets(template, allDonorSheets().filter(s => s !== DONOR_TOC_SHEET && !kept.has(s)))

const tally = (bytes: Uint8Array, label: string) => {
  const wb = XLSX.read(bytes)
  const c = { '○': 0, '×': 0, '/': 0 } as Record<string, number>
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name]
    for (const k of Object.keys(sh)) {
      if (k.startsWith('!')) continue
      const v = String((sh[k] as XLSX.CellObject).v ?? '')
      for (const ch of ['○', '×', '/']) c[ch] += (v.match(new RegExp(ch === '/' ? '\\/' : ch, 'g')) ?? []).length
    }
  }
  console.log(`${label}: 시트 ${wb.SheetNames.length}장 · ○ ${c['○']} · × ${c['×']} · / ${c['/']}`)
  return c
}

const before = tally(cut.bytes, '주입 전(대조군)')
const live = tally(new Uint8Array(readFileSync('F:/AI/ERP/_d11-live.xlsx')), '라이브 산출물')

console.log(`\n차분(라이브 − 대조군): ○ ${live['○'] - before['○']} · × ${live['×'] - before['×']} · / ${live['/'] - before['/']}`)
console.log(`기대 착지                : ○ 19 · × 3 · / 160`)
console.log(`\n▶ _probe-d11-render.mts [3] 'count(×) >= 3' 이 주입 0건 대조군에서 통과하는가: ${before['×'] >= 3}`)
console.log(`▶ _probe-d11-render.mts [4] 'count(○) >= 19' 이 주입 0건 대조군에서 통과하는가: ${before['○'] >= 19}`)
