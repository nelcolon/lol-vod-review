<#
.SYNOPSIS
  Measure the FPS cost of one capture backend while a game (or test window)
  runs: PresentMon frame times + nvidia-smi encoder/SM utilisation + the
  recording itself, written to tools/bakeoff/results/<timestamp>-<backend>/.

.DESCRIPTION
  Backends:
    none        baseline: PresentMon + nvidia-smi only, no capture
    recorder    packages/recorder (lvr-recorder.exe): WGC -> Media Foundation H.264
    gfxcapture  FFmpeg -f lavfi -i gfxcapture=... (WGC) -> h264_nvenc, fragmented MP4
    ddagrab     FFmpeg -filter_complex ddagrab=... (DXGI Desktop Duplication, whole
                monitor) -> h264_nvenc, fragmented MP4

  Flow: wait for the target process to own a window; start the backend; wait
  until it reports its first frames; run PresentMon (--process_name) and
  nvidia-smi dmon for -Seconds; stop everything; write summary.json.

  PresentMon opens an ETW session, which needs an elevated PowerShell (or
  membership in "Performance Log Users"). Without it the run still records
  video and nvidia-smi, and summary.json says why PresentMon data is missing.

.PARAMETER Backend
  none | recorder | gfxcapture | ddagrab

.PARAMETER Seconds
  Measurement window (default 120). Use 10-20 for plumbing checks.

.PARAMETER ProcessName
  Executable whose frames PresentMon measures and (unless -WindowTitle is
  given) whose window is captured. Default "League of Legends.exe".

.PARAMETER WindowTitle
  Capture a window by title substring instead of by process (e.g. "lvr-testsrc"
  from Start-TestWindow.ps1). PresentMon still measures -ProcessName.

.PARAMETER Label
  Free text appended to the results folder name (e.g. "borderless", "fullscreen").

.EXAMPLE
  # plumbing check without League, from an elevated shell:
  Start-Process powershell -ArgumentList '-File .\Start-TestWindow.ps1 -Seconds 300'
  .\Run-Bakeoff.ps1 -Backend recorder -Seconds 10 -ProcessName powershell.exe -WindowTitle lvr-testsrc
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet("none", "recorder", "gfxcapture", "ddagrab")][string]$Backend,
    [int]$Seconds = 120,
    [string]$ProcessName = "League of Legends.exe",
    [string]$WindowTitle = "",
    [string]$Label = "",
    [int]$Fps = 60,
    # recorder only: "light" = current defaults, "legacy" = v0.3.7 (full-frame health check every 1 s, normal priority)
    [ValidateSet("light", "legacy")][string]$Perf = "light",
    [double]$BitrateMbps = 12,
    [int]$Cq = 23,
    [switch]$NoAudio,
    [switch]$Cursor,
    [switch]$NoPresentMon,
    [switch]$NoNvidiaSmi,
    [int]$WaitForWindowSec = 900,
    [int]$StartupTimeoutSec = 30
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2

