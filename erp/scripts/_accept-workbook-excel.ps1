# S6-7 acceptance via real Excel (COM) - run _accept-workbook-build.mts first.
# ASCII only in this file: Korean strings come from expect.json (UTF-8).
$ErrorActionPreference = 'Stop'
$base = Join-Path $PSScriptRoot '_out\accept'
$expect = Get-Content -LiteralPath (Join-Path $base 'expect.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$pass = 0; $fail = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { $script:pass++; Write-Output ("  OK   $name $detail") }
  else { $script:fail++; Write-Output ("  FAIL $name $detail") }
}
function PdfPages([string]$path) {
  $s = [System.Text.Encoding]::GetEncoding(28591).GetString([System.IO.File]::ReadAllBytes($path))
  return ([regex]::Matches($s, '/Type\s*/Page\b')).Count
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.ScreenUpdating = $false
try {
  $results = @{}
  foreach ($name in @('template', 'injected')) {
    $xlsx = Join-Path $base "$name.xlsx"
    $pdf = Join-Path $base "$name-excel.pdf"
    if (Test-Path $pdf) { Remove-Item -LiteralPath $pdf -Force }
    $wb = $xl.Workbooks.Open($xlsx, 0, $true)   # read-only; corrupt file would throw or repair-flag
    Check "$name opens in Excel (sheets=$($wb.Sheets.Count))" ($wb.Sheets.Count -eq $expect.sheetCount)
    if ($name -eq 'injected') {
      foreach ($c in $expect.cells) {
        $v = $wb.Worksheets.Item($c.sheet).Range($c.cell).Value2
        $ok = if ($c.value -is [string]) { "$v" -eq $c.value } else { [double]$v -eq [double]$c.value }
        Check "cell $($c.sheet)!$($c.cell)" $ok "got='$v' want='$($c.value)'"
      }
    }
    $wb.ExportAsFixedFormat(0, $pdf)   # 0 = xlTypePDF, Excel's own pagination engine
    $wb.Close($false)
    $results[$name] = PdfPages $pdf
    Check "$name Excel PDF export" (Test-Path $pdf) "pages=$($results[$name])"
  }
  Check 'page count: injected == template (Excel pagination)' ($results['injected'] -eq $results['template']) "$($results['injected']) vs $($results['template'])"
} finally {
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
Write-Output ""
Write-Output ("RESULT: $pass pass / $fail fail")
if ($fail -gt 0) { exit 1 } else { exit 0 }
