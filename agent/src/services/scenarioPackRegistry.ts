import { indoPakScenarioPack } from '../config/indoPakScenarioPack.ts'
import type { EvidenceIR } from '../contracts/evidence.ts'
import type { EventPlan } from '../contracts/eventPlan.ts'
import type { ScenarioPack } from '../contracts/scenarioPack.ts'
import { diagnostic, type CompilationDiagnostic } from './runtimeDiagnostics.ts'

export const genericScenarioPack: ScenarioPack = {
  schemaVersion: 'ise-scenario-pack/v1',
  packId: 'generic/v1',
  displayName: 'Generic',
  matchRules: [],
  factions: [],
  entityProfiles: [],
  locationProfiles: [],
  routeBundles: [],
  mediaProfiles: [],
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/[\s\-_.]+/g, '').toLocaleLowerCase('en-US')
}

function explicitEvidenceTokens(evidence: EvidenceIR): Set<string> {
  return new Set(evidence.records
    .filter(record => record.kind === 'explicit_fact')
    .flatMap(record => [...record.entities, ...(record.locationExpression ? [record.locationExpression] : [])])
    .map(normalize))
}

function score(pack: ScenarioPack, evidence: EvidenceIR): number {
  const tokens = explicitEvidenceTokens(evidence)
  return Math.max(0, ...pack.matchRules.map(rule => {
    const matches = new Set([
      ...rule.entityAliases,
      ...rule.locationAliases,
    ].map(normalize).filter(alias => tokens.has(alias))).size
    return matches >= rule.minimumScore ? matches : 0
  }))
}

export interface ScenarioPackSelection {
  pack: ScenarioPack
  diagnostics: CompilationDiagnostic[]
}

export function selectScenarioPackFrom(
  packs: readonly ScenarioPack[],
  _eventPlan: EventPlan,
  evidence: EvidenceIR,
): ScenarioPackSelection {
  const scored = packs.map(pack => ({ pack, score: score(pack, evidence) }))
  const highestScore = Math.max(0, ...scored.map(candidate => candidate.score))
  const winners = scored.filter(candidate => candidate.score === highestScore && candidate.score > 0)
  const winner = winners[0]
  if (winner !== undefined && winners.length === 1) return { pack: winner.pack, diagnostics: [] }

  if (winners.length > 1) return {
    pack: genericScenarioPack,
    diagnostics: [diagnostic(
      'SCENARIO_PACK_AMBIGUOUS',
      'Multiple scenario packs matched the same explicit evidence score; using generic/v1.',
      'warning',
    )],
  }

  return {
    pack: genericScenarioPack,
    diagnostics: [diagnostic(
      'SCENARIO_PACK_NOT_MATCHED',
      'No scenario pack matched explicit entity and location evidence; using generic/v1.',
      'warning',
    )],
  }
}

export function selectScenarioPack(eventPlan: EventPlan, evidence: EvidenceIR): ScenarioPackSelection {
  return selectScenarioPackFrom([indoPakScenarioPack], eventPlan, evidence)
}
