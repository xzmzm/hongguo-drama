# SPDX-License-Identifier: GPL-3.0-only
[CmdletBinding()]
param(
    [string]$SdkRoot,
    [string]$JavaHome,
    [string]$BuildToolsVersion = '36.0.0',
    [int]$ApiLevel = 36,
    [string]$InputsDirectory,
    [string]$OutputDirectory,
    [string]$Keystore,
    [string]$KeyAlias = 'oracle',
    [switch]$SourcesOnly
)
$ErrorActionPreference = 'Stop'

function Invoke-Tool([string]$Tool, [string[]]$ToolArguments) {
    & $Tool @ToolArguments
    if ($LASTEXITCODE -ne 0) { throw "Build tool failed: $([IO.Path]::GetFileName($Tool))" }
}

function Require-File([string]$Target, [string]$Description) {
    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { throw "Missing $Description." }
    return (Resolve-Path -LiteralPath $Target).Path
}

if (-not $SdkRoot) { $SdkRoot = $env:ANDROID_SDK_ROOT }
if (-not $SdkRoot) { $SdkRoot = $env:ANDROID_HOME }
if (-not $SdkRoot) { throw 'Set ANDROID_SDK_ROOT or pass -SdkRoot.' }
if (-not $JavaHome) { $JavaHome = $env:JAVA_HOME }
if (-not $JavaHome) {
    $compiler = Get-Command javac -CommandType Application -ErrorAction Stop
    $JavaHome = Split-Path -Parent (Split-Path -Parent $compiler.Source)
}
$windowsHost = $env:OS -eq 'Windows_NT'
$binarySuffix = if ($windowsHost) { '.exe' } else { '' }
$scriptSuffix = if ($windowsHost) { '.bat' } else { '' }
$buildTools = Join-Path (Join-Path $SdkRoot 'build-tools') $BuildToolsVersion
$androidJar = Require-File (Join-Path $SdkRoot "platforms/android-$ApiLevel/android.jar") 'Android SDK platform'
$javac = Require-File (Join-Path $JavaHome "bin/javac$binarySuffix") 'JDK compiler'
$aapt = Require-File (Join-Path $buildTools "aapt2$binarySuffix") 'aapt2'
$d8 = Require-File (Join-Path $buildTools "d8$scriptSuffix") 'd8'
$zipalign = Require-File (Join-Path $buildTools "zipalign$binarySuffix") 'zipalign'

if (-not $InputsDirectory) { $InputsDirectory = Join-Path $PSScriptRoot '.local/inputs' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '.local/builds' }
$config = $null
if (-not $SourcesOnly) {
    $configFile = Require-File (Join-Path $InputsDirectory 'oracle-config.json') 'local SDK configuration'
    $nativeLibrary = Require-File (Join-Path $InputsDirectory 'libmetasec_ml.so') 'local arm64 SDK library'
    try { $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw 'Invalid local SDK configuration JSON.' }
    $allowed = @('target_package', 'app_id', 'license', 'setting_config', 'channel')
    if ($config -isnot [pscustomobject]) { throw 'SDK configuration must be an object.' }
    foreach ($property in $config.PSObject.Properties) {
        if ($property.Name -cnotin $allowed) { throw 'Unsupported SDK configuration field; device identities are not configuration.' }
    }
    foreach ($name in $allowed) {
        if ($config.$name -isnot [string] -or -not $config.$name.Trim() -or $config.$name.Length -gt 16384) {
            throw 'Complete the local SDK configuration; the shared example contains no SDK values.'
        }
    }
    if ($config.target_package -notmatch '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$' -or $config.app_id -notmatch '^\d{1,10}$') {
        throw 'Invalid local SDK package or application ID.'
    }
    $configJson = $config | ConvertTo-Json -Depth 3
    if ([Text.Encoding]::UTF8.GetByteCount($configJson) -gt 65536) { throw 'Local SDK configuration exceeds 64 KiB.' }
    $elf = [IO.File]::ReadAllBytes($nativeLibrary)
    if ($elf.Length -lt 20 -or $elf[0] -ne 127 -or $elf[1] -ne 69 -or $elf[2] -ne 76 -or $elf[3] -ne 70 -or
        $elf[4] -ne 2 -or $elf[5] -ne 1 -or [BitConverter]::ToUInt16($elf, 18) -ne 183) {
        throw 'The local SDK library must be an arm64 little-endian ELF shared library.'
    }
}
if ($SourcesOnly -and $Keystore) { throw '-SourcesOnly does not sign or create an installable helper.' }
if ($Keystore) {
    $Keystore = Require-File $Keystore 'local signing keystore'
    if (-not $env:SIGN_ORACLE_STORE_PASSWORD) { throw 'Set SIGN_ORACLE_STORE_PASSWORD before signing.' }
    $apksigner = Require-File (Join-Path $buildTools "apksigner$scriptSuffix") 'apksigner'
}

