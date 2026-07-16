[CmdletBinding()]
param(
  [string]$WorkingRoot = (Split-Path $PSScriptRoot -Parent),
  [string]$DatabasePath = '.ise\agent.sqlite',
  [ValidateRange(1, 65535)]
  [int]$Port = 4444,
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

$server = Join-Path $root 'agent\src\server.ts'
$tsx = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw 'AGENT_SERVER_NOT_FOUND' }
if (-not (Test-Path -LiteralPath $tsx -PathType Leaf)) { throw 'AGENT_TSX_NOT_FOUND' }

$nodeCandidates = @(
  (Join-Path $root '.runtime\node-v24.14.0-win-x64\node.exe'),
  (Join-Path $root '.tools\node-v24.14.0-win-x64\node.exe'),
  (Join-Path $HOME '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
)
$node = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $node) {
  $node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
}

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

  $agentProcess = Start-Process `
    -FilePath $node `
    -ArgumentList @(('"{0}"' -f $tsx), ('"{0}"' -f $server)) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru
} finally {
  foreach ($name in $environmentNames) {
    [System.Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }
}

$deadline = [DateTime]::UtcNow.AddSeconds(30)
do {
  if ($agentProcess.HasExited) { throw 'AGENT_START_FAILED' }

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $client.Connect($hostAddress, $Port)
    Write-Output "AGENT_${Port}_LISTENING=ok"
    return
  } catch [System.Net.Sockets.SocketException] {
    Start-Sleep -Milliseconds 200
  } finally {
    $client.Dispose()
  }
} while ([DateTime]::UtcNow -lt $deadline)

throw 'AGENT_LISTEN_TIMEOUT'
