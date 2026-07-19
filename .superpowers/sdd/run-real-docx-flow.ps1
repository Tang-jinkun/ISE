[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$ApiBaseUrl = 'http://127.0.0.1:3333',
  [string]$AgentBaseUrl = 'http://127.0.0.1:4444',
  [string]$SourceDocxPath = '',
  [string]$OutputDirectory = '',
  [switch]$GenericMode,
  [switch]$StartEndScenario,
  [switch]$SkipActualSchemaValidation,
  [ValidateRange(1, 30)][int]$PollIntervalSeconds = 2,
  [ValidateRange(30, 3600)][int]$DraftTimeoutSeconds = 900,
  [ValidateRange(30, 3600)][int]$CompileTimeoutSeconds = 1200
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:HttpClient = $null
$script:LocationPushed = $false
$script:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Fail-Flow {
  param([string]$Code, [string]$Message)
  throw "$Code`: $Message"
}

function Get-PropertyValue {
  param($InputObject, [string]$Name)
  if ($null -eq $InputObject) { return $null }
  if ($InputObject -is [System.Collections.IDictionary]) {
    if ($InputObject.Contains($Name)) { return $InputObject[$Name] }
    return $null
  }
  $property = $InputObject.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Require-String {
  param($Value, [string]$Code, [string]$Field)
  if (-not ($Value -is [string]) -or [string]::IsNullOrWhiteSpace($Value)) {
    Fail-Flow $Code "Missing or invalid $Field."
  }
  return [string]$Value
}

function Test-OrdinalEqual {
  param($Left, $Right)
  return ($Left -is [string] -and $Right -is [string] -and
    [string]::Equals([string]$Left, [string]$Right, [System.StringComparison]::Ordinal))
}

function New-OrdinalStringSet {
  param($Values)
  $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($value in @($Values)) {
    if (-not ($value -is [string]) -or [string]::IsNullOrWhiteSpace([string]$value)) { return $null }
    $null = $set.Add([string]$value)
  }
  return ,$set
}

function Test-OrdinalUnique {
  param($Values)
  $items = @($Values)
  $set = New-OrdinalStringSet $items
  return ($null -ne $set -and $set.Count -eq $items.Count)
}

function Test-OrdinalSetEqual {
  param($Left, $Right)
  $leftItems = @($Left)
  $rightItems = @($Right)
  $leftSet = New-OrdinalStringSet $leftItems
  $rightSet = New-OrdinalStringSet $rightItems
  return ($null -ne $leftSet -and $null -ne $rightSet -and
    $leftSet.Count -eq $leftItems.Count -and $rightSet.Count -eq $rightItems.Count -and
    $leftSet.SetEquals($rightSet))
}

function Test-OrdinalContains {
  param($Values, $Expected)
  foreach ($value in @($Values)) {
    if (Test-OrdinalEqual $value $Expected) { return $true }
  }
  return $false
}

function Test-SceneDataLinkTrackType {
  param($Value)
  return (Test-OrdinalEqual $Value 'data-link') -or (Test-OrdinalEqual $Value 'data_link')
}

function Require-OpaqueId {
  param($Value, [string]$Code, [string]$Field)
  $id = Require-String $Value $Code $Field
  if ($id -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') {
    Fail-Flow $Code "Invalid $Field."
  }
  return $id
}

function Require-EnvelopeData {
  param($Envelope, [string]$Code)
  $statusCode = Get-PropertyValue $Envelope 'code'
  $data = Get-PropertyValue $Envelope 'data'
  if ($null -eq $statusCode -or [int]$statusCode -lt 200 -or [int]$statusCode -ge 300 -or $null -eq $data) {
    Fail-Flow $Code 'API returned an invalid success envelope.'
  }
  return $data
}

function ConvertTo-JsonText {
  param($Value)
  return ($Value | ConvertTo-Json -Depth 100)
}

function Copy-EventUnits {
  param($EventUnits)
  $json = ConvertTo-JsonText @($EventUnits)
  $parsed = $json | ConvertFrom-Json
  return @($parsed)
}

function Parse-JsonResponse {
  param([System.Net.Http.HttpResponseMessage]$Response, [string]$Operation)
  $text = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if (-not $Response.IsSuccessStatusCode) {
    $upstreamCode = $null
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      try {
        $body = $text | ConvertFrom-Json
        $errorObject = Get-PropertyValue $body 'error'
        $candidate = Get-PropertyValue $errorObject 'code'
        if ($candidate -is [string] -and $candidate -match '^[A-Z][A-Z0-9_]{2,80}$') {
          $upstreamCode = $candidate
        }
      } catch {
        $upstreamCode = $null
      }
    }
    $status = [int]$Response.StatusCode
    if ($upstreamCode) {
      Fail-Flow $upstreamCode "$Operation failed with HTTP $status."
    }
    Fail-Flow 'REAL_DEMO_HTTP_FAILED' "$Operation failed with HTTP $status."
  }
  if ([string]::IsNullOrWhiteSpace($text)) {
    Fail-Flow 'REAL_DEMO_INVALID_JSON_RESPONSE' "$Operation returned an empty response."
  }
  try {
    return ($text | ConvertFrom-Json)
  } catch {
    Fail-Flow 'REAL_DEMO_INVALID_JSON_RESPONSE' "$Operation returned invalid JSON."
  }
}

function Join-ServiceUrl {
  param([string]$BaseUrl, [string]$Path)
  return $BaseUrl.TrimEnd('/') + '/' + $Path.TrimStart('/')
}

function Invoke-JsonRequest {
  param(
    [ValidateSet('GET', 'POST')][string]$Method,
    [string]$BaseUrl,
    [string]$Path,
    $Body,
    [string]$AccessToken,
    [string]$Operation
  )
  $request = $null
  $response = $null
  try {
    $httpMethod = if ($Method -eq 'GET') { [System.Net.Http.HttpMethod]::Get } else { [System.Net.Http.HttpMethod]::Post }
    $request = New-Object System.Net.Http.HttpRequestMessage($httpMethod, (Join-ServiceUrl $BaseUrl $Path))
    $request.Headers.Accept.Add((New-Object System.Net.Http.Headers.MediaTypeWithQualityHeaderValue('application/json')))
    if (-not [string]::IsNullOrWhiteSpace($AccessToken)) {
      $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $AccessToken)
    }
    if ($null -ne $Body) {
      $json = ConvertTo-JsonText $Body
      $request.Content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
    }
    try {
      $response = $script:HttpClient.SendAsync($request).GetAwaiter().GetResult()
    } catch {
      Fail-Flow 'REAL_DEMO_SERVICE_UNREACHABLE' "$Operation could not reach its service."
    }
    return Parse-JsonResponse $response $Operation
  } finally {
    if ($null -ne $response) { $response.Dispose() }
    if ($null -ne $request) { $request.Dispose() }
  }
}

function Invoke-DocxUpload {
  param([string]$BaseUrl, [System.IO.FileInfo]$SourceFile, [string]$AccessToken)
  $request = $null
  $response = $null
  $multipart = $null
  $stream = $null
  try {
    $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, (Join-ServiceUrl $BaseUrl '/file/upload'))
    $request.Headers.Accept.Add((New-Object System.Net.Http.Headers.MediaTypeWithQualityHeaderValue('application/json')))
    $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $AccessToken)
    $multipart = New-Object System.Net.Http.MultipartFormDataContent
    $stream = [System.IO.File]::OpenRead($SourceFile.FullName)
    $fileContent = New-Object System.Net.Http.StreamContent($stream)
    $fileContent.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    $multipart.Add($fileContent, 'file', $SourceFile.Name)
    $request.Content = $multipart
    try {
      $response = $script:HttpClient.SendAsync($request).GetAwaiter().GetResult()
    } catch {
      Fail-Flow 'REAL_DEMO_UPLOAD_UNREACHABLE' 'DOCX upload could not reach the API.'
    }
    return Parse-JsonResponse $response 'DOCX upload'
  } finally {
    if ($null -ne $response) { $response.Dispose() }
    if ($null -ne $request) { $request.Dispose() }
    elseif ($null -ne $multipart) { $multipart.Dispose() }
    elseif ($null -ne $stream) { $stream.Dispose() }
  }
}

function Assert-ServiceOrigin {
  param([string]$Value, [string]$Code, [string]$Name)
  try { $uri = New-Object System.Uri($Value, [System.UriKind]::Absolute) }
  catch { Fail-Flow $Code "$Name must be an absolute HTTP origin." }
  if (($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') -or -not [string]::IsNullOrEmpty($uri.UserInfo) -or
      -not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment) -or
      ($uri.AbsolutePath -ne '/')) {
    Fail-Flow $Code "$Name must be a credential-free HTTP origin without a path, query, or fragment."
  }
  return $uri
}

function Assert-TcpReachable {
  param([System.Uri]$Uri, [string]$Code, [string]$Name)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $port = $Uri.Port
    $task = $client.ConnectAsync($Uri.DnsSafeHost, $port)
    if (-not $task.Wait(3000) -or -not $client.Connected) {
      Fail-Flow $Code "$Name is not listening on the configured origin."
    }
  } catch {
    if ($_.Exception.Message -match '^[A-Z][A-Z0-9_]+:') { throw }
    Fail-Flow $Code "$Name is not listening on the configured origin."
  } finally {
    $client.Dispose()
  }
}

function Assert-DocxFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Fail-Flow 'REAL_DEMO_SOURCE_DOCX_MISSING' 'The required DOCX is missing from the repository root.'
  }
  $file = Get-Item -LiteralPath $Path
  if ($file.Length -lt 1 -or $file.Length -gt 26214400) {
    Fail-Flow 'REAL_DEMO_SOURCE_DOCX_SIZE_INVALID' 'The source DOCX must be between 1 and 26214400 bytes.'
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = $null
  try {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($file.FullName)
    $names = @($archive.Entries | ForEach-Object { $_.FullName })
    if ($names -notcontains '[Content_Types].xml' -or $names -notcontains 'word/document.xml') {
      Fail-Flow 'REAL_DEMO_SOURCE_DOCX_INVALID' 'The source file is not a valid DOCX package.'
    }
  } catch {
    if ($_.Exception.Message -match '^[A-Z][A-Z0-9_]+:') { throw }
    Fail-Flow 'REAL_DEMO_SOURCE_DOCX_INVALID' 'The source file is not a readable DOCX package.'
  } finally {
    if ($null -ne $archive) { $archive.Dispose() }
  }
  return $file
}

function Assert-ContractText {
  param([string]$Path, [string[]]$Needles, [string]$Code)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Fail-Flow $Code 'A required route or schema source file is missing.'
  }
  $text = [System.IO.File]::ReadAllText($Path)
  foreach ($needle in $Needles) {
    if (-not $text.Contains($needle)) {
      Fail-Flow $Code "Required contract marker is missing: $needle"
    }
  }
}

