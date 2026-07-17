import assert from 'node:assert/strict'
import test from 'node:test'
import { ArtifactStore, DomainStateStore, type AgentContext } from '@ise/agent-core'
import { EVENT_PLAN_ACCEPTED_ARTIFACT } from '../src/contracts/artifactTypes.ts'
import {
  narrativePlanInputJsonSchema,
  narrativePlanSchema,
  type NarrativePlan,
} from '../src/contracts/narrativePlan.ts'
import { eventPlanSchema } from '../src/contracts/eventPlan.ts'
import { fingerprint } from '../src/services/fingerprint.ts'
import { createScenePlanTools } from '../src/tools/scenePlanTools.ts'
import { CompilationError } from '../src/services/runtimeDiagnostics.ts'

function context(includeSecondUnit = false): { context: AgentContext; acceptedId: string; acceptedFingerprint: string } {
  const artifacts = new ArtifactStore()
  const plan = eventPlanSchema.parse({
    schemaVersion: 'event-plan/v1', planId: 'plan-1', documentId: 'doc-1', version: 2,
    eventUnits: [{
      eventUnitId: 'unit-1', title: 'Deployment', worldStateChange: 'Aircraft deployed',
      participants: ['JF-17'], locationRefs: ['border'], evidenceRefs: ['ev-1', 'ev-2'], inferenceRefs: [],
      uncertainties: [], narrativePurpose: 'Opening', importance: 'high',
    }, ...(includeSecondUnit ? [{
      eventUnitId: 'unit-2', title: 'Interception', worldStateChange: 'Aircraft intercepted',
      participants: ['Rafale'], locationRefs: ['border'], evidenceRefs: ['ev-3'], inferenceRefs: [],
      uncertainties: [], narrativePurpose: 'Action', importance: 'medium' as const,
    }] : [])],
    omittedEvidence: [], warnings: [],
  })
  const acceptedFingerprint = fingerprint(plan)
  const accepted = artifacts.create({
    id: 'accepted-1', type: EVENT_PLAN_ACCEPTED_ARTIFACT, version: 2, createdBy: 'user',
    logicalKey: 'accepted-event-plan:plan-1', data: plan,
    metadata: {
      planId: 'plan-1', documentId: 'doc-1', version: 2, fingerprint: acceptedFingerprint,
      acceptedDraftArtifactId: 'draft-2', confirmationId: 'review:r1:user-1', status: 'accepted',
    },
  })
  return {
    acceptedId: accepted.id,
    acceptedFingerprint,
    context: {
      workspace: process.cwd(),
      goal: { objective: 'test', status: 'active', turnCount: 0, maxTurns: 1, evidence: [], remainingIssues: [], startedAt: new Date(0).toISOString() },
      artifacts,
      domainState: new DomainStateStore(),
    },
  }
}

function validNarrativePlan(): NarrativePlan {
  const fixture = context()
  return {
    schemaVersion: 'narrative-plan/v1',
    narrativePlanId: 'narrative-1',
    sourceEventPlan: {
      artifactId: fixture.acceptedId, planId: 'plan-1', version: 2, fingerprint: fixture.acceptedFingerprint,
    },
    targetDurationMs: 180_000,
    subtitles: [{ subtitleId: 'subtitle-1', eventUnitId: 'unit-1', text: 'Aircraft deployed', evidenceRefs: ['ev-1'], importance: 'high' }],
    sceneRequirements: [{
      requirementId: 'requirement-1', eventUnitId: 'unit-1', focusEntities: ['JF-17'],
      spatialRelations: ['near border'], stateChanges: ['deployment'], motionRequirements: ['follow route'],
      attentionRequirements: ['show deployment'], requiredFacts: ['Aircraft deployed'], forbiddenClaims: ['confirmed hit'],
      preferredTemplate: 'deployment',
    }],
  }
}

test('NarrativePlan contains no commands or exact playback times', () => {
  assert.equal(narrativePlanSchema.safeParse({ ...validNarrativePlan(), commands: [] }).success, false)
  assert.equal(narrativePlanSchema.safeParse({ ...validNarrativePlan(), startMs: 0 }).success, false)
})

