# Ask Excel for the LINE PITCH of wrapped text in a cell (Malgun Gothic 10pt) -- AutoFit slope.
#
# height(N lines) = N * pitch + padding, so pitch = height(N+1) - height(N). Taking the slope
# cancels the padding, which is the part we do not care about (vertical centering hides it).
#
# This is a PRIOR, not the verdict. Excel's AutoFit ruler is not the render ruler -- the render
# diff probe is the authority (a font-width model that matched its own ruler to 0.01px was 9% off
# in the cell). Run _probe-cb-linerender.mts to confirm before trusting this number.
#
# NOTE: keep string literals ASCII (PS 5.1 reads BOM-less UTF-8 .ps1 as cp949).
$ErrorActionPreference = 'Stop'
$KO = [string]([char]0xAC00) + [string]([char]0xB098) + [string]([char]0xB2E4)   # 3 hangul syllables
$LF = [string][char]10

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1)
  $ws.Columns.Item(1).ColumnWidth = 40
  $heights = @()
  for ($n = 1; $n -le 6; $n++) {
    $cell = $ws.Cells.Item($n, 1)
    $cell.Font.Name = 'Malgun Gothic'
    $cell.Font.Size = 10
    $cell.WrapText = $true
    $parts = @()
    for ($k = 1; $k -le $n; $k++) { $parts += $KO }
    $cell.Value2 = ($parts -join $LF)
    $ws.Rows.Item($n).AutoFit() | Out-Null
    $pt = $ws.Rows.Item($n).RowHeight
    $heights += $pt
    Write-Output ("lines={0}  height={1,7:N2}pt  = {2,6:N2}px" -f $n, $pt, ($pt * 4 / 3))
  }
  Write-Output ''
  for ($i = 1; $i -lt $heights.Count; $i++) {
    $d = $heights[$i] - $heights[$i - 1]
    Write-Output ("  delta {0}->{1}: {2,6:N2}pt = {3,6:N2}px" -f $i, ($i + 1), $d, ($d * 4 / 3))
  }
  $wb.Close($false)
} finally {
  $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl); [GC]::Collect()
}