function Assert-RepositoryContracts {
  param([string]$RepoRoot)
  Assert-ContractText (Join-Path $RepoRoot 'agent/src/api/sessionRoutes.ts') @(
    "app.post('/sessions'", "app.get('/sessions/:sessionId'", "app.post('/sessions/:sessionId/attachments'",
    "app.post('/sessions/:sessionId/messages'", "app.get('/sessions/:sessionId/artifacts'"
  ) 'REAL_DEMO_AGENT_ROUTE_CONTRACT_MISMATCH'
  Assert-ContractText (Join-Path $RepoRoot 'agent/src/api/reviewRoutes.ts') @(
    "app.post('/sessions/:sessionId/reviews/:reviewId/approve'",
    "app.post('/sessions/:sessionId/event-plans/:artifactId/revisions'"
  ) 'REAL_DEMO_AGENT_REVIEW_CONTRACT_MISMATCH'
  Assert-ContractText (Join-Path $RepoRoot 'apps/api/src/modules/auth/auth.controller.ts') @(
    "@Controller('auth')", "@Post('register')"
  ) 'REAL_DEMO_API_AUTH_CONTRACT_MISMATCH'
  Assert-ContractText (Join-Path $RepoRoot 'apps/api/src/modules/file/file.controller.ts') @(
    "@Controller('file')", "@Post('upload')", "FileInterceptor('file'"
  ) 'REAL_DEMO_API_FILE_CONTRACT_MISMATCH'
  Assert-ContractText (Join-Path $RepoRoot 'apps/api/src/modules/scene/scene.controller.ts') @(
    "@Controller('scene')", '@Post()'
  ) 'REAL_DEMO_API_SCENE_CONTRACT_MISMATCH'
  Assert-ContractText (Join-Path $RepoRoot 'agent/src/contracts/artifactTypes.ts') @(
    "EVENT_PLAN_DRAFT_ARTIFACT = 'ise.event-plan-draft/v1'",
    "EVENT_PLAN_ACCEPTED_ARTIFACT = 'ise.event-plan-accepted/v1'",
    "NARRATION_PLAN_ARTIFACT = 'ise.narration-plan/v1'",
    "SCENE_BLUEPRINT_ARTIFACT = 'ise.scene-blueprint/v1'",
    "RESOLVED_SCENE_PLAN_ARTIFACT = 'ise.resolved-scene-plan/v1'",
    "CHOREOGRAPHY_PLAN_ARTIFACT = 'ise.choreography-plan/v1'",
    "COMPILED_RUNTIME_ARTIFACT = 'ise.canonical-runtime-plan/v1'"
  ) 'REAL_DEMO_ARTIFACT_CONTRACT_MISMATCH'
  Assert-ContractText (Join-Path $RepoRoot 'agent/src/contracts/narrationPlan.ts') @(
    'export const narrationPlanSchema'
  ) 'REAL_DEMO_ARTIFACT_CONTRACT_MISMATCH'
  Assert-ContractText (Join-Path $RepoRoot 'agent/src/contracts/sceneBlueprint.ts') @(
    'export const sceneBlueprintSchema'
  ) 'REAL_DEMO_ARTIFACT_CONTRACT_MISMATCH'
  Assert-ContractText (Join-Path $RepoRoot 'agent/src/contracts/resolvedScenePlan.ts') @(
    'export const resolvedScenePlanSchema'
  ) 'REAL_DEMO_ARTIFACT_CONTRACT_MISMATCH'
  Assert-ContractText (Join-Path $RepoRoot 'agent/src/contracts/choreographyPlan.ts') @(
    'export const choreographyPlanSchema'
  ) 'REAL_DEMO_ARTIFACT_CONTRACT_MISMATCH'
}

function Assert-NoSecretMaterial {
  param($Value, [string]$Label, [string]$SourceAbsolutePath)
  $forbiddenKeys = 'access_token|refresh_token|password|authorization|api[_-]?key|secret|signed[_-]?url|objectname|model[_-]?credential'
  function Visit-Value {
    param($Current)
    if ($null -eq $Current) { return }
    if ($Current -is [string]) {
      $text = [string]$Current
      if (($SourceAbsolutePath -and $text.IndexOf($SourceAbsolutePath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) -or
          $text -match '(?i)(?:^|\s)(?:[A-Z]:[\\/]|\\\\)[^\r\n]+' -or
          $text -match '(?i)https?://[^\s]+(?:x-amz-|signature=|token=|expires=)' -or
          $text -match '(?i)\bBearer\s+\S+' -or $text -match '\bsk-[A-Za-z0-9_-]{16,}\b') {
        Fail-Flow 'REAL_DEMO_SECRET_OUTPUT_REJECTED' "$Label contains forbidden secret or source-path material."
      }
      return
    }
    if ($Current -is [System.Collections.IDictionary]) {
      foreach ($key in $Current.Keys) {
        if ([string]$key -match "(?i)^(?:$forbiddenKeys)$") {
          Fail-Flow 'REAL_DEMO_SECRET_OUTPUT_REJECTED' "$Label contains a forbidden field."
        }
        Visit-Value $Current[$key]
      }
      return
    }
    if ($Current -is [System.Collections.IEnumerable] -and -not ($Current -is [string])) {
      foreach ($item in $Current) { Visit-Value $item }
      return
    }
    foreach ($property in $Current.PSObject.Properties) {
      if ($property.Name -match "(?i)^(?:$forbiddenKeys)$") {
        Fail-Flow 'REAL_DEMO_SECRET_OUTPUT_REJECTED' "$Label contains a forbidden field."
      }
      Visit-Value $property.Value
    }
  }
  Visit-Value $Value
}

function Assert-ActualArtifactSchemas {
  param(
    $EventPlan,
    $NarrationPlan,
    $SceneBlueprint,
    $ResolvedScenePlan,
    $ChoreographyPlan,
    $RuntimePlan,
    $SceneProjectConfig,
    [string]$RepoRoot
  )
  $tsxCandidates = @((Join-Path $RepoRoot 'node_modules/.bin/tsx.cmd'))
  $gitCommonDir = & git -C $RepoRoot rev-parse --path-format=absolute --git-common-dir 2>$null
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($gitCommonDir)) {
    $tsxCandidates += Join-Path (Split-Path ([string]$gitCommonDir.Trim()) -Parent) 'node_modules/.bin/tsx.cmd'
  }
  $tsx = $tsxCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($tsx)) {
    Fail-Flow 'REAL_DEMO_TSX_MISSING' 'A workspace node_modules/.bin/tsx.cmd is required for exact artifact validation.'
  }
  $payload = ConvertTo-JsonText ([ordered]@{
    eventPlan = $EventPlan
    narrationPlan = $NarrationPlan
    sceneBlueprint = $SceneBlueprint
    resolvedScenePlan = $ResolvedScenePlan
    choreographyPlan = $ChoreographyPlan
    runtimePlan = $RuntimePlan
    sceneProjectConfig = $SceneProjectConfig
  })
  $validator = @'
import { readFileSync } from 'node:fs';
import { eventPlanSchema } from './agent/src/contracts/eventPlan.ts';
import { narrationPlanSchema } from './agent/src/contracts/narrationPlan.ts';
import { sceneBlueprintSchema } from './agent/src/contracts/sceneBlueprint.ts';
import { resolvedScenePlanSchema } from './agent/src/contracts/resolvedScenePlan.ts';
import { choreographyPlanSchema } from './agent/src/contracts/choreographyPlan.ts';
import { canonicalRuntimePlanSchema } from './agent/src/contracts/runtimePlan.ts';
import { sceneProjectConfigSchema } from './packages/runtime-contracts/src/scene.ts';
const value = JSON.parse(readFileSync(0, 'utf8'));
eventPlanSchema.parse(value.eventPlan);
narrationPlanSchema.parse(value.narrationPlan);
sceneBlueprintSchema.parse(value.sceneBlueprint);
resolvedScenePlanSchema.parse(value.resolvedScenePlan);
choreographyPlanSchema.parse(value.choreographyPlan);
canonicalRuntimePlanSchema.parse(value.runtimePlan);
sceneProjectConfigSchema.parse(value.sceneProjectConfig);
'@
  $priorOutputEncoding = $OutputEncoding
  try {
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $null = $payload | & $tsx --eval $validator 2>$null
    if ($LASTEXITCODE -ne 0) {
      Fail-Flow 'REAL_DEMO_ARTIFACT_SCHEMA_INVALID' 'An export does not match the authoritative repository schema.'
    }
  } finally {
    $OutputEncoding = $priorOutputEncoding
  }
}

function Assert-CompiledCorrelation {
  param($CompiledArtifact, $AcceptedArtifact, $RevisedArtifactId)
  if ((Get-PropertyValue $CompiledArtifact 'type') -ne 'ise.canonical-runtime-plan/v1' -or
      [bool](Get-PropertyValue $CompiledArtifact 'superseded')) {
    Fail-Flow 'COMPILED_ARTIFACT_INVALID' 'The selected runtime artifact is not active and completed.'
  }
  $compiledId = Require-String (Get-PropertyValue $CompiledArtifact 'artifactId') 'COMPILED_ARTIFACT_INVALID' 'compiled artifactId'
  $acceptedId = Require-String (Get-PropertyValue $AcceptedArtifact 'artifactId') 'COMPILED_ARTIFACT_INVALID' 'accepted artifactId'
  $acceptedMetadata = Get-PropertyValue $AcceptedArtifact 'metadata'
  if ((Get-PropertyValue $AcceptedArtifact 'type') -ne 'ise.event-plan-accepted/v1' -or
      [bool](Get-PropertyValue $AcceptedArtifact 'superseded') -or
      (Get-PropertyValue $acceptedMetadata 'acceptedDraftArtifactId') -ne $RevisedArtifactId) {
    Fail-Flow 'COMPILED_ARTIFACT_INVALID' 'The accepted EventPlan does not bind to the revised draft.'
  }
  $data = Get-PropertyValue $CompiledArtifact 'data'
  $runtimePlan = Get-PropertyValue $data 'runtimePlan'
  $scene = Get-PropertyValue $data 'sceneProjectConfig'
  $metadata = Get-PropertyValue $CompiledArtifact 'metadata'
  if ((Get-PropertyValue $runtimePlan 'eventPlanArtifactId') -ne $acceptedId -or
      (Get-PropertyValue $scene 'eventPlanArtifactId') -ne $acceptedId -or
      (Get-PropertyValue $scene 'runtimePlanArtifactId') -ne $compiledId -or
      (Get-PropertyValue $metadata 'eventPlanArtifactId') -ne $acceptedId) {
    Fail-Flow 'COMPILED_ARTIFACT_INVALID' 'Compiled artifact lineage is inconsistent.'
  }
}

