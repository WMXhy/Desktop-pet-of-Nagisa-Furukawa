param([Parameter(Mandatory)][string]$Setup,[Parameter(Mandatory)][string]$Baseline,
  [Parameter(Mandatory)][string]$Portable100,[Parameter(Mandatory)][string]$Portable101)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Run this test on its dedicated Windows CI virtual machine.'
}
$root = Join-Path $env:LOCALAPPDATA 'nagisa_app'
$userData = Join-Path $env:APPDATA 'Nagisa Desktop Pet'
$save = Join-Path $userData 'save.json'
$prefs = Join-Path $userData 'settings.json'
$position = Join-Path $userData 'pet-position.json'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$approved = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$programs = [Environment]::GetFolderPath('Programs')
$exeName = 'Nagisa Desktop Pet.exe'
$stub = Join-Path $root $exeName
$old = Join-Path $root "app-1.0.0/$exeName"
$current = Join-Path $root "app-1.0.2/$exeName"
$update = Join-Path $root 'Update.exe'
$systemPath = "$env:SystemRoot\System32;$env:SystemRoot"
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NagisaClose {
    private delegate bool Window(IntPtr hwnd, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Window callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint id);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr param,IntPtr data);
    public static void Close(uint owner) {
        EnumWindows((hwnd, data) => {
            uint id;
            GetWindowThreadProcessId(hwnd, out id);
            if (id == owner && IsWindowVisible(hwnd)) PostMessage(hwnd, 0x10, IntPtr.Zero, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);
    }
}
'@

function Require($Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}
function Wait-Until([scriptblock]$Condition,[string]$Message,[int]$Seconds=35) {
    $end = (Get-Date).AddSeconds($Seconds)
    do {
        $result = & $Condition
        if ($result) { return $result }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $end)
    throw $Message
}
function Run-WithoutNode([string]$Path,[string[]]$Arguments = @()) {
    $prior = $env:Path
    try {
        $env:Path = $systemPath
        Require (!(Get-Command node.exe -ErrorAction SilentlyContinue)) 'Node was available on the exercise PATH.'
        if($Arguments.Count) { return Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru }
        return Start-Process -FilePath $Path -PassThru
    } finally { $env:Path = $prior }
}
function Wait-Exit($Process,[string]$Label) {
    Require ($Process.WaitForExit(120000)) "$Label did not exit."
    Require ($Process.ExitCode -eq 0) "$Label exited with $($Process.ExitCode)."
}
function PetProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name = '$exeName'" | Where-Object { $_.CommandLine -notmatch '\s--type=' })
}
function Stop-TestPet {
    foreach($process in (PetProcesses)) {
        $proc = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
        if($proc) { [NagisaClose]::Close($proc.Id) }
        if($proc -and !$proc.WaitForExit(3500)) {
            Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue
            $proc.WaitForExit(3000) | Out-Null
        }
    }
    Wait-Until { @(PetProcesses).Count -eq 0 } 'The test pet did not stop.' | Out-Null
}
function Install([string]$File,[string]$Expected,[switch]$Silent) {
    $args = @()
    if($Silent) { $args = @('--silent') }
    $proc = Run-WithoutNode $File $args
    Wait-Exit $proc 'Setup'
    Wait-Until { Test-Path -LiteralPath $Expected } 'The requested installed executable is missing.' | Out-Null
    Require (Test-Path -LiteralPath $stub) 'The root launcher was not installed.'
}
function StartLinks {
    $shell = New-Object -ComObject WScript.Shell
    @(Get-ChildItem -LiteralPath $programs -Recurse -Filter '*.lnk' | Where-Object {
        $target = $shell.CreateShortcut($_.FullName).TargetPath
        $target -and $target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -and
          [IO.Path]::GetFileName($target) -eq $exeName
    })
}
function UninstallEntry {
    @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
      Where-Object { $_.UninstallString -and $_.UninstallString.IndexOf($update,[StringComparison]::OrdinalIgnoreCase) -ge 0 })
}
function RunValue {
    if (Test-Path -LiteralPath $runKey) {
        (Get-Item -LiteralPath $runKey).GetValue('NagisaDesktopPet')
    }
}
function Set-LegacyLogin([string]$Path,[bool]$Enabled) {
    New-Item -Path $runKey -Force | Out-Null
    New-Item -Path $approved -Force | Out-Null
    New-ItemProperty -LiteralPath $runKey -Name 'NagisaDesktopPet' -Value ('"'+$Path+'"') -PropertyType String -Force | Out-Null
    [byte[]]$approval = @($(if($Enabled){2}else{3}),0,0,0,0,0,0,0,0,0,0,0)
    New-ItemProperty -LiteralPath $approved -Name 'NagisaDesktopPet' -Value $approval -PropertyType Binary -Force | Out-Null
}
function Verify-Login([bool]$Enabled) {
    Require ((RunValue).Trim('"') -eq $stub) 'The login entry did not migrate to the stable launcher.'
    $bytes = Get-ItemPropertyValue -LiteralPath $approved -Name 'NagisaDesktopPet'
    $expected = if($Enabled){2}else{3}
    Require ($bytes[0] -eq $expected) 'The Windows startup approval state changed.'
}
function Start-Installed {
    $links = @(StartLinks)
    Require ($links.Count -eq 1) 'Exactly one Start menu entry is required.'
    Require (@(UninstallEntry).Count -eq 1) 'Exactly one uninstall entry is required.'
    Require ((UninstallEntry)[0].DisplayVersion -eq '1.0.2') 'The uninstall entry does not describe v1.0.2.'
    Start-Process -FilePath $links[0].FullName
    Wait-Until { @(PetProcesses | Where-Object { $_.ExecutablePath -eq $current }).Count -eq 1 } 'The Start menu did not launch v1.0.2.' | Out-Null
    Require (@(PetProcesses).Count -eq 1) 'More than one main application process.'
    Start-Sleep -Seconds 2
}
function Seed([int]$Coins,[int]$Scale) {
    New-Item -ItemType Directory -Path $userData -Force | Out-Null
    $data = @{
        version=6; revision=4; coins=$Coins; fullness=51; energy=65; mood=60; affection=21; studyPoints=6
        inventory=@{bread=4;redBeanBread=1;dangoSnack=0}; ownedToys=@{dangoPlush=$true;miniStage=$false}
        daily=@{day=(Get-Date -Format 'yyyy-MM-dd');gained=1}; activityLog=@(); activeActivity=$null
        online=@{hungerMs=0;idleMs=0}; lastGreetingDay=$null; relationshipLog=@()
    }
    $settings = @{
        version=1; preferences=@{launchAtLogin=$false;showOnStartup=$true;stayInTray=$true
        scale=$Scale;opacity=100;onTop=$true;lockPosition=$false;displayId=$null;passThrough=$false
        allowDrag=$true;bubbleSeconds=4;autoGreeting=$false;greetingMinutes=30;volume=50;soundEffects=$false
        reducedMotion=$false;fps=24;completionBubble=$true;systemNotifications=$false;quietHours=$true
        quietStart='22:00';quietEnd='08:00';fullscreenQuiet=$true;fullscreenHide=$false;manualQuiet=$false
        shortcuts=@{togglePet='';recoverPet='';openJournal=''};onboardingSeen=$true}
    }
    $data | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $save -Encoding utf8NoBOM
    $settings | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $prefs -Encoding utf8NoBOM
    if (Test-Path -LiteralPath $position) {
        @{version=1;displayId=(Get-Content -LiteralPath $position -Raw | ConvertFrom-Json).displayId;dx=115;dy=160} |
            ConvertTo-Json | Set-Content -LiteralPath $position -Encoding utf8NoBOM
    }
}
function Snapshot {
    $data = Get-Content -LiteralPath $save -Raw | ConvertFrom-Json
    $settings = Get-Content -LiteralPath $prefs -Raw | ConvertFrom-Json
    [ordered]@{ coins=$data.coins; affection=$data.affection; toy=$data.ownedToys.dangoPlush; bread=$data.inventory.bread
        scale=$settings.preferences.scale; position=(Get-Content -LiteralPath $position -Raw | ConvertFrom-Json) } |
        ConvertTo-Json -Compress -Depth 6
}
function Boot-Previous([string]$Path) {
    $proc=Run-WithoutNode $Path
    Wait-Until { (Test-Path -LiteralPath $save) -and @(PetProcesses).Count -eq 1 } 'Baseline failed to start.' | Out-Null
    Start-Sleep -Seconds 2
    Stop-TestPet
    Require (Test-Path -LiteralPath $position) 'Baseline did not persist a desktop position.'
}
function Uninstall {
    Stop-TestPet
    Require (@(UninstallEntry).Count -eq 1) 'The installed app did not register the expected uninstall action.'
    Wait-Exit (Run-WithoutNode $update @('--uninstall','--silent')) 'Uninstaller'
    Wait-Until { @(UninstallEntry).Count -eq 0 -and @(StartLinks).Count -eq 0 } 'Uninstall left shortcuts or a Windows apps entry.' | Out-Null
    Require (!(RunValue)) 'Uninstall left the desktop pet startup registration.'
    Require (Test-Path -LiteralPath $save) 'Uninstall removed the user save.'
}

