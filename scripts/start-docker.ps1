[CmdletBinding()]
param(
  [string]$WorkingRoot = '',
  [string]$LegacyAgentDatabasePath = '',
  [ValidateRange(30, 900)]
  [int]$StartupTimeoutSeconds = 300,
  [switch]$SkipBuild,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = if ([string]::IsNullOrWhiteSpace($WorkingRoot)) {
  [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
} else {
  [System.IO.Path]::GetFullPath($WorkingRoot)
}
$runtimeRoot = Join-Path $root '.ise'
$environmentPath = Join-Path $runtimeRoot 'docker.env'
$secretDirectory = Join-Path $runtimeRoot 'docker-secrets'
$credentialKeyPath = Join-Path $secretDirectory 'agent-model-key'
$agentDataDirectory = Join-Path $runtimeRoot 'agent-data'
$agentDatabasePath = Join-Path $agentDataDirectory 'agent.sqlite'
$legacyDatabase = if ([string]::IsNullOrWhiteSpace($LegacyAgentDatabasePath)) {
  Join-Path $runtimeRoot 'agent.sqlite'
} else {
  [System.IO.Path]::GetFullPath($LegacyAgentDatabasePath)
}
$composePath = Join-Path $root 'compose.yaml'

function Get-ContainerInspect {
  param([string]$Name)
  $json = & docker inspect $Name 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
  return @($json | ConvertFrom-Json)[0]
}

function Get-ContainerEnvironmentValue {
  param($Inspect, [string]$Name)
  if ($null -eq $Inspect) { return $null }
  $prefix = "$Name="
  $entry = @($Inspect.Config.Env) |
    Where-Object { ([string]$_).StartsWith($prefix, [System.StringComparison]::Ordinal) } |
    Select-Object -First 1
  if ($null -eq $entry) { return $null }
  return ([string]$entry).Substring($prefix.Length)
}

function Get-ComposeLabel {
  param($Inspect)
  if ($null -eq $Inspect -or $null -eq $Inspect.Config.Labels) { return $null }
  $property = $Inspect.Config.Labels.PSObject.Properties['com.docker.compose.project']
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Assert-LegacyVolume {
  param($Inspect, [string]$ExpectedVolume, [string]$ExpectedDestination)
  if ($null -eq $Inspect -or (Get-ComposeLabel $Inspect)) { return }
  $mount = @($Inspect.Mounts) |
    Where-Object { $_.Type -eq 'volume' -and $_.Destination -eq $ExpectedDestination } |
    Select-Object -First 1
  if ($null -eq $mount -or $mount.Name -ne $ExpectedVolume) {
    throw "LEGACY_CONTAINER_VOLUME_MISMATCH_$ExpectedVolume"
  }
}

function New-RandomBase64 {
  param([int]$ByteCount)
  $bytes = New-Object byte[] $ByteCount
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($bytes) } finally { $random.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

function Use-ValueOrDefault {
  param($Value, $DefaultValue)
  if ($null -eq $Value -or [string]::IsNullOrEmpty([string]$Value)) { return $DefaultValue }
  return $Value
}

function ConvertFrom-SecureInput {
  param([Security.SecureString]$Value)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Read-DockerEnvironment {
  param([string]$Path)
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $values }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    $separator = $line.IndexOf('=')
    if ($separator -le 0) { throw 'DOCKER_ENV_INVALID' }
    $name = $line.Substring(0, $separator)
    $value = $line.Substring($separator + 1)
    if ($value.Length -ge 2 -and $value[0] -eq "'" -and $value[$value.Length - 1] -eq "'") {
      $value = $value.Substring(1, $value.Length - 2).Replace("\'", "'").Replace('\\', '\')
    }
    $values[$name] = $value
  }
  return $values
}

function ConvertTo-DockerEnvironmentLine {
  param([string]$Name, [string]$Value)
  if ($Value.Contains("`r") -or $Value.Contains("`n")) { throw "DOCKER_ENV_VALUE_INVALID_$Name" }
  $escaped = $Value.Replace('\', '\\').Replace("'", "\'")
  return "$Name='$escaped'"
}

function Write-DockerEnvironment {
  param([string]$Path, [hashtable]$Values)
  $orderedNames = @(
    'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_PASSWORD_URLENCODED', 'POSTGRES_DB',
    'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'JWT_SECRET', 'MAIL_PASS', 'PUBLIC_MAPBOX_TOKEN'
  )
  $lines = foreach ($name in $orderedNames) {
    ConvertTo-DockerEnvironmentLine $name ([string]$Values[$name])
  }
  $encoding = New-Object System.Text.UTF8Encoding($false)
  $temporary = "$Path.tmp"
  [System.IO.File]::WriteAllLines($temporary, $lines, $encoding)
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-NodeExecutable {
  $candidates = [System.Collections.Generic.List[string]]::new()
  [void]$candidates.Add((Join-Path $HOME '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'))
  $pathNode = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $pathNode) { [void]$candidates.Add($pathNode.Source) }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
  }
  throw 'NODE_NOT_FOUND'
}

function Get-HostTsxCli {
  $candidates = [System.Collections.Generic.List[string]]::new()
  [void]$candidates.Add((Join-Path $root 'node_modules\tsx\dist\cli.mjs'))
  try {
    $commonGitDirectory = (& git -C $root rev-parse --path-format=absolute --git-common-dir 2>$null).Trim()
    if ($commonGitDirectory) {
      $commonRoot = Split-Path $commonGitDirectory -Parent
      [void]$candidates.Add((Join-Path $commonRoot 'node_modules\tsx\dist\cli.mjs'))
    }
  } catch {}
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  throw 'HOST_TSX_NOT_FOUND'
}

function Stop-IseHostListener {
  param([int]$Port, [string]$Pattern)
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $listener) { return }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if ($process.Name -eq 'com.docker.backend.exe') { return }
  if (([string]$process.CommandLine) -notmatch $Pattern) { throw "PORT_${Port}_NOT_ISE" }

  $processes = [System.Collections.Generic.List[object]]::new()
  [void]$processes.Add($process)
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)" -ErrorAction SilentlyContinue
  if ($null -ne $parent -and ([string]$parent.CommandLine) -match 'E:\\Github\\ISE|tsx\\dist\\cli|rsbuild|nest') {
    [void]$processes.Add($parent)
  }
  foreach ($item in $processes) {
    Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
  }
}

function Remove-VerifiedLegacyContainer {
  param($Inspect, [string]$Name)
  if ($null -eq $Inspect -or (Get-ComposeLabel $Inspect)) { return }
  & docker stop $Name | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "LEGACY_CONTAINER_STOP_FAILED_$Name" }
  & docker rm $Name | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "LEGACY_CONTAINER_REMOVE_FAILED_$Name" }
}

