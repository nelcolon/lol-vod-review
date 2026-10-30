<#
.SYNOPSIS
  How much FPS does recording cost League? Alternates runs with no recording, the
  v0.3.7 recorder ("legacy") and the current one ("light"), twice each, and prints the
  game's average FPS and 1% low per run plus the drop against the baseline.

.DESCRIPTION
  Open League (Practice Tool is fine), stand somewhere with a steady view, keep the
  game in the foreground and don't touch anything while it runs. Close other recorders
  (Insights Capture, OBS...) and LoL VOD Review itself. Asks for admin once (PresentMon).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\bakeoff\Run-PerfAB.ps1 -Seconds 45
#>
param([int]$Seconds = 45, [int]$Rounds = 2, [string]$Label = "perf-ab")
$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $log = Join-Path $env:TEMP "lvr-perfab.log"
    Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"& '$PSCommandPath' -Seconds $Seconds -Rounds $Rounds -Label $Label *>&1 | Tee-Object -FilePath '$log'`""
    Get-Content $log
    return
}

$here = $PSScriptRoot
# leftovers from an interrupted run would make PresentMon refuse to start
foreach ($n in @("PresentMon") + (& logman.exe query -ets | Select-String -Pattern "lvr-bakeoff-\d+" | ForEach-Object { $_.Matches.Value })) { & logman.exe stop $n -ets 2>&1 | Out-Null }
if (-not (Get-Process "League of Legends" -ErrorAction SilentlyContinue)) { throw "Start a League game (Practice Tool is fine) first." }
$others = Get-Process "Insights Capture", "obs64", "LoL VOD Review" -ErrorAction SilentlyContinue
if ($others) { Write-Warning ("Still running, results will be skewed: " + (($others | Select-Object -ExpandProperty ProcessName -Unique) -join ", ")) }

$runs = @()
for ($r = 1; $r -le $Rounds; $r++) {
    foreach ($v in @(@{ b = "none"; p = "light" }, @{ b = "recorder"; p = "legacy" }, @{ b = "recorder"; p = "light" })) {
        $name = if ($v.b -eq "none") { "baseline" } else { "recorder-$($v.p)" }
        Write-Host "round $r/$Rounds  $name  ($Seconds s)..."
        & (Join-Path $here "Run-Bakeoff.ps1") -Backend $v.b -Perf $v.p -Seconds $Seconds -Label "$Label-$name" -NoNvidiaSmi | Out-Null
        $dir = Get-ChildItem (Join-Path $here "results") -Directory | Sort-Object LastWriteTime | Select-Object -Last 1
        $sum = Get-Content (Join-Path $dir.FullName "summary.json") -Raw | ConvertFrom-Json
        $pm = $sum.presentMon
        $runs += [pscustomobject]@{ Round = $r; Run = $name; AvgFps = [double]$pm.avgFps; Low1 = [double]$pm.onePercentLowFps; Dir = $dir.Name }
        Start-Sleep 3
    }
}

$base = $runs | Where-Object Run -eq "baseline"
$baseAvg = ($base | Measure-Object AvgFps -Average).Average
$baseLow = ($base | Measure-Object Low1 -Average).Average
"`nPer run:"
$runs | Format-Table Round, Run, @{ n = "Avg FPS"; e = { "{0:N1}" -f $_.AvgFps } }, @{ n = "1% low"; e = { "{0:N1}" -f $_.Low1 } }, Dir -AutoSize | Out-String -Width 200
"Averages (drop vs baseline):"
$runs | Group-Object Run | ForEach-Object {
    $a = ($_.Group | Measure-Object AvgFps -Average).Average
    $l = ($_.Group | Measure-Object Low1 -Average).Average
    [pscustomobject]@{
        Run = $_.Name
        "Avg FPS" = "{0:N1}" -f $a
        "Avg drop" = $(if ($_.Name -eq "baseline") { "-" } else { "{0:N1}%" -f ((1 - $a / $baseAvg) * 100) })
        "1% low" = "{0:N1}" -f $l
        "1% low drop" = $(if ($_.Name -eq "baseline") { "-" } else { "{0:N1}%" -f ((1 - $l / $baseLow) * 100) })
    }
} | Format-Table -AutoSize | Out-String -Width 200
