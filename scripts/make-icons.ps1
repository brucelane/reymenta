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

# Google Play: store/google-play/icon-512.png (Play applies its own mask) and the feature graphic 1024x500
# (no alpha: drawn on black, saved as 24-bit). Screenshots: node scripts/store-shots.mjs.
$store = "$root\store\google-play"
Save-Square 512 0.9 "$store\icon-512.png"
$fg = New-Object System.Drawing.Bitmap 1024, 500, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($fg)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.Clear([System.Drawing.Color]::Black)
$lh = 360; $lw = $logo.Width * $lh / $logo.Height
$g.DrawImage($logo, [single]40, [single]((500 - $lh) / 2), [single]$lw, [single]$lh)
$font = New-Object System.Drawing.Font 'Segoe UI', 30, ([System.Drawing.FontStyle]::Bold)
$small = New-Object System.Drawing.Font 'Segoe UI', 21
$white = [System.Drawing.Brushes]::White; $grey = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(170, 170, 185))
$x = [single](40 + $lw + 30)
$g.DrawString('Jouez avec le show', $font, $white, $x, [single]170)
$g.DrawString('Play along with the show', $small, $grey, $x, [single]220)
$dot = [string][char]0xB7; $g.DrawString("inclinez $dot secouez $dot touchez", $small, $grey, $x, [single]275)
$g.Dispose()
$fg.Save("$store\feature-graphic-1024x500.png", [System.Drawing.Imaging.ImageFormat]::Png); $fg.Dispose()
"wrote $store\feature-graphic-1024x500.png"

# Android (once `npx cap add android` made android/): every launcher icon and splash png of the template is
# redrawn at its own size, so no extra tool is needed (@capacitor/assets does the same from resources/).
function Save-Fit([int]$W, [int]$H, [double]$LogoFraction, [string]$Path, [bool]$Background) {
  $bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if ($Background) { $g.Clear([System.Drawing.Color]::Black) } else { $g.Clear([System.Drawing.Color]::Transparent) }
  $box = [Math]::Min($W, $H) * $LogoFraction
  $scale = [Math]::Min($box / $logo.Width, $box / $logo.Height)
  $lw = $logo.Width * $scale; $lh = $logo.Height * $scale
  $g.DrawImage($logo, [single](($W - $lw) / 2), [single](($H - $lh) / 2), [single]$lw, [single]$lh)
  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$androidRes = "$root\android\app\src\main\res"
if (Test-Path $androidRes) {
  foreach ($file in Get-ChildItem $androidRes -Recurse -Filter *.png) {
    $img = [System.Drawing.Image]::FromFile($file.FullName); $w = $img.Width; $h = $img.Height; $img.Dispose()
    if ($file.Name -eq 'ic_launcher_foreground.png') { Save-Fit $w $h 0.62 $file.FullName $false }   # adaptive icon, 66% safe zone
    elseif ($file.Name -like 'ic_launcher*.png') { Save-Fit $w $h 0.9 $file.FullName $true }
    elseif ($file.Name -eq 'splash.png') { Save-Fit $w $h 0.4 $file.FullName $true }
  }
  $bgXml = "$androidRes\values\ic_launcher_background.xml"
  if (Test-Path $bgXml) {
    (Get-Content $bgXml -Raw) -replace '#[0-9A-Fa-f]{6,8}', '#000000' | Set-Content -NoNewline -Encoding utf8 $bgXml
  }
  "android icons and splash redrawn in $androidRes"
}

$logo.Dispose()
