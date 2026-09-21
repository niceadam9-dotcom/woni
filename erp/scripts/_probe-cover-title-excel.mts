/** 표지 제목 실측 — **Excel에게 직접 묻는다**(일회용 프로브).
 *
 *  XML 단언은 「우리가 쓴 대로 쓰였나」까지만 답한다. 정작 사람이 보는 건 Excel이 그리는
 *  글자라, 병합·스타일이 엉키면 XML은 맞는데 화면은 틀릴 수 있다 — 그리는 주체에게 묻는다.
 *
 *  ① 운영 라우트와 **같은 injectWorkbook**으로 제목을 A3에 끼우고
 *  ② 그 파일을 Excel COM으로 열어 글꼴·크기·정렬·병합을 읽는다.
 *
 *  실행: npx tsx scripts/_probe-cover-title-excel.mts
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT = resolve(ROOT, 'scripts/_out/_cover-title-probe.xlsx')

const TITLE = process.argv[2] ?? '[ 용문3 ] 소방계획서'
const tpl = readFileSync(resolve(ROOT, 'templates/fire-plan-workbook.xlsx'))
const r = await injectWorkbook(tpl, [{ sheet: '표지', cell: 'A3', value: TITLE }])
writeFileSync(OUT, Buffer.from(r.bytes))
console.log(`주입 ${r.applied?.length ?? '?'}칸 · 놓침 ${JSON.stringify(r.missed ?? [])} · ${OUT}`)

/* ── Excel COM ── */
const ps = `
$ErrorActionPreference='Stop'
$x = New-Object -ComObject Excel.Application
$x.Visible = $false; $x.DisplayAlerts = $false
try {
  $wb = $x.Workbooks.Open('${OUT.replace(/\\/g, '\\\\')}', $false, $true)
  $ws = $wb.Sheets.Item('표지')
  $c  = $ws.Range('A3')
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  Write-Output ("값=" + $c.Text)
  Write-Output ("글꼴=" + $c.Font.Name)
  Write-Output ("크기=" + $c.Font.Size)
  Write-Output ("굵게=" + $c.Font.Bold)
  Write-Output ("가로정렬=" + $c.HorizontalAlignment)   # -4108=center -4131=left
  Write-Output ("세로정렬=" + $c.VerticalAlignment)
  Write-Output ("병합=" + $c.MergeArea.Address($false,$false))
  Write-Output ("행높이=" + $ws.Rows.Item(3).RowHeight)

  # 「잘리지 않는가」 — 병합 칸은 AutoFit이 안 먹으므로 **같은 폭의 단일 칸**을 만들어 재고,
  # 필요한 높이를 3행의 고정 높이(132pt)와 맞댄다. 재는 주체는 여전히 Excel이다.
  $sc = $wb.Sheets.Add()
  $sc.Columns.Item(1).ColumnWidth = 111.4        # 60열 x 1.80 = 780px 과 같은 폭
  $m = $sc.Range('A1')
  $m.Font.Name = $c.Font.Name; $m.Font.Size = $c.Font.Size
  $m.WrapText = $true
  $m.Value2 = $c.Text
  $sc.Rows.Item(1).AutoFit()
  Write-Output ("필요높이=" + $sc.Rows.Item(1).RowHeight + " (폭 " + $sc.Columns.Item(1).Width + "px)")
  # 대조군 — 본문 칸은 건드리지 않았는가
  Write-Output ("대조 A1: " + $ws.Range('A1').Font.Name + "/" + $ws.Range('A1').Font.Size)
  $ws2 = $wb.Sheets.Item('1.1 건축물 일반현황')
  Write-Output ("대조 1.1!A1: " + $ws2.Range('A1').Font.Name + "/" + $ws2.Range('A1').Font.Size)
  $wb.Close($false)
} finally { $x.Quit() }
`
console.log(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
  { encoding: 'utf8', maxBuffer: 1 << 22 }))
rmSync(OUT, { force: true })
