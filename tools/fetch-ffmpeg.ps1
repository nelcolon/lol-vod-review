# Downloads BtbN's LGPL FFmpeg build (static, win64) to tools/bin/ffmpeg.exe for clip export.
# The installer bundles it, so it must be LGPL: a GPL build is refused.
param([string]$Version = '8.1')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$bin = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force $bin | Out-Null
$zip = "ffmpeg-n$Version-latest-win64-lgpl-$Version.zip"
$tmp = Join-Path ([IO.Path]::GetTempPath()) $zip
$dir = Join-Path ([IO.Path]::GetTempPath()) 'lvr-ffmpeg-lgpl'

Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$zip" -OutFile $tmp
Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
Expand-Archive $tmp $dir
$exe = Get-ChildItem $dir -Recurse -Filter ffmpeg.exe | Select-Object -First 1
$config = & $exe.FullName -hide_banner -buildconf | Out-String
if ($config -match '--enable-gpl') { throw "$zip is a GPL build; refusing to bundle it" }
Copy-Item $exe.FullName (Join-Path $bin 'ffmpeg.exe') -Force
Remove-Item -Recurse -Force $dir, $tmp
& (Join-Path $bin 'ffmpeg.exe') -hide_banner -version | Select-Object -First 1
