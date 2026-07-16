[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$launcher = Join-Path $PSScriptRoot 'start-agent.ps1'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw 'Launcher script does not exist'
}

$root = Split-Path $PSScriptRoot -Parent
$database = Join-Path ([System.IO.Path]::GetTempPath()) ("ise-agent-launcher-{0}.sqlite" -f [guid]::NewGuid())
$source = Get-Content -Raw -LiteralPath $launcher

if ($source -match 'Read-Host|PromptForChoice') {
  throw 'Default launcher must not prompt'
}
if ($source -match 'Stop-Process') {
  throw 'Launcher must not stop processes'
}

$dryRunGuard = $source.IndexOf('if ($DryRun)', [System.StringComparison]::Ordinal)
$dryRunReturn = if ($dryRunGuard -ge 0) {
  $source.IndexOf('return', $dryRunGuard, [System.StringComparison]::Ordinal)
} else {
  -1
}
$startProcess = $source.IndexOf('Start-Process', [System.StringComparison]::Ordinal)
if ($dryRunGuard -lt 0 -or $dryRunReturn -lt 0 -or $startProcess -lt $dryRunReturn) {
  throw 'Dry run must return before process startup'
}

foreach ($name in 'MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_API_KEY') {
  if ($source -notmatch ('Remove-Item\s+(?:-LiteralPath\s+)?[''"]?Env:{0}' -f $name)) {
    throw "Launcher must explicitly remove $name"
  }
}

$ambientSentinel = [guid]::Empty.ToString()
$env:MODEL_BASE_URL = $ambientSentinel
$env:MODEL_NAME = $ambientSentinel
$env:MODEL_API_KEY = $ambientSentinel

$output = @(& $launcher -WorkingRoot $root -DatabasePath $database -Port 4544 -DryRun)

if ($output -notcontains 'MODEL_CONFIG_SOURCE=persisted') { throw 'Missing persisted source marker' }
if ($output -notcontains 'MODEL_BASE_URL=unset') { throw 'Model base URL must be unset' }
if ($output -notcontains 'MODEL_NAME=unset') { throw 'Model name must be unset' }
if ($output -notcontains 'MODEL_API_KEY=unset') { throw 'Model key must be unset' }
if ($output -notcontains 'DRY_RUN=yes') { throw 'Missing dry-run marker' }
if ($output -notcontains 'AGENT_PORT=4544') { throw 'Dry run must report the requested port' }
if ($output -notcontains "AGENT_DB_PATH=$database") { throw 'Dry run must report the persistent database path' }
if (Test-Path -LiteralPath $database) { throw 'Dry run must not create the database' }
if ($env:MODEL_API_KEY -ne $ambientSentinel) { throw 'Dry run must not mutate the caller environment' }

Write-Output 'start-agent tests passed'