# Every build gets a new directory. No prior outputs are removed or overwritten.
$runName = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runDir = Join-Path $OutputDirectory $runName
New-Item -ItemType Directory -Path $runDir | Out-Null
$runDir = (Resolve-Path -LiteralPath $runDir).Path
$classesDir = Join-Path $runDir 'classes'
New-Item -ItemType Directory -Path $classesDir | Out-Null
$originalJavaHome = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $JavaHome
    $sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Filter '*.java' -Recurse -File | ForEach-Object FullName)
    Invoke-Tool $javac (@('-encoding', 'UTF-8', '-source', '17', '-target', '17', '-cp', $androidJar, '-d', $classesDir) + $sources)
    $classes = @(Get-ChildItem -LiteralPath $classesDir -Filter '*.class' -Recurse -File | ForEach-Object FullName)
    Invoke-Tool $d8 (@('--output', $runDir, '--min-api', '26', '--lib', $androidJar) + $classes)
    $baseApk = Join-Path $runDir 'manifest.apk'
    $linkArguments = @('link', '-o', $baseApk, '-I', $androidJar, '--manifest', (Join-Path $PSScriptRoot 'AndroidManifest.xml'),
        '--min-sdk-version', '26', '--target-sdk-version', '36', '--version-code', '1', '--version-name', '0.1.0')
    if (-not $SourcesOnly) {
        $assetsDir = Join-Path $runDir 'assets'
        New-Item -ItemType Directory -Path $assetsDir | Out-Null
        [IO.File]::WriteAllText((Join-Path $assetsDir 'oracle-config.json'), $configJson, (New-Object Text.UTF8Encoding($false)))
        $linkArguments += @('-A', $assetsDir)
    }
    Invoke-Tool $aapt $linkArguments
    if ($SourcesOnly) {
        Write-Output ([pscustomobject]@{ Directory = $runDir; SourcesOnly = $true; Installable = $false })
        return
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $assembled = Join-Path $runDir 'assembled.apk'
    Copy-Item -LiteralPath $baseApk -Destination $assembled
    $archive = [IO.Compression.ZipFile]::Open($assembled, [IO.Compression.ZipArchiveMode]::Update)
    try {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $runDir 'classes.dex'), 'classes.dex') | Out-Null
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $nativeLibrary, 'lib/arm64-v8a/libmetasec_ml.so') | Out-Null
    } finally { $archive.Dispose() }
    $unsignedApk = Join-Path $runDir 'sign-oracle-unsigned.apk'
    Invoke-Tool $zipalign @('-p', '4', $assembled, $unsignedApk)
    $apk = $unsignedApk
    if ($Keystore) {
        $apk = Join-Path $runDir 'sign-oracle.apk'
        $keyPassword = if ($env:SIGN_ORACLE_KEY_PASSWORD) { 'env:SIGN_ORACLE_KEY_PASSWORD' } else { 'env:SIGN_ORACLE_STORE_PASSWORD' }
        Invoke-Tool $apksigner @('sign', '--ks', $Keystore, '--ks-key-alias', $KeyAlias, '--ks-pass', 'env:SIGN_ORACLE_STORE_PASSWORD',
            '--key-pass', $keyPassword, '--v4-signing-enabled', 'false', '--out', $apk, $unsignedApk)
        Invoke-Tool $apksigner @('verify', $apk)
    }
    Invoke-Tool $zipalign @('-c', '-p', '4', $apk)
    Write-Output ([pscustomobject]@{ Directory = $runDir; Apk = $apk; Signed = [bool]$Keystore; Sha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash })
} finally { $env:JAVA_HOME = $originalJavaHome }