# ---------------------------------------------------------------- paths
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$binDir = Join-Path $repoRoot "tools\bin"
$ffmpeg = Join-Path $binDir "ffmpeg.exe"
$ffprobe = Join-Path $binDir "ffprobe.exe"
$presentMon = Join-Path $binDir "PresentMon.exe"
$recorder = Join-Path $repoRoot "packages\recorder\target\release\lvr-recorder.exe"
$nvsmi = (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runName = "$stamp-$Backend"
if ($Label) { $runName += "-" + ($Label -replace '[^A-Za-z0-9_.-]', '_') }
$outDir = Join-Path $PSScriptRoot "results\$runName"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$videoPath = Join-Path $outDir "video.mp4"
$pmCsv = Join-Path $outDir "presentmon.csv"
$pmLog = Join-Path $outDir "presentmon.log"
$nvLog = Join-Path $outDir "nvidia-smi.log"
$notes = New-Object System.Collections.ArrayList

function Note($msg) { Write-Host ("[bakeoff] " + $msg); [void]$notes.Add($msg) }

$procBase = [IO.Path]::GetFileNameWithoutExtension($ProcessName)
$isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# ---------------------------------------------------------------- preflight
if ($Backend -ne "none" -and $Backend -ne "recorder" -and -not (Test-Path $ffmpeg)) { throw "ffmpeg not found at $ffmpeg" }
if ($Backend -eq "recorder" -and -not (Test-Path $recorder)) { throw "lvr-recorder.exe not built: cargo build --release in packages\recorder" }
$usePresentMon = -not $NoPresentMon
if ($usePresentMon -and -not (Test-Path $presentMon)) { Note "PresentMon.exe missing (run Install-PresentMon.ps1); skipping PresentMon"; $usePresentMon = $false }
if ($usePresentMon -and -not $isElevated) { Note "WARNING: shell is not elevated; PresentMon's ETW session will most likely fail. Re-run from an elevated PowerShell." }
$useNvSmi = -not $NoNvidiaSmi
if ($useNvSmi -and -not $nvsmi) { Note "nvidia-smi not found; skipping GPU utilisation"; $useNvSmi = $false }

# ---------------------------------------------------------------- wait for the target window
function Get-TargetWindow {
    if ($WindowTitle) {
        $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$WindowTitle*" } | Select-Object -First 1
    } else {
        $p = Get-Process -Name $procBase -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    }
    return $p
}

$what = if ($WindowTitle) { "window '*$WindowTitle*'" } else { "a window owned by $ProcessName" }
Write-Host "[bakeoff] waiting up to $WaitForWindowSec s for $what ..."
$deadline = (Get-Date).AddSeconds($WaitForWindowSec)
$target = $null
while ((Get-Date) -lt $deadline) {
    $target = Get-TargetWindow
    if ($target) { break }
    Start-Sleep -Milliseconds 500
}
if (-not $target) { throw "timed out waiting for $what" }
$targetHwnd = [int64]$target.MainWindowHandle
Note ("target: pid {0} '{1}' hwnd {2} title '{3}'" -f $target.Id, $target.ProcessName, $targetHwnd, $target.MainWindowTitle)
# League's game process shows its window a few seconds before it renders; give it a moment.
if (-not $WindowTitle -and $procBase -eq "League of Legends") { Start-Sleep -Seconds 3 }

# ---------------------------------------------------------------- helpers
function Start-Redirected([string]$exe, [string]$args, [string]$stdoutFile, [string]$stderrFile, [bool]$stdin) {
    # cmd.exe does the file redirection so we can still drive stdin from here.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = "/d /c `"`"$exe`" $args > `"$stdoutFile`" 2> `"$stderrFile`"`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $stdin
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $outDir
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    return $p
}

function Stop-Tree([System.Diagnostics.Process]$p) {
    if ($p -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null }
}

function Read-LastProgressBlock([string]$file) {
    if (-not (Test-Path $file)) { return $null }
    $lines = Get-Content $file -ErrorAction SilentlyContinue
    if (-not $lines) { return $null }
    $block = @{}
    foreach ($l in $lines) {
        if ($l -match '^([a-z_]+)=(.*)$') { $block[$matches[1]] = $matches[2].Trim() }
    }
    return $block
}

$ffmpegCommon = @(
    "-y", "-hide_banner", "-loglevel", "info", "-nostdin:0",
    "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "$Cq", "-b:v", "0",
    "-maxrate", ("{0}M" -f [int]($BitrateMbps * 2)), "-bufsize", ("{0}M" -f [int]($BitrateMbps * 2)),
    "-g", "$Fps", "-bf", "0", "-forced-idr", "1",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-t", "$($Seconds + $StartupTimeoutSec)",
    "-progress", "progress.txt", "-stats_period", "1"
) -join " "
# NOTE: -nostdin is intentionally not used; we send 'q' on stdin for a clean stop.
$ffmpegCommon = $ffmpegCommon -replace '-nostdin:0 ', ''

$backendProc = $null
$backendStartedAt = $null
$recorderEvents = Join-Path $outDir "recorder-events.jsonl"
$recorderErr = Join-Path $outDir "recorder-stderr.log"
$ffLog = Join-Path $outDir "ffmpeg.log"
$ffOut = Join-Path $outDir "ffmpeg-stdout.log"
$progressFile = Join-Path $outDir "progress.txt"

# ---------------------------------------------------------------- start backend
switch ($Backend) {
    "none" { Note "baseline run, no capture" }
    "recorder" {
        $backendProc = Start-Redirected $recorder "" $recorderEvents $recorderErr $true
        $targetJson = if ($WindowTitle) { @{ windowTitle = $WindowTitle } } else { @{ processName = $ProcessName } }
        $start = @{
            cmd = "start"; target = $targetJson; out = $videoPath; fps = $Fps; bitrateMbps = $BitrateMbps
            width = $null; height = $null; audio = @{ game = (-not $NoAudio); mic = $false }
            cursor = [bool]$Cursor; border = $false
            perf = if ($Perf -eq "legacy") { @{ healthEveryS = 1; healthCrop = $false; lowPriority = $false } } else { @{} }
        } | ConvertTo-Json -Compress -Depth 4
        $backendProc.StandardInput.WriteLine($start)
        $backendProc.StandardInput.Flush()
        Note "recorder start: $start"
        $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
        $started = $null
        while ((Get-Date) -lt $deadline -and -not $started) {
            Start-Sleep -Milliseconds 250
            if ($backendProc.HasExited) { throw "recorder exited early; see $recorderErr and $recorderEvents" }
            if (Test-Path $recorderEvents) {
                foreach ($l in (Get-Content $recorderEvents -ErrorAction SilentlyContinue)) {
                    if ($l -match '"ev":"started"') { $started = $l; break }
                    if ($l -match '"ev":"error"') { throw "recorder error: $l" }
                }
            }
        }
        if (-not $started) { Stop-Tree $backendProc; throw "recorder did not report 'started' within $StartupTimeoutSec s (window minimized or static?). Events: $recorderEvents" }
        Note "recorder started: $started"
        $backendStartedAt = Get-Date
    }
    "gfxcapture" {
        $cursorFlag = if ($Cursor) { 1 } else { 0 }
        if ($WindowTitle) {
            $sel = "window_title=" + [Regex]::Escape($WindowTitle)
        } else {
            $sel = "window_exe=" + ([Regex]::Escape($ProcessName) -replace '\\', '\\\\')
        }
        # window_exe/window_title are ECMAScript regexes; colons are option separators in lavfi so none may appear in them.
        $src = "gfxcapture=${sel}:max_framerate=${Fps}:capture_cursor=${cursorFlag}:display_border=0:resize_mode=scale"
        $args = "-f lavfi -i `"$src`" $ffmpegCommon `"$videoPath`""
        Note "ffmpeg $args"
        $backendProc = Start-Redirected $ffmpeg $args $ffOut $ffLog $true
    }
    "ddagrab" {
        $cursorFlag = if ($Cursor) { 1 } else { 0 }
        $src = "ddagrab=output_idx=0:framerate=${Fps}:draw_mouse=${cursorFlag}"
        $args = "-filter_complex `"$src`" $ffmpegCommon `"$videoPath`""
        Note "ffmpeg $args"
        $backendProc = Start-Redirected $ffmpeg $args $ffOut $ffLog $true
    }
}
if ($Backend -eq "gfxcapture" -or $Backend -eq "ddagrab") {
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
    $ok = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if ($backendProc.HasExited) { throw "ffmpeg exited early; see $ffLog" }
        $blk = Read-LastProgressBlock $progressFile
        if ($blk -and $blk.ContainsKey("frame") -and [int]$blk["frame"] -gt 0) { $ok = $true; break }
    }
    if (-not $ok) { Stop-Tree $backendProc; throw "ffmpeg produced no frames within $StartupTimeoutSec s; see $ffLog" }
    Note ("ffmpeg producing frames (frame={0})" -f (Read-LastProgressBlock $progressFile)["frame"])
    $backendStartedAt = Get-Date
}

