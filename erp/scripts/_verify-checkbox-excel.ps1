# Does real Excel 2019 accept what the PRODUCTION module emits?
#
# Node tests cannot answer this -- a CT_Worksheet order violation passes LibreOffice and only
# Excel complains. The decisive signal is POSITIVE: CheckBoxes().Count must equal the expected
# count, because a repaired file silently loses its controls.
#
# The ruler for position is Excel's own Range.Left/Top, not our formula. If the generator's
# geometry were wrong we would be comparing a bent ruler against itself.
#
# 2026-09-14 SCOPE CHANGE: controls now span the WHOLE workbook (582 across 28 sheets), not
# just sheet '1.4'. The old contract "no stray controls on the other 49 sheets" is REPLACED by
# the pair below -- present on every eligible sheet / absent on every other. Deleting it instead
# of replacing it would leave "where should they be?" unasked, and a half-done rollout green.
#
# NOTE: keep all string literals ASCII -- PS 5.1 reads BOM-less UTF-8 .ps1 as cp949.
# Sheet names are read from the JSON (UTF8) instead, and matched by name -- never assumed by index.
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
  Check "all worksheets survive" ($wb.Worksheets.Count -eq $expect.sheetCount) "got $($wb.Worksheets.Count), want $($expect.sheetCount)"

  # ---- total across the workbook. A repair drops controls silently, so a POSITIVE total is the signal.
  $grand = 0
  for ($i = 1; $i -le $wb.Worksheets.Count; $i++) { $grand += $wb.Worksheets.Item($i).CheckBoxes().Count }
  Check "Excel parsed every control (a repair would drop them)" ($grand -eq $expect.total) "got $grand, want $($expect.total)"

  # ---- name-indexed expectation. Index is asserted, not assumed.
  $wantBySheet = @{}
  foreach ($s in $expect.sheets) {
    $ws = $wb.Worksheets.Item($s.index)
    if ($ws.Name -ne $s.name) { Check ("sheet index {0} is the expected sheet" -f $s.index) $false ("got '" + $ws.Name + "'") }
    $wantBySheet[$ws.Name] = $s
  }

  # ---- REPLACES "only sheet 8 has controls": present where eligible / absent where not.
  $missingSheets = @(); $straySheets = @(); $countOff = @()
  for ($i = 1; $i -le $wb.Worksheets.Count; $i++) {
    $ws = $wb.Worksheets.Item($i)
    $n = $ws.CheckBoxes().Count
    if ($wantBySheet.ContainsKey($ws.Name)) {
      $w = $wantBySheet[$ws.Name].cells.Count
      if ($n -eq 0) { $missingSheets += $ws.Name }
      elseif ($n -ne $w) { $countOff += ("{0} got={1} want={2}" -f $ws.Name, $n, $w) }
    } elseif ($n -ne 0) { $straySheets += ("{0}={1}" -f $ws.Name, $n) }
  }
  Check "every eligible sheet has its controls (positive)" ($missingSheets.Count -eq 0) ($missingSheets -join ' | ')
  Check "per-sheet counts match exactly" ($countOff.Count -eq 0) ($countOff -join ' | ')
  Check "no controls on sheets that have none eligible (negative pair)" ($straySheets.Count -eq 0) ($straySheets -join ' | ')

  # ---- geometry / state / wording, across ALL sheets. Excel's own Range is the ruler.
  if ($grand -eq $expect.total) {
    $badCell = @(); $badState = @(); $badText = @(); $badHide = @(); $checkedSeen = 0
    foreach ($s in $expect.sheets) {
      $ws = $wb.Worksheets.Item($s.index)
      $cbs = $ws.CheckBoxes()
      for ($i = 1; $i -le $cbs.Count; $i++) {
        $cb = $cbs.Item($i); $e = $s.cells[$i - 1]; $rg = $ws.Range($e.ref)
        # 2026-09-14: a cell can hold several boxes ("box1 yes  box2 no"), so the expected left edge
        # is the CELL's left plus THIS box's own offset -- not the cell's left. Those offsets were
        # obtained by printing the sheet and diffing the render, so the ruler is still Excel's.
        $wantLeft = $rg.Left + [double]$e.offsetPt
        if ([Math]::Abs($cb.Left - $wantLeft) -gt 1.5 -or [Math]::Abs($cb.Top - $rg.Top) -gt 1.0) {
          $badCell += ("{0}!{1}#{2} ctrl=({3},{4}) want=({5},{6})" -f $s.name, $e.ref, $e.box, [Math]::Round($cb.Left,1), [Math]::Round($cb.Top,1), [Math]::Round($wantLeft,1), [Math]::Round($rg.Top,1))
        }
        if (($cb.Value -eq 1) -ne [bool]$e.checked) { $badState += ("{0}!{1}#{2} got={3} want={4}" -f $s.name, $e.ref, $e.box, $cb.Value, $e.checked) }
        if ($cb.Value -eq 1) { $checkedSeen++ }
        # 2026-09-14 CONTRACT CHANGE: the box glyph is no longer swapped for a blank -- it stays and
        # is PAINTED IN THE CELL'S BACKGROUND COLOUR. Swapping it moved every following character
        # (the box renders in SegoeUISymbol, the blank in Malgun Gothic -- different advance), which
        # dragged labels under the controls. So the checks flip:
        #   before: "the glyph is gone"      ->  now: "the text is byte-identical to the form"
        #   and, new: "the glyph is invisible" == its font colour equals the cell's background.
        $v = [string]$rg.Value2
        if ($v -ne $e.expectText) { $badText += ("{0}!{1} text differs: '{2}'" -f $s.name, $e.ref, $v) }
        else {
          $bg = if ($rg.Interior.ColorIndex -eq -4142) { 16777215 } else { [int]$rg.Interior.Color }
          $fg = [int]$rg.Characters([int]$e.boxAt, 1).Font.Color
          if ($fg -ne $bg) { $badHide += ("{0}!{1}#{2} glyph colour {3} != background {4}" -f $s.name, $e.ref, $e.box, $fg, $bg) }
        }
      }
    }
    Check "each control sits on its own cell's top-left (<=1pt, Excel is the ruler)" ($badCell.Count -eq 0) (($badCell | Select-Object -First 6) -join ' | ')
    Check "checked states pair 1:1 with the injected data" ($badState.Count -eq 0) (($badState | Select-Object -First 6) -join ' | ')
    Check "legal wording byte-identical to the form (text is never rewritten)" ($badText.Count -eq 0) (($badText | Select-Object -First 6) -join ' | ')
    Check "the box glyph is painted in the cell background (invisible, no double mark)" ($badHide.Count -eq 0) (($badHide | Select-Object -First 6) -join ' | ')
    # empty positive control: if nothing was ever checked the state assertion above proves nothing
    $wantChecked = 0
    foreach ($s in $expect.sheets) { foreach ($c in $s.cells) { if ($c.checked) { $wantChecked++ } } }
    Check "the checked sample was non-empty (state assertion is not vacuous)" ($wantChecked -gt 0 -and $checkedSeen -eq $wantChecked) "seen=$checkedSeen want=$wantChecked"

    # live toggle, on a sheet other than the original one -- proves the expansion is interactive too
    $last = $expect.sheets[$expect.sheets.Count - 1]
    $lc = $wb.Worksheets.Item($last.index).CheckBoxes().Item(1)
    $before = [int]$lc.Value
    $lc.Value = if ($before -eq 1) { -4146 } else { 1 }
    Check ("controls are live on a newly covered sheet (toggle changes value)") ([int]$lc.Value -ne $before) "before=$before"
    $lc.Value = $before
  }

  $pdf = Join-Path $env:TEMP 'fireplan-prod.pdf'
  if (Test-Path $pdf) { Remove-Item $pdf -Force }
  $wb.ExportAsFixedFormat(0, $pdf)
  Check "workbook prints (PDF produced)" (Test-Path $pdf) "no pdf"
  Write-Output ("  pdf: {0}" -f $pdf)
  $wb.Close($false)
} finally {
  $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl); [GC]::Collect()
}
Write-Output ""
if ($fail -eq 0) { Write-Output "ALL CHECKS PASSED" } else { Write-Output ("FAILURES: {0}" -f $fail); exit 1 }
