# Icons and splash screens from the logo (Windows, System.Drawing): powershell -File scripts/make-icons.ps1
# Source: web/public/logo.png (copied from C:\ReyMenta\ReyMentaLogo.png, 706x534, transparent background).
# Writes:
#   web/public/favicon-32.png, favicon-48.png, apple-touch-icon.png (180), icon-192.png, icon-512.png,
#   icon-maskable-512.png (logo inside the 80% safe circle)              -> the page and its PWA manifest
#   resources/icon-only.png (1024), icon-foreground.png (1024, logo in the 66% adaptive-icon safe zone,
#   transparent), icon-background.png (1024, black), splash.png and splash-dark.png (2732)
#                                                                        -> `npx @capacitor/assets generate --android`
# Re-run after changing the logo. Black background everywhere (the page is dark).
param([string]$Source = "$PSScriptRoot\..\web\public\logo.png")

Add-Type -AssemblyName System.Drawing
$root = Resolve-Path "$PSScriptRoot\.."
$logo = [System.Drawing.Image]::FromFile((Resolve-Path $Source))

function Save-Square([int]$Size, [double]$LogoFraction, [string]$Path, [bool]$Background = $true) {
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if ($Background) { $g.Clear([System.Drawing.Color]::Black) } else { $g.Clear([System.Drawing.Color]::Transparent) }
  if ($LogoFraction -gt 0) {
    # the logo fits in a LogoFraction x LogoFraction box, centered, aspect kept
    $box = $Size * $LogoFraction
    $scale = [Math]::Min($box / $logo.Width, $box / $logo.Height)
    $w = $logo.Width * $scale; $h = $logo.Height * $scale
    $g.DrawImage($logo, [single](($Size - $w) / 2), [single](($Size - $h) / 2), [single]$w, [single]$h)
  }
  $g.Dispose()
  $dir = Split-Path $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "wrote $Path"
}

$pub = "$root\web\public"
Save-Square 32 0.98 "$pub\favicon-32.png"
Save-Square 48 0.98 "$pub\favicon-48.png"
Save-Square 180 0.9 "$pub\apple-touch-icon.png"
Save-Square 192 0.9 "$pub\icon-192.png"
Save-Square 512 0.9 "$pub\icon-512.png"
Save-Square 512 0.62 "$pub\icon-maskable-512.png"   # within the maskable 80% safe circle

$res = "$root\resources"
Save-Square 1024 0.9 "$res\icon-only.png"
Save-Square 1024 0.62 "$res\icon-foreground.png" $false   # adaptive icon: 66% safe zone
Save-Square 1024 0 "$res\icon-background.png"
Save-Square 2732 0.4 "$res\splash.png"
Save-Square 2732 0.4 "$res\splash-dark.png"

$logo.Dispose()