if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) { throw 'COMPOSE_FILE_MISSING' }
& docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'DOCKER_UNAVAILABLE' }
& docker compose version --short | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'DOCKER_COMPOSE_UNAVAILABLE' }

$postgresInspect = Get-ContainerInspect 'ise-postgres'
$minioInspect = Get-ContainerInspect 'ise-minio'
Assert-LegacyVolume $postgresInspect 'ise-postgres-data' '/var/lib/postgresql/data'
Assert-LegacyVolume $minioInspect 'ise-minio-data' '/data'

$values = Read-DockerEnvironment $environmentPath
if (-not $values.ContainsKey('POSTGRES_USER')) {
  $values.POSTGRES_USER = Use-ValueOrDefault (Get-ContainerEnvironmentValue $postgresInspect 'POSTGRES_USER') 'ise'
  $values.POSTGRES_PASSWORD = Use-ValueOrDefault (Get-ContainerEnvironmentValue $postgresInspect 'POSTGRES_PASSWORD') (New-RandomBase64 36)
  $values.POSTGRES_DB = Use-ValueOrDefault (Get-ContainerEnvironmentValue $postgresInspect 'POSTGRES_DB') 'ise'
  $values.MINIO_ROOT_USER = Use-ValueOrDefault (Get-ContainerEnvironmentValue $minioInspect 'MINIO_ROOT_USER') 'iseadmin'
  $values.MINIO_ROOT_PASSWORD = Use-ValueOrDefault (Get-ContainerEnvironmentValue $minioInspect 'MINIO_ROOT_PASSWORD') (New-RandomBase64 36)
  $values.JWT_SECRET = New-RandomBase64 48
  $values.MAIL_PASS = New-RandomBase64 32
}
$values.POSTGRES_PASSWORD_URLENCODED = [uri]::EscapeDataString([string]$values.POSTGRES_PASSWORD)
if (-not $values.ContainsKey('PUBLIC_MAPBOX_TOKEN') -or [string]::IsNullOrWhiteSpace($values.PUBLIC_MAPBOX_TOKEN)) {
  $mapbox = [Environment]::GetEnvironmentVariable('PUBLIC_MAPBOX_TOKEN', 'Process')
  $values.PUBLIC_MAPBOX_TOKEN = if ([string]::IsNullOrWhiteSpace($mapbox)) { '' } else { $mapbox }
}

