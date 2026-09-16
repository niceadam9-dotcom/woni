# Export the SAME sheet indices from the three variants (X/Y/Z) to one-PDF-per-sheet with real Excel.
#
# The three books differ only in colour and in whether controls exist, so the three PDFs of a sheet
# are pixel-comparable. Diffing them isolates first the controls and then the box glyphs.
#
# NOTE: keep string literals ASCII (PS 5.1 reads BOM-less UTF-8 .ps1 as cp949).
#
# -Zoom100 turns OFF fitToPage and prints at 100%. That matters: the sheets are fitToPage, so the
# printed layout is the SCALED one, while the person clicking the checkboxes sees the UNSCALED one
# on screen. Text advances do not necessarily scale linearly, so the two spaces can disagree --
# measure both before believing either.
param(
  [string]$Dir    = (Join-Path $env:TEMP 'cb3'),
  [string]$Sheets = '8,9,15',
  [switch]$Zoom100,
  [string]$Suffix = ''
)
$ErrorActionPreference = 'Stop'
$idx = @($Sheets -split ',' | ForEach-Object { [int]$_.Trim() })

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  foreach ($tag in @('X', 'Y', 'Z')) {
    $src = Join-Path $Dir "$tag.xlsx"
    $out = Join-Path $Dir ("pdf-$tag" + $Suffix)
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }
    New-Item -ItemType Directory -Path $out | Out-Null
    $wb = $xl.Workbooks.Open($src)
    foreach ($i in $idx) {
      $ws = $wb.Worksheets.Item($i)
      if ($Zoom100) {
        $ws.PageSetup.Zoom = $false        # must clear FitToPages first
        $ws.PageSetup.FitToPagesWide = $false
        $ws.PageSetup.FitToPagesTall = $false
        $ws.PageSetup.Zoom = 100
      }
      $pdf = Join-Path $out ("s{0}.pdf" -f $i)
      $ws.ExportAsFixedFormat(0, $pdf)
      Write-Output ("{0} [{1}] {2} -> {3}" -f $tag, $i, $ws.Name, (Split-Path $pdf -Leaf))
    }
    $wb.Close($false)
  }
} finally {
  $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl); [GC]::Collect()
}
