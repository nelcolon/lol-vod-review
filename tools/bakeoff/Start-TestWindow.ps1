<#
.SYNOPSIS
  Open a window that changes every frame, as a stand-in capture target when
  League is not running, and as the Q9 alignment target.

.DESCRIPTION
  A WinForms window titled "lvr-testsrc" repaints ~60 times per second (the
  WinForms timer floor is ~15.6 ms) with: a moving block, a frame counter, the
  wall clock with milliseconds, the raw QueryPerformanceCounter value
  ([Diagnostics.Stopwatch]::GetTimestamp(), which is QPC on Windows) and the
  elapsed seconds. Recording it lets you compare the QPC burned into a frame
  with the recorder's reported qpcStart + frame index / fps (open question 9).

  Prints one JSON line with the HWND and PID once the window is shown, so a
  caller can target it by hwnd.

.PARAMETER Seconds
  Close automatically after this many seconds (0 = stay open until closed).
#>
[CmdletBinding()]
param(
    [int]$Seconds = 0,
    [int]$Width = 1280,
    [int]$Height = 720,
    [string]$Title = "lvr-testsrc",
    [int]$IntervalMs = 15
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.ClientSize = New-Object System.Drawing.Size($Width, $Height)
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point(100, 100)
$form.BackColor = [System.Drawing.Color]::Black
# DoubleBuffered is protected; flip it via reflection to avoid flicker.
$prop = $form.GetType().GetProperty("DoubleBuffered", [System.Reflection.BindingFlags]"Instance,NonPublic")
$prop.SetValue($form, $true, $null)

$script:state = @{ frame = 0; sw = [System.Diagnostics.Stopwatch]::StartNew() }
$fontBig = New-Object System.Drawing.Font("Consolas", 30, [System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font("Consolas", 14)
$bg = [System.Drawing.Color]::FromArgb(18, 22, 30)

$form.Add_Paint({
    param($sender, $e)
    $g = $e.Graphics
    $g.Clear($bg)
    $script:state.frame++
    $f = $script:state.frame
    $w = $sender.ClientSize.Width
    $h = $sender.ClientSize.Height

    # Moving block: 7 px per repaint so motion is obvious at any capture rate.
    $x = ($f * 7) % [Math]::Max(1, ($w - 80))
    $g.FillRectangle([System.Drawing.Brushes]::Orange, $x, 30, 80, 80)
    # Colour strip that changes every frame (defeats frozen-frame detection).
    $c = [System.Drawing.Color]::FromArgb(($f * 13) % 256, ($f * 7) % 256, ($f * 3) % 256)
    $brush = New-Object System.Drawing.SolidBrush($c)
    $g.FillRectangle($brush, 0, $h - 24, $w, 24)
    $brush.Dispose()

    $qpc = [System.Diagnostics.Stopwatch]::GetTimestamp()
    $now = Get-Date
    $g.DrawString(("frame   {0}" -f $f), $fontBig, [System.Drawing.Brushes]::White, 20, 140)
    $g.DrawString(("wall    {0:HH:mm:ss.fff}" -f $now), $fontBig, [System.Drawing.Brushes]::White, 20, 200)
    $g.DrawString(("qpc     {0}" -f $qpc), $fontBig, [System.Drawing.Brushes]::White, 20, 260)
    $g.DrawString(("elapsed {0:F3} s" -f $script:state.sw.Elapsed.TotalSeconds), $fontBig, [System.Drawing.Brushes]::White, 20, 320)
    $g.DrawString("lvr-testsrc: moving capture target for tools/bakeoff (close this window to stop)", $fontSmall, [System.Drawing.Brushes]::Gray, 20, $h - 60)
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $IntervalMs
$timer.Add_Tick({ $form.Invalidate() })

$form.Add_Shown({
    $timer.Start()
    $info = @{ hwnd = [int64]$form.Handle; pid = $PID; title = $Title; qpcFreq = [System.Diagnostics.Stopwatch]::Frequency } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($info)
    [Console]::Out.Flush()
})

if ($Seconds -gt 0) {
    $closer = New-Object System.Windows.Forms.Timer
    $closer.Interval = $Seconds * 1000
    $closer.Add_Tick({ $form.Close() })
    $closer.Start()
}

[System.Windows.Forms.Application]::Run($form)
