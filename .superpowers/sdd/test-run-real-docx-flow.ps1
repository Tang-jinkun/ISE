[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$flowPath = Join-Path $PSScriptRoot 'run-real-docx-flow.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($flowPath, [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'Flow script does not parse.' }

$flowText = [System.IO.File]::ReadAllText($flowPath)
foreach ($marker in @(
  'eventPlanSchema',
  'narrationPlanSchema',
  'sceneBlueprintSchema',
  'resolvedScenePlanSchema',
  'choreographyPlanSchema',
  'canonicalRuntimePlanSchema',
  'sceneProjectConfigSchema',
  'event-plan.json',
  'narration-plan.json',
  'scene-blueprint.json',
  'resolved-scene-plan.json',
  'choreography-plan.json',
  'canonical-runtime-plan.json',
  'scene-project.json'
)) {
  if (-not $flowText.Contains($marker)) { throw "Missing final artifact contract marker: $marker" }
}

foreach ($name in @(
  'Fail-Flow',
  'Get-PropertyValue',
  'Require-String',
  'ConvertTo-JsonText',
  'Copy-EventUnits',
  'Get-SessionArtifacts',
  'Assert-NoSecretMaterial',
  'Write-Utf8File',
  'Select-CorrelatedArtifacts',
  'Assert-FinalDomainInvariants',
  'Export-FinalArtifacts'
)) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if ($null -eq $functionAst) { throw "Missing function under test: $name" }
  Invoke-Expression $functionAst.Extent.Text
}

function Invoke-JsonRequest {
  return [pscustomobject]@{ artifacts = @() }
}

$dictionaryValues = @(Get-PropertyValue ([ordered]@{ values = @('one', 'two') }) 'values')
if ($dictionaryValues.Count -ne 2 -or $dictionaryValues[1] -ne 'two') {
  throw 'Expected ordered dictionary properties to be readable.'
}

$script:AgentBaseUrl = 'http://127.0.0.1:4444'
$actual = @(Get-SessionArtifacts 'test-session' 'test-token')
if ($actual.Count -ne 0) { throw 'Expected an empty artifact ledger.' }

$sourceUnits = @(
  [pscustomobject]@{ eventUnitId = 'one'; title = 'First' },
  [pscustomobject]@{ eventUnitId = 'two'; title = 'Second' }
)
$copiedUnits = @(Copy-EventUnits $sourceUnits)
if ($copiedUnits.Count -ne 2 -or $copiedUnits[0].title -ne 'First' -or $copiedUnits[1].title -ne 'Second') {
  throw 'Expected EventUnit JSON cloning to preserve a flat array.'
}