test('NarrativePlan defaults targetDurationMs to 180 seconds', () => {
  const { targetDurationMs: _omitted, ...withoutDuration } = validNarrativePlan()
  assert.equal(narrativePlanSchema.parse(withoutDuration).targetDurationMs, 180_000)
  assert.equal((narrativePlanInputJsonSchema.required as string[]).includes('targetDurationMs'), false)
})

test('propose_scene_plan requires the exact accepted EventPlan tuple', async () => {
  const fixture = context()
  const input = validNarrativePlan()
  input.sourceEventPlan = { ...input.sourceEventPlan, fingerprint: `sha256:${'0'.repeat(64)}` }
  const tool = createScenePlanTools()[0]!
  await assert.rejects(tool.execute(input, fixture.context), /Accepted EventPlan fingerprint mismatch/)
})

test('subtitles may cite only refs present on their EventUnit', async () => {
  const fixture = context()
  const input = validNarrativePlan()
  input.subtitles[0]!.evidenceRefs = ['ev-outside-unit']
  const tool = createScenePlanTools()[0]!
  await assert.rejects(tool.execute(input, fixture.context), /Narrative evidence is not linked/)
})

test('scene requirements must reference an accepted EventUnit', async () => {
  const fixture = context()
  const input = validNarrativePlan()
  input.sceneRequirements[0]!.eventUnitId = 'missing-unit'
  const tool = createScenePlanTools()[0]!
  await assert.rejects(tool.execute(input, fixture.context), /Unknown EventUnit in scene requirement/)
})

test('propose_scene_plan creates one grounded semantic artifact', async () => {
  const fixture = context()
  const result = await createScenePlanTools()[0]!.execute(validNarrativePlan(), fixture.context)
  assert.equal(result.artifacts?.length, 1)
  assert.equal(result.artifacts?.[0]?.type, 'ise.narrative-plan/v1')
  assert.equal(JSON.stringify(result).includes('startMs'), false)
  assert.equal(JSON.stringify(result).includes('assetId'), false)
})

test('propose_scene_plan raises target duration to the deterministic narration floor', async () => {
  const fixture = context(true)
  const input = validNarrativePlan()
  input.sourceEventPlan = {
    artifactId: fixture.acceptedId, planId: 'plan-1', version: 2, fingerprint: fixture.acceptedFingerprint,
  }
  input.subtitles = [
    { subtitleId: 'subtitle-1', eventUnitId: 'unit-1', text: '\u4e2d'.repeat(400), evidenceRefs: ['ev-1'], importance: 'high' },
    { subtitleId: 'subtitle-2', eventUnitId: 'unit-2', text: '\u6587'.repeat(400), evidenceRefs: ['ev-3'], importance: 'medium' },
  ]
  input.sceneRequirements.push({
    ...input.sceneRequirements[0]!, requirementId: 'requirement-2', eventUnitId: 'unit-2',
  })

  const result = await createScenePlanTools()[0]!.execute(input, fixture.context)
  const artifactPlan = result.artifacts?.[0]?.data as NarrativePlan
  const content = JSON.parse(result.content)

  // 102s high beat + 101s medium beat + 1s unit transition + 0.5s model hide.
  assert.equal(artifactPlan.targetDurationMs, 204_500)
  assert.equal(content.targetDurationMs, 204_500)
})

test('propose_scene_plan never lowers an already sufficient target duration', async () => {
  const fixture = context()
  const input = validNarrativePlan()
  input.targetDurationMs = 300_000

  const result = await createScenePlanTools()[0]!.execute(input, fixture.context)
  const artifactPlan = result.artifacts?.[0]?.data as NarrativePlan

  assert.equal(artifactPlan.targetDurationMs, 300_000)
  assert.equal(JSON.parse(result.content).targetDurationMs, 300_000)
})

test('propose_scene_plan rejects narration floors above the schema duration limit', async () => {
  const fixture = context()
  const input = validNarrativePlan()
  input.subtitles[0]!.text = '\u4e2d'.repeat(2_400)

  await assert.rejects(
    createScenePlanTools()[0]!.execute(input, fixture.context),
    (error: unknown) => error instanceof CompilationError
      && error.diagnostics.some(item => item.code === 'NARRATIVE_DURATION_UNSUPPORTED'),
  )
})
