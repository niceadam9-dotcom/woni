# Export the most interesting worksheets to individual PDFs with real Excel (the renderer that matters).
#
# Page numbers are NOT sheet numbers -- some sheets span several pages -- so never rasterize the
# whole-workbook PDF by page guess. And do not take indices from outside: ask the workbook itself
# which sheets carry controls, then pick by count. Fewer moving parts, no encoding of Korean names.
#
# NOTE: keep string literals ASCII (PS 5.1 reads BOM-less UTF-8 .ps1 as cp949).
param(
  [string]$File = (Join-Path $env:TEMP 'fireplan-prod.xlsx'),
  [string]$OutDir = (Join-Path $env:TEMP 'cbshots'),
  [int]$Top = 4
)
$ErrorActionPreference = 'Stop'
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir | Out-Null

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($File)
  $rows = @()
  for ($i = 1; $i -le $wb.Worksheets.Count; $i++) {
    $ws = $wb.Worksheets.Item($i)
    $n = $ws.CheckBoxes().Count
    if ($n -gt 0) { $rows += [pscustomobject]@{ Index = $i; Name = $ws.Name; Count = $n } }
  }
  Write-Output ("sheets with controls: {0}" -f $rows.Count)
  # Control group: the same sheets from a workbook with NO controls (env var, because PS 5.1
  # param binding of int arrays from a parent shell has bitten us). Comma separated indices.
  if ($env:CB_SHOT_INDEX) {
    $rows = @()
    foreach ($t in ($env:CB_SHOT_INDEX -split ',')) {
      $n = [int]$t.Trim()
      $rows += [pscustomobject]@{ Index = $n; Name = $wb.Worksheets.Item($n).Name; Count = 0 }
    }
  }
  # densest sheets (new shapes the 40-cell version never had) + the sheet that used to be the only one
  $pick = @($rows | Sort-Object Count -Descending | Select-Object -First $Top)
  $pick += @($rows | Where-Object { $_.Count -eq 40 })
  foreach ($r in ($pick | Sort-Object Index -Unique)) {
    $pdf = Join-Path $OutDir ("s{0}-n{1}.pdf" -f $r.Index, $r.Count)
    $wb.Worksheets.Item($r.Index).ExportAsFixedFormat(0, $pdf)
    Write-Output ("  [{0}] {1}  controls={2} -> {3}" -f $r.Index, $r.Name, $r.Count, (Split-Path $pdf -Leaf))
  }
  $wb.Close($false)
} finally {
  $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl); [GC]::Collect()
}