$artifacts = @(
  [pscustomobject]@{
    artifactId = 'accepted-1'; type = 'ise.event-plan-accepted/v1'; superseded = $false
    data = [pscustomobject]@{ planId = 'event-plan-1' }
    metadata = [pscustomobject]@{ acceptedDraftArtifactId = 'revised-1' }
  },
  [pscustomobject]@{
    artifactId = 'narration-1'; type = 'ise.narration-plan/v1'; superseded = $false
    data = [pscustomobject]@{ narrationPlanId = 'narration-plan-1'; sourceEventPlanId = 'event-plan-1' }
    metadata = [pscustomobject]@{ eventPlanArtifactId = 'accepted-1' }
  },
  [pscustomobject]@{
    artifactId = 'blueprint-1'; type = 'ise.scene-blueprint/v1'; superseded = $false
    data = [pscustomobject]@{
      blueprintId = 'blueprint-plan-1'; sourceNarrationPlanId = 'narration-plan-1'
      actorGroups = @([pscustomobject]@{ groupId = 'group-a' }, [pscustomobject]@{ groupId = 'group-b' })
    }
    metadata = [pscustomobject]@{ narrationPlanArtifactId = 'narration-1' }
  },
  [pscustomobject]@{
    artifactId = 'resolved-1'; type = 'ise.resolved-scene-plan/v1'; superseded = $false
    data = [pscustomobject]@{
      resolvedScenePlanId = 'resolved-plan-1'; sourceBlueprintId = 'blueprint-plan-1'
      resolvedActors = @(
        [pscustomobject]@{ actorInstanceId = 'actor:a' },
        [pscustomobject]@{ actorInstanceId = 'actor:b' }
      )
      actorRouteAssignments = @(
        [pscustomobject]@{ actorInstanceRef = 'actor:a'; trajectoryAssetRef = 'trajectory:a'; sourceKind = 'catalog' },
        [pscustomobject]@{ actorInstanceRef = 'actor:b'; trajectoryAssetRef = 'trajectory:b'; sourceKind = 'catalog' }
      )
      fallbackTrajectoryRecipes = @()
      diagnostics = @()
    }
    metadata = [pscustomobject]@{ sceneBlueprintArtifactId = 'blueprint-1' }
  },
  [pscustomobject]@{
    artifactId = 'choreography-1'; type = 'ise.choreography-plan/v1'; superseded = $false
    data = [pscustomobject]@{
      choreographyPlanId = 'choreography-plan-1'; sourceResolvedScenePlanId = 'resolved-plan-1'
      actorInstances = @(
        [pscustomobject]@{ actorInstanceId = 'actor:a' },
        [pscustomobject]@{ actorInstanceId = 'actor:b' }
      )
    }
    metadata = [pscustomobject]@{ resolvedScenePlanArtifactId = 'resolved-1' }
  },
  [pscustomobject]@{
    artifactId = 'compiled-1'; type = 'ise.canonical-runtime-plan/v1'; superseded = $false
    data = [pscustomobject]@{
      runtimePlan = [pscustomobject]@{
        planId = 'runtime-plan-1'; eventPlanArtifactId = 'accepted-1'
        entities = @(
          [pscustomobject]@{ entityId = 'actor:a'; defaultTrajectoryAssetId = 'trajectory:a' },
          [pscustomobject]@{ entityId = 'actor:b'; defaultTrajectoryAssetId = 'trajectory:b' }
        )
        subtitles = @([pscustomobject]@{ subtitleId = 'subtitle-1'; eventUnitId = 'event-1'; startMs = 100 })
        commands = @(
          [pscustomobject]@{ commandId = 'follow-a'; eventUnitId = 'event-1'; type = 'model.follow_path'; startMs = 900; params = [pscustomobject]@{ entityId = 'actor:a'; trajectoryAssetId = 'trajectory:a' } },
          [pscustomobject]@{ commandId = 'follow-b'; eventUnitId = 'event-1'; type = 'model.follow_path'; startMs = 900; params = [pscustomobject]@{ entityId = 'actor:b'; trajectoryAssetId = 'trajectory:b' } },
          [pscustomobject]@{ commandId = 'image-1'; eventUnitId = 'event-1'; type = 'image.show'; startMs = 900; params = [pscustomobject]@{ assetId = 'image:a' } },
          [pscustomobject]@{ commandId = 'video-1'; eventUnitId = 'event-1'; type = 'video.play'; startMs = 1000; params = [pscustomobject]@{ assetId = 'video:a' } }
        )
        lineage = @([pscustomobject]@{
          outputId = 'follow-a'
          sourceArtifactIds = @('accepted-1', 'narration-1', 'blueprint-1', 'resolved-1', 'choreography-1')
        })
        diagnostics = @()
      }
      sceneProjectConfig = [pscustomobject]@{
        schemaVersion = 'ise-scene/v1'; eventPlanArtifactId = 'accepted-1'; runtimePlanArtifactId = 'compiled-1'
      }
    }
    metadata = [pscustomobject]@{
      eventPlanArtifactId = 'accepted-1'
      narrationPlanArtifactId = 'narration-1'
      sceneBlueprintArtifactId = 'blueprint-1'
      resolvedScenePlanArtifactId = 'resolved-1'
      choreographyPlanArtifactId = 'choreography-1'
    }
  }
)

$selection = Select-CorrelatedArtifacts $artifacts 'revised-1'
if ($selection.Accepted.artifactId -ne 'accepted-1' -or
    $selection.Narration.artifactId -ne 'narration-1' -or
    $selection.SceneBlueprint.artifactId -ne 'blueprint-1' -or
    $selection.ResolvedScenePlan.artifactId -ne 'resolved-1' -or
    $selection.ChoreographyPlan.artifactId -ne 'choreography-1' -or
    $selection.Compiled.artifactId -ne 'compiled-1') {
  throw 'Expected exact correlated final artifact selection.'
}
Assert-FinalDomainInvariants $selection