Require (!(Test-Path -LiteralPath $root) -and !(Test-Path -LiteralPath $userData)) 'Expected a fresh VM.'
Install $Setup $current
Wait-Until { @(PetProcesses | Where-Object ExecutablePath -eq $current).Count -eq 1 } 'Desktop pet did not open after a normal setup.' | Out-Null
Require (@(PetProcesses).Count -eq 1) 'Normal install opened multiple desktop pets.'
Stop-TestPet
Start-Installed
Wait-Until { Test-Path -LiteralPath $save } 'The fresh install did not use the default user data path.' | Out-Null
Stop-TestPet
Seed 48 125
$cleanSnapshot=Snapshot
Uninstall
Install $Setup $current -Silent
Start-Installed
Require ((Snapshot) -eq $cleanSnapshot) 'Reinstall did not preserve the saved progress.'
Uninstall
Write-Host 'PASS Fresh Setup, single instance, Start menu, Windows Apps entry, uninstall and reinstall'

foreach($scenario in @(@{Version='1.0.0';File=$Portable100;Coins=51;Scale=125;Enabled=$true},
                       @{Version='1.0.1';File=$Portable101;Coins=72;Scale=150;Enabled=$false})) {
    Seed $scenario.Coins $scenario.Scale
    $portableExe=Join-Path $scenario.File $exeName
    Set-LegacyLogin $portableExe $scenario.Enabled
    Boot-Previous $portableExe
    $before=Snapshot
    Install $Setup $current -Silent
    Rename-Item -LiteralPath $scenario.File -NewName ((Split-Path $scenario.File -Leaf)+'-archived')
    Start-Installed
    Require ((Snapshot) -eq $before) "Portable data changed for $($scenario.Version)."
    Verify-Login $scenario.Enabled
    Uninstall
    Write-Host "PASS Portable $($scenario.Version) -> Setup, default data, position, preferences, moved ZIP, login state"
}

foreach($enabled in @($true,$false)) {
    Install $Baseline $old -Silent
    Seed 63 125
    Set-LegacyLogin $old $enabled
    Boot-Previous $old
    $before=Snapshot
    Install $Setup $current -Silent
    Start-Installed
    Require ((Snapshot) -eq $before) 'Installed upgrade changed the previous save.'
    Verify-Login $enabled
    if($enabled) {
        Stop-TestPet
        Run-WithoutNode ((RunValue).Trim('"')) | Out-Null
        Wait-Until { @(PetProcesses | Where-Object ExecutablePath -eq $current).Count -eq 1 } 'Login launcher did not start v1.0.2.' |
          Out-Null
        Require (@(PetProcesses).Count -eq 1) 'Started more than one application from the login target.'
    }
    Uninstall
    Write-Host "PASS Internal 1.0.0 Setup -> v1.0.2 Setup, login enabled=$enabled, uninstall removed startup"
}