# ---------------------------------------------------------------- measure
$pmProc = $null
$nvProc = $null
$pmError = $null
if ($usePresentMon) {
    $pmArgs = "--process_name `"$ProcessName`" --output_file `"$pmCsv`" --timed $Seconds --terminate_after_timed --stop_existing_session --no_console_stats --qpc_time --track_gpu_video"
    Note "PresentMon $pmArgs"
    $pmProc = Start-Redirected $presentMon $pmArgs (Join-Path $outDir "presentmon-stdout.log") $pmLog $false
}
if ($useNvSmi) {
    $nvProc = Start-Redirected $nvsmi "dmon -s u -d 1 -c $($Seconds + 1) -f `"$nvLog`"" (Join-Path $outDir "nvidia-smi-stdout.log") (Join-Path $outDir "nvidia-smi-stderr.log") $false
}
$measureStart = Get-Date
Write-Host "[bakeoff] measuring for $Seconds s ..."
for ($i = 1; $i -le $Seconds; $i++) {
    Start-Sleep -Seconds 1
    if ($i % 10 -eq 0 -or $i -eq $Seconds) { Write-Host ("[bakeoff]   {0}/{1} s" -f $i, $Seconds) }
    if ($pmProc -and $pmProc.HasExited -and $i -lt ($Seconds - 1) -and -not $pmError) {
        $pmError = "PresentMon exited early (exit {0}); see {1}" -f $pmProc.ExitCode, $pmLog
        Note $pmError
    }
    if ($backendProc -and $backendProc.HasExited) { Note "WARNING: backend exited during measurement"; break }
}
$measureEnd = Get-Date

# ---------------------------------------------------------------- stop everything
if ($pmProc) {
    if (-not $pmProc.WaitForExit(15000)) { Stop-Tree $pmProc; Note "PresentMon killed after timeout" }
    if ($pmProc.ExitCode -ne 0 -and -not $pmError) { $pmError = "PresentMon exit code $($pmProc.ExitCode); see $pmLog" ; Note $pmError }
}
if ($nvProc) { if (-not $nvProc.WaitForExit(5000)) { Stop-Tree $nvProc } }

$stopReason = $null
switch ($Backend) {
    "recorder" {
        if (-not $backendProc.HasExited) {
            $backendProc.StandardInput.WriteLine('{"cmd":"stop"}')
            $backendProc.StandardInput.Flush()
            $backendProc.StandardInput.Close()
            if (-not $backendProc.WaitForExit(60000)) { Stop-Tree $backendProc; Note "recorder killed after 60 s (file may be unplayable)" }
        }
    }
    { $_ -eq "gfxcapture" -or $_ -eq "ddagrab" } {
        if (-not $backendProc.HasExited) {
            try { $backendProc.StandardInput.Write("q"); $backendProc.StandardInput.Flush() } catch {}
            if (-not $backendProc.WaitForExit(30000)) { Stop-Tree $backendProc; Note "ffmpeg killed after 30 s" }
        }
    }
}

# ---------------------------------------------------------------- summarise
function Get-Percentile([double[]]$sorted, [double]$p) {
    if (-not $sorted -or $sorted.Count -eq 0) { return $null }
    $idx = [Math]::Min($sorted.Count - 1, [Math]::Max(0, [int][Math]::Floor($p * ($sorted.Count - 1))))
    return $sorted[$idx]
}

function Get-PresentMonStats([string]$csv, [string]$app) {
    if (-not (Test-Path $csv)) { return $null }
    $rows = Import-Csv $csv
    if (-not $rows -or $rows.Count -eq 0) { return $null }
    $cols = $rows[0].PSObject.Properties.Name
    $ftCol = @("FrameTime", "MsBetweenPresents", "msBetweenPresents") | Where-Object { $cols -contains $_ } | Select-Object -First 1
    if (-not $ftCol) { return @{ error = "no frame-time column in $($cols -join ',')" } }
    $appRows = $rows | Where-Object { $_.Application -like "$app*" }
    if (-not $appRows -or $appRows.Count -eq 0) { $appRows = $rows }
    # Skip the first second as warm-up.
    $ft = @($appRows | Select-Object -Skip 60 | ForEach-Object { [double]$_.$ftCol } | Where-Object { $_ -gt 0 })
    if ($ft.Count -lt 10) { $ft = @($appRows | ForEach-Object { [double]$_.$ftCol } | Where-Object { $_ -gt 0 }) }
    if ($ft.Count -eq 0) { return @{ error = "no frames for $app in $csv"; rows = $rows.Count } }
    $sorted = [double[]]($ft | Sort-Object)
    $mean = ($ft | Measure-Object -Average).Average
    $p99 = Get-Percentile $sorted 0.99
    $p999 = Get-Percentile $sorted 0.999
    $gpuBusyCol = @("GPUBusy", "msGPUActive", "GPUTime") | Where-Object { $cols -contains $_ } | Select-Object -First 1
    $gpuBusy = $null
    if ($gpuBusyCol) { $gpuBusy = ($appRows | ForEach-Object { [double]$_.$gpuBusyCol } | Measure-Object -Average).Average }
    $modes = $appRows | Group-Object PresentMode | Sort-Object Count -Descending | ForEach-Object { "$($_.Name) x$($_.Count)" }
    return @{
        frames = $ft.Count; frameTimeColumn = $ftCol
        avgFrameTimeMs = [Math]::Round($mean, 3); avgFps = [Math]::Round(1000.0 / $mean, 1)
        p99FrameTimeMs = [Math]::Round($p99, 3); onePercentLowFps = [Math]::Round(1000.0 / $p99, 1)
        p999FrameTimeMs = [Math]::Round($p999, 3); pointOnePercentLowFps = [Math]::Round(1000.0 / $p999, 1)
        avgGpuBusyMs = if ($gpuBusy -ne $null) { [Math]::Round($gpuBusy, 3) } else { $null }
        presentModes = @($modes)
    }
}

function Get-NvidiaSmiStats([string]$log) {
    if (-not (Test-Path $log)) { return $null }
    $lines = Get-Content $log | Where-Object { $_.Trim() }
    $header = $lines | Where-Object { $_ -match '^#\s*gpu' } | Select-Object -First 1
    if (-not $header) { return @{ error = "no header in $log" } }
    $names = ($header -replace '^#', '').Trim() -split '\s+'
    $data = $lines | Where-Object { $_ -notmatch '^#' } | ForEach-Object { ($_.Trim() -split '\s+') }
    $data = @($data | Where-Object { $_.Count -eq $names.Count -and $_[0] -eq '0' })
    if ($data.Count -eq 0) { return @{ error = "no samples in $log" } }
    $res = @{ samples = $data.Count }
    for ($c = 1; $c -lt $names.Count; $c++) {
        $vals = $data | ForEach-Object { $v = $_[$c]; if ($v -match '^\d+$') { [double]$v } } | Where-Object { $_ -ne $null }
        if ($vals) {
            $res["avg_" + $names[$c]] = [Math]::Round(($vals | Measure-Object -Average).Average, 1)
            $res["max_" + $names[$c]] = ($vals | Measure-Object -Maximum).Maximum
        }
    }
    return $res
}

function Get-FfprobeInfo([string]$video) {
    if (-not (Test-Path $video)) { return $null }
    $json = & $ffprobe -v error -show_streams -show_format -of json "$video" 2>$null | Out-String
    if (-not $json) { return @{ error = "ffprobe failed" } }
    $info = $json | ConvertFrom-Json
    $v = $info.streams | Where-Object { $_.codec_type -eq "video" } | Select-Object -First 1
    $a = $info.streams | Where-Object { $_.codec_type -eq "audio" } | Select-Object -First 1
    $keyCount = 0
    $keys = & $ffprobe -v error -select_streams v:0 -skip_frame nokey -show_entries frame=pts_time -of csv=p=0 "$video" 2>$null
    if ($keys) { $keyCount = @($keys | Where-Object { $_ -ne "" }).Count }
    $dur = [double]$info.format.duration
    $frames = $null
    if ($v -and $v.PSObject.Properties.Name -contains "nb_frames" -and $v.nb_frames -match '^\d+$') { $frames = [int]$v.nb_frames }
    if ($frames -eq $null) {
        $cnt = & $ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$video" 2>$null
        if ($cnt -match '^\d+$') { $frames = [int]$cnt }
    }
    return @{
        codec = $v.codec_name; profile = $v.profile; width = $v.width; height = $v.height; pixFmt = $v.pix_fmt
        rFrameRate = $v.r_frame_rate; avgFrameRate = $v.avg_frame_rate
        durationSec = [Math]::Round($dur, 3); videoFrames = $frames
        measuredFps = if ($frames -and $dur -gt 0) { [Math]::Round($frames / $dur, 2) } else { $null }
        keyframes = $keyCount; avgGopSec = if ($keyCount -gt 0 -and $dur -gt 0) { [Math]::Round($dur / $keyCount, 2) } else { $null }
        audioCodec = if ($a) { $a.codec_name } else { $null }
        audioSampleRate = if ($a) { $a.sample_rate } else { $null }
        audioChannels = if ($a) { $a.channels } else { $null }
        sizeBytes = [int64]$info.format.size; bitrateKbps = [Math]::Round([double]$info.format.bit_rate / 1000, 0)
        formatName = $info.format.format_name
    }
}

$summary = [ordered]@{
    run = $runName; backend = $Backend; label = $Label; processName = $ProcessName; windowTitle = $WindowTitle
    targetHwnd = $targetHwnd; targetPid = $target.Id
    seconds = $Seconds; fps = $Fps; bitrateMbps = $BitrateMbps; cq = $Cq; audio = (-not $NoAudio); cursor = [bool]$Cursor
    elevated = $isElevated
    measureStart = $measureStart.ToString("o"); measureEnd = $measureEnd.ToString("o")
    machine = @{
        windows = (Get-CimInstance Win32_OperatingSystem).Version
        gpu = $(if ($nvsmi) { (& $nvsmi --query-gpu=name,driver_version --format=csv,noheader) } else { $null })
    }
    presentMon = $null; presentMonError = $pmError
    nvidiaSmi = $null; video = $null; backendStats = $null; warnings = @(); notes = @()
}

if ($usePresentMon) {
    $summary.presentMon = Get-PresentMonStats $pmCsv $procBase
    if (-not $summary.presentMon -and -not $pmError) { $summary.presentMonError = "no CSV produced; see $pmLog" }
}
if ($useNvSmi) { $summary.nvidiaSmi = Get-NvidiaSmiStats $nvLog }
if ($Backend -ne "none") { $summary.video = Get-FfprobeInfo $videoPath }

switch ($Backend) {
    "recorder" {
        $evs = @()
        if (Test-Path $recorderEvents) { $evs = Get-Content $recorderEvents | Where-Object { $_.Trim() } | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ } }
        $started = $evs | Where-Object { $_.ev -eq "started" } | Select-Object -First 1
        $stopped = $evs | Where-Object { $_.ev -eq "stopped" } | Select-Object -Last 1
        $lastStats = $evs | Where-Object { $_.ev -eq "stats" } | Select-Object -Last 1
        $warn = @($evs | Where-Object { $_.ev -eq "warning" } | ForEach-Object { $_.code })
        $errs = @($evs | Where-Object { $_.ev -eq "error" } | ForEach-Object { "$($_.code): $($_.message)" })
        $summary.backendStats = @{
            encoder = if ($started) { $started.encoder } else { $null }
            encoderHw = if ($started) { $started.encoderHw } else { $null }
            qpcStart = if ($started) { $started.qpcStart } else { $null }
            qpcFreq = if ($started) { $started.qpcFreq } else { $null }
            wallStart = if ($started) { $started.wallStart } else { $null }
            firstFrameLatencyMs = if ($started) { $started.firstFrameLatencyMs } else { $null }
            width = if ($started) { $started.width } else { $null }
            height = if ($started) { $started.height } else { $null }
            audioMode = if ($started) { $started.audioMode } else { $null }
            frames = if ($stopped) { $stopped.frames } else { $null }
            dropped = if ($stopped) { $stopped.dropped } else { $null }
            durationMs = if ($stopped) { $stopped.durationMs } else { $null }
            stopReason = if ($stopped) { $stopped.reason } else { $null }
            lastFpsActual = if ($lastStats) { $lastStats.fpsActual } else { $null }
            errors = $errs
        }
        $summary.warnings = $warn
    }
    { $_ -eq "gfxcapture" -or $_ -eq "ddagrab" } {
        $blk = Read-LastProgressBlock $progressFile
        $summary.backendStats = @{
            encoder = "h264_nvenc"
            frames = if ($blk -and $blk.ContainsKey("frame")) { [int]$blk["frame"] } else { $null }
            fps = if ($blk -and $blk.ContainsKey("fps")) { [double]$blk["fps"] } else { $null }
            dropped = if ($blk -and $blk.ContainsKey("drop_frames")) { [int]$blk["drop_frames"] } else { $null }
            duplicated = if ($blk -and $blk.ContainsKey("dup_frames")) { [int]$blk["dup_frames"] } else { $null }
            outTimeUs = if ($blk -and $blk.ContainsKey("out_time_us")) { [int64]$blk["out_time_us"] } else { $null }
            progressEnd = if ($blk -and $blk.ContainsKey("progress")) { $blk["progress"] } else { $null }
        }
        if (Test-Path $ffLog) {
            $summary.warnings = @(Get-Content $ffLog | Where-Object { $_ -match 'error|warning|dropped|ACCESS_LOST|Unsupported' } | Select-Object -First 20)
        }
    }
}
$summary.notes = @($notes)

$summaryPath = Join-Path $outDir "summary.json"
$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryPath -Encoding UTF8
Write-Host ""
Write-Host "[bakeoff] results in $outDir"
if ($summary.presentMon -and -not $summary.presentMon.ContainsKey("error")) {
    Write-Host ("[bakeoff] game FPS: avg {0}  1% low {1}  0.1% low {2}  ({3} frames)" -f $summary.presentMon.avgFps, $summary.presentMon.onePercentLowFps, $summary.presentMon.pointOnePercentLowFps, $summary.presentMon.frames)
} else {
    Write-Host ("[bakeoff] PresentMon: {0}" -f ($(if ($summary.presentMonError) { $summary.presentMonError } elseif ($summary.presentMon) { $summary.presentMon.error } else { "disabled" })))
}
if ($summary.nvidiaSmi -and -not $summary.nvidiaSmi.ContainsKey("error")) {
    Write-Host ("[bakeoff] GPU: sm avg {0}%  enc avg {1}%  (max enc {2}%)" -f $summary.nvidiaSmi["avg_sm"], $summary.nvidiaSmi["avg_enc"], $summary.nvidiaSmi["max_enc"])
}
if ($summary.video -and -not $summary.video.ContainsKey("error")) {
    $v = $summary.video
    Write-Host ("[bakeoff] video: {0} {1}x{2} {3} frames in {4} s = {5} fps, GOP ~{6} s, {7} MB, audio {8}" -f $v.codec, $v.width, $v.height, $v.videoFrames, $v.durationSec, $v.measuredFps, $v.avgGopSec, [Math]::Round($v.sizeBytes / 1MB, 1), $v.audioCodec)
}
if ($summary.warnings.Count -gt 0) { Write-Host ("[bakeoff] warnings: {0}" -f ($summary.warnings -join ", ")) }
Write-Host "[bakeoff] summary: $summaryPath"
