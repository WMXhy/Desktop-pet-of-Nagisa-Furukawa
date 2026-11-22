$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows'){throw 'Use a disposable Windows runner.'}

$product='Nagisa Desktop Pet'
$exe="$product.exe"
$root=Join-Path $env:RUNNER_TEMP 'v111 verification'
$data=Join-Path $env:APPDATA $product
$registry='HKCU:\Software\WMXhy\NagisaDesktopPet'
$uninstall='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WMXhy.NagisaDesktopPet'
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk"
$destination=Join-Path $root $product
$old=Join-Path $root 'OldSetup.exe'
$new=(Resolve-Path -LiteralPath 'nagisa-app/out/release/v1.1.1/Nagisa-Desktop-Pet-1.1.1-win-x64-Setup.exe').Path

function Confirm($Condition,[string]$Failure){if(!$Condition){throw $Failure}}
function Wait-For([scriptblock]$Condition,[string]$Failure){
  $deadline=(Get-Date).AddSeconds(35)
  do {
    $result=& $Condition
    if($result){return $result}
    Start-Sleep -Milliseconds 200
  }while((Get-Date) -lt $deadline)
  throw $Failure
}
function Install-Setup([string]$Setup,[string]$Arguments){
  $p=Start-Process -FilePath $Setup -ArgumentList $Arguments -PassThru
  Confirm ($p.WaitForExit(140000)) 'Setup timed out.'
  Confirm ($p.ExitCode -eq 0) "Setup returned $($p.ExitCode)."
}
function Install-Version([string]$Version){
  Confirm ((Get-ItemPropertyValue -LiteralPath $registry -Name InstallDir) -eq $destination) 'Setup changed the selected directory.'
  Confirm ((Get-ItemPropertyValue -LiteralPath $uninstall -Name DisplayVersion) -eq $Version) "Windows did not register $Version."
  Confirm ((Get-Item -LiteralPath "$destination/$exe").VersionInfo.ProductVersion -eq $Version) 'Unexpected executable version.'
  $shell=New-Object -ComObject Shell.Application
  $folder=$shell.NameSpace([IO.Path]::GetDirectoryName($shortcut))
  $link=$folder.ParseName([IO.Path]::GetFileName($shortcut))
  Confirm ($link.ExtendedProperty('System.Link.TargetParsingPath') -eq "$destination\$exe") 'Start menu does not target installed executable.'
}
function Check-Launch {
  Start-Process -FilePath $shortcut
  $process=Wait-For {
    Get-CimInstance Win32_Process -Filter "Name = '$exe'" |
      Where-Object { $_.ExecutablePath -eq "$destination\$exe" -and $_.CommandLine -notmatch '\s--type=' } |
      Select-Object -First 1
  } 'Start menu did not start the installed copy.'
  Start-Sleep -Seconds 2
  $rootProcess=Get-Process -Id $process.ProcessId
  Confirm (!$rootProcess.HasExited) 'The desktop pet stopped after launch.'
  $rootProcess.Kill()
  Wait-For { !(Get-Process -Name $product -ErrorAction SilentlyContinue) } 'Installed desktop pet did not exit.' | Out-Null
}

