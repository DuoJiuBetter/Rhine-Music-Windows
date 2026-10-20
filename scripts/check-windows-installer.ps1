param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$SourcePackage
)
$ErrorActionPreference = 'Stop'
$taskWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskInstaller = (Resolve-Path -LiteralPath $Installer).Path
$taskSource = (Resolve-Path -LiteralPath $SourcePackage).Path
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskSource 'BUILD-INFO.json') -Raw | ConvertFrom-Json).version
if ($taskVersion -notmatch '^\d+\.\d+\.\d+[-a-z0-9]*$') { throw 'Invalid validation build version' }
$taskTestRoot = Join-Path $taskWorkspace ('artifacts/installer-validation/' + $taskVersion)
$taskInstall = Join-Path $taskTestRoot '中文安装路径'
$taskForeign = Join-Path $taskTestRoot '已有文件的文件夹'
$taskRegistry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RhineMusicWindowsPreview'
$taskDesktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Rhine Music Preview.lnk'
$taskStartMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Rhine Music Preview'
if ((Test-Path -LiteralPath $taskRegistry) -or (Test-Path -LiteralPath $taskDesktop) -or (Test-Path -LiteralPath $taskStartMenu)) { throw 'An existing installed Preview or its shortcuts must be preserved; use a clean test account.' }
if ((Test-Path -LiteralPath $taskInstall) -or (Test-Path -LiteralPath $taskForeign)) { throw 'Validation folders already exist; preserve earlier results.' }
New-Item -ItemType Directory -Path $taskTestRoot -Force | Out-Null
New-Item -ItemType Directory -Path $taskForeign | Out-Null
[IO.File]::WriteAllText((Join-Path $taskForeign 'keep.txt'), 'Foreign directory must not be overwritten')
$taskReport = [ordered]@{ installer = [IO.Path]::GetFileName($taskInstaller); foreignDirectoryRejected=$false; installed=$false; verifiedFiles=0; reinstalled=$false; shortcutVerified=$false; registryVerified=$false; serviceHealth=0; uninstalled=$false; unrelatedFilePreserved=$false; userDataTouched=$false; nativeWindowLaunched=$false }
try {
  $taskProcess = Start-Process -FilePath $taskInstaller -ArgumentList "/S /D=$taskForeign" -WindowStyle Hidden -Wait -PassThru
  if ($taskProcess.ExitCode -ne 2 -or (Test-Path -LiteralPath (Join-Path $taskForeign 'Rhine Music.exe'))) { throw 'Foreign directory protection failed' }
  $taskReport.foreignDirectoryRejected = $true
  $taskProcess = Start-Process -FilePath $taskInstaller -ArgumentList "/S /D=$taskInstall" -WindowStyle Hidden -Wait -PassThru
  if ($taskProcess.ExitCode -ne 0) { throw "Installer failed: $($taskProcess.ExitCode)" }
  $taskReport.installed = $true
  foreach ($taskRow in [IO.File]::ReadAllLines((Join-Path $taskSource 'SHA256SUMS.txt'))) {
    if ($taskRow -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid payload manifest' }
    $taskExpectedHash = $Matches[1]
    $taskFile = [IO.Path]::GetFullPath((Join-Path $taskInstall $Matches[2]))
    if (-not $taskFile.StartsWith($taskInstall + [IO.Path]::DirectorySeparatorChar)) { throw 'Payload path escaped validation folder' }
    if ((Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpectedHash) { throw "Installed hash mismatch: $($Matches[2])" }
    $taskReport.verifiedFiles++
  }
  $taskRegistered = Get-ItemProperty -LiteralPath $taskRegistry
  if ($taskRegistered.InstallLocation -ne $taskInstall -or $taskRegistered.DisplayVersion -ne $taskVersion) { throw 'Uninstall registry mismatch' }
  $taskReport.registryVerified = $true
  $taskShell = New-Object -ComObject WScript.Shell
  $taskShortcut = $taskShell.CreateShortcut($taskDesktop)
  if ($taskShortcut.TargetPath -ne (Join-Path $taskInstall 'Rhine Music.exe')) { throw 'Desktop shortcut mismatch' }
  if (-not (Test-Path -LiteralPath (Join-Path $taskStartMenu 'Rhine Music.lnk'))) { throw 'Start menu shortcut missing' }
  $taskReport.shortcutVerified = $true
  [IO.File]::WriteAllText((Join-Path $taskInstall 'user-keep.txt'), 'Unrelated files remain after uninstall')
  $taskProcess = Start-Process -FilePath $taskInstaller -ArgumentList "/S /D=$taskInstall" -WindowStyle Hidden -Wait -PassThru
  if ($taskProcess.ExitCode -ne 0) { throw 'Reinstall failed' }
  $taskReport.reinstalled = $true
  # Service-only check: no WebView window, GPU scene, account or audio.
  $taskProbe = Join-Path $taskInstall 'installer-service-probe.mjs'
  [IO.File]::WriteAllText($taskProbe, @'
import {createMusicServer} from './runtime/scripts/music-server.mjs';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rhine-install-probe-'));let server;
try { ({server}=await createMusicServer({dataDir:directory,autoScan:false}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/health');if(response.status!==200)throw Error('HTTP probe failed');console.log('200'); }
finally { if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('rhine-install-probe-'))await fs.rm(directory,{recursive:true,force:true}); }
'@, [Text.UTF8Encoding]::new($false))
  $taskProbeOutput = & (Join-Path $taskInstall 'runtime/node.exe') $taskProbe
  if ($LASTEXITCODE -ne 0 -or $taskProbeOutput -ne '200') { throw 'Installed service probe failed' }
  $taskReport.serviceHealth = 200
} finally {
  $taskUninstaller = Join-Path $taskInstall 'Uninstall.exe'
  if (Test-Path -LiteralPath $taskUninstaller) {
    $taskProcess = Start-Process -FilePath $taskUninstaller -ArgumentList "/S _?=$taskInstall" -WindowStyle Hidden -Wait -PassThru
    $taskRemaining = @((Join-Path $taskInstall 'Rhine Music.exe'),(Join-Path $taskInstall 'runtime/node.exe'),$taskDesktop,$taskStartMenu,$taskRegistry) | Where-Object { Test-Path -LiteralPath $_ }
    $taskReport.uninstalled = ($taskProcess.ExitCode -eq 0 -and $taskRemaining.Count -eq 0)
    $taskReport.unrelatedFilePreserved = Test-Path -LiteralPath (Join-Path $taskInstall 'user-keep.txt')
  }
  [IO.File]::WriteAllText((Join-Path $taskTestRoot 'result.json'), ($taskReport | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  $taskReport | ConvertTo-Json
}
if (-not $taskReport.uninstalled -or -not $taskReport.unrelatedFilePreserved) { throw 'Uninstall validation failed' }
