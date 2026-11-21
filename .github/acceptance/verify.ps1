param([string]$Setup,[string]$Later,[string]$Squirrel,[string]$Portable100,[string]$Portable101)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows'){throw 'Use a dedicated Windows CI virtual machine.'}
$product='Nagisa Desktop Pet'
$exe="$product.exe"
$state='HKCU:\Software\WMXhy\NagisaDesktopPet'
$uninstallRoot='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$newUninstall="$uninstallRoot\WMXhy.NagisaDesktopPet"
$oldUninstall="$uninstallRoot\nagisa_app"
$oldRoot=Join-Path $env:LOCALAPPDATA 'nagisa_app'
$userData=Join-Path $env:APPDATA $product
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk"
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$approval='HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$default=Join-Path $env:LOCALAPPDATA "Programs/$product"
$testRoot=Join-Path $env:RUNNER_TEMP 'NSIS acceptance'
$driveRoot=if(Test-Path -LiteralPath 'D:\'){'D:\'}else{[IO.Path]::GetPathRoot($testRoot)}
$customParent=Join-Path $driveRoot '渚的 游戏验收'
$custom=Join-Path $customParent $product
$differentParent=Join-Path $env:LOCALAPPDATA '渚的 另一个目录'
$different=Join-Path $differentParent $product
$save=Join-Path $userData 'save.json'
$prefs=Join-Path $userData 'settings.json'

function Require($Value,[string]$Message){if(!$Value){throw $Message}}
function Within([scriptblock]$Action,[string]$Message,[int]$Seconds=40) {
    $end=(Get-Date).AddSeconds($Seconds)
    do {
        $value=& $Action
        if($value){return $value}
        Start-Sleep -Milliseconds 260
    }while((Get-Date) -lt $end)
    throw $Message
}
function Process-NoNode([string]$File,[string]$Args='') {
    $previous=$env:PATH
    try {
        $env:PATH="$env:SystemRoot\System32;$env:SystemRoot"
        Require (!(Get-Command node.exe -ErrorAction SilentlyContinue)) 'Node is visible on the test PATH.'
        if($Args){return Start-Process -FilePath $File -ArgumentList $Args -PassThru}
        return Start-Process -FilePath $File -PassThru
    }finally{$env:PATH=$previous}
}
function Expect-Exit($Proc,[int]$Code,[string]$Label){
    Require ($Proc.WaitForExit(130000)) "$Label timed out."
    Require ($Proc.ExitCode -eq $Code) "$Label exited with $($Proc.ExitCode), expected $Code."
}
function Run-Setup([string]$File,[string]$Directory='',[int]$Code=0){
    $line='/S'
    if($Directory){$line+=" /D=$Directory"}
    Expect-Exit (Process-NoNode $File $line) $Code "Setup ($Directory)"
}
function RegValue([string]$Key,[string]$Name){
    if(Test-Path -LiteralPath $Key){(Get-Item -LiteralPath $Key).GetValue($Name)}
}
function Check-Install([string]$Path,[string]$Version){
    Require ((RegValue $state 'InstallDir') -eq $Path) "Unexpected installed path for $Path."
    Require ((RegValue $newUninstall 'DisplayVersion') -eq $Version) 'Windows uninstall registration has a different version.'
    Require (Test-Path -LiteralPath "$Path/resources/NagisaDesktopState.exe") 'Windows helper missing.'
    Require (Test-Path -LiteralPath "$Path/resources/app.asar") 'Application archive missing.'
    Require (Test-Path -LiteralPath "$Path/.nagisa-install") 'Install manifest missing.'
    Require ((Get-Item -LiteralPath "$Path/$exe").VersionInfo.ProductVersion -eq $Version) 'Application version mismatches install version.'
    Require (Test-Path -LiteralPath $shortcut) 'Start menu shortcut missing.'
    $shell=New-Object -ComObject WScript.Shell
    Require ($shell.CreateShortcut($shortcut).TargetPath -eq "$Path\$exe") 'Start menu target mismatches installation.'
}
function Check-Launch([string]$Path) {
    Start-Process -FilePath $shortcut
    $app=Within { Get-CimInstance Win32_Process -Filter "Name = '$exe'" |
            Where-Object { $_.CommandLine -notmatch '\s--type=' -and $_.ExecutablePath -eq "$Path\$exe" } |
            Select-Object -First 1 } "The shortcut did not launch $Path." 
    $proc=Get-Process -Id $app.ProcessId
    Start-Sleep -Seconds 2
    Require (!$proc.HasExited) 'The desktop pet exited unexpectedly.'
    return $proc
}
function Close-Pet($Proc) {
    if ($Proc.CloseMainWindow() -and $Proc.WaitForExit(3000)){return}
    $Proc.Kill(); $Proc.WaitForExit(3000)|Out-Null
}
function Uninstall-Current {
    $path=RegValue $state 'InstallDir'
    $proc=Process-NoNode "$path/Uninstall.exe" '/S'
    Require ($proc.WaitForExit(20000)) 'Uninstaller bootstrap hung.'
    Within { !(Test-Path -LiteralPath $newUninstall) -and !(Test-Path -LiteralPath $shortcut) } 'Uninstall left registered entries.' | Out-Null
    Require (!(Test-Path -LiteralPath "$path/$exe")) 'Uninstall left installed app files.'
}
function Seed([int]$Coins,[int]$Scale){
    New-Item -Path $userData -ItemType Directory -Force | Out-Null
    @{
        version=6;revision=5;coins=$Coins;fullness=56;energy=58;mood=60;affection=27;studyPoints=9
        inventory=@{bread=4;redBeanBread=1;dangoSnack=0};ownedToys=@{dangoPlush=$true;miniStage=$false}
        daily=@{day=(Get-Date -Format 'yyyy-MM-dd');gained=0};activityLog=@();activeActivity=$null
        online=@{hungerMs=0;idleMs=0};lastGreetingDay=$null;relationshipLog=@()
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $save -Encoding utf8NoBOM
    @{
        version=1;preferences=@{launchAtLogin=$false;showOnStartup=$true;stayInTray=$true;scale=$Scale;opacity=100;onTop=$true
        lockPosition=$false;displayId=$null;passThrough=$false;allowDrag=$true;bubbleSeconds=4;autoGreeting=$false
        greetingMinutes=30;volume=50;soundEffects=$false;reducedMotion=$false;fps=24;completionBubble=$true
        systemNotifications=$false;quietHours=$true;quietStart='22:00';quietEnd='08:00';fullscreenQuiet=$true
        fullscreenHide=$false;manualQuiet=$false;shortcuts=@{togglePet='';recoverPet='';openJournal=''};onboardingSeen=$true}
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $prefs -Encoding utf8NoBOM
}
function Check-Data([int]$Coins,[int]$Scale) {
    $data=Get-Content -LiteralPath $save -Raw | ConvertFrom-Json
    $config=Get-Content -LiteralPath $prefs -Raw | ConvertFrom-Json
    Require ($data.coins -eq $Coins -and $data.affection -eq 27 -and $data.inventory.bread -eq 4 -and $data.ownedToys.dangoPlush) 'The existing care data changed.'
    Require ($config.preferences.scale -eq $Scale) 'The existing scale changed.'
}
function Set-Login([string]$App,[bool]$Enabled) {
    foreach($key in @($runKey,$approval)){if(!(Test-Path -LiteralPath $key)){New-Item -Path $key -Force|Out-Null}}
    $value='"'+$App+'"'
    New-ItemProperty -LiteralPath $runKey -Name NagisaDesktopPet -PropertyType String -Value $value -Force | Out-Null
    [byte[]]$bytes=@($(if($Enabled){2}else{3}),0,0,0,0,0,0,0,0,0,0,0)
    New-ItemProperty -LiteralPath $approval -Name NagisaDesktopPet -PropertyType Binary -Value $bytes -Force | Out-Null
}
function Check-Login([string]$Install,[bool]$Enabled){
    Require ((RegValue $runKey NagisaDesktopPet).Trim('"') -eq "$Install\$exe") 'Startup target did not migrate.'
    $bytes=RegValue $approval NagisaDesktopPet
    $enabledNow=$null -eq $bytes -or $bytes[0] -eq 2
    Require ($enabledNow -eq $Enabled) 'Windows startup approval changed.'
}

New-Item -Path $testRoot -ItemType Directory -Force | Out-Null
Require (!(Test-Path -LiteralPath $state) -and !(Test-Path -LiteralPath $oldUninstall)) 'Expected a clean VM.'
Run-Setup $Setup
Check-Install $default '1.0.3'
Close-Pet (Check-Launch $default)
Uninstall-Current
Write-Host '::notice title=Passed default installation::Fresh NSIS default path, Windows entry, Start menu and launch'

$bad=Join-Path $customParent '其它文件/Nagisa Desktop Pet'
New-Item -Path $bad -ItemType Directory -Force | Out-Null
'keep' | Set-Content -LiteralPath "$bad/unrelated.txt"
Run-Setup $Setup $bad 1
Run-Setup $Setup $driveRoot 1
Run-Setup $Setup $userData 1
Require ((Get-Content -LiteralPath "$bad/unrelated.txt") -eq 'keep') 'Validation touched an unrelated file.'
Require (!(Test-Path -LiteralPath $newUninstall)) 'Invalid installation added an entry.'
Write-Host '::notice title=Passed directory protections::Disallowed root, unrelated nonempty folder and AppData'

foreach($entry in @(@{App=$Portable100;Version='1.0.0';Coins=52;Scale=125;Enabled=$true},
                     @{App=$Portable101;Version='1.0.1';Coins=66;Scale=150;Enabled=$false})){
    Seed $entry.Coins $entry.Scale
    $oldPet=Process-NoNode "$($entry.App)/$exe"
    Start-Sleep -Seconds 2
    Require (!$oldPet.HasExited) 'Portable app could not start.'
    Run-Setup $Setup $customParent 1
    Close-Pet $oldPet
    Set-Login "$($entry.App)\$exe" $entry.Enabled
    Run-Setup $Setup $customParent
    Check-Install $custom '1.0.3'
    Check-Login $custom $entry.Enabled
    Close-Pet (Check-Launch $custom)
    Check-Data $entry.Coins $entry.Scale
    Uninstall-Current
    Require (!(RegValue $runKey NagisaDesktopPet)) 'Uninstall left startup entry.'
    Write-Host "::notice title=Passed portable migration::$($entry.Version) to $custom; save and startup state retained"
}

Expect-Exit (Process-NoNode $Squirrel '--silent') 0 'Published Squirrel 1.0.2'
Within {Test-Path -LiteralPath "$oldRoot/app-1.0.2/$exe"} 'Official Squirrel install did not finish.' | Out-Null
Seed 72 150
Set-Login "$oldRoot\$exe" $true
Run-Setup $Setup $custom
Require (!(Test-Path -LiteralPath $oldUninstall)) 'Squirrel uninstall entry was left behind.'
Check-Install $custom '1.0.3'
Check-Login $custom $true
Close-Pet (Check-Launch $custom)
Check-Data 72 150
Write-Host '::notice title=Passed published Squirrel migration::Official 1.0.2 installed edition to custom NSIS directory, save and startup retained'

'player file' | Set-Content -LiteralPath "$custom/user.txt"
Run-Setup $Setup
Check-Install $custom '1.0.3'
$locked=[IO.File]::Open("$custom/resources/app.asar",[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
try { Run-Setup $Later '' 1 } finally { $locked.Dispose() }
Check-Install $custom '1.0.3'
Require ((Get-Content -LiteralPath "$custom/user.txt") -eq 'player file') 'Failure changed a player file.'
Close-Pet (Check-Launch $custom)
Run-Setup $Later
Check-Install $custom '1.0.4'
Run-Setup $Later $differentParent
Check-Install $different '1.0.4'
Check-Login $different $true
Require (!(Test-Path -LiteralPath "$custom/$exe")) 'Move did not retire the previous app payload.'
Require ((Get-Content -LiteralPath "$custom/user.txt") -eq 'player file') 'Move deleted a player file.'
Close-Pet (Check-Launch $different)
Check-Data 72 150
Write-Host '::notice title=Passed rollback and relocation::Locked file rolled back; retry upgraded in place, then moved to another volume while retaining user file'

'keep installed notes' | Set-Content -LiteralPath "$different/personal.txt"
Uninstall-Current
Require ((Get-Content -LiteralPath "$different/personal.txt") -eq 'keep installed notes') 'Uninstall removed an unmanaged file.'
Require (!(RegValue $runKey NagisaDesktopPet)) 'Uninstall left an obsolete logon command.'
Run-Setup $Setup $testRoot
$reinstalled=Join-Path $testRoot $product
Check-Install $reinstalled '1.0.3'
Close-Pet (Check-Launch $reinstalled)
Check-Data 72 150
Uninstall-Current
Write-Host '::notice title=Passed uninstall and reinstall::Unmanaged file and same-account save survived uninstall and reinstall at a new location'
