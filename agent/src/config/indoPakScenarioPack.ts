import type { ScenarioPack } from '../contracts/scenarioPack.ts'
import { indoPakRouteBundles } from './indoPakTrajectoryScenario.ts'

/** Data-only metadata for the existing Indo-Pak assets and routes. */
export const indoPakScenarioPack: ScenarioPack = {
  schemaVersion: 'ise-scenario-pack/v1',
  packId: 'indo-pak-air-combat/v1',
  displayName: 'Indo-Pak Air Combat',
  matchRules: [{
    ruleId: 'indo-pak-explicit-platform-and-location/v1',
    entityAliases: ['Su-30MKI', 'Rafale', 'JF-17', 'Netra AEW&CS', 'Saab 2000 Erieye', 'ZDK-03'],
    locationAliases: ['Adampur', 'Ambala', 'Minhas', 'Minas', 'Rafiki'],
    minimumScore: 2,
  }],
  factions: [
    { factionId: 'india', aliases: ['India'], displayName: 'India' },
    { factionId: 'pakistan', aliases: ['Pakistan'], displayName: 'Pakistan' },
  ],
  entityProfiles: [
    { entityId: 'su30mki', aliases: ['Su-30MKI'], platformKind: 'aircraft', modelAssetAliases: ['model:su30mki'] },
    { entityId: 'rafale', aliases: ['Rafale'], platformKind: 'aircraft', modelAssetAliases: ['model:rafale'] },
    { entityId: 'jf17', aliases: ['JF-17'], platformKind: 'aircraft', modelAssetAliases: ['model:jf17'] },
    { entityId: 'netra-awacs', aliases: ['Netra AEW&CS', 'Netra'], platformKind: 'sensor', modelAssetAliases: ['model:netra-awacs'] },
    { entityId: 'pakistan-awacs', aliases: ['Saab 2000 Erieye', 'ZDK-03'], platformKind: 'sensor', modelAssetAliases: ['model:awacs-generic-e3a'] },
    { entityId: 'pl15e', aliases: ['PL-15E', 'missile'], platformKind: 'weapon', modelAssetAliases: ['model:pl15e'] },
  ],
  locationProfiles: [
    { locationId: 'location:adampur', aliases: ['Adampur'] },
    { locationId: 'location:ambala', aliases: ['Ambala'] },
    { locationId: 'location:minhas', aliases: ['Minhas', 'Minas'] },
    { locationId: 'location:rafiki', aliases: ['Rafiki'] },
  ],
  routeBundles: indoPakRouteBundles,
  mediaProfiles: [],
}