function Assert-InvariantRejected {
  param([scriptblock]$Mutate, [string]$Label)
  $invalidSelection = (ConvertTo-JsonText $selection) | ConvertFrom-Json
  & $Mutate $invalidSelection
  $rejected = $false
  try { Assert-FinalDomainInvariants $invalidSelection }
  catch { $rejected = $_.Exception.Message -match '^REAL_DEMO_FINAL_DOMAIN_INVALID:' }
  if (-not $rejected) { throw "Expected final-domain rejection: $Label" }
}
Assert-InvariantRejected {
  param($value)
  $value.ResolvedScenePlan.data.actorRouteAssignments[0].sourceKind = 'illustrative'
} 'non-catalog assignment'
Assert-InvariantRejected {
  param($value)
  $value.ResolvedScenePlan.data.actorRouteAssignments[1].trajectoryAssetRef = 'trajectory:a'
} 'duplicate route'
Assert-InvariantRejected {
  param($value)
  $value.ResolvedScenePlan.data.diagnostics = @([pscustomobject]@{ code = 'TRAJECTORY_SYNTHESIZED' })
} 'synthesized trajectory diagnostic'
Assert-InvariantRejected {
  param($value)
  $value.Compiled.data.runtimePlan.entities[1].entityId = 'actor:other'
} 'runtime entity drift'
Assert-InvariantRejected {
  param($value)
  $value.Compiled.data.runtimePlan.commands = @(
    $value.Compiled.data.runtimePlan.commands | Where-Object { $_.type -ne 'image.show' }
  )
} 'missing image command'
Assert-InvariantRejected {
  param($value)
  $value.Compiled.data.runtimePlan.subtitles[0].startMs = 101
} 'visual lead below 800ms'

$ambiguous = @($artifacts) + [pscustomobject]@{
  artifactId = 'narration-1'; type = 'ise.narration-plan/v1'; superseded = $false
  data = [pscustomobject]@{ narrationPlanId = 'duplicate'; sourceEventPlanId = 'event-plan-1' }
  metadata = [pscustomobject]@{ eventPlanArtifactId = 'accepted-1' }
}
$ambiguityRejected = $false
try { $null = Select-CorrelatedArtifacts $ambiguous 'revised-1' }
catch { $ambiguityRejected = $_.Exception.Message -match '^RUN_OUTPUT_AMBIGUOUS:' }
if (-not $ambiguityRejected) { throw 'Expected duplicate active final artifacts to be rejected.' }

$exportDir = Join-Path ([System.IO.Path]::GetTempPath()) ('ise-flow-test-' + [Guid]::NewGuid().ToString('N'))
try {
  Export-FinalArtifacts $exportDir $selection 'scene-1' 'C:\source\report.docx'
  $expectedFiles = @(
    'event-plan.json',
    'narration-plan.json',
    'scene-blueprint.json',
    'resolved-scene-plan.json',
    'choreography-plan.json',
    'canonical-runtime-plan.json',
    'scene-project.json',
    'scene-id.txt'
  )
  $actualFiles = @(Get-ChildItem -LiteralPath $exportDir -File | Sort-Object Name | ForEach-Object { $_.Name })
  if (($actualFiles -join '|') -ne (($expectedFiles | Sort-Object) -join '|')) {
    throw 'Expected the exact seven JSON artifacts plus scene-id.txt.'
  }
  foreach ($name in $expectedFiles) {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $exportDir $name))
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
      throw "Expected BOM-free UTF-8 export: $name"
    }
  }
} finally {
  if (Test-Path -LiteralPath $exportDir) { Remove-Item -LiteralPath $exportDir -Recurse -Force }
}

[Console]::Out.WriteLine('EMPTY_ARTIFACT_LEDGER=ok')
[Console]::Out.WriteLine('ORDERED_DICTIONARY_PROPERTY=ok')
[Console]::Out.WriteLine('EVENT_UNIT_COPY=ok')
[Console]::Out.WriteLine('CORRELATED_ARTIFACT_SELECTION=ok')
[Console]::Out.WriteLine('FINAL_DOMAIN_INVARIANTS=ok')
[Console]::Out.WriteLine('FINAL_ARTIFACT_EXPORT=ok')
