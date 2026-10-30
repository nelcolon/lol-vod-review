# Samples CPU, RAM, GPU (3D + video encode) and disk writes per app, to compare LoL VOD Review
# with other recorders (Insights Capture, OBS, Outplayed, Medal...) and with League itself.
#
#   powershell -ExecutionPolicy Bypass -File tools\measure-resources.ps1 -Seconds 120
#
# Run it while a game is being recorded for the number that matters. CPU % is of the whole
# machine (all cores = 100 %), like Task Manager's Processes tab.
param(
  [int]$Seconds = 60,
  [int]$IntervalMs = 1000,
  [string]$Csv = ''
)
$ErrorActionPreference = 'Stop'

# App name -> process names (without .exe). Add more here to compare other tools.
$apps = [ordered]@{
  'LoL VOD Review'   = @('LoL VOD Review', 'lvr-recorder', 'ffmpeg')
  'Insights Capture' = @('Insights Capture')
  'OBS'              = @('obs64', 'obs-ffmpeg-mux')
  'Outplayed/Overwolf' = @('Overwolf', 'OverwolfBrowser', 'OverwolfHelper', 'OverwolfHelper64', 'Outplayed')
  'Medal'            = @('Medal', 'MedalEncoder')
  'NVIDIA overlay'   = @('NVIDIA Share', 'NVIDIA Overlay')
  'League (game)'    = @('League of Legends')
  'League client'    = @('LeagueClient', 'LeagueClientUx', 'LeagueClientUxRender')
}
# The dev build runs as electron.exe from this repo; count it as LoL VOD Review.
$repo = Split-Path $PSScriptRoot -Parent

$cores = [Environment]::ProcessorCount
$appOf = @{}
foreach ($k in $apps.Keys) { foreach ($n in $apps[$k]) { $appOf["$n.exe".ToLower()] = $k } }

function Snapshot {
  $rows = @{}
  foreach ($p in Get-CimInstance Win32_Process -Property ProcessId, Name, ExecutablePath, KernelModeTime, UserModeTime, WorkingSetSize, PrivatePageCount, WriteTransferCount) {
    $app = $appOf[$p.Name.ToLower()]
    if (-not $app -and $p.Name -eq 'electron.exe' -and $p.ExecutablePath -and $p.ExecutablePath.StartsWith($repo)) { $app = 'LoL VOD Review' }
    if ($app) { $rows[[int]$p.ProcessId] = [pscustomobject]@{ App = $app; Cpu = [double]($p.KernelModeTime + $p.UserModeTime); Ws = [double]$p.WorkingSetSize; Write = [double]$p.WriteTransferCount } }
  }
  $rows
}

function GpuByPid {
  $g = @{}
  try {
    $samples = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples
  } catch { return $g }
  foreach ($s in $samples) {
    if ($s.InstanceName -match 'pid_(\d+)_.*engtype_(\w+)') {
      $procId = [int]$Matches[1]; $eng = $Matches[2]
      if (-not $g[$procId]) { $g[$procId] = @{ '3D' = 0.0; 'VideoEncode' = 0.0 } }
      if ($eng -eq '3D') { $g[$procId]['3D'] += $s.CookedValue }
      elseif ($eng -like 'VideoEncode*') { $g[$procId]['VideoEncode'] += $s.CookedValue }
    }
  }
  $g
}

Write-Host "Sampling for $Seconds s every $IntervalMs ms ($cores logical cores)..."
$series = @{}
foreach ($k in $apps.Keys) { $series[$k] = New-Object System.Collections.Generic.List[object] }
$prev = Snapshot
$prevT = Get-Date
$end = $prevT.AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  Start-Sleep -Milliseconds $IntervalMs
  $gpu = GpuByPid
  $cur = Snapshot
  $now = Get-Date
  $dt = ($now - $prevT).TotalSeconds
  $agg = @{}
  foreach ($procId in $cur.Keys) {
    $c = $cur[$procId]; $p = $prev[$procId]
    if (-not $agg[$c.App]) { $agg[$c.App] = @{ Cpu = 0.0; Ram = 0.0; Gpu3d = 0.0; Enc = 0.0; Write = 0.0; Procs = 0 } }
    $a = $agg[$c.App]
    $a.Procs++
    $a.Ram += $c.Ws / 1MB
    if ($p) {
      # CIM times are in 100 ns units
      $a.Cpu += [math]::Max(0, ($c.Cpu - $p.Cpu) / 1e7 / $dt / $cores * 100)
      $a.Write += [math]::Max(0, ($c.Write - $p.Write) / 1MB / $dt)
    }
    if ($gpu[$procId]) { $a.Gpu3d += $gpu[$procId]['3D']; $a.Enc += $gpu[$procId]['VideoEncode'] }
  }
  foreach ($k in $agg.Keys) { $series[$k].Add([pscustomobject]$agg[$k]) }
  $prev = $cur; $prevT = $now
}

$avg = { param($list, $f) if ($list.Count) { ($list | Measure-Object -Property $f -Average).Average } else { 0 } }
$max = { param($list, $f) if ($list.Count) { ($list | Measure-Object -Property $f -Maximum).Maximum } else { 0 } }
$result = foreach ($k in $apps.Keys) {
  $l = $series[$k]
  if ($l.Count -eq 0) { continue }
  [pscustomobject]@{
    App            = $k
    Procs          = (& $max $l 'Procs')
    'CPU avg %'    = [math]::Round((& $avg $l 'Cpu'), 1)
    'CPU peak %'   = [math]::Round((& $max $l 'Cpu'), 1)
    'RAM avg MB'   = [math]::Round((& $avg $l 'Ram'))
    'GPU 3D avg %' = [math]::Round((& $avg $l 'Gpu3d'), 1)
    'Encoder avg %' = [math]::Round((& $avg $l 'Enc'), 1)
    'Disk MB/s'    = [math]::Round((& $avg $l 'Write'), 2)
  }
}
$result | Format-Table -AutoSize
if ($Csv) { $result | Export-Csv -NoTypeInformation $Csv; Write-Host "Saved $Csv" }
