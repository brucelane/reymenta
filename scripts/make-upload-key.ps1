# Creates the Google Play upload key once: %USERPROFILE%\.android-keys\reymenta-upload.jks (next to Lumipod's, outside the repo) + android/keystore.properties
# (both git-ignored, and android/ isn't synced by Syncthing). Run: powershell -File scripts/make-upload-key.ps1
# Back both files up somewhere safe (a password manager / an offline copy): with Play App Signing, Google keeps
# the app signing key, and a lost upload key can be reset through Play Console support, but it takes days.
# Uses the keytool of Android Studio's bundled Java (jbr). Refuses to overwrite an existing key.

$root = Resolve-Path "$PSScriptRoot\.."
$dir = "$env:USERPROFILE\.android-keys"
$jks = "$dir\reymenta-upload.jks"
$props = "$root\android\keystore.properties"
if ((Test-Path $jks) -or (Test-Path $props)) { Write-Error "an upload key already exists ($jks / $props): not overwritten"; exit 1 }

$keytool = @("$env:JAVA_HOME\bin\keytool.exe", "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe") |
  Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $keytool) { Write-Error "keytool not found: install Android Studio (or set JAVA_HOME)"; exit 1 }

# a random 32-character password (letters and digits: no quoting trouble in .properties)
$chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pass = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

New-Item -ItemType Directory -Force $dir | Out-Null
& $keytool -genkeypair -v -keystore $jks -storetype PKCS12 -alias upload -keyalg RSA -keysize 4096 -validity 10000 `
  -storepass $pass -keypass $pass -dname "CN=Bruce Lane, O=Videodromm, C=FR" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "keytool failed"; exit 1 }

@"
storeFile=$($jks -replace '\\','/')
storePassword=$pass
keyAlias=upload
keyPassword=$pass
"@ | Set-Content -Encoding ascii $props
"upload key created: $jks (password in $props). Back up both files now."
