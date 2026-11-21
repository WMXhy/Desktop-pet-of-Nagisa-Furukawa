param(
    [string]$Nsis = $env:NAGISA_MAKENSIS,
    [string]$PackageDirectory
)
$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot
$json = Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw | ConvertFrom-Json
$version = $json.version
if (!$Nsis) {
    $found = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($found) { $Nsis = $found.Source }
    else { $Nsis = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe' }
}
if (!(Test-Path -LiteralPath $Nsis -PathType Leaf)) {
    throw 'Install NSIS 3.13 or set NAGISA_MAKENSIS to its makensis.exe.'
}
$Nsis = (Resolve-Path -LiteralPath $Nsis).Path
$reported = (& $Nsis /VERSION | Out-String).Trim()
if ($LASTEXITCODE -or $reported -notmatch '^v?3\.13$') { throw "NSIS 3.13 required, found $reported." }

Push-Location -LiteralPath $app
try {
    if (!$PackageDirectory) {
        npm.cmd run package -- --platform=win32 --arch=x64
        if ($LASTEXITCODE) { throw "Forge package exited with $LASTEXITCODE." }
        $PackageDirectory = Join-Path $app "out\$($json.productName)-win32-x64"
    }
    $payload = (Resolve-Path -LiteralPath $PackageDirectory).Path
    foreach ($required in "$($json.productName).exe", 'resources\app.asar', 'resources\NagisaDesktopState.exe') {
        if (!(Test-Path -LiteralPath (Join-Path $payload $required) -PathType Leaf)) { throw "Packaged file missing: $required" }
    }
    if ((Get-Item -LiteralPath (Join-Path $payload "$($json.productName).exe")).VersionInfo.ProductVersion -ne $version) {
        throw "Forge payload does not match package.json version $version."
    }

    $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $build = New-Item -ItemType Directory -Path (Join-Path $app "out\installer\v$version") -Force
    $engine = Join-Path $build.FullName 'NagisaInstaller.exe'
    & $compiler /nologo /optimize+ /codepage:65001 /platform:anycpu /target:exe /reference:Microsoft.CSharp.dll "/out:$engine" 'installer\engine.cs'
    if ($LASTEXITCODE) { throw 'Could not build the Windows installer helper.' }
    $bytes = (Get-ChildItem -LiteralPath $payload -Recurse -File | Measure-Object -Property Length -Sum).Sum + 16MB
    $size = [int64][Math]::Ceiling($bytes / 1KB)
    $release = New-Item -ItemType Directory -Path (Join-Path $app "out\release\v$version") -Force
    $setup = Join-Path $release.FullName "Nagisa-Desktop-Pet-$version-win-x64-Setup.exe"
    $workingSetup = Join-Path $build.FullName "Nagisa-Desktop-Pet-$version-win-x64-Setup.exe"
    $icon = Join-Path $app 'src\assets\app-icon.ico'
    & $Nsis /INPUTCHARSET UTF8 /V3 "/DAPP_VERSION=$version" "/DAPP_ICON=$icon" "/DINSTALL_ENGINE=$engine" "/DPAYLOAD_DIR=$payload" "/DPAYLOAD_BYTES=$bytes" "/DPAYLOAD_KIB=$size" "/DSETUP_EXE=$workingSetup" 'installer\windows.nsi'
    if ($LASTEXITCODE) { throw "NSIS packaging exited with $LASTEXITCODE." }
    Copy-Item -LiteralPath $workingSetup -Destination $setup -Force
    $file = Get-Item -LiteralPath $setup
    $sha = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($file.FullName)
    try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
    [pscustomobject]@{ Path=$file.FullName; Bytes=$file.Length; SHA256=$digest } | Format-List
}
finally { Pop-Location }
