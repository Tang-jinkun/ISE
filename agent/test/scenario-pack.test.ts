import assert from 'node:assert/strict'
import test from 'node:test'
import type { EvidenceIR } from '../src/contracts/evidence.ts'
import type { EventPlan } from '../src/contracts/eventPlan.ts'
import type { ScenarioPack } from '../src/contracts/scenarioPack.ts'
import { indoPakScenarioPack } from '../src/config/indoPakScenarioPack.ts'
import { genericScenarioPack, legacyCompatibilityPackForBlueprint, selectScenarioPack, selectScenarioPackFrom } from '../src/services/scenarioPackRegistry.ts'

function eventPlan(): EventPlan {
  return {
    schemaVersion: 'event-plan/v1', planId: 'event-plan:test', documentId: 'doc:test', version: 1,
    eventUnits: [{
      eventUnitId: 'event:test', title: 'test', worldStateChange: 'test', participants: ['test'],
      locationRefs: ['location:test'], evidenceRefs: ['ev:test'], inferenceRefs: [], uncertainties: [],
      narrativePurpose: 'test', importance: 'low',
    }],
    omittedEvidence: [], warnings: [],
  }
}

function evidence(records: EvidenceIR['records']): EvidenceIR {
  return { schemaVersion: 'evidence-ir/v1', documentId: 'doc:test', records }
}

test('selects the Indo-Pak pack from explicit entity and location evidence', () => {
  const result = selectScenarioPack(eventPlan(), evidence([{
    evidenceId: 'ev:test', sourceRef: 'docx:p1', claim: 'A report', kind: 'explicit_fact',
    entities: ['Su-30MKI', 'Adampur'], locationExpression: 'Adampur', confidence: 1, ambiguities: [],
  }]))

  assert.equal(result.pack.packId, 'indo-pak-air-combat/v1')
  assert.deepEqual(result.diagnostics, [])
  assert.deepEqual(
    result.pack.routeBundles.find(bundle => bundle.bundleId === 'formation:india-su30-adampur')?.routeAssetRefs,
    ['trajectory:adampur-vampire-1', 'trajectory:adampur-vampire-2', 'trajectory:adampur-vampire-3', 'trajectory:adampur-vampire-4'],
  )
})

test('returns the empty generic pack when explicit evidence does not match a pack', () => {
  const result = selectScenarioPack(eventPlan(), evidence([{
    evidenceId: 'ev:test', sourceRef: 'docx:p1', claim: 'Mentions a named air base', kind: 'explicit_fact',
    entities: ['unrelated-aircraft'], locationExpression: 'unrelated-base', confidence: 1, ambiguities: [],
  }]))

  assert.equal(result.pack.packId, 'generic/v1')
  assert.equal(result.diagnostics[0]?.code, 'SCENARIO_PACK_NOT_MATCHED')
  assert.deepEqual(genericScenarioPack.factions, [])
  assert.deepEqual(genericScenarioPack.entityProfiles, [])
  assert.deepEqual(genericScenarioPack.locationProfiles, [])
  assert.deepEqual(genericScenarioPack.routeBundles, [])
  assert.deepEqual(genericScenarioPack.mediaProfiles, [])
})

test('requires both an explicit known entity and an explicit known location', () => {
  const result = selectScenarioPack(eventPlan(), evidence([{
    evidenceId: 'ev:test', sourceRef: 'docx:p1', claim: 'A report', kind: 'explicit_fact',
    entities: ['Su-30MKI'], confidence: 1, ambiguities: [],
  }]))

  assert.equal(result.pack.packId, 'generic/v1')
  assert.equal(result.diagnostics[0]?.code, 'SCENARIO_PACK_NOT_MATCHED')
})

test('returns generic and ambiguity diagnostics when packs tie', () => {
  const tiedPack: ScenarioPack = {
    ...indoPakScenarioPack,
    packId: 'indo-pak-air-combat-copy/v1',
    displayName: 'Copy',
  }
  const result = selectScenarioPackFrom([indoPakScenarioPack, tiedPack], eventPlan(), evidence([{
    evidenceId: 'ev:test', sourceRef: 'docx:p1', claim: 'A report', kind: 'explicit_fact',
    entities: ['Su-30MKI', 'Adampur'], locationExpression: 'Adampur', confidence: 1, ambiguities: [],
  }]))

  assert.equal(result.pack.packId, 'generic/v1')
  assert.equal(result.diagnostics[0]?.code, 'SCENARIO_PACK_AMBIGUOUS')
})

test('selects deterministically for repeated identical EvidenceIR', () => {
  const input = evidence([{
    evidenceId: 'ev:test', sourceRef: 'docx:p1', claim: 'A report', kind: 'explicit_fact',
    entities: ['Su-30MKI', 'Adampur'], locationExpression: 'Adampur', confidence: 1, ambiguities: [],
  }])
  const selections = Array.from({ length: 10 }, () => selectScenarioPack(eventPlan(), input))

  assert.deepEqual(selections.map(selection => ({ packId: selection.pack.packId, diagnostics: selection.diagnostics })),
    Array.from({ length: 10 }, () => ({ packId: 'indo-pak-air-combat/v1', diagnostics: [] })))
})

test('provides a registry-owned compatibility pack only for blueprints without lineage', () => {
  assert.equal(legacyCompatibilityPackForBlueprint(undefined)?.packId, 'indo-pak-air-combat/v1')
  assert.equal(legacyCompatibilityPackForBlueprint({ packId: 'missing/v1', version: '1' }), undefined)
})