function Select-CorrelatedArtifacts {
  param($Artifacts, [string]$RevisedArtifactId)
  $active = @($Artifacts | Where-Object { -not [bool](Get-PropertyValue $_ 'superseded') })

  function Select-OneArtifact {
    param([string]$Type, [string]$ArtifactId, [string]$Label)
    $matches = @($active | Where-Object {
      (Get-PropertyValue $_ 'type') -eq $Type -and
      (Get-PropertyValue $_ 'artifactId') -eq $ArtifactId
    })
    if ($matches.Count -gt 1) {
      Fail-Flow 'RUN_OUTPUT_AMBIGUOUS' "More than one active $Label matches compiled metadata."
    }
    if ($matches.Count -ne 1) {
      Fail-Flow 'REAL_DEMO_FINAL_ARTIFACT_MISSING' "The active $Label referenced by compiled metadata is missing."
    }
    return $matches[0]
  }

  $acceptedMatches = @($active | Where-Object {
    $metadata = Get-PropertyValue $_ 'metadata'
    (Get-PropertyValue $_ 'type') -eq 'ise.event-plan-accepted/v1' -and
    (Get-PropertyValue $metadata 'acceptedDraftArtifactId') -eq $RevisedArtifactId
  })
  if ($acceptedMatches.Count -gt 1) {
    Fail-Flow 'RUN_OUTPUT_AMBIGUOUS' 'More than one active accepted EventPlan matches the review.'
  }
  if ($acceptedMatches.Count -ne 1) {
    Fail-Flow 'REAL_DEMO_FINAL_ARTIFACT_MISSING' 'The active accepted EventPlan is missing.'
  }
  $accepted = $acceptedMatches[0]
  $acceptedId = Require-String (Get-PropertyValue $accepted 'artifactId') 'COMPILED_ARTIFACT_INVALID' 'accepted artifactId'

  $compiledMatches = @($active | Where-Object {
    $metadata = Get-PropertyValue $_ 'metadata'
    (Get-PropertyValue $_ 'type') -eq 'ise.canonical-runtime-plan/v1' -and
    (Get-PropertyValue $metadata 'eventPlanArtifactId') -eq $acceptedId
  })
  if ($compiledMatches.Count -gt 1) {
    Fail-Flow 'RUN_OUTPUT_AMBIGUOUS' 'More than one active compiled runtime matches the accepted EventPlan.'
  }
  if ($compiledMatches.Count -ne 1) {
    Fail-Flow 'REAL_DEMO_FINAL_ARTIFACT_MISSING' 'The active compiled runtime is missing.'
  }
  $compiled = $compiledMatches[0]
  $compiledMetadata = Get-PropertyValue $compiled 'metadata'
  $narration = Select-OneArtifact 'ise.narration-plan/v1' (Require-String (Get-PropertyValue $compiledMetadata 'narrationPlanArtifactId') 'COMPILED_ARTIFACT_INVALID' 'narrationPlanArtifactId') 'NarrationPlan'
  $sceneBlueprint = Select-OneArtifact 'ise.scene-blueprint/v1' (Require-String (Get-PropertyValue $compiledMetadata 'sceneBlueprintArtifactId') 'COMPILED_ARTIFACT_INVALID' 'sceneBlueprintArtifactId') 'SceneBlueprint'
  $resolvedScenePlan = Select-OneArtifact 'ise.resolved-scene-plan/v1' (Require-String (Get-PropertyValue $compiledMetadata 'resolvedScenePlanArtifactId') 'COMPILED_ARTIFACT_INVALID' 'resolvedScenePlanArtifactId') 'ResolvedScenePlan'
  $choreographyPlan = Select-OneArtifact 'ise.choreography-plan/v1' (Require-String (Get-PropertyValue $compiledMetadata 'choreographyPlanArtifactId') 'COMPILED_ARTIFACT_INVALID' 'choreographyPlanArtifactId') 'ChoreographyPlan'

  $narrationMetadata = Get-PropertyValue $narration 'metadata'
  $blueprintMetadata = Get-PropertyValue $sceneBlueprint 'metadata'
  $resolvedMetadata = Get-PropertyValue $resolvedScenePlan 'metadata'
  $choreographyMetadata = Get-PropertyValue $choreographyPlan 'metadata'
  if ((Get-PropertyValue $narrationMetadata 'eventPlanArtifactId') -ne $acceptedId -or
      (Get-PropertyValue $blueprintMetadata 'narrationPlanArtifactId') -ne (Get-PropertyValue $narration 'artifactId') -or
      (Get-PropertyValue $resolvedMetadata 'sceneBlueprintArtifactId') -ne (Get-PropertyValue $sceneBlueprint 'artifactId') -or
      (Get-PropertyValue $choreographyMetadata 'resolvedScenePlanArtifactId') -ne (Get-PropertyValue $resolvedScenePlan 'artifactId')) {
    Fail-Flow 'COMPILED_ARTIFACT_INVALID' 'Final artifact metadata lineage is inconsistent.'
  }

  $eventPlan = Get-PropertyValue $accepted 'data'
  $narrationData = Get-PropertyValue $narration 'data'
  $blueprintData = Get-PropertyValue $sceneBlueprint 'data'
  $resolvedData = Get-PropertyValue $resolvedScenePlan 'data'
  $choreographyData = Get-PropertyValue $choreographyPlan 'data'
  if ((Get-PropertyValue $narrationData 'sourceEventPlanId') -ne (Get-PropertyValue $eventPlan 'planId') -or
      (Get-PropertyValue $blueprintData 'sourceNarrationPlanId') -ne (Get-PropertyValue $narrationData 'narrationPlanId') -or
      (Get-PropertyValue $resolvedData 'sourceBlueprintId') -ne (Get-PropertyValue $blueprintData 'blueprintId') -or
      (Get-PropertyValue $choreographyData 'sourceResolvedScenePlanId') -ne (Get-PropertyValue $resolvedData 'resolvedScenePlanId')) {
    Fail-Flow 'COMPILED_ARTIFACT_INVALID' 'Final artifact data lineage is inconsistent.'
  }

  return [pscustomobject]@{
    Accepted = $accepted
    Narration = $narration
    SceneBlueprint = $sceneBlueprint
    ResolvedScenePlan = $resolvedScenePlan
    ChoreographyPlan = $choreographyPlan
    Compiled = $compiled
  }
}

function Test-RequiredEngagementOutcomes {
  param($Engagements)
  $outcomes = @(@($Engagements) | ForEach-Object { Get-PropertyValue $_ 'outcome' })
  return (Test-OrdinalContains $outcomes 'interception') -and
    (Test-OrdinalContains $outcomes 'destroyed')
}

