/** 격자 환산의 **정답지를 Excel에게 받는다** (일회용 · 이 PC에 Excel 필요).
 *
 *  왜: 검사와 제품이 같은 환산 산식을 공유하면, 그 산식이 틀려도 둘이 함께 틀려서 **늘 일관**이다
 *  (변이 M1~M3이 전부 생존해 그 사실을 실증했다). 그래서 산식 밖의 기준이 있어야 하고,
 *  그건 **실제로 그리는 주체**인 Excel이다. 여기서 받은 값이 `test-xlsx-geometry`의 정답지가 된다.
 *
 *  실행: npx tsx scripts/_probe-excel-colpx.mts
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { colWidthToPx, rowHeightToPx } from '../src/lib/xlsx-geometry.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TPL = resolve(HERE, '../templates/fire-plan-workbook.xlsx').replace(/\\/g, '\\\\')

/** Excel은 Range.Width를 **포인트**로 준다. 96dpi 화면 픽셀 = pt × 4/3 */
const ps = `
$ErrorActionPreference='Stop'
$x = New-Object -ComObject Excel.Application
$x.Visible = $false; $x.DisplayAlerts = $false
try {
  $wb = $x.Workbooks.Open('${TPL}', $false, $true)
  $ws = $wb.Sheets.Item('표지')
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  Write-Output ("col1_width=" + $ws.Columns.Item(1).ColumnWidth)
  Write-Output ("col1_pt=" + $ws.Columns.Item(1).Width)
  Write-Output ("box_pt=" + $ws.Range('A5:BH5').Width)
  Write-Output ("row5_pt=" + $ws.Rows.Item(5).Height)
  Write-Output ("title_pt=" + $ws.Range('A3:BH3').Width)
  $wb.Close($false)
} finally { $x.Quit() }
`
const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
  { encoding: 'utf8', maxBuffer: 1 << 22 })
const kv = new Map(out.trim().split(/\r?\n/).map(l => l.split('=') as [string, string]))
const num = (k: string) => Number(kv.get(k))

const PT2PX = 4 / 3
console.log(out.trim(), '\n')

/* 🚨 **입력을 헷갈리면 안 된다.** Excel의 `ColumnWidth`(1.14)와 시트 XML의 `width`(1.80)는
 *   **다른 눈금**이다 — XML 쪽이 칸 안쪽 여백을 포함한 값이라 약 5/7자만큼 크다.
 *   제품은 XML을 읽으므로 환산 함수에도 **XML 값**을 넣어야 한다(첫 판에서 1.14를 넣어
 *   「우리 8px」이라는 엉뚱한 결론이 나왔다 — 계측기가 자기 입력을 틀린 것이다).
 *   ⭐ 그리고 이 차이가 곧 옛 결함의 정체다: 옛 산식 `w*7+5`는 **ColumnWidth 의미**로 쓰인
 *     식인데 XML 값에 먹여 여백을 **두 번** 더했다. */
const xmlW = Number(/width="([\d.]+)"/.exec(
  readFileSync(resolve(HERE, '../templates/fire-plan-workbook.xlsx')).toString('latin1')
    .match(/<col min="1" max="1"[^>]*>/)?.[0] ?? '') ?.[1] ?? 1.8)
const w = num('col1_width')
const excelCol1Px = num('col1_pt') * PT2PX
const excelBoxPx = num('box_pt') * PT2PX
const ourCol1Px = colWidthToPx(xmlW)
const ourBoxPx = ourCol1Px * 60

console.log(`열 폭 — Excel ColumnWidth ${w}자 · 시트 XML width ${xmlW}자 (여백 포함이라 다르다)`)
console.log(`  Excel(정답): 한 열 ${excelCol1Px.toFixed(1)}px · 60열 상자 ${excelBoxPx.toFixed(1)}px`)
console.log(`  우리(XML→px): 한 열 ${ourCol1Px}px · 60열 상자 ${ourBoxPx}px`)
console.log(`  옛 산식(XML→px): 한 열 ${Math.round(xmlW * 7 + 5)}px · 60열 상자 ${Math.round(xmlW * 7 + 5) * 60}px`)
console.log(`\n행 5 높이 ${num('row5_pt')}pt → Excel ${(num('row5_pt') * PT2PX).toFixed(1)}px · 우리 ${rowHeightToPx(num('row5_pt'))}px`)
console.log(`\n▶ 상자 폭 오차 — 우리 ${(ourBoxPx - excelBoxPx).toFixed(1)}px · 옛 산식 ${(Math.round(w * 7 + 5) * 60 - excelBoxPx).toFixed(1)}px`)
