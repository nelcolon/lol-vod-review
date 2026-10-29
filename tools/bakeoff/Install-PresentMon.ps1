<#
.SYNOPSIS
  Download the latest PresentMon console build (x64) into tools/bin (git-ignored).

.DESCRIPTION
  Queries the GitHub releases API for GameTechDev/PresentMon, picks the
  "PresentMon-<ver>-x64.exe" asset and saves it as tools/bin/PresentMon.exe
  (plus the versioned file name next to it). PresentMon needs an elevated
  shell (or membership in "Performance Log Users") to open its ETW session.

.PARAMETER Force
  Re-download even if tools/bin/PresentMon.exe exists.

.PARAMETER Tag
  Pin a release tag (e.g. v2.6.0) instead of "latest".
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [string]$Tag = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$binDir = Join-Path $repoRoot "tools\bin"
$dest = Join-Path $binDir "PresentMon.exe"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }

if ((Test-Path $dest) -and -not $Force) {
    $ver = & $dest --help 2>&1 | Select-Object -First 1
    Write-Host "PresentMon already present: $dest ($ver). Use -Force to re-download."
    exit 0
}

$api = "https://api.github.com/repos/GameTechDev/PresentMon/releases/latest"
if ($Tag) { $api = "https://api.github.com/repos/GameTechDev/PresentMon/releases/tags/$Tag" }
Write-Host "Querying $api"
$release = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "lol-vod-review-bakeoff" }
$asset = $release.assets | Where-Object { $_.name -match '^PresentMon-.*-x64\.exe$' } | Select-Object -First 1
if (-not $asset) { throw "No PresentMon-*-x64.exe asset in release $($release.tag_name)" }

$versioned = Join-Path $binDir $asset.name
Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size/1KB)) KB) from $($release.tag_name)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $versioned -Headers @{ "User-Agent" = "lol-vod-review-bakeoff" }
Copy-Item $versioned $dest -Force
$ver = & $dest --help 2>&1 | Select-Object -First 1
Write-Host "Installed $dest ($ver)"
Write-Host "Note: PresentMon needs an elevated PowerShell (ETW). Run-Bakeoff.ps1 checks for that."