function Assert-FinalDomainInvariants {
  param($Selection, [int]$ExpectedActorCount = 0, [switch]$AllowGenericScene, [switch]$RequireGeneratedScenario)
  $blueprint = Get-PropertyValue $Selection.SceneBlueprint 'data'
  $resolved = Get-PropertyValue $Selection.ResolvedScenePlan 'data'
  $choreography = Get-PropertyValue $Selection.ChoreographyPlan 'data'
  $compiledData = Get-PropertyValue $Selection.Compiled 'data'
  $runtime = Get-PropertyValue $compiledData 'runtimePlan'
  $scene = Get-PropertyValue $compiledData 'sceneProjectConfig'

  $actorGroups = @(Get-PropertyValue $blueprint 'actorGroups')
  $resolvedActors = @(Get-PropertyValue $resolved 'resolvedActors')
  $assignments = @(Get-PropertyValue $resolved 'actorRouteAssignments')
  $staticBindings = @(Get-PropertyValue $resolved 'staticActorBindings')
  if ($AllowGenericScene) {
    if ($actorGroups.Count -lt 1 -or $resolvedActors.Count -lt 1 -or $assignments.Count + $staticBindings.Count -ne $resolvedActors.Count) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'The generated generic scene must contain grounded playable actors.'
    }
  } elseif ($actorGroups.Count -le 1 -or $resolvedActors.Count -le 1 -or $assignments.Count -ne $resolvedActors.Count) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'The generated scene must contain multiple actor groups and one route assignment per resolved actor.'
  }
  if ($ExpectedActorCount -gt 0 -and $resolvedActors.Count -ne $ExpectedActorCount) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' "Expected exactly $ExpectedActorCount resolved actors from the source report, received $($resolvedActors.Count)."
  }

  if ($RequireGeneratedScenario) {
    $generatedRoutes = @(Get-PropertyValue $resolved 'generatedTrajectoryAssets')
    $generatedAssignments = @($assignments | Where-Object { (Get-PropertyValue $_ 'sourceKind') -eq 'generated' })
    if ($generatedRoutes.Count -lt 1 -or $generatedAssignments.Count -lt 1) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'The start/end scenario must contain embedded generated trajectories and assignments.'
    }
    $sceneGeneratedRoutes = @(Get-PropertyValue $scene 'generatedTrajectories')
    if ($sceneGeneratedRoutes.Count -lt $generatedRoutes.Count) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Generated trajectory geometry did not reach SceneProjectConfig.'
    }
    $runtimeModelIds = @($runtime.entities | ForEach-Object { Get-PropertyValue $_ 'modelAssetId' })
    if (-not (Test-OrdinalContains $runtimeModelIds 'model:awacs-generic-e3a') -and
        -not (Test-OrdinalContains $runtimeModelIds 'model:netra-awacs')) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'The start/end scenario must retain an AWACS model.'
    }
    if (-not (Test-OrdinalContains $runtimeModelIds 'model:pl15e')) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'The start/end scenario must retain a missile model.'
    }
    $scenarioEngagements = @(Get-PropertyValue $choreography 'weaponEngagements')
    $destroyedEngagements = @($scenarioEngagements | Where-Object { (Get-PropertyValue $_ 'outcome') -eq 'destroyed' })
    $resolvedScenarioInteractions = @($runtime.interactions | Where-Object { (Get-PropertyValue $_ 'status') -eq 'resolved' })
    $destroyedStateCommands = @($runtime.commands | Where-Object {
      (Get-PropertyValue $_ 'type') -eq 'model.set_state' -and
      (Get-PropertyValue (Get-PropertyValue $_ 'params') 'state') -eq 'destroyed'
    })
    $hasResolvedDestroyedEngagement = $false
    foreach ($engagement in $destroyedEngagements) {
      $engagementId = Get-PropertyValue $engagement 'engagementId'
      $targetRef = Get-PropertyValue $engagement 'targetRef'
      $matchingInteraction = @($resolvedScenarioInteractions | Where-Object {
        Test-OrdinalEqual (Get-PropertyValue $_ 'engagementId') $engagementId
      })
      $matchingState = @($destroyedStateCommands | Where-Object {
        Test-OrdinalEqual (Get-PropertyValue $_ 'targetId') $targetRef -and
        Test-OrdinalEqual (Get-PropertyValue (Get-PropertyValue $_ 'params') 'entityId') $targetRef
      })
      if ($matchingInteraction.Count -eq 1 -and $matchingState.Count -eq 1) {
        $hasResolvedDestroyedEngagement = $true
        break
      }
    }
    if (-not $hasResolvedDestroyedEngagement) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'The start/end scenario must contain one geometrically resolved destroyed engagement and matching state transition.'
    }
    if (@($runtime.interactions | Where-Object { (Get-PropertyValue $_ 'status') -eq 'unresolved' }).Count -lt 1) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'The start/end scenario must preserve one unresolved interaction.'
    }
  }

  $actorIds = @($resolvedActors | ForEach-Object { Get-PropertyValue $_ 'actorInstanceId' })
  $assignmentActorIds = @($assignments | ForEach-Object { Get-PropertyValue $_ 'actorInstanceRef' })
  $staticActorIds = @($staticBindings | ForEach-Object { Get-PropertyValue $_ 'actorInstanceRef' })
  $trajectoryIds = @($assignments | ForEach-Object { Get-PropertyValue $_ 'trajectoryAssetRef' })
  $bindingActorIds = if ($AllowGenericScene) { @($assignmentActorIds) + @($staticActorIds) } else { $assignmentActorIds }
  if (-not (Test-OrdinalSetEqual $actorIds $bindingActorIds) -or
      -not (Test-OrdinalUnique $trajectoryIds) -or
      @($assignments | Where-Object {
        $kind = Get-PropertyValue $_ 'sourceKind'
        $kind -ne 'catalog' -and $kind -ne 'generated'
      }).Count -ne 0 -or
      @(Get-PropertyValue $resolved 'fallbackTrajectoryRecipes').Count -ne 0) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Resolved actors require unique catalog or generated route assignments without fallback recipes.'
  }

  $diagnostics = @(
    @(Get-PropertyValue (Get-PropertyValue $Selection.Narration 'data') 'diagnostics')
    @(Get-PropertyValue $blueprint 'diagnostics')
    @(Get-PropertyValue $resolved 'diagnostics')
    @(Get-PropertyValue $runtime 'diagnostics')
  )
  if (@($diagnostics | Where-Object {
    (Get-PropertyValue $_ 'severity') -eq 'error' -or (Get-PropertyValue $_ 'recoverable') -eq $false
  }).Count -ne 0) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Unrecoverable final-plan diagnostics are forbidden.'
  }

  $choreographyActorIds = @(@(Get-PropertyValue $choreography 'actorInstances') | ForEach-Object {
    Get-PropertyValue $_ 'actorInstanceId'
  })
  $entities = @(Get-PropertyValue $runtime 'entities')
  $entityIds = @($entities | ForEach-Object { Get-PropertyValue $_ 'entityId' })
  if (-not (Test-OrdinalSetEqual $choreographyActorIds $actorIds) -or
      -not (Test-OrdinalSetEqual $entityIds $actorIds)) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Choreography and RuntimePlan entities must exactly match resolved actors.'
  }

  if ($AllowGenericScene) {
    if ($assignments.Count + $staticBindings.Count -ne $resolvedActors.Count) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Every resolved actor must have either a catalog route or a grounded static binding.'
    }
    $markerCommands = @($runtime.commands | Where-Object { (Get-PropertyValue $_ 'type') -eq 'marker.show' })
    $followCommands = @($runtime.commands | Where-Object { (Get-PropertyValue $_ 'type') -eq 'model.follow_path' })
    if ($markerCommands.Count -eq 0 -and $followCommands.Count -eq 0) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Generic scenes require at least one grounded marker or moving actor.'
    }
    $markerActorIds = @($markerCommands | ForEach-Object { Get-PropertyValue $_ 'targetId' })
    if (-not (Test-OrdinalSetEqual $markerActorIds $staticActorIds)) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Generic static actor bindings must correspond exactly to RuntimePlan marker.show targets.'
    }
    $resolvedInteractions = @(@(Get-PropertyValue $runtime 'interactions') | Where-Object {
      (Get-PropertyValue $_ 'status') -eq 'resolved'
    })
    $confirmedEngagements = @(@(Get-PropertyValue $choreography 'weaponEngagements') | Where-Object {
      Test-OrdinalContains @('destroyed', 'interception', 'intercepted') (Get-PropertyValue $_ 'outcome')
    })
    $resolvedInteractionEngagementIds = @($resolvedInteractions | ForEach-Object { Get-PropertyValue $_ 'engagementId' })
    $confirmedEngagementIds = @($confirmedEngagements | ForEach-Object { Get-PropertyValue $_ 'engagementId' })
    if (-not (Test-OrdinalUnique $resolvedInteractionEngagementIds) -or
        @($resolvedInteractionEngagementIds | Where-Object { -not (Test-OrdinalContains $confirmedEngagementIds $_) }).Count -ne 0) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Resolved generic interaction engagementIds must be a unique subset of confirmed weapon engagements.'
    }
  }

  if ($ExpectedActorCount -gt 0) {
    $aircraftEntities = @($entities | Where-Object { (Get-PropertyValue $_ 'kind') -eq 'aircraft' })
    $missileEntities = @($entities | Where-Object { (Get-PropertyValue $_ 'kind') -eq 'missile' })
    if ($missileEntities.Count -lt 3) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'RuntimePlan must preserve at least three missile entities from the source report.'
    }

    $expectedMissileRoutes = @(
      'trajectory:india-missile-1',
      'trajectory:pakistan-missile-1',
      'trajectory:pakistan-strike-missile-2'
    )
    $missileRoutes = @($missileEntities | ForEach-Object { Get-PropertyValue $_ 'defaultTrajectoryAssetId' })
    if (-not (Test-OrdinalSetEqual $missileRoutes $expectedMissileRoutes)) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'RuntimePlan missile entities must use the three exact scenario missile routes.'
    }

    $expectedAwacsRoutes = @('trajectory:india-awacs-1', 'trajectory:pakistan-awacs-1')
    $awacsRoutes = @($aircraftEntities | ForEach-Object { Get-PropertyValue $_ 'defaultTrajectoryAssetId' } | Where-Object {
      Test-OrdinalContains $expectedAwacsRoutes $_
    })
    if (-not (Test-OrdinalSetEqual $awacsRoutes $expectedAwacsRoutes)) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'RuntimePlan aircraft entities must include the two exact scenario AWACS routes.'
    }

    $weaponEngagements = @(Get-PropertyValue $choreography 'weaponEngagements')
    if (-not (Test-RequiredEngagementOutcomes $weaponEngagements)) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'ChoreographyPlan requires interception and destroyed weapon engagements.'
    }
    $relationLinkKinds = @(@(Get-PropertyValue $choreography 'relationSegments') | ForEach-Object {
      Get-PropertyValue $_ 'linkKind'
    })
    if (-not (Test-OrdinalContains $relationLinkKinds 'awacs-fighter') -or
        -not (Test-OrdinalContains $relationLinkKinds 'fighter-missile')) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'ChoreographyPlan relation segments must include AWACS-fighter and fighter-missile data links.'
    }
  }

  $modelTracks = @(@(Get-PropertyValue $scene 'tracks') | Where-Object {
    (Get-PropertyValue $_ 'type') -eq 'model'
  })
  $runtimeEntityIds = @($entities | ForEach-Object { Get-PropertyValue $_ 'entityId' })
  $runtimeEntityIdSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($runtimeEntityId in $runtimeEntityIds) {
    if (-not ($runtimeEntityId -is [string]) -or [string]::IsNullOrWhiteSpace([string]$runtimeEntityId) -or
        -not $runtimeEntityIdSet.Add([string]$runtimeEntityId)) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'SceneProjectConfig must contain exactly one model track per RuntimePlan entity.'
    }
  }
  $expectedModelActorIds = @(if ($AllowGenericScene) { $assignmentActorIds } else { $runtimeEntityIds })
  $expectedModelActorIdSet = New-OrdinalStringSet $expectedModelActorIds
  if ($null -eq $expectedModelActorIdSet) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'SceneProjectConfig model track actor IDs are invalid.'
  }
  $modelTrackEntityIdSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $interceptedTargetIds = @(
    @(Get-PropertyValue $choreography 'weaponEngagements') |
      Where-Object { (Get-PropertyValue $_ 'outcome') -eq 'interception' } |
      ForEach-Object { Get-PropertyValue $_ 'targetRef' }
  )
  foreach ($track in $modelTracks) {
    $items = @(Get-PropertyValue $track 'items')
    $trackEntityIdSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($item in $items) {
      $itemEntityId = Get-PropertyValue (Get-PropertyValue $item 'params') 'entityId'
      if (-not ($itemEntityId -is [string]) -or [string]::IsNullOrWhiteSpace([string]$itemEntityId)) {
        Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Each model track must contain commands for exactly one RuntimePlan entity.'
      }
      $null = $trackEntityIdSet.Add([string]$itemEntityId)
    }
    if ($items.Count -eq 0 -or $trackEntityIdSet.Count -ne 1) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Each model track must contain commands for exactly one RuntimePlan entity.'
    }
    $null = $modelTrackEntityIdSet.Add(@($trackEntityIdSet)[0])
  }
  if ($modelTracks.Count -ne $expectedModelActorIds.Count -or
      $modelTrackEntityIdSet.Count -ne $expectedModelActorIdSet.Count) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'SceneProjectConfig must contain exactly one model track per moving RuntimePlan entity.'
  }
  foreach ($expectedModelActorId in $expectedModelActorIds) {
    if (-not $modelTrackEntityIdSet.Contains([string]$expectedModelActorId)) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'SceneProjectConfig must contain exactly one model track per moving RuntimePlan entity.'
    }
  }
  $sceneEntityIds = @(@(Get-PropertyValue $scene 'entities') | ForEach-Object { Get-PropertyValue $_ 'entityId' })
  if (-not (Test-OrdinalSetEqual $sceneEntityIds $runtimeEntityIds)) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'SceneProjectConfig entities must exactly match RuntimePlan entities.'
  }

  foreach ($track in $modelTracks) {
    $items = @(Get-PropertyValue $track 'items')
    $spawnItems = @($items | Where-Object {
      (Get-PropertyValue (Get-PropertyValue $_ 'params') 'action') -eq 'model.spawn'
    })
    $followItems = @($items | Where-Object {
      (Get-PropertyValue (Get-PropertyValue $_ 'params') 'action') -eq 'model.follow_path'
    })
    $hideItems = @($items | Where-Object {
      (Get-PropertyValue (Get-PropertyValue $_ 'params') 'action') -eq 'model.hide'
    })
    $destroyedStateItems = @($items | Where-Object {
      (Get-PropertyValue (Get-PropertyValue $_ 'params') 'action') -eq 'model.set_state' -and
      (Get-PropertyValue (Get-PropertyValue $_ 'params') 'state') -eq 'destroyed'
    })
    if ($spawnItems.Count -ne 1 -or $followItems.Count -ne 1 -or $hideItems.Count -ne 1) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Each RuntimePlan entity must have one contiguous spawn/follow/hide lifecycle.'
    }
    if ($destroyedStateItems.Count -gt 1) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'A RuntimePlan entity may have at most one destroyed state transition.'
    }
    $spawnEndMs = [long](Get-PropertyValue $spawnItems[0] 'startMs') + [long](Get-PropertyValue $spawnItems[0] 'durationMs')
    $followStartMs = [long](Get-PropertyValue $followItems[0] 'startMs')
    $followEndMs = $followStartMs + [long](Get-PropertyValue $followItems[0] 'durationMs')
    $hideStartMs = [long](Get-PropertyValue $hideItems[0] 'startMs')
    $trackEntityId = [string](Get-PropertyValue (Get-PropertyValue $followItems[0] 'params') 'entityId')
    if ($followStartMs -ne $spawnEndMs) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Each RuntimePlan entity must have one contiguous spawn/follow/hide lifecycle.'
    }
    if ($destroyedStateItems.Count -eq 0) {
      if (-not (Test-OrdinalContains $interceptedTargetIds $trackEntityId) -and $followEndMs -ne $hideStartMs) {
        Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'A non-destroyed RuntimePlan entity must hide exactly when its follow interval ends.'
      }
      continue
    }
    $destroyedStartMs = [long](Get-PropertyValue $destroyedStateItems[0] 'startMs')
    if ($destroyedStartMs -lt $followStartMs -or $destroyedStartMs -gt $followEndMs -or
        $hideStartMs -lt $destroyedStartMs + 1000) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'A destroyed RuntimePlan entity must transition during follow and remain visible for at least 1,000ms before hiding.'
    }
  }

  $commands = @(Get-PropertyValue $runtime 'commands')
  $followCommands = @($commands | Where-Object { (Get-PropertyValue $_ 'type') -eq 'model.follow_path' })
  $expectedFollowActorIds = @(if ($AllowGenericScene) { $assignmentActorIds } else { $runtimeEntityIds })
  if ($followCommands.Count -ne $expectedFollowActorIds.Count -or
      @($commands | Where-Object { (Get-PropertyValue $_ 'type') -eq 'image.show' }).Count -lt 1 -or
      @($commands | Where-Object { (Get-PropertyValue $_ 'type') -eq 'video.play' }).Count -lt 1) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'RuntimePlan requires one follow route per moving entity plus image and video commands.'
  }
  foreach ($entityId in $expectedFollowActorIds) {
    $entityFollows = @($followCommands | Where-Object {
      Test-OrdinalEqual (Get-PropertyValue (Get-PropertyValue $_ 'params') 'entityId') $entityId
    })
    $assignment = @($assignments | Where-Object {
      Test-OrdinalEqual (Get-PropertyValue $_ 'actorInstanceRef') $entityId
    })
    if ($entityFollows.Count -ne 1 -or $assignment.Count -ne 1 -or
        -not (Test-OrdinalEqual (Get-PropertyValue (Get-PropertyValue $entityFollows[0] 'params') 'trajectoryAssetId') (Get-PropertyValue $assignment[0] 'trajectoryAssetRef')) -or
        -not (Test-OrdinalEqual (Get-PropertyValue ($entities | Where-Object {
          Test-OrdinalEqual (Get-PropertyValue $_ 'entityId') $entityId
        } | Select-Object -First 1) 'defaultTrajectoryAssetId') (Get-PropertyValue $assignment[0] 'trajectoryAssetRef'))) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Each moving RuntimePlan entity must follow its unique resolved route exactly once.'
    }
  }

  if ($ExpectedActorCount -gt 0) {
    $dataLinkCommands = @($commands | Where-Object { (Get-PropertyValue $_ 'type') -eq 'data_link.show' })
    $commandLinkKinds = @($dataLinkCommands | ForEach-Object {
      Get-PropertyValue (Get-PropertyValue $_ 'params') 'linkKind'
    })
    if (-not (Test-OrdinalContains $commandLinkKinds 'awacs-fighter') -or
        -not (Test-OrdinalContains $commandLinkKinds 'fighter-missile')) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'RuntimePlan data_link.show commands must include both supported link kinds.'
    }

    $dataLinkItems = @(@(Get-PropertyValue $scene 'tracks') | Where-Object {
      Test-SceneDataLinkTrackType (Get-PropertyValue $_ 'type')
    } | ForEach-Object { @(Get-PropertyValue $_ 'items') })
    $sceneLinkKinds = @($dataLinkItems | ForEach-Object {
      Get-PropertyValue (Get-PropertyValue $_ 'params') 'linkKind'
    })
    if ($dataLinkItems.Count -lt 1 -or
        -not (Test-OrdinalContains $sceneLinkKinds 'awacs-fighter') -or
        -not (Test-OrdinalContains $sceneLinkKinds 'fighter-missile')) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'SceneProjectConfig data-link items must include both supported link kinds.'
    }

    $impactVideos = @($commands | Where-Object {
      (Get-PropertyValue $_ 'type') -eq 'video.play' -and
      (Test-OrdinalEqual (Get-PropertyValue (Get-PropertyValue $_ 'params') 'assetId') 'video:missile-impact')
    })
    if ($impactVideos.Count -lt 1) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'RuntimePlan requires at least one exact video:missile-impact command.'
    }

    $destroyedEngagements = @(@(Get-PropertyValue $choreography 'weaponEngagements') | Where-Object {
      (Get-PropertyValue $_ 'outcome') -eq 'destroyed'
    })
    $destroyedStates = @($commands | Where-Object {
      (Get-PropertyValue $_ 'type') -eq 'model.set_state' -and
      (Get-PropertyValue (Get-PropertyValue $_ 'params') 'state') -eq 'destroyed'
    })
    if ($destroyedEngagements.Count -ne 1 -or $destroyedStates.Count -ne 1) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Exactly one evidence-grounded target must receive model.set_state destroyed.'
    }
    $destroyedTargetId = Get-PropertyValue $destroyedEngagements[0] 'targetRef'
    $destroyedStateTargetId = Get-PropertyValue (Get-PropertyValue $destroyedStates[0] 'params') 'entityId'
    $destroyedHides = @($commands | Where-Object {
      (Get-PropertyValue $_ 'type') -eq 'model.hide' -and
      (Test-OrdinalEqual (Get-PropertyValue (Get-PropertyValue $_ 'params') 'entityId') $destroyedTargetId)
    })
    if (-not (Test-OrdinalEqual $destroyedStateTargetId $destroyedTargetId) -or
        $destroyedHides.Count -ne 1 -or
        [long](Get-PropertyValue $destroyedHides[0] 'startMs') -lt [long](Get-PropertyValue $destroyedStates[0] 'startMs') + 1000) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'The destroyed target must remain present for at least 1,000ms before its model.hide command.'
    }
    $engagementEvidenceRefs = @(Get-PropertyValue $destroyedEngagements[0] 'evidenceRefs')
    $destroyedStateEvidenceRefs = @(Get-PropertyValue $destroyedStates[0] 'evidenceRefs')
    $destroyedHideEvidenceRefs = @(Get-PropertyValue $destroyedHides[0] 'evidenceRefs')
    if ($engagementEvidenceRefs.Count -lt 1 -or
        $destroyedStateEvidenceRefs.Count -lt 1 -or
        $destroyedHideEvidenceRefs.Count -lt 1) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'The destroyed engagement, state command, and hide command require non-empty evidence references.'
    }
    foreach ($engagementEvidenceRef in $engagementEvidenceRefs) {
      if (-not (Test-OrdinalContains $destroyedStateEvidenceRefs $engagementEvidenceRef) -or
          -not (Test-OrdinalContains $destroyedHideEvidenceRefs $engagementEvidenceRef)) {
        Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Destroyed state and hide commands must preserve all engagement evidence references.'
      }
    }

    $cameraCommands = @($commands | Where-Object { (Get-PropertyValue $_ 'type') -eq 'camera.transition' })
    foreach ($phase in @('launch', 'midcourse', 'terminal', 'aftermath')) {
      $phaseSuffix = ":$phase`:camera"
      $phaseCameras = @($cameraCommands | Where-Object {
        $commandId = Get-PropertyValue $_ 'commandId'
        $commandId -is [string] -and $commandId.EndsWith($phaseSuffix, [System.StringComparison]::Ordinal)
      })
      if ($phaseCameras.Count -lt 1) {
        Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' "RuntimePlan camera commands must cover the $phase engagement phase."
      }
    }
  }

  $expectedLineageIds = @(
    Get-PropertyValue $Selection.Accepted 'artifactId'
    Get-PropertyValue $Selection.Narration 'artifactId'
    Get-PropertyValue $Selection.SceneBlueprint 'artifactId'
    Get-PropertyValue $Selection.ResolvedScenePlan 'artifactId'
    Get-PropertyValue $Selection.ChoreographyPlan 'artifactId'
  )
  $runtimeLineage = @(Get-PropertyValue $runtime 'lineage')
  if ($runtimeLineage.Count -lt 1) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'RuntimePlan lineage is missing.'
  }
  foreach ($lineage in $runtimeLineage) {
    $sourceIds = @(Get-PropertyValue $lineage 'sourceArtifactIds')
    foreach ($expectedId in $expectedLineageIds) {
      if (-not (Test-OrdinalContains $sourceIds $expectedId)) {
        Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'RuntimePlan lineage omits a final-domain artifact.'
      }
    }
  }

  $acceptedId = Get-PropertyValue $Selection.Accepted 'artifactId'
  $compiledId = Get-PropertyValue $Selection.Compiled 'artifactId'
  if (-not (Test-OrdinalEqual (Get-PropertyValue $runtime 'eventPlanArtifactId') $acceptedId) -or
      -not (Test-OrdinalEqual (Get-PropertyValue $scene 'eventPlanArtifactId') $acceptedId) -or
      -not (Test-OrdinalEqual (Get-PropertyValue $scene 'runtimePlanArtifactId') $compiledId)) {
    Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'Compiled RuntimePlan and SceneProjectConfig lineage is inconsistent.'
  }

  $visualTypes = @(
    'image.show', 'video.play', 'marker.show', 'geojson.show', 'camera.transition',
    'data_link.show', 'model.spawn', 'model.follow_path', 'model.set_state', 'model.hide'
  )
  foreach ($subtitle in @(Get-PropertyValue $runtime 'subtitles')) {
    $eventUnitId = Get-PropertyValue $subtitle 'eventUnitId'
    $visuals = @($commands | Where-Object {
      (Test-OrdinalEqual (Get-PropertyValue $_ 'eventUnitId') $eventUnitId) -and
      $visualTypes -contains (Get-PropertyValue $_ 'type')
    } | Sort-Object { [int](Get-PropertyValue $_ 'startMs') })
    if ($visuals.Count -gt 0 -and
        [int](Get-PropertyValue $visuals[0] 'startMs') -lt [int](Get-PropertyValue $subtitle 'startMs') + 800) {
      Fail-Flow 'REAL_DEMO_FINAL_DOMAIN_INVALID' 'The first visual command must lead its subtitle by at least 800ms.'
    }
  }
}