if ($DryRun) {
  Write-Output 'DOCKER_RUNTIME_DRY_RUN=ok'
  Write-Output "COMPOSE_FILE=$composePath"
  Write-Output "DOCKER_ENV_PRESENT=$([bool](Test-Path -LiteralPath $environmentPath))"
  Write-Output "AGENT_KEY_PRESENT=$([bool](Test-Path -LiteralPath $credentialKeyPath))"
  return
}

New-Item -ItemType Directory -Path $runtimeRoot, $secretDirectory, $agentDataDirectory -Force | Out-Null
Write-DockerEnvironment $environmentPath $values
if (-not (Test-Path -LiteralPath $credentialKeyPath -PathType Leaf)) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($credentialKeyPath, (New-RandomBase64 32), $encoding)
}

Stop-IseHostListener 3333 'dist[\\/]main\.js|nest\.js.*start'
Stop-IseHostListener 4444 'agent[\\/]src[\\/]server\.ts'
Stop-IseHostListener 9999 'rsbuild'

if (-not (Test-Path -LiteralPath $agentDatabasePath -PathType Leaf) -and (Test-Path -LiteralPath $legacyDatabase -PathType Leaf)) {
  Copy-Item -LiteralPath $legacyDatabase -Destination $agentDatabasePath
}
if (Test-Path -LiteralPath $agentDatabasePath -PathType Leaf) {
  $node = Get-NodeExecutable
  $tsx = Get-HostTsxCli
  $previousDatabase = [Environment]::GetEnvironmentVariable('AGENT_DB_PATH', 'Process')
  $previousKeyFile = [Environment]::GetEnvironmentVariable('AGENT_CREDENTIAL_KEY_FILE', 'Process')
  try {
    $env:AGENT_DB_PATH = $agentDatabasePath
    $env:AGENT_CREDENTIAL_KEY_FILE = $credentialKeyPath
    & $node $tsx (Join-Path $root 'agent\src\cli\migrateCredentialStore.ts')
    if ($LASTEXITCODE -ne 0) { throw 'AGENT_CREDENTIAL_MIGRATION_FAILED' }
  } finally {
    [Environment]::SetEnvironmentVariable('AGENT_DB_PATH', $previousDatabase, 'Process')
    [Environment]::SetEnvironmentVariable('AGENT_CREDENTIAL_KEY_FILE', $previousKeyFile, 'Process')
  }
}

Remove-VerifiedLegacyContainer $postgresInspect 'ise-postgres'
Remove-VerifiedLegacyContainer $minioInspect 'ise-minio'

$composeArguments = @('compose', '--env-file', $environmentPath, '-f', $composePath, 'up', '-d')
if (-not $SkipBuild) { $composeArguments += '--build' }
& docker @composeArguments
if ($LASTEXITCODE -ne 0) { throw 'DOCKER_COMPOSE_UP_FAILED' }

$expectedContainers = @('ise-postgres', 'ise-minio', 'ise-api', 'ise-agent', 'ise-web')
$deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
do {
  $ready = $true
  foreach ($containerName in $expectedContainers) {
    $inspect = Get-ContainerInspect $containerName
    $health = if ($null -ne $inspect -and $null -ne $inspect.State.Health) { [string]$inspect.State.Health.Status } else { '' }
    if ($health -ne 'healthy') { $ready = $false; break }
  }
  if (-not $ready) { Start-Sleep -Milliseconds 750 }
} while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
if (-not $ready) { throw 'DOCKER_RUNTIME_UNHEALTHY' }

Write-Output 'DOCKER_RUNTIME_HEALTHY=ok'
Write-Output 'WEB_URL=http://127.0.0.1:9999'
Write-Output 'API_URL=http://127.0.0.1:3333'
Write-Output 'AGENT_URL=http://127.0.0.1:4444'
