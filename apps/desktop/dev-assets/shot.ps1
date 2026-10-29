param([string]$Out = "shot-game.png", [int]$Wait = 10, [string]$OpenFirst = "1")
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@
$env:LVR_DEV_OPEN_FIRST=$OpenFirst
$p = Start-Process -FilePath "C:\Users\ncolo\dev\lol-vod-review\node_modules\electron\dist\electron.exe" -ArgumentList "." -WorkingDirectory "C:\Users\ncolo\dev\lol-vod-review\apps\desktop" -PassThru
Start-Sleep -Seconds $Wait
$h = [IntPtr]::Zero
foreach ($proc in Get-Process electron -ErrorAction SilentlyContinue) { if ($proc.MainWindowHandle -ne 0 -and $proc.MainWindowTitle -like "LoL VOD Review*") { $h = $proc.MainWindowHandle } }
if ($h -eq [IntPtr]::Zero) { Stop-Process -Name electron -Force -ErrorAction SilentlyContinue; throw "window not found" }
$r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R-$r.L),($r.B-$r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
[W]::PrintWindow($h, $hdc, 2) | Out-Null   # PW_RENDERFULLCONTENT
$g.ReleaseHdc($hdc)
$bmp.Save("C:\Users\ncolo\dev\lol-vod-review\apps\desktop\dev-assets\$Out")
Stop-Process -Name electron -Force -ErrorAction SilentlyContinue
"saved $Out $($bmp.Width)x$($bmp.Height)"
