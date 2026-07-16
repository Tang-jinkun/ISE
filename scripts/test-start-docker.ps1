[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$launcher = Join-Path $PSScriptRoot 'start-docker.ps1'
$compose = Join-Path (Split-Path $PSScriptRoot -Parent) 'compose.yaml'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ise docker launcher {0}" -f [guid]::NewGuid())
$fakeBin = Join-Path $tempRoot 'bin'
$failures = [System.Collections.Generic.List[string]]::new()
$originalPath = $env:Path
$originalMapbox = [Environment]::GetEnvironmentVariable('PUBLIC_MAPBOX_TOKEN', 'Process')

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

try {
  New-Item -ItemType Directory -Path $fakeBin -Force | Out-Null
  Copy-Item -LiteralPath $compose -Destination (Join-Path $tempRoot 'compose.yaml')
  $fakeDocker = @'
@echo off
if "%1"=="version" (
  echo 27.0.0
  exit /b 0
)
if "%1"=="compose" if "%2"=="version" (
  echo 2.29.0
  exit /b 0
)
if "%1"=="inspect" exit /b 1
exit /b 0
'@
  [System.IO.File]::WriteAllText(
    (Join-Path $fakeBin 'docker.cmd'),
    $fakeDocker,
    [System.Text.Encoding]::ASCII
  )
  $env:Path = "$fakeBin;$originalPath"

  Run-Test 'dry run is prompt-free and side-effect-free' {
    $sentinel = 'pk.test.public-mapbox-token'
    $env:PUBLIC_MAPBOX_TOKEN = $sentinel
    $output = @(& $launcher -WorkingRoot $tempRoot -DryRun)
    Assert-True ($output -contains 'DOCKER_RUNTIME_DRY_RUN=ok') 'Missing dry-run success marker'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $tempRoot '.ise'))) 'Dry run created runtime state'
    Assert-True (-not (($output -join "`n").Contains($sentinel))) 'Dry run exposed the Mapbox token'
  }

  Run-Test 'missing Mapbox token uses the runtime fallback without mutation' {
    Remove-Item Env:PUBLIC_MAPBOX_TOKEN -ErrorAction SilentlyContinue
    $output = @(& $launcher -WorkingRoot $tempRoot -DryRun)
    Assert-True ($output -contains 'DOCKER_RUNTIME_DRY_RUN=ok') 'Tokenless fallback did not pass dry run'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $tempRoot '.ise'))) 'Dry run created runtime state'
  }

  Run-Test 'launcher never deletes named volumes' {
    $source = Get-Content -Raw -LiteralPath $launcher
    Assert-True ($source -notmatch 'docker\s+volume\s+(?:rm|prune)') 'Launcher contains a destructive volume command'
    Assert-True ($source -match 'Assert-LegacyVolume\s+\$postgresInspect\s+''ise-postgres-data''') 'Postgres volume guard is missing'
    Assert-True ($source -match 'Assert-LegacyVolume\s+\$minioInspect\s+''ise-minio-data''') 'MinIO volume guard is missing'
  }

  Run-Test 'compose declares complete loopback runtime' {
    $source = Get-Content -Raw -LiteralPath $compose
    foreach ($service in 'postgres', 'minio', 'api', 'agent', 'web') {
      Assert-True ($source -match "(?m)^  $service`:") "Compose service is missing: $service"
    }
    foreach ($port in 55432, 9000, 9001, 3333, 4444, 9999) {
      Assert-True ($source -match "127\.0\.0\.1`:$port`:") "Loopback port is missing: $port"
    }
    Assert-True ($source -match '(?s)postgres-data:.*external:\s*true.*name:\s*ise-postgres-data') 'Postgres external volume is missing'
    Assert-True ($source -match '(?s)minio-data:.*external:\s*true.*name:\s*ise-minio-data') 'MinIO external volume is missing'
  }

  if ($failures.Count -gt 0) {
    throw ("start-docker tests failed ({0}):`n{1}" -f $failures.Count, ($failures -join "`n"))
  }
  Write-Output 'start-docker tests passed'
} finally {
  $env:Path = $originalPath
  [Environment]::SetEnvironmentVariable('PUBLIC_MAPBOX_TOKEN', $originalMapbox, 'Process')
  if ((Test-Path -LiteralPath $tempRoot) -and $tempRoot.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