function Get-SessionArtifacts {
  param([string]$SessionId, [string]$AccessToken)
  $encoded = [System.Uri]::EscapeDataString($SessionId)
  $response = Invoke-JsonRequest GET $AgentBaseUrl "/sessions/$encoded/artifacts" $null $AccessToken 'artifact polling'
  $artifactsProperty = $response.PSObject.Properties['artifacts']
  if ($null -eq $artifactsProperty) { Fail-Flow 'REAL_DEMO_ARTIFACT_LEDGER_INVALID' 'Agent artifact ledger is missing.' }
  return @($artifactsProperty.Value)
}

function Get-SessionView {
  param([string]$SessionId, [string]$AccessToken)
  $encoded = [System.Uri]::EscapeDataString($SessionId)
  return Invoke-JsonRequest GET $AgentBaseUrl "/sessions/$encoded" $null $AccessToken 'session polling'
}

function Wait-ForCondition {
  param([string]$Description, [int]$TimeoutSeconds, [scriptblock]$Probe)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $consecutiveBridgeFailures = 0
  do {
    $result = $null
    try {
      $result = & $Probe
      $consecutiveBridgeFailures = 0
    } catch {
      if ($_.Exception.Message -notmatch '^NEST_BRIDGE_FAILED:') { throw }
      $consecutiveBridgeFailures += 1
      if ($consecutiveBridgeFailures -gt 3) { throw }
    }
    if ($null -ne $result -and $result -ne $false) { return $result }
    $remainingMs = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    if ($remainingMs -le 0) { break }
    Start-Sleep -Milliseconds ([Math]::Min($PollIntervalSeconds * 1000, $remainingMs))
  } while ([DateTime]::UtcNow -lt $deadline)
  Fail-Flow 'REAL_DEMO_WAIT_TIMEOUT' "Timed out waiting for $Description after $TimeoutSeconds seconds."
}

function Assert-SessionNotTerminalFailure {
  param($Session)
  $status = Get-PropertyValue $Session 'status'
  if ($status -eq 'failed') { Fail-Flow 'AGENT_RUN_FAILED' 'The Agent session entered failed state.' }
  if ($status -eq 'cancelled') { Fail-Flow 'REAL_DEMO_SESSION_CANCELLED' 'The Agent session was cancelled.' }
}

