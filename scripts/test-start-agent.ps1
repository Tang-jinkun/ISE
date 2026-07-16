[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$launcher = Join-Path $PSScriptRoot 'start-agent.ps1'
$node24 = 'C:\Users\t\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$modelNames = @('MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_API_KEY')
$testEnvironmentNames = $modelNames + @(
  'ISE_LAUNCHER_FIXTURE_MODE',
  'ISE_LAUNCHER_RESULT_PATH',
  'ISE_LAUNCHER_SECRET_SENTINEL'
)
$originalEnvironment = @{}
foreach ($name in $testEnvironmentNames) {
  $originalEnvironment[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
}

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$root = Join-Path $tempBase ("ise launcher tests {0}" -f [guid]::NewGuid())
$database = Join-Path $root 'data\agent.sqlite'
$fixturePids = [System.Collections.Generic.HashSet[int]]::new()
$failures = [System.Collections.Generic.List[string]]::new()

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-Equal {
  param($Actual, $Expected, [string]$Message)
  if (-not [object]::Equals($Actual, $Expected)) {
    throw "$Message (expected '$Expected', received '$Actual')"
  }
}

function Assert-ModelEnvironment {
  param([string]$Expected)
  foreach ($name in $modelNames) {
    Assert-Equal ([System.Environment]::GetEnvironmentVariable($name, 'Process')) $Expected "Launcher did not restore $name"
  }
}

function Assert-SecretFree {
  param($Result, [string]$Secret)
  $text = (@($Result.Output) + @($Result.Error)) -join "`n"
  Assert-True (-not $text.Contains($Secret)) 'Launcher output exposed the caller model sentinel'
}

function Get-FreePort {
  do {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
  } while ($port -eq 4444)
  return $port
}

function Get-ListenerProcessId {
  param([int]$Port)
  $connection = Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $connection) { return $null }
  return [int]$connection.OwningProcess
}

function Invoke-Launcher {
  param(
    [int]$Port,
    [string]$Mode,
    [string]$ResultPath,
    [string]$NodePath,
    [int]$StartupTimeoutSeconds = 0
  )

  $env:ISE_LAUNCHER_FIXTURE_MODE = $Mode
  $env:ISE_LAUNCHER_RESULT_PATH = $ResultPath
  $output = [System.Collections.Generic.List[string]]::new()
  $parameters = @{
    WorkingRoot = $root
    DatabasePath = $database
    Port = $Port
  }
  if ($NodePath) { $parameters.NodePath = $NodePath }
  if ($StartupTimeoutSeconds -gt 0) {
    $parameters.StartupTimeoutSeconds = $StartupTimeoutSeconds
  }

  try {
    & $launcher @parameters | ForEach-Object { [void]$output.Add([string]$_) }
    return [pscustomobject]@{ Succeeded = $true; Output = $output.ToArray(); Error = $null }
  } catch {
    return [pscustomobject]@{ Succeeded = $false; Output = $output.ToArray(); Error = $_.Exception.Message }
  }
}

function Read-FixtureResult {
  param([string]$Path)
  $deadline = [DateTime]::UtcNow.AddSeconds(3)
  while (-not (Test-Path -LiteralPath $Path -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 50
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }

  $result = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  [void]$fixturePids.Add([int]$result.pid)
  return $result
}

function Run-Test {
  param([string]$Name, [scriptblock]$Test)
  try {
    & $Test
    Write-Output "PASS $Name"
  } catch {
    [void]$failures.Add("$Name`: $($_.Exception.Message)")
    Write-Output "FAIL $Name"
  }
}

function New-OldNodeExecutable {
  param([string]$Path)
  $source = @'
using System;
public static class OldNodeFixture {
  public static int Main(string[] args) {
    if (args.Length == 1 && args[0] == "--version") {
      Console.Out.WriteLine("v20.18.9");
      Console.Error.WriteLine(Environment.GetEnvironmentVariable("ISE_LAUNCHER_SECRET_SENTINEL"));
      return 0;
    }
    return 91;
  }
}
'@
  Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $Path -OutputType ConsoleApplication
}

try {
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Launcher script does not exist' }
  if (-not (Test-Path -LiteralPath $node24 -PathType Leaf)) { throw 'Node 24 fixture runtime does not exist' }

  $agentDirectory = Join-Path $root 'agent\src'
  $tsxDirectory = Join-Path $root 'node_modules\tsx\dist'
  New-Item -ItemType Directory -Path $agentDirectory, $tsxDirectory -Force | Out-Null

  $utf8 = [System.Text.UTF8Encoding]::new($false)
  $loader = @'
import { pathToFileURL } from 'node:url';
await import(pathToFileURL(process.argv[2]).href);
'@
  [System.IO.File]::WriteAllText((Join-Path $tsxDirectory 'cli.mjs'), $loader, $utf8)

  $entrypoint = @'
import fs from 'node:fs';
import net from 'node:net';

const mode = process.env.ISE_LAUNCHER_FIXTURE_MODE;
const resultPath = process.env.ISE_LAUNCHER_RESULT_PATH;
fs.writeFileSync(resultPath, JSON.stringify({
  pid: process.pid,
  execPath: process.execPath,
  modelBaseUrl: process.env.MODEL_BASE_URL ?? null,
  modelName: process.env.MODEL_NAME ?? null,
  modelApiKey: process.env.MODEL_API_KEY ?? null,
}));

if (mode === 'early-exit') process.exit(23);
if (mode === 'timeout') {
  setInterval(() => {}, 1000);
} else {
  net.createServer(() => {}).listen(Number(process.env.AGENT_PORT), '127.0.0.1');
}
'@
  [System.IO.File]::WriteAllText((Join-Path $agentDirectory 'server.ts'), $entrypoint, $utf8)

  $source = Get-Content -Raw -LiteralPath $launcher
  Run-Test 'dry run is prompt-free and side-effect-free' {
    Assert-True ($source -notmatch 'Read-Host|PromptForChoice') 'Default launcher must not prompt'
    foreach ($name in $modelNames) {
      Assert-True ($source -match ('Remove-Item\s+(?:-LiteralPath\s+)?[''"]?Env:{0}' -f $name)) "Launcher must explicitly remove $name"
    }

    $sentinel = [guid]::NewGuid().ToString()
    foreach ($name in $modelNames) { [System.Environment]::SetEnvironmentVariable($name, $sentinel, 'Process') }
    $dryDatabase = Join-Path $root 'dry-run.sqlite'
    $output = @(& $launcher -WorkingRoot $root -DatabasePath $dryDatabase -Port (Get-FreePort) -DryRun)
    Assert-True ($output -contains 'MODEL_CONFIG_SOURCE=persisted') 'Missing persisted source marker'
    Assert-True ($output -contains 'MODEL_API_KEY=unset') 'Model key must be unset'
    Assert-True ($output -contains 'DRY_RUN=yes') 'Missing dry-run marker'
    Assert-True (-not (Test-Path -LiteralPath $dryDatabase)) 'Dry run created the database'
    Assert-ModelEnvironment $sentinel
  }

  Run-Test 'successful child receives no model environment and owns readiness' {
    $sentinel = [guid]::NewGuid().ToString()
    $env:ISE_LAUNCHER_SECRET_SENTINEL = $sentinel
    foreach ($name in $modelNames) { [System.Environment]::SetEnvironmentVariable($name, $sentinel, 'Process') }
    $port = Get-FreePort
    $resultPath = Join-Path $root 'success.json'
    $launch = Invoke-Launcher -Port $port -Mode 'success' -ResultPath $resultPath
    $child = Read-FixtureResult $resultPath
    $owner = Get-ListenerProcessId $port

    Assert-True $launch.Succeeded "Launcher failed: $($launch.Error)"
    Assert-True ($null -ne $child) 'Fixture child did not write its result'
    Assert-Equal $child.modelBaseUrl $null 'Child inherited MODEL_BASE_URL'
    Assert-Equal $child.modelName $null 'Child inherited MODEL_NAME'
    Assert-Equal $child.modelApiKey $null 'Child inherited MODEL_API_KEY'
    Assert-ModelEnvironment $sentinel
    Assert-SecretFree $launch $sentinel
    Assert-Equal $owner ([int]$child.pid) 'Listening socket is not owned by the spawned child'
    Assert-True ($launch.Output -contains "AGENT_PROCESS_ID=$($child.pid)") 'Readiness output does not identify the spawned child'
  }

  Run-Test 'pre-existing listener rejects before child spawn' {
    $port = Get-FreePort
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    $listener.Start()
    try {
      $resultPath = Join-Path $root 'collision.json'
      $launch = Invoke-Launcher -Port $port -Mode 'success' -ResultPath $resultPath
      [void](Read-FixtureResult $resultPath)
      Assert-True (-not $launch.Succeeded) 'Port collision unexpectedly reported readiness'
      Assert-Equal $launch.Error 'AGENT_PORT_IN_USE' 'Port collision did not use the stable error'
      Assert-True (-not (Test-Path -LiteralPath $resultPath)) 'Port collision spawned the Agent child'
    } finally {
      $listener.Stop()
    }
  }

  Run-Test 'wildcard listener rejects before child spawn' {
    $port = Get-FreePort
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
    $listener.Start()
    try {
      $resultPath = Join-Path $root 'wildcard-collision.json'
      $launch = Invoke-Launcher -Port $port -Mode 'success' -ResultPath $resultPath
      [void](Read-FixtureResult $resultPath)
      Assert-True (-not $launch.Succeeded) 'Wildcard port collision unexpectedly reported readiness'
      Assert-Equal $launch.Error 'AGENT_PORT_IN_USE' 'Wildcard port collision did not use the stable error'
      Assert-True (-not (Test-Path -LiteralPath $resultPath)) 'Wildcard port collision spawned the Agent child'
    } finally {
      $listener.Stop()
    }
  }

  $oldNode = Join-Path $root 'old node.exe'
  New-OldNodeExecutable $oldNode
  Run-Test 'explicit Node below 20.19 is rejected without leaking diagnostics' {
    $sentinel = [guid]::NewGuid().ToString()
    $env:ISE_LAUNCHER_SECRET_SENTINEL = $sentinel
    $port = Get-FreePort
    $resultPath = Join-Path $root 'old-explicit.json'
    $launch = Invoke-Launcher -Port $port -Mode 'success' -ResultPath $resultPath -NodePath $oldNode
    Assert-True (-not $launch.Succeeded) 'Unsupported explicit Node started the Agent'
    Assert-Equal $launch.Error 'AGENT_NODE_VERSION_UNSUPPORTED' 'Unsupported explicit Node did not use the stable error'
    Assert-True (-not (Test-Path -LiteralPath $resultPath)) 'Unsupported explicit Node spawned the Agent child'
    Assert-SecretFree $launch $sentinel
  }

  $dynamicNodeDirectory = Join-Path $root '.runtime\node-v24.99.1-win-x64'
  New-Item -ItemType Directory -Path $dynamicNodeDirectory -Force | Out-Null
  $dynamicNode = Join-Path $dynamicNodeDirectory 'node.exe'
  Copy-Item -LiteralPath $oldNode -Destination $dynamicNode -Force
  Run-Test 'discovered Node is version-checked despite its directory name' {
    $port = Get-FreePort
    $resultPath = Join-Path $root 'old-discovered.json'
    $launch = Invoke-Launcher -Port $port -Mode 'success' -ResultPath $resultPath
    [void](Read-FixtureResult $resultPath)
    Assert-True (-not $launch.Succeeded) 'Unsupported discovered Node started the Agent'
    Assert-Equal $launch.Error 'AGENT_NODE_VERSION_UNSUPPORTED' 'Unsupported discovered Node did not use the stable error'
    Assert-True (-not (Test-Path -LiteralPath $resultPath)) 'Unsupported discovered Node spawned the Agent child'
  }

  Copy-Item -LiteralPath $node24 -Destination $dynamicNode -Force
  Run-Test 'variable Node 24 patch directory and paths with spaces are supported' {
    $port = Get-FreePort
    $resultPath = Join-Path $root 'dynamic-node.json'
    $launch = Invoke-Launcher -Port $port -Mode 'success' -ResultPath $resultPath
    $child = Read-FixtureResult $resultPath
    Assert-True $launch.Succeeded "Dynamic Node launcher failed: $($launch.Error)"
    Assert-True ($null -ne $child) 'Dynamic Node child did not write its result'
    Assert-Equal ([System.IO.Path]::GetFullPath($child.execPath).ToLowerInvariant()) ([System.IO.Path]::GetFullPath($dynamicNode).ToLowerInvariant()) 'Launcher did not select the variable Node 24 patch directory'
  }

  Run-Test 'early child exit is stable, secret-free, and restores caller environment' {
    $sentinel = [guid]::NewGuid().ToString()
    $env:ISE_LAUNCHER_SECRET_SENTINEL = $sentinel
    foreach ($name in $modelNames) { [System.Environment]::SetEnvironmentVariable($name, $sentinel, 'Process') }
    $port = Get-FreePort
    $resultPath = Join-Path $root 'early-exit.json'
    $launch = Invoke-Launcher -Port $port -Mode 'early-exit' -ResultPath $resultPath
    $child = Read-FixtureResult $resultPath
    Assert-True (-not $launch.Succeeded) 'Early child exit unexpectedly reported readiness'
    Assert-Equal $launch.Error 'AGENT_START_FAILED' 'Early child exit did not use the stable error'
    Assert-ModelEnvironment $sentinel
    Assert-SecretFree $launch $sentinel
    if ($null -ne $child) {
      Assert-True ($null -eq (Get-Process -Id ([int]$child.pid) -ErrorAction SilentlyContinue)) 'Early-exit child is still running'
    }
  }

  Run-Test 'timeout stops its child and restores caller environment' {
    $sentinel = [guid]::NewGuid().ToString()
    $env:ISE_LAUNCHER_SECRET_SENTINEL = $sentinel
    foreach ($name in $modelNames) { [System.Environment]::SetEnvironmentVariable($name, $sentinel, 'Process') }
    $port = Get-FreePort
    $resultPath = Join-Path $root 'timeout.json'
    $launch = Invoke-Launcher -Port $port -Mode 'timeout' -ResultPath $resultPath -StartupTimeoutSeconds 1
    $child = Read-FixtureResult $resultPath
    Assert-True (-not $launch.Succeeded) 'Timeout unexpectedly reported readiness'
    Assert-Equal $launch.Error 'AGENT_LISTEN_TIMEOUT' 'Timeout did not use the stable error'
    Assert-True ($null -ne $child) 'Timeout child never started'
    Assert-True ($null -eq (Get-Process -Id ([int]$child.pid) -ErrorAction SilentlyContinue)) 'Timed-out child is still running'
    Assert-ModelEnvironment $sentinel
    Assert-SecretFree $launch $sentinel
  }

  if ($failures.Count -gt 0) {
    throw ("start-agent tests failed ({0}):`n{1}" -f $failures.Count, ($failures -join "`n"))
  }

  Write-Output 'start-agent tests passed'
} finally {
  foreach ($pidValue in $fixturePids) {
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    $processRecord = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
    if ($null -ne $process -and $null -ne $processRecord -and ([string]$processRecord.CommandLine).Contains($root)) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $pidValue -ErrorAction SilentlyContinue
    }
  }
  foreach ($name in $testEnvironmentNames) {
    [System.Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
  }
  if ((Test-Path -LiteralPath $root) -and $root.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $root -Recurse -Force
  }
}