Confirm (!(Test-Path -LiteralPath $registry) -and !(Test-Path -LiteralPath $data)) 'Expected an empty Windows profile.'
New-Item -ItemType Directory -Path $root | Out-Null
curl.exe -fsSL --retry 2 'https://github.com/WMXhy/Desktop-pet-of-Nagisa-Furukawa/releases/download/v1.1.0/Nagisa-Desktop-Pet-1.1.0-win-x64-Setup.exe' -o $old
Confirm ($LASTEXITCODE -eq 0) 'Fetching the published baseline failed.'
Confirm ((Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash -eq '175DC9D368B7DD36D5B7196F3DF7AD50054475407A788058D6999975663D79BA') 'Published v1.1.0 digest differs.'
Install-Setup $old "/S /D=$root"
Install-Version '1.1.0'
Check-Launch

New-Item -ItemType Directory -Path $data -Force | Out-Null
$env:NAGISA_TEST_DATA=$data
Push-Location -LiteralPath 'nagisa-app'
try {
  node.exe -e "const fs=require('node:fs');const path=require('node:path');const {defaultSettings}=require('./src/settings.ts');fs.writeFileSync(path.join(process.env.NAGISA_TEST_DATA,'settings.json'),JSON.stringify({version:1,preferences:{...defaultSettings,scale:100,onboardingSeen:true}}))"
  Confirm ($LASTEXITCODE -eq 0) 'Could not write older settings fixture.'
} finally {Pop-Location}
@{
  version=6;revision=5;coins=30;fullness=95;energy=78;mood=60;affection=27;studyPoints=9
  inventory=@{bread=1;redBeanBread=0;dangoSnack=1};ownedToys=@{dangoPlush=$true;miniStage=$false}
  daily=@{day=(Get-Date -Format 'yyyy-MM-dd');gained=12};activityLog=@();activeActivity=$null
  online=@{hungerMs=0;idleMs=0};lastGreetingDay=$null;relationshipLog=@()
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath "$data/save.json" -Encoding utf8NoBOM
'{"version":1,"displayId":1,"dx":137,"dy":169}' | Set-Content -LiteralPath "$data/pet-position.json" -Encoding utf8NoBOM
$fixtureNames='settings.json','pet-position.json','save.json'
$before=@{}
foreach($name in $fixtureNames){$before[$name]=(Get-FileHash -LiteralPath "$data/$name" -Algorithm SHA256).Hash}

Install-Setup $new '/S'
Install-Version '1.1.1'
foreach($name in $fixtureNames){
  Confirm ((Get-FileHash -LiteralPath "$data/$name" -Algorithm SHA256).Hash -eq $before[$name]) "Setup changed $name."
}
Check-Launch
Write-Host '::notice title=Passed installed upgrade::Official v1.1.0 to v1.1.1 at the same path; Start menu launch and byte-for-byte retention of care, preferences and position.'

$runtime=New-Item -ItemType Directory -Path (Join-Path $root 'runtime')
$zip=Join-Path $env:RUNNER_TEMP 'v111-build/electron-v45.4.1-win32-x64.zip'
& "$env:SystemRoot/System32/tar.exe" -xf $zip -C $runtime.FullName
Confirm ($LASTEXITCODE -eq 0) 'Could not unpack the previously verified test runtime.'
$Electron=(Resolve-Path -LiteralPath (Join-Path $runtime.FullName 'electron.exe')).Path
$harness=(Resolve-Path -LiteralPath '.github/acceptance/acceptance.cjs').Path
$env:NAGISA_QA_ENTRY="$destination\resources\app.asar\.webpack\main\index.js"
$env:NAGISA_QA_RECEIPT=Join-Path $root 'receipt.json'
$p=Start-Process -FilePath $Electron -ArgumentList ('"'+$harness+'"') -PassThru
Confirm ($p.WaitForExit(110000)) 'Packaged renderer acceptance timed out.'
Confirm (Test-Path -LiteralPath $env:NAGISA_QA_RECEIPT) "Packaged renderer acceptance produced no result, exit $($p.ExitCode)."
$receipt=Get-Content -LiteralPath $env:NAGISA_QA_RECEIPT -Raw | ConvertFrom-Json
if(!$receipt.ok){throw $receipt.error}
foreach($check in $receipt.checks){Write-Host "::notice title=Passed desktop food::$check"}
$env:NAGISA_QA_RESTART='1'
$p=Start-Process -FilePath $Electron -ArgumentList ('"'+$harness+'"') -PassThru
Confirm ($p.WaitForExit(35000)) 'Restart test timed out.'
$receipt=Get-Content -LiteralPath $env:NAGISA_QA_RECEIPT -Raw | ConvertFrom-Json
if($p.ExitCode -or !$receipt.ok){throw "Restart test failed. $($receipt.error)"}
foreach($check in $receipt.checks){Write-Host "::notice title=Passed desktop food::$check"}
