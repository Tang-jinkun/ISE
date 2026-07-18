import type { ScenarioTrajectoryBundle } from './trajectoryCatalog.ts'

export interface ScenarioMatchRule {
  ruleId: string
  entityAliases: readonly string[]
  locationAliases: readonly string[]
  minimumScore: number
}

export interface FactionProfile {
  factionId: string
  aliases: readonly string[]
  displayName: string
}

export interface EntityProfile {
  entityId: string
  aliases: readonly string[]
  platformKind: 'aircraft' | 'weapon' | 'sensor' | 'vehicle' | 'unknown'
  modelAssetAliases: readonly string[]
}

export interface LocationProfile {
  locationId: string
  aliases: readonly string[]
  coordinates?: readonly [number, number]
}

export interface MediaProfile {
  mediaProfileId: string
  aliases: readonly string[]
  assetIds: readonly string[]
}

export interface ScenarioDiagnosticProfile {
  code: string
  message: string
}

export interface ScenarioActorProfile {
  groupId: string
  semanticEntityRef: string
  aliases: readonly string[]
  factionId: string
  locationAliases: readonly string[]
  locationRef: string
  platformType: string
  role: string
  formationPattern: string
  leaderPolicy: string
  behaviorProfile: string
  linkedEvidenceOnly: boolean
  participantAliases: readonly string[]
  sharedEvidenceAliases: readonly string[]
  diagnostics: readonly ScenarioDiagnosticProfile[]
}

export interface WeaponBehaviorProfile {
  factionId?: string
  behaviorProfile: string
  matchTerms: readonly string[]
}

export interface ScenarioQuantityDefault {
  role: string
  value: number
  policyId: string
}

export interface ScenarioPack {
  schemaVersion: 'ise-scenario-pack/v1'
  packId: string
  version: string
  displayName: string
  matchRules: readonly ScenarioMatchRule[]
  factions: readonly FactionProfile[]
  entityProfiles: readonly EntityProfile[]
  locationProfiles: readonly LocationProfile[]
  routeBundles: readonly ScenarioTrajectoryBundle[]
  mediaProfiles: readonly MediaProfile[]
  actorProfiles: readonly ScenarioActorProfile[]
  weaponBehaviorProfiles: readonly WeaponBehaviorProfile[]
  quantityDefaults?: readonly ScenarioQuantityDefault[]
}
