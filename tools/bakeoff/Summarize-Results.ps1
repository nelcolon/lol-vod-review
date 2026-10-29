<#
.SYNOPSIS
  Tabulate every tools/bakeoff/results/*/summary.json for ADR-002.

.DESCRIPTION
  One row per run: game FPS from PresentMon (avg, 1% low, 0.1% low), the delta
  against the baseline ("none") run, GPU SM / encoder utilisation from
  nvidia-smi, and what the backend produced (frames, dropped, measured fps,
  GOP, size, audio). -Markdown prints a table ready to paste into the ADR.

.PARAMETER Baseline
  Results folder name to use as the FPS baseline. Default: the most recent
  "none" run with the same -Label (or any "none" run).
#>
[CmdletBinding()]
param(
    [string]$ResultsDir = (Join-Path $PSScriptRoot "results"),
    [string]$Baseline = "",
    [string]$Label = "",
    [switch]$Markdown
)

$ErrorActionPreference = "Stop"

$files = Get-ChildItem -Path $ResultsDir -Filter summary.json -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName
if (-not $files) { Write-Host "no summary.json under $ResultsDir"; exit 0 }
$runs = foreach ($f in $files) { try { Get-Content $f.FullName -Raw | ConvertFrom-Json } catch { Write-Warning "skip $($f.FullName): $_" } }
if ($Label) { $runs = $runs | Where-Object { $_.label -eq $Label } }

function Val($obj, $name) {
    if ($null -eq $obj) { return $null }
    $p = $obj.PSObject.Properties[$name]
    if ($p) { return $p.Value } else { return $null }
}
function Fmt($v, $digits = 1) {
    if ($null -eq $v -or $v -eq "") { return "-" }
    if ($v -is [double] -or $v -is [decimal] -or $v -is [single]) { return ([math]::Round([double]$v, $digits)).ToString() }
    return "$v"
}

$baselineRun = $null
if ($Baseline) { $baselineRun = $runs | Where-Object { $_.run -eq $Baseline } | Select-Object -First 1 }
if (-not $baselineRun) { $baselineRun = $runs | Where-Object { $_.backend -eq "none" -and (Val $_.presentMon "avgFps") } | Select-Object -Last 1 }
$baseFps = if ($baselineRun) { Val $baselineRun.presentMon "avgFps" } else { $null }

$rows = foreach ($r in $runs) {
    $pm = $r.presentMon
    $nv = $r.nvidiaSmi
    $v = $r.video
    $bs = $r.backendStats
    $avg = Val $pm "avgFps"
    $delta = if ($baseFps -and $avg) { [math]::Round([double]$avg - [double]$baseFps, 1) } else { $null }
    $pct = if ($baseFps -and $avg) { [math]::Round(100.0 * ([double]$avg - [double]$baseFps) / [double]$baseFps, 1) } else { $null }
    $warnCount = if ($r.warnings) { @($r.warnings).Count } else { 0 }
    [pscustomobject]@{
        Run        = $r.run
        Backend    = $r.backend
        Label      = $r.label
        Secs       = $r.seconds
        GameFps    = Fmt $avg
        Low1Pct    = Fmt (Val $pm "onePercentLowFps")
        Low01Pct   = Fmt (Val $pm "pointOnePercentLowFps")
        DeltaFps   = if ($null -ne $delta) { "{0:+0.0;-0.0;0.0}" -f $delta } else { "-" }
        DeltaPct   = if ($null -ne $pct) { "{0:+0.0;-0.0;0.0}%" -f $pct } else { "-" }
        PmFrames   = Fmt (Val $pm "frames") 0
        GpuSm      = Fmt (Val $nv "avg_sm")
        GpuEnc     = Fmt (Val $nv "avg_enc")
        RecFrames  = Fmt (Val $v "videoFrames") 0
        RecFps     = Fmt (Val $v "measuredFps")
        Dropped    = Fmt (Val $bs "dropped") 0
        GopSec     = Fmt (Val $v "avgGopSec") 2
        SizeMB     = if (Val $v "sizeBytes") { Fmt ([double](Val $v "sizeBytes") / 1MB) } else { "-" }
        Codec      = if ($v) { "{0}/{1}" -f (Val $v "codec"), (Val $v "audioCodec") } else { "-" }
        Encoder    = if ($bs) { $(if (Val $bs "encoderHw") { "{0} ({1})" -f (Val $bs "encoder"), (Val $bs "encoderHw") } else { Val $bs "encoder" }) } else { "-" }
        Warnings   = $warnCount
        PmError    = if ($r.presentMonError) { "$($r.presentMonError)" } elseif ($pm -and (Val $pm "error")) { Val $pm "error" } else { "" }
    }
}

if ($baselineRun) { Write-Host ("baseline: {0} (game avg {1} fps)" -f $baselineRun.run, $baseFps) } else { Write-Host "baseline: none found (run -Backend none first)" }

if ($Markdown) {
    $cols = "Run", "Backend", "Label", "GameFps", "Low1Pct", "Low01Pct", "DeltaFps", "DeltaPct", "GpuSm", "GpuEnc", "RecFps", "Dropped", "GopSec", "SizeMB", "Codec", "Encoder", "Warnings"
    Write-Output ("| " + ($cols -join " | ") + " |")
    Write-Output ("|" + (($cols | ForEach-Object { "---" }) -join "|") + "|")
    foreach ($row in $rows) {
        Write-Output ("| " + (($cols | ForEach-Object { "$($row.$_)" -replace '\|', '\|' }) -join " | ") + " |")
    }
    $bad = $rows | Where-Object { $_.PmError }
    if ($bad) { Write-Output ""; foreach ($b in $bad) { Write-Output ("- {0}: PresentMon: {1}" -f $b.Run, $b.PmError) } }
} else {
    $rows | Format-Table Run, Backend, Label, GameFps, Low1Pct, Low01Pct, DeltaFps, DeltaPct, GpuSm, GpuEnc, RecFrames, RecFps, Dropped, GopSec, SizeMB, Codec, Warnings -AutoSize | Out-String -Width 400 | Write-Host
    $bad = $rows | Where-Object { $_.PmError }
    foreach ($b in $bad) { Write-Host ("{0}: PresentMon: {1}" -f $b.Run, $b.PmError) }
    $enc = $rows | Where-Object { $_.Encoder -ne "-" } | Select-Object -Last 1
    if ($enc) { Write-Host ("encoder (last run): {0}" -f $enc.Encoder) }
}
