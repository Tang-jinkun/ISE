import type { ScenarioTrajectoryBundle } from './trajectoryCatalog.ts'

export interface ScenarioMatchRule {
  ruleId: string
  entityAliases: string[]
  locationAliases: string[]
  minimumScore: number
}

export interface FactionProfile {
  factionId: string
  aliases: string[]
  displayName: string
}

export interface EntityProfile {
  entityId: string
  aliases: string[]
  platformKind: 'aircraft' | 'weapon' | 'sensor' | 'vehicle' | 'unknown'
  modelAssetAliases: string[]
}

export interface LocationProfile {
  locationId: string
  aliases: string[]
}

export interface MediaProfile {
  mediaProfileId: string
  aliases: string[]
  assetIds: string[]
}

export interface ScenarioDiagnosticProfile {
  code: string
  message: string
}

export interface ScenarioActorProfile {
  groupId: string
  semanticEntityRef: string
  aliases: string[]
  factionId: string
  locationAliases: string[]
  locationRef: string
  platformType: string
  role: string
  formationPattern: string
  leaderPolicy: string
  behaviorProfile: string
  linkedEvidenceOnly: boolean
  participantAliases: string[]
  sharedEvidenceAliases: string[]
  diagnostics: ScenarioDiagnosticProfile[]
}

export interface WeaponBehaviorProfile {
  factionId?: string
  behaviorProfile: string
  matchTerms: string[]
}

export interface ScenarioPack {
  schemaVersion: 'ise-scenario-pack/v1'
  packId: string
  version: string
  displayName: string
  matchRules: ScenarioMatchRule[]
  factions: FactionProfile[]
  entityProfiles: EntityProfile[]
  locationProfiles: LocationProfile[]
  routeBundles: ScenarioTrajectoryBundle[]
  mediaProfiles: MediaProfile[]
  actorProfiles: ScenarioActorProfile[]
  weaponBehaviorProfiles: WeaponBehaviorProfile[]
}
