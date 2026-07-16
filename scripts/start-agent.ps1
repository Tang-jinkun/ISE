[CmdletBinding()]
param(
  [string]$WorkingRoot = (Split-Path $PSScriptRoot -Parent),
  [string]$DatabasePath = '.ise\agent.sqlite',
  [ValidateRange(1, 65535)]
  [int]$Port = 4444,
  [string]$NodePath,
  [ValidateRange(1, 300)]
  [int]$StartupTimeoutSeconds = 30,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath($WorkingRoot)
$database = if ([System.IO.Path]::IsPathRooted($DatabasePath)) {
  [System.IO.Path]::GetFullPath($DatabasePath)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $root $DatabasePath))
}
$hostAddress = '127.0.0.1'
$nestBaseUrl = 'http://127.0.0.1:3333'

Write-Output 'MODEL_CONFIG_SOURCE=persisted'
Write-Output 'MODEL_BASE_URL=unset'
Write-Output 'MODEL_NAME=unset'
Write-Output 'MODEL_API_KEY=unset'
Write-Output "AGENT_HOST=$hostAddress"
Write-Output "AGENT_PORT=$Port"
Write-Output "AGENT_DB_PATH=$database"
Write-Output "NEST_API_BASE_URL=$nestBaseUrl"

if ($DryRun) {
  Write-Output 'DRY_RUN=yes'
  return
}

function Get-ListeningProcessId {
  param([string]$Address, [int]$LocalPort)

  $connection = Get-NetTCPConnection `
    -State Listen `
    -LocalPort $LocalPort `
    -ErrorAction SilentlyContinue | Where-Object {
      $_.LocalAddress -in @($Address, '0.0.0.0', '::')
    } |
    Select-Object -First 1
  if ($null -eq $connection) { return $null }
  return [int]$connection.OwningProcess
}

function Get-NodeExecutable {
  param([string]$RepositoryRoot, [string]$ExplicitPath)

  if ($ExplicitPath) {
    $explicitNode = [System.IO.Path]::GetFullPath($ExplicitPath)
    if (-not (Test-Path -LiteralPath $explicitNode -PathType Leaf)) { throw 'AGENT_NODE_NOT_FOUND' }
    return $explicitNode
  }

  $candidates = [System.Collections.Generic.List[string]]::new()
  foreach ($runtimeDirectory in '.runtime', '.tools') {
    $runtimeRoot = Join-Path $RepositoryRoot $runtimeDirectory
    if (-not (Test-Path -LiteralPath $runtimeRoot -PathType Container)) { continue }

    Get-ChildItem -LiteralPath $runtimeRoot -Directory -Filter 'node-v24*-win-x64' -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { [void]$candidates.Add((Join-Path $_.FullName 'node.exe')) }
  }
  [void]$candidates.Add((Join-Path $HOME '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'))

  $pathNode = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $pathNode) { [void]$candidates.Add($pathNode.Source) }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }
  throw 'AGENT_NODE_NOT_FOUND'
}

function Assert-SupportedNode {
  param([string]$Executable)

  try {
    $versionText = (@(& $Executable '--version' 2>$null) -join '').Trim()
    $exitCode = $LASTEXITCODE
  } catch {
    throw 'AGENT_NODE_VERSION_UNSUPPORTED'
  }
  if ($exitCode -ne 0 -or $versionText -notmatch '^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$') {
    throw 'AGENT_NODE_VERSION_UNSUPPORTED'
  }

  $version = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
  if ($version -lt [version]'20.19.0') { throw 'AGENT_NODE_VERSION_UNSUPPORTED' }
}

function Close-AgentProcess {
  param([System.Diagnostics.Process]$Process, [switch]$Stop)

  try {
    if ($Stop -and -not $Process.HasExited) { $Process.Kill() }
    $Process.WaitForExit()
  } catch {
    throw 'AGENT_PROCESS_CLEANUP_FAILED'
  } finally {
    $Process.Dispose()
  }
}

if ($null -ne (Get-ListeningProcessId -Address $hostAddress -LocalPort $Port)) {
  throw 'AGENT_PORT_IN_USE'
}

$server = Join-Path $root 'agent\src\server.ts'
$tsx = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw 'AGENT_SERVER_NOT_FOUND' }
if (-not (Test-Path -LiteralPath $tsx -PathType Leaf)) { throw 'AGENT_TSX_NOT_FOUND' }

$node = Get-NodeExecutable -RepositoryRoot $root -ExplicitPath $NodePath
Assert-SupportedNode -Executable $node

$databaseDirectory = Split-Path $database -Parent
if (-not (Test-Path -LiteralPath $databaseDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $databaseDirectory -Force | Out-Null
}

$environmentNames = @(
  'AGENT_HOST',
  'AGENT_PORT',
  'AGENT_DB_PATH',
  'AGENT_SQLITE_DRIVER',
  'NEST_API_BASE_URL',
  'MODEL_BASE_URL',
  'MODEL_NAME',
  'MODEL_API_KEY'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
  $env:AGENT_HOST = $hostAddress
  $env:AGENT_PORT = $Port.ToString()
  $env:AGENT_DB_PATH = $database
  $env:AGENT_SQLITE_DRIVER = 'sql.js'
  $env:NEST_API_BASE_URL = $nestBaseUrl
  Remove-Item Env:MODEL_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:MODEL_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue

  try {
    $agentProcess = Start-Process `
      -FilePath $node `
      -ArgumentList @(('"{0}"' -f $tsx), ('"{0}"' -f $server)) `
      -WorkingDirectory $root `
      -WindowStyle Hidden `
      -PassThru
  } catch {
    throw 'AGENT_START_FAILED'
  }
} finally {
  foreach ($name in $environmentNames) {
    [System.Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }
}

$agentProcessId = $agentProcess.Id
$deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
do {
  if ($agentProcess.HasExited) {
    Close-AgentProcess -Process $agentProcess
    throw 'AGENT_START_FAILED'
  }

  $listenerProcessId = Get-ListeningProcessId -Address $hostAddress -LocalPort $Port
  if ($null -ne $listenerProcessId) {
    if ($listenerProcessId -ne $agentProcessId) {
      Close-AgentProcess -Process $agentProcess -Stop
      throw 'AGENT_PORT_IN_USE'
    }

    $agentProcess.Dispose()
    Write-Output "AGENT_PROCESS_ID=$agentProcessId"
    Write-Output "AGENT_${Port}_LISTENING=ok"
    return
  }

  Start-Sleep -Milliseconds 200
} while ([DateTime]::UtcNow -lt $deadline)

Close-AgentProcess -Process $agentProcess -Stop
throw 'AGENT_LISTEN_TIMEOUT'
