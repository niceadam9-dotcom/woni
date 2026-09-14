# Does real Excel 2019 accept what the PRODUCTION module emits?
#
# Node tests cannot answer this -- a CT_Worksheet order violation passes LibreOffice and only
# Excel complains. The decisive signal is POSITIVE: CheckBoxes().Count must equal the expected
# count, because a repaired file silently loses its controls.
#
# The ruler for position is Excel's own Range.Left/Top, not our formula. If the generator's
# geometry were wrong we would be comparing a bent ruler against itself.
#
# NOTE: keep all string literals ASCII -- PS 5.1 reads BOM-less UTF-8 .ps1 as cp949.
# Sheet '1.4' is workbook order 7 (0-based) = Worksheets.Item(8).
param([string]$File = (Join-Path $env:TEMP 'fireplan-prod.xlsx'))
$ErrorActionPreference = 'Stop'
$expect = Get-Content ($File + '.expect.json') -Raw -Encoding UTF8 | ConvertFrom-Json
# WHITE SQUARE / BALLOT BOX / BLACK SQUARE / BALLOT BOX WITH CHECK / WHITE SQUARE CONTAINING BLACK
$BOX_GLYPHS = [char[]]@(0x25A1, 0x2610, 0x25A0, 0x2611, 0x25A3)
$fail = 0
function Check([string]$name, [bool]$ok, [string]$detail) {
  if ($ok) { Write-Output ("  [ OK ] {0}" -f $name) }
  else { Write-Output ("  [FAIL] {0}  <- {1}" -f $name, $detail); $script:fail++ }
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($File)
  Check "50 worksheets survive" ($wb.Worksheets.Count -eq 50) "got $($wb.Worksheets.Count)"
  $ws = $wb.Worksheets.Item(8)
  $cbs = $ws.CheckBoxes()
  Check "Excel parsed all controls (a repair would drop them)" ($cbs.Count -eq $expect.Count) "got $($cbs.Count), want $($expect.Count)"

  $other = 0
  for ($i = 1; $i -le $wb.Worksheets.Count; $i++) { if ($i -ne 8) { $other += $wb.Worksheets.Item($i).CheckBoxes().Count } }
  Check "no stray controls on the other 49 sheets" ($other -eq 0) "got $other"

  if ($cbs.Count -eq $expect.Count) {
    $badCell = @(); $badState = @(); $badText = @()
    for ($i = 1; $i -le $cbs.Count; $i++) {
      $cb = $cbs.Item($i); $e = $expect[$i - 1]; $rg = $ws.Range($e.ref)
      if ([Math]::Abs($cb.Left - $rg.Left) -gt 1.0 -or [Math]::Abs($cb.Top - $rg.Top) -gt 1.0) {
        $badCell += ("{0} ctrl=({1},{2}) cell=({3},{4})" -f $e.ref, $cb.Left, $cb.Top, $rg.Left, $rg.Top)
      }
      if (($cb.Value -eq 1) -ne [bool]$e.checked) { $badState += ("{0} got={1} want={2}" -f $e.ref, $cb.Value, $e.checked) }
      $v = [string]$rg.Value2
      # NOTE: box glyphs MUST be built from code points. A literal U+25A1 etc. in a PS string
      # gets mangled to cp949 garbage and the regex dies with "Unterminated [] set".
      if ($v.IndexOfAny($BOX_GLYPHS) -ge 0) { $badText += ("{0} still has a box glyph" -f $e.ref) }
      elseif (-not $v.Contains($e.label)) { $badText += ("{0} lost wording: '{1}'" -f $e.ref, $v) }
    }
    Check "each control sits on its own cell's top-left (<=1pt, Excel is the ruler)" ($badCell.Count -eq 0) ($badCell -join ' | ')
    Check "checked states pair 1:1 with the injected data" ($badState.Count -eq 0) ($badState -join ' | ')
    Check "box glyph gone, legal wording intact" ($badText.Count -eq 0) ($badText -join ' | ')

    $c1 = $cbs.Item(1); $before = [int]$c1.Value
    $c1.Value = if ($before -eq 1) { -4146 } else { 1 }
    Check "controls are live (toggle changes value)" ([int]$c1.Value -ne $before) "before=$before"
    $c1.Value = $before
  }

  $pdf = Join-Path $env:TEMP 'fireplan-prod.pdf'
  if (Test-Path $pdf) { Remove-Item $pdf -Force }
  $ws.ExportAsFixedFormat(0, $pdf)
  Check "sheet prints (PDF produced)" (Test-Path $pdf) "no pdf"
  Write-Output ("  pdf: {0}" -f $pdf)
  $wb.Close($false)
} finally {
  $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl); [GC]::Collect()
}
Write-Output ""
if ($fail -eq 0) { Write-Output "ALL CHECKS PASSED" } else { Write-Output ("FAILURES: {0}" -f $fail); exit 1 }