function New-DryRunFixtures {
  $fingerprint = 'sha256:' + ('0' * 64)
  $evidenceRefs = @('evidence:dry')
  $eventUnit = [ordered]@{
    eventUnitId = 'dry-unit-1'; title = 'Dry run event'; worldStateChange = 'Dry run state change'
    participants = @('dry-participant'); locationRefs = @('dry-location'); evidenceRefs = @('evidence:dry')
    inferenceRefs = @(); uncertainties = @(); narrativePurpose = 'Validate schema'; importance = 'high'
  }
  $eventPlan = [ordered]@{
    schemaVersion = 'event-plan/v1'; planId = 'dry-plan'; documentId = 'dry-document'; version = 1
    eventUnits = @($eventUnit); omittedEvidence = @(); warnings = @()
  }
  $narrationPlan = [ordered]@{
    schemaVersion = 'ise.narration-plan/v1'; narrationPlanId = 'dry-narration'
    sourceEventPlanId = 'dry-plan'; sourceEventPlanFingerprint = $fingerprint
    sourceNarrativePlanId = 'dry-narrative'
    beats = @([ordered]@{
      subtitleId = 'dry-subtitle'; eventUnitId = 'dry-unit-1'; text = 'Dry run narration'
      evidenceRefs = $evidenceRefs; beatRole = 'action'; attentionTarget = 'dry-participant'
      importance = 'high'; estimatedDurationMs = 2000
    })
    diagnostics = @()
  }
  $actorA = [ordered]@{ actorInstanceId = 'actor:dry-a'; actorGroupRef = 'dry-group-a'; role = 'leader'; ordinal = 0 }
  $actorB = [ordered]@{ actorInstanceId = 'actor:dry-b'; actorGroupRef = 'dry-group-b'; role = 'leader'; ordinal = 0 }
  $quantity = [ordered]@{
    value = 1; constraint = 'exact'; source = 'evidence'; evidenceRefs = $evidenceRefs
    reason = 'Dry run exact actor count'
  }
  $sceneBlueprint = [ordered]@{
    schemaVersion = 'ise.scene-blueprint/v1'; blueprintId = 'dry-blueprint'
    sourceNarrationPlanId = 'dry-narration'; sourceNarrationFingerprint = $fingerprint
    actorGroups = @(
      [ordered]@{
        groupId = 'dry-group-a'; semanticEntityRef = 'dry-a'; side = 'one'; locationRef = 'dry-location'
        platformType = 'aircraft'; role = 'fighter'; quantityDecision = $quantity; formationPattern = 'single'
        leaderPolicy = 'first'; behaviorProfile = 'follow'; lifecycle = 'scene'
      },
      [ordered]@{
        groupId = 'dry-group-b'; semanticEntityRef = 'dry-b'; side = 'two'; locationRef = 'dry-location'
        platformType = 'aircraft'; role = 'fighter'; quantityDecision = $quantity; formationPattern = 'single'
        leaderPolicy = 'first'; behaviorProfile = 'follow'; lifecycle = 'scene'
      }
    )
    sceneBeats = @([ordered]@{
      sceneBeatId = 'dry-beat'; subtitleId = 'dry-subtitle'; eventUnitId = 'dry-unit-1'
      purpose = 'Dry run'; actorRefs = @('dry-group-a', 'dry-group-b'); behaviorIntents = @('follow')
      spatialConstraints = @('catalog route'); stateTransitions = @('normal'); cameraIntent = 'track'
      mediaIntents = @('image', 'video'); requiredFacts = @('dry fact'); forbiddenClaims = @('none')
      fidelity = 'evidence'; priority = 'high'
    })
    diagnostics = @()
  }
  $assignmentA = [ordered]@{
    actorInstanceRef = 'actor:dry-a'; formationBundleRef = 'dry-bundle-a'; trajectoryAssetRef = 'trajectory:dry-a'
    segmentId = 'dry-route-a'; resamplePolicy = 'preserve-source-samples'
    timeMapping = [ordered]@{ mode = 'fit-window'; startMs = 900; durationMs = 1900 }
    spatialPathMode = 'preserve'; sourceKind = 'catalog'; matchReason = 'Dry catalog route'; lineage = @('dry-catalog')
  }
  $assignmentB = [ordered]@{
    actorInstanceRef = 'actor:dry-b'; formationBundleRef = 'dry-bundle-b'; trajectoryAssetRef = 'trajectory:dry-b'
    segmentId = 'dry-route-b'; resamplePolicy = 'preserve-source-samples'
    timeMapping = [ordered]@{ mode = 'fit-window'; startMs = 900; durationMs = 1900 }
    spatialPathMode = 'preserve'; sourceKind = 'catalog'; matchReason = 'Dry catalog route'; lineage = @('dry-catalog')
  }
  $resolvedScenePlan = [ordered]@{
    schemaVersion = 'ise.resolved-scene-plan/v1'; resolvedScenePlanId = 'dry-resolved'
    sourceBlueprintId = 'dry-blueprint'; sourceBlueprintFingerprint = $fingerprint
    trajectoryCatalogFingerprint = $fingerprint; scenarioMappingFingerprint = $fingerprint
    resolvedActors = @($actorA, $actorB); resolvedLocations = @('dry-location')
    resolvedAssets = @('model:dry-a', 'model:dry-b', 'trajectory:dry-a', 'trajectory:dry-b')
    resolvedFormationBundles = @(
      [ordered]@{
        bundleId = 'dry-bundle-a'; actorGroupRef = 'dry-group-a'; routeAssetRefs = @('trajectory:dry-a')
        recommendedActorCount = 1; role = 'fighter'; side = 'one'; semanticTags = @('dry')
        scenarioBindings = @('dry'); mappingAuthority = 'scenario_config'; diagnostics = @()
      },
      [ordered]@{
        bundleId = 'dry-bundle-b'; actorGroupRef = 'dry-group-b'; routeAssetRefs = @('trajectory:dry-b')
        recommendedActorCount = 1; role = 'fighter'; side = 'two'; semanticTags = @('dry')
        scenarioBindings = @('dry'); mappingAuthority = 'scenario_config'; diagnostics = @()
      }
    )
    actorRouteAssignments = @($assignmentA, $assignmentB); fallbackTrajectoryRecipes = @()
    resolvedBehaviors = @('follow'); resolvedMedia = @('image:dry', 'video:dry')
    fallbackDecisions = @(); diagnostics = @()
  }
  $choreographyPlan = [ordered]@{
    schemaVersion = 'ise.choreography-plan/v1'; choreographyPlanId = 'dry-choreography'
    sourceResolvedScenePlanId = 'dry-resolved'; sourceResolvedScenePlanFingerprint = $fingerprint
    actorInstances = @($actorA, $actorB)
    actorLifecycles = @(
      [ordered]@{ actorInstanceRef = 'actor:dry-a'; firstSceneBeatRef = 'dry-beat'; lastSceneBeatRef = 'dry-beat' },
      [ordered]@{ actorInstanceRef = 'actor:dry-b'; firstSceneBeatRef = 'dry-beat'; lastSceneBeatRef = 'dry-beat' }
    )
    motionSegments = @(
      [ordered]@{ segmentId = 'dry-motion-a'; actorInstanceRef = 'actor:dry-a'; sceneBeatRef = 'dry-beat'; behavior = 'follow'; routeAssignmentRef = 'dry-route-a' },
      [ordered]@{ segmentId = 'dry-motion-b'; actorInstanceRef = 'actor:dry-b'; sceneBeatRef = 'dry-beat'; behavior = 'follow'; routeAssignmentRef = 'dry-route-b' }
    )
    formationSegments = @(); weaponEngagements = @(); relationSegments = @(); effectSegments = @()
    shotPlan = @(); overlayPlan = @(); timeConstraints = @(); lineage = @()
  }
  $layout = [ordered]@{ xPct = 65; yPct = 5; widthPct = 30; heightPct = 30; zIndex = 10; opacity = 1; fit = 'contain' }
  $sourceArtifactIds = @('dry-accepted', 'dry-narration-artifact', 'dry-blueprint-artifact', 'dry-resolved-artifact', 'dry-choreography-artifact')
  $commandBase = [ordered]@{
    eventUnitId = 'dry-unit-1'; durationMs = 1000; dependsOn = @(); onFailure = 'abort'; evidenceRefs = $evidenceRefs
  }
  $runtimePlan = [ordered]@{
    schemaVersion = 'canonical-runtime-plan/v1'; planId = 'dry-runtime'; sourceDocumentId = 'dry-document'
    eventPlanArtifactId = 'dry-accepted'; eventPlanId = 'dry-plan'; narrativePlanId = 'dry-narrative'
    capabilityManifestVersion = 'ise-capabilities/v1'; assetRegistryVersion = 'dry-assets'; totalDurationMs = 4000
    entities = @(
      [ordered]@{ entityId = 'actor:dry-a'; displayName = 'Dry A'; kind = 'aircraft'; modelAssetId = 'model:dry-a'; defaultTrajectoryAssetId = 'trajectory:dry-a'; initialState = 'normal' },
      [ordered]@{ entityId = 'actor:dry-b'; displayName = 'Dry B'; kind = 'aircraft'; modelAssetId = 'model:dry-b'; defaultTrajectoryAssetId = 'trajectory:dry-b'; initialState = 'normal' }
    )
    subtitles = @([ordered]@{
      subtitleId = 'dry-subtitle'; eventUnitId = 'dry-unit-1'; text = 'Dry run narration'; evidenceRefs = $evidenceRefs
      importance = 'high'; startMs = 0; durationMs = 3000; position = 'bottom'; maxWidthPct = 70
    })
    commands = @(
      [ordered]@{ commandId = 'dry-spawn-a'; eventUnitId = $commandBase.eventUnitId; targetId = 'actor:dry-a'; type = 'model.spawn'; startMs = 800; durationMs = 100; dependsOn = @(); onFailure = $commandBase.onFailure; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.spawn'; entityId = 'actor:dry-a' } },
      [ordered]@{ commandId = 'dry-follow-a'; eventUnitId = $commandBase.eventUnitId; targetId = 'actor:dry-a'; type = 'model.follow_path'; startMs = 900; durationMs = 1900; dependsOn = @(); onFailure = $commandBase.onFailure; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.follow_path'; entityId = 'actor:dry-a'; trajectoryAssetId = 'trajectory:dry-a' } },
      [ordered]@{ commandId = 'dry-hide-a'; eventUnitId = $commandBase.eventUnitId; targetId = 'actor:dry-a'; type = 'model.hide'; startMs = 2800; durationMs = 0; dependsOn = @(); onFailure = $commandBase.onFailure; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.hide'; entityId = 'actor:dry-a' } },
      [ordered]@{ commandId = 'dry-spawn-b'; eventUnitId = $commandBase.eventUnitId; targetId = 'actor:dry-b'; type = 'model.spawn'; startMs = 800; durationMs = 100; dependsOn = @(); onFailure = $commandBase.onFailure; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.spawn'; entityId = 'actor:dry-b' } },
      [ordered]@{ commandId = 'dry-follow-b'; eventUnitId = $commandBase.eventUnitId; targetId = 'actor:dry-b'; type = 'model.follow_path'; startMs = 900; durationMs = 1900; dependsOn = @(); onFailure = $commandBase.onFailure; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.follow_path'; entityId = 'actor:dry-b'; trajectoryAssetId = 'trajectory:dry-b' } },
      [ordered]@{ commandId = 'dry-hide-b'; eventUnitId = $commandBase.eventUnitId; targetId = 'actor:dry-b'; type = 'model.hide'; startMs = 2800; durationMs = 0; dependsOn = @(); onFailure = $commandBase.onFailure; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.hide'; entityId = 'actor:dry-b' } },
      [ordered]@{ commandId = 'dry-image'; eventUnitId = $commandBase.eventUnitId; targetId = 'overlay:image'; type = 'image.show'; startMs = 900; durationMs = $commandBase.durationMs; dependsOn = @(); onFailure = 'warn'; evidenceRefs = $evidenceRefs; params = [ordered]@{ assetId = 'image:dry'; layout = $layout; enter = 'fade'; exit = 'fade' } },
      [ordered]@{ commandId = 'dry-video'; eventUnitId = $commandBase.eventUnitId; targetId = 'overlay:video'; type = 'video.play'; startMs = 1000; durationMs = $commandBase.durationMs; dependsOn = @(); onFailure = 'warn'; evidenceRefs = $evidenceRefs; params = [ordered]@{ assetId = 'video:dry'; layout = $layout; volume = 0.5; playbackRate = 1; loop = $false } }
    )
    informationCards = @()
    lineage = @([ordered]@{ outputId = 'dry-follow-a'; sourceArtifactIds = $sourceArtifactIds; evidenceRefs = $evidenceRefs })
    diagnostics = @()
  }
  $scene = [ordered]@{
    schemaVersion = 'ise-scene/v1'; sourceDocumentId = 'dry-document'; eventPlanArtifactId = 'dry-accepted'
    runtimePlanArtifactId = 'dry-compiled'; totalDurationMs = 4000; entities = $runtimePlan.entities
    tracks = @(
      [ordered]@{
        trackId = 'dry-model-track-a'; type = 'model'; label = 'Dry model A'; visible = $true
        items = @(
          [ordered]@{ id = 'dry-scene-spawn-a'; eventUnitId = 'dry-unit-1'; startMs = 800; durationMs = 100; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.spawn'; entityId = 'actor:dry-a' } },
          [ordered]@{ id = 'dry-scene-follow-a'; eventUnitId = 'dry-unit-1'; startMs = 900; durationMs = 1900; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.follow_path'; entityId = 'actor:dry-a'; trajectoryAssetId = 'trajectory:dry-a' } },
          [ordered]@{ id = 'dry-scene-hide-a'; eventUnitId = 'dry-unit-1'; startMs = 2800; durationMs = 0; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.hide'; entityId = 'actor:dry-a' } }
        )
      },
      [ordered]@{
        trackId = 'dry-model-track-b'; type = 'model'; label = 'Dry model B'; visible = $true
        items = @(
          [ordered]@{ id = 'dry-scene-spawn-b'; eventUnitId = 'dry-unit-1'; startMs = 800; durationMs = 100; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.spawn'; entityId = 'actor:dry-b' } },
          [ordered]@{ id = 'dry-scene-follow-b'; eventUnitId = 'dry-unit-1'; startMs = 900; durationMs = 1900; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.follow_path'; entityId = 'actor:dry-b'; trajectoryAssetId = 'trajectory:dry-b' } },
          [ordered]@{ id = 'dry-scene-hide-b'; eventUnitId = 'dry-unit-1'; startMs = 2800; durationMs = 0; evidenceRefs = $evidenceRefs; params = [ordered]@{ action = 'model.hide'; entityId = 'actor:dry-b' } }
        )
      },
      [ordered]@{ trackId = 'dry-image-track'; type = 'image'; label = 'Dry image'; visible = $true; items = @([ordered]@{ id = 'dry-scene-image'; eventUnitId = 'dry-unit-1'; startMs = 900; durationMs = 1000; evidenceRefs = $evidenceRefs; assetId = 'image:dry'; params = [ordered]@{ layout = $layout; enter = 'fade'; exit = 'fade' } }) },
      [ordered]@{ trackId = 'dry-video-track'; type = 'video'; label = 'Dry video'; visible = $true; items = @([ordered]@{ id = 'dry-scene-video'; eventUnitId = 'dry-unit-1'; startMs = 1000; durationMs = 1000; evidenceRefs = $evidenceRefs; assetId = 'video:dry'; params = [ordered]@{ layout = $layout; volume = 0.5; playbackRate = 1; loop = $false } }) }
    )
    diagnostics = @()
  }
  $artifacts = @(
    [pscustomobject]@{ artifactId = 'dry-accepted'; type = 'ise.event-plan-accepted/v1'; superseded = $false; data = $eventPlan; metadata = [pscustomobject]@{ acceptedDraftArtifactId = 'dry-revised' } },
    [pscustomobject]@{ artifactId = 'dry-narration-artifact'; type = 'ise.narration-plan/v1'; superseded = $false; data = $narrationPlan; metadata = [pscustomobject]@{ eventPlanArtifactId = 'dry-accepted' } },
    [pscustomobject]@{ artifactId = 'dry-blueprint-artifact'; type = 'ise.scene-blueprint/v1'; superseded = $false; data = $sceneBlueprint; metadata = [pscustomobject]@{ narrationPlanArtifactId = 'dry-narration-artifact' } },
    [pscustomobject]@{ artifactId = 'dry-resolved-artifact'; type = 'ise.resolved-scene-plan/v1'; superseded = $false; data = $resolvedScenePlan; metadata = [pscustomobject]@{ sceneBlueprintArtifactId = 'dry-blueprint-artifact' } },
    [pscustomobject]@{ artifactId = 'dry-choreography-artifact'; type = 'ise.choreography-plan/v1'; superseded = $false; data = $choreographyPlan; metadata = [pscustomobject]@{ resolvedScenePlanArtifactId = 'dry-resolved-artifact' } },
    [pscustomobject]@{ artifactId = 'dry-compiled'; type = 'ise.canonical-runtime-plan/v1'; superseded = $false; data = [pscustomobject]@{ runtimePlan = $runtimePlan; sceneProjectConfig = $scene }; metadata = [pscustomobject]@{ eventPlanArtifactId = 'dry-accepted'; narrationPlanArtifactId = 'dry-narration-artifact'; sceneBlueprintArtifactId = 'dry-blueprint-artifact'; resolvedScenePlanArtifactId = 'dry-resolved-artifact'; choreographyPlanArtifactId = 'dry-choreography-artifact' } }
  )
  return [pscustomobject]@{
    EventPlan = $eventPlan; NarrationPlan = $narrationPlan; SceneBlueprint = $sceneBlueprint
    ResolvedScenePlan = $resolvedScenePlan; ChoreographyPlan = $choreographyPlan
    RuntimePlan = $runtimePlan; Scene = $scene
    Selection = Select-CorrelatedArtifacts $artifacts 'dry-revised'
  }
}

function Write-Utf8File {
  param([string]$Path, [string]$Text)
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Export-FinalArtifacts {
  param($OutputDir, $Selection, [string]$SceneId, [string]$SourceAbsolutePath)
  $compiledData = Get-PropertyValue $Selection.Compiled 'data'
  $exports = [ordered]@{
    'event-plan.json' = Get-PropertyValue $Selection.Accepted 'data'
    'narration-plan.json' = Get-PropertyValue $Selection.Narration 'data'
    'scene-blueprint.json' = Get-PropertyValue $Selection.SceneBlueprint 'data'
    'resolved-scene-plan.json' = Get-PropertyValue $Selection.ResolvedScenePlan 'data'
    'choreography-plan.json' = Get-PropertyValue $Selection.ChoreographyPlan 'data'
    'canonical-runtime-plan.json' = Get-PropertyValue $compiledData 'runtimePlan'
    'scene-project.json' = Get-PropertyValue $compiledData 'sceneProjectConfig'
  }
  foreach ($entry in $exports.GetEnumerator()) {
    Assert-NoSecretMaterial $entry.Value $entry.Key $SourceAbsolutePath
  }
  Assert-NoSecretMaterial $SceneId 'scene-id.txt' $SourceAbsolutePath

  if (-not (Test-Path -LiteralPath $OutputDir)) {
    $null = New-Item -ItemType Directory -Path $OutputDir -Force
  }
  foreach ($entry in $exports.GetEnumerator()) {
    Write-Utf8File (Join-Path $OutputDir $entry.Key) ((ConvertTo-JsonText $entry.Value) + [Environment]::NewLine)
  }
  Write-Utf8File (Join-Path $OutputDir 'scene-id.txt') ($SceneId + [Environment]::NewLine)
}

function Get-FlowAccessToken {
  param([string]$BaseUrl)
  $presetToken = [Environment]::GetEnvironmentVariable('ISE_E2E_ACCESS_TOKEN', 'Process')
  if (-not [string]::IsNullOrWhiteSpace($presetToken)) {
    return [string]$presetToken
  }

  $nonce = [Guid]::NewGuid().ToString('N')
  $registration = [ordered]@{
    email = "ise-real-$nonce@example.invalid"
    username = "ise-real-$($nonce.Substring(0, 12))"
    password = "Ise!$nonce"
  }
  $registered = Invoke-JsonRequest POST $BaseUrl '/auth/register' $registration $null 'user registration'
  $authData = Require-EnvelopeData $registered 'REAL_DEMO_REGISTER_RESPONSE_INVALID'
  $accessToken = Require-String (Get-PropertyValue $authData 'access_token') 'REAL_DEMO_REGISTER_RESPONSE_INVALID' 'access token'
  $registration = $null
  $registered = $null
  $authData = $null
  return $accessToken
}

function Invoke-RealFlow {
  param([string]$RepoRoot, [System.IO.FileInfo]$SourceFile, [switch]$AllowGenericScene)
  Add-Type -AssemblyName System.Net.Http
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  $script:HttpClient = New-Object System.Net.Http.HttpClient($handler)
  $script:HttpClient.Timeout = [TimeSpan]::FromMinutes(5)

  $accessToken = Get-FlowAccessToken $ApiBaseUrl

  $uploaded = Invoke-DocxUpload $ApiBaseUrl $SourceFile $accessToken
  $fileData = Require-EnvelopeData $uploaded 'REAL_DEMO_UPLOAD_RESPONSE_INVALID'
  $fileId = Require-OpaqueId (Get-PropertyValue $fileData 'id') 'REAL_DEMO_UPLOAD_RESPONSE_INVALID' 'file id'
  $uploaded = $null
  $fileData = $null

  $created = Invoke-JsonRequest POST $AgentBaseUrl '/sessions' ([ordered]@{}) $accessToken 'session creation'
  $sessionId = Require-String (Get-PropertyValue $created 'sessionId') 'REAL_DEMO_SESSION_RESPONSE_INVALID' 'sessionId'
  try { $null = [Guid]$sessionId } catch { Fail-Flow 'REAL_DEMO_SESSION_RESPONSE_INVALID' 'Agent returned an invalid sessionId.' }
  $encodedSession = [System.Uri]::EscapeDataString($sessionId)

  $null = Invoke-JsonRequest POST $AgentBaseUrl "/sessions/$encodedSession/attachments" ([ordered]@{ fileId = $fileId }) $accessToken 'file attachment'
  $message = [ordered]@{ content = 'Parse the attached battle-review DOCX and propose one grounded EventPlan for battle replay.' }
  $queued = Invoke-JsonRequest POST $AgentBaseUrl "/sessions/$encodedSession/messages" $message $accessToken 'Agent message'
  $null = Require-String (Get-PropertyValue $queued 'runId') 'REAL_DEMO_RUN_RESPONSE_INVALID' 'runId'

  $draft = Wait-ForCondition 'an active EventPlan draft' $DraftTimeoutSeconds {
    $session = Get-SessionView $sessionId $accessToken
    Assert-SessionNotTerminalFailure $session
    $artifacts = @(Get-SessionArtifacts $sessionId $accessToken)
    $drafts = @($artifacts | Where-Object {
      (Get-PropertyValue $_ 'type') -eq 'ise.event-plan-draft/v1' -and -not [bool](Get-PropertyValue $_ 'superseded')
    })
    if ($drafts.Count -gt 1) { Fail-Flow 'RUN_OUTPUT_AMBIGUOUS' 'More than one active EventPlan draft exists.' }
    if ($drafts.Count -eq 1 -and (Get-PropertyValue $session 'status') -eq 'awaiting_review') { return $drafts[0] }
    return $null
  }

  $draftId = Require-String (Get-PropertyValue $draft 'artifactId') 'REAL_DEMO_DRAFT_INVALID' 'draft artifactId'
  $draftPlan = Get-PropertyValue $draft 'data'
  $fixtures = New-DryRunFixtures
  if (-not $SkipActualSchemaValidation) {
    Assert-ActualArtifactSchemas $draftPlan $fixtures.NarrationPlan $fixtures.SceneBlueprint $fixtures.ResolvedScenePlan $fixtures.ChoreographyPlan $fixtures.RuntimePlan $fixtures.Scene $RepoRoot
  }
  $revisedUnits = @(Copy-EventUnits (Get-PropertyValue $draftPlan 'eventUnits'))
  if ($revisedUnits.Count -lt 1) { Fail-Flow 'EVENT_UNIT_REQUIRED' 'The active draft has no EventUnit to revise.' }
  $firstTitle = Require-String (Get-PropertyValue $revisedUnits[0] 'title') 'EVENT_UNIT_INVALID' 'EventUnit title'
  $revisedUnits[0].title = "$firstTitle [reviewed]"

  $encodedDraft = [System.Uri]::EscapeDataString($draftId)
  $revisionBody = [ordered]@{ baseArtifactId = $draftId; eventUnits = @($revisedUnits) }
  $revision = Invoke-JsonRequest POST $AgentBaseUrl "/sessions/$encodedSession/event-plans/$encodedDraft/revisions" $revisionBody $accessToken 'EventPlan revision'
  $revisedArtifact = Get-PropertyValue $revision 'artifact'
  $review = Get-PropertyValue $revision 'review'
  $reviewId = Require-String (Get-PropertyValue $review 'reviewId') 'REAL_DEMO_REVISION_RESPONSE_INVALID' 'reviewId'
  $reviewArtifactId = Require-String (Get-PropertyValue $review 'artifactId') 'REAL_DEMO_REVISION_RESPONSE_INVALID' 'review artifactId'
  $reviewFingerprint = Require-String (Get-PropertyValue $review 'fingerprint') 'REAL_DEMO_REVISION_RESPONSE_INVALID' 'review fingerprint'
  $reviewVersion = Get-PropertyValue $review 'version'
  if ($reviewFingerprint -notmatch '^sha256:[0-9a-f]{64}$' -or $reviewVersion -isnot [ValueType] -or [int]$reviewVersion -lt 1 -or
      $reviewArtifactId -ne (Get-PropertyValue $revisedArtifact 'artifactId') -or
      [int]$reviewVersion -ne [int](Get-PropertyValue $revisedArtifact 'version')) {
    Fail-Flow 'REAL_DEMO_REVISION_RESPONSE_INVALID' 'Revision artifact and review tuple do not match.'
  }
  $revisedPlan = Get-PropertyValue $revisedArtifact 'data'
  if (-not $SkipActualSchemaValidation) {
    Assert-ActualArtifactSchemas $revisedPlan $fixtures.NarrationPlan $fixtures.SceneBlueprint $fixtures.ResolvedScenePlan $fixtures.ChoreographyPlan $fixtures.RuntimePlan $fixtures.Scene $RepoRoot
  }

  $encodedReview = [System.Uri]::EscapeDataString($reviewId)
  $approvalBody = [ordered]@{
    artifactId = $reviewArtifactId
    version = [int]$reviewVersion
    fingerprint = $reviewFingerprint
  }
  $approval = Invoke-JsonRequest POST $AgentBaseUrl "/sessions/$encodedSession/reviews/$encodedReview/approve" $approvalBody $accessToken 'exact review approval'
  $null = Require-String (Get-PropertyValue $approval 'runId') 'REAL_DEMO_APPROVAL_RESPONSE_INVALID' 'downstream runId'

  $completed = Wait-ForCondition 'a correlated completed runtime artifact' $CompileTimeoutSeconds {
    $session = Get-SessionView $sessionId $accessToken
    Assert-SessionNotTerminalFailure $session
    if ((Get-PropertyValue $session 'status') -ne 'completed') { return $null }
    return Select-CorrelatedArtifacts @(Get-SessionArtifacts $sessionId $accessToken) $reviewArtifactId
  }

  Assert-CompiledCorrelation $completed.Compiled $completed.Accepted $reviewArtifactId
  # Actor counts are authored by the source DOCX and may change with the scenario.
  Assert-FinalDomainInvariants $completed -AllowGenericScene:$AllowGenericScene -RequireGeneratedScenario:$StartEndScenario
  $eventPlan = Get-PropertyValue $completed.Accepted 'data'
  $narrationPlan = Get-PropertyValue $completed.Narration 'data'
  $sceneBlueprint = Get-PropertyValue $completed.SceneBlueprint 'data'
  $resolvedScenePlan = Get-PropertyValue $completed.ResolvedScenePlan 'data'
  $choreographyPlan = Get-PropertyValue $completed.ChoreographyPlan 'data'
  $compiledData = Get-PropertyValue $completed.Compiled 'data'
  $runtimePlan = Get-PropertyValue $compiledData 'runtimePlan'
  $sceneProject = Get-PropertyValue $compiledData 'sceneProjectConfig'
  if (-not $SkipActualSchemaValidation) {
    Assert-ActualArtifactSchemas $eventPlan $narrationPlan $sceneBlueprint $resolvedScenePlan $choreographyPlan $runtimePlan $sceneProject $RepoRoot
  }
  Assert-NoSecretMaterial $eventPlan 'event-plan.json' $SourceFile.FullName
  Assert-NoSecretMaterial $narrationPlan 'narration-plan.json' $SourceFile.FullName
  Assert-NoSecretMaterial $sceneBlueprint 'scene-blueprint.json' $SourceFile.FullName
  Assert-NoSecretMaterial $resolvedScenePlan 'resolved-scene-plan.json' $SourceFile.FullName
  Assert-NoSecretMaterial $choreographyPlan 'choreography-plan.json' $SourceFile.FullName
  Assert-NoSecretMaterial $runtimePlan 'canonical-runtime-plan.json' $SourceFile.FullName
  Assert-NoSecretMaterial $sceneProject 'scene-project.json' $SourceFile.FullName

  $sceneTitle = 'ISE real DOCX replay ' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $sceneResponse = Invoke-JsonRequest POST $ApiBaseUrl '/scene' ([ordered]@{ title = $sceneTitle; config = $sceneProject }) $accessToken 'Scene persistence'
  $sceneData = Require-EnvelopeData $sceneResponse 'REAL_DEMO_SCENE_RESPONSE_INVALID'
  $sceneId = Require-String (Get-PropertyValue $sceneData 'id') 'REAL_DEMO_SCENE_RESPONSE_INVALID' 'scene id'

  $outputDir = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    Join-Path $RepoRoot $(if ($AllowGenericScene) { '.superpowers/sdd/cross-document-demo' } else { '.superpowers/sdd/real-demo' })
  } elseif ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    [System.IO.Path]::GetFullPath($OutputDirectory)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $OutputDirectory))
  }
  Export-FinalArtifacts $outputDir $completed $sceneId $SourceFile.FullName
  [Console]::Out.WriteLine("REAL_DEMO_OK: correlated artifacts exported and Scene persisted under $outputDir.")
}

try {
  $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
  Push-Location $repoRoot
  $script:LocationPushed = $true
  $apiUri = Assert-ServiceOrigin $ApiBaseUrl 'REAL_DEMO_API_ORIGIN_INVALID' 'API origin'
  $agentUri = Assert-ServiceOrigin $AgentBaseUrl 'REAL_DEMO_AGENT_ORIGIN_INVALID' 'Agent origin'
  $sourceName = -join ([char[]]@(0x5370, 0x5DF4, 0x8FB9, 0x5883, 0x7A7A, 0x4E2D, 0x5BF9, 0x6297, 0x884C, 0x52A8, 0x6218, 0x540E, 0x590D, 0x76D8, 0x62A5, 0x544A))
  $sourcePath = if ([string]::IsNullOrWhiteSpace($SourceDocxPath)) {
    Join-Path $repoRoot ($sourceName + '.docx')
  } elseif ([System.IO.Path]::IsPathRooted($SourceDocxPath)) {
    [System.IO.Path]::GetFullPath($SourceDocxPath)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $SourceDocxPath))
  }
  $sourceFile = Assert-DocxFile $sourcePath
  Assert-RepositoryContracts $repoRoot
  $fixtures = New-DryRunFixtures
  Assert-ActualArtifactSchemas $fixtures.EventPlan $fixtures.NarrationPlan $fixtures.SceneBlueprint $fixtures.ResolvedScenePlan $fixtures.ChoreographyPlan $fixtures.RuntimePlan $fixtures.Scene $repoRoot
  Assert-FinalDomainInvariants $fixtures.Selection
  Assert-NoSecretMaterial $fixtures.EventPlan 'dry-run EventPlan' $sourceFile.FullName
  Assert-NoSecretMaterial $fixtures.NarrationPlan 'dry-run NarrationPlan' $sourceFile.FullName
  Assert-NoSecretMaterial $fixtures.SceneBlueprint 'dry-run SceneBlueprint' $sourceFile.FullName
  Assert-NoSecretMaterial $fixtures.ResolvedScenePlan 'dry-run ResolvedScenePlan' $sourceFile.FullName
  Assert-NoSecretMaterial $fixtures.ChoreographyPlan 'dry-run ChoreographyPlan' $sourceFile.FullName
  Assert-NoSecretMaterial $fixtures.RuntimePlan 'dry-run RuntimePlan' $sourceFile.FullName
  Assert-NoSecretMaterial $fixtures.Scene 'dry-run SceneProjectConfig' $sourceFile.FullName
  if ($DryRun) {
    [Console]::Out.WriteLine('DRY_RUN_OK: origins, route contracts, source DOCX, seven artifact schemas, and final-domain invariants passed; no service connection or HTTP request was attempted.')
  } else {
    Invoke-RealFlow $repoRoot $sourceFile -AllowGenericScene:$GenericMode
  }
} catch {
  $message = $_.Exception.Message
  if ($message -notmatch '^[A-Z][A-Z0-9_]{2,80}: [^\r\n]{1,500}$') {
    $message = 'REAL_DEMO_UNEXPECTED: Flow failed without exposing private diagnostics.'
  }
  [Console]::Error.WriteLine($message)
  exit 1
} finally {
  if ($null -ne $script:HttpClient) { $script:HttpClient.Dispose() }
  if ($script:LocationPushed) { Pop-Location }
}
