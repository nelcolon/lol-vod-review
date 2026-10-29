<#
.SYNOPSIS
  Run event-dump in a loop so every game gets dumped unattended (Phase 0 step 1).
  Each pass waits for the next game, dumps it to fixtures/raw/<ts>/, and exits on GameEnd;
  the loop then starts the next pass. Stop with: Stop-Process -Id (Get-Content $env:TEMP\lvr-watch.pid)
#>
param([int]$MaxSecondsPerGame = 3600)
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$log = Join-Path $env:TEMP "lvr-watch.log"
$PID | Set-Content (Join-Path $env:TEMP "lvr-watch.pid")
Set-Location $repo
& npm run build -w packages/schema -w tools/event-dump *>> $log
while ($true) {
  "$(Get-Date -Format o) waiting for a game" | Add-Content $log
  & node tools/event-dump/dist/cli.js --quiet --max-seconds $MaxSecondsPerGame *>> $log
  "$(Get-Date -Format o) pass ended (exit $LASTEXITCODE)" | Add-Content $log
  Start-Sleep -Seconds 5
}
