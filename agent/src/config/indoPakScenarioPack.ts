import type { ScenarioPack } from '../contracts/scenarioPack.ts'
import { indoPakRouteBundles } from './indoPakTrajectoryScenario.ts'

function routeBundle(bundleId: string) {
  const bundle = indoPakRouteBundles.find(candidate => candidate.bundleId === bundleId)
  if (bundle === undefined) throw new Error(`Missing scenario route bundle: ${bundleId}`)
  return bundle
}

const su30 = routeBundle('formation:india-su30-adampur')
const rafale = routeBundle('formation:india-rafale-ambala')
const minhas = routeBundle('formation:pakistan-jf17-minhas')
const rafiki = routeBundle('formation:pakistan-jf17-rafiki')
const netra = routeBundle('support:india-netra-awacs')
const pakistanAwacs = routeBundle('support:pakistan-awacs-proxy')
const matchEntityAliases = [
  ...su30.semanticEntityAliases, ...rafale.semanticEntityAliases,
  ...minhas.semanticEntityAliases, ...netra.semanticEntityAliases, ...pakistanAwacs.semanticEntityAliases,
]
const matchLocationAliases = [
  ...su30.locationRefs, ...rafale.locationRefs, ...minhas.locationRefs, ...rafiki.locationRefs,
].filter(alias => !alias.startsWith('location:'))
matchLocationAliases.push('米纳斯', '拉菲基')

/** Data-only metadata for the existing Indo-Pak assets and routes. */
export const indoPakScenarioPack: ScenarioPack = {
  schemaVersion: 'ise-scenario-pack/v1',
  packId: 'indo-pak-air-combat/v1',
  version: '1',
  displayName: 'Indo-Pak Air Combat',
  matchRules: [{
    ruleId: 'indo-pak-explicit-platform-and-location/v1',
    entityAliases: matchEntityAliases,
    locationAliases: matchLocationAliases,
    minimumScore: 2,
  }],
  factions: [
    { factionId: 'india', aliases: ['India', '印方'], displayName: 'India' },
    { factionId: 'pakistan', aliases: ['Pakistan', '巴方'], displayName: 'Pakistan' },
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
  actorProfiles: [
    {
      groupId: 'group:india-su30-adampur', semanticEntityRef: su30.semanticEntityAliases[2] ?? su30.semanticEntityAliases[0]!,
      aliases: su30.semanticEntityAliases, factionId: 'india', locationAliases: su30.locationRefs,
      locationRef: 'location:adampur', platformType: 'fighter', role: 'fighter-formation',
      formationPattern: 'finger-four', leaderPolicy: 'stable-first-member', behaviorProfile: 'fighter-formation/v1',
      linkedEvidenceOnly: false, participantAliases: [...su30.semanticEntityAliases, 'Indian formation', '印方编队'], sharedEvidenceAliases: [],
      diagnostics: [{ code: 'SCENARIO_LOCAL_CALLSIGN_MAPPING', message: 'Vampire is a scenario-local Su-30MKI callsign, not a global synonym.' }],
    },
    {
      groupId: 'group:india-rafale-ambala', semanticEntityRef: rafale.semanticEntityAliases[2] ?? rafale.semanticEntityAliases[0]!,
      aliases: rafale.semanticEntityAliases, factionId: 'india', locationAliases: rafale.locationRefs,
      locationRef: 'location:ambala', platformType: 'fighter', role: 'fighter-formation',
      formationPattern: 'finger-four', leaderPolicy: 'stable-first-member', behaviorProfile: 'fighter-formation/v1',
      linkedEvidenceOnly: false, participantAliases: [...rafale.semanticEntityAliases, 'Indian formation', '印方编队'], sharedEvidenceAliases: [], diagnostics: [],
    },
    {
      groupId: 'group:pakistan-jf17-minhas', semanticEntityRef: minhas.semanticEntityAliases[0]!,
      aliases: [...minhas.semanticEntityAliases, 'JF17'], factionId: 'pakistan', locationAliases: [...minhas.locationRefs, '米纳斯'],
      locationRef: 'location:minhas', platformType: minhas.semanticEntityAliases[0]!, role: 'fighter-formation',
      formationPattern: 'finger-four', leaderPolicy: 'stable-first-member', behaviorProfile: 'fighter-formation/v1',
      linkedEvidenceOnly: false, participantAliases: [...minhas.semanticEntityAliases, 'Pakistani formation', 'Pakistani interceptor formation', '巴方编队', '巴方拦截编队'], sharedEvidenceAliases: [],
      diagnostics: [{ code: 'OPERATOR_ROUTE_LABEL_DIFFERS_FROM_REPORT_ENTITY', message: 'Current-scenario J-10CE route labels map to report JF-17 actors without creating a global synonym.' }],
    },
    {
      groupId: 'group:pakistan-jf17-rafiki', semanticEntityRef: rafiki.semanticEntityAliases[0]!,
      aliases: [...rafiki.semanticEntityAliases, 'JF17'], factionId: 'pakistan', locationAliases: [...rafiki.locationRefs, '拉菲基'],
      locationRef: 'location:rafiki', platformType: rafiki.semanticEntityAliases[0]!, role: 'fighter-formation',
      formationPattern: 'finger-four', leaderPolicy: 'stable-first-member', behaviorProfile: 'fighter-formation/v1',
      linkedEvidenceOnly: false, participantAliases: [...rafiki.semanticEntityAliases, 'Pakistani formation', 'Pakistani interceptor formation', '巴方编队', '巴方拦截编队'], sharedEvidenceAliases: [],
      diagnostics: [{ code: 'OPERATOR_ROUTE_LABEL_DIFFERS_FROM_REPORT_ENTITY', message: 'Current-scenario J-10CE route labels map to report JF-17 actors without creating a global synonym.' }],
    },
    {
      groupId: 'group:india-netra-awacs', semanticEntityRef: netra.semanticEntityAliases[0]!,
      aliases: netra.semanticEntityAliases, factionId: 'india', locationAliases: [], locationRef: 'location:india-awacs',
      platformType: 'awacs', role: 'early-warning-support', formationPattern: 'single', leaderPolicy: 'single-member',
      behaviorProfile: 'awacs-support/india/v1', linkedEvidenceOnly: true, participantAliases: netra.semanticEntityAliases,
      sharedEvidenceAliases: ['Indian and Pakistani AWACS', '双方预警机', '印巴双方预警机'], diagnostics: [],
    },
    {
      groupId: 'group:pakistan-awacs-proxy', semanticEntityRef: pakistanAwacs.semanticEntityAliases[0]!,
      aliases: pakistanAwacs.semanticEntityAliases, factionId: 'pakistan', locationAliases: [], locationRef: 'location:pakistan-awacs',
      platformType: 'awacs', role: 'early-warning-support', formationPattern: 'single', leaderPolicy: 'single-member',
      behaviorProfile: 'awacs-support/pakistan/v1', linkedEvidenceOnly: true, participantAliases: pakistanAwacs.semanticEntityAliases,
      sharedEvidenceAliases: ['Indian and Pakistani AWACS', '双方预警机', '印巴双方预警机'], diagnostics: [],
    },
  ],
  weaponBehaviorProfiles: [
    { factionId: 'india', behaviorProfile: 'weapon-launch/india-first-strike/v1', matchTerms: [] },
    { factionId: 'pakistan', behaviorProfile: 'weapon-launch/pakistan-intercept/v1', matchTerms: ['intercept', 'incoming missile', '拦截', '来袭导弹'] },
    { factionId: 'pakistan', behaviorProfile: 'weapon-launch/pakistan-counterattack/v1', matchTerms: ['counterattack', 'rafale', '反击'] },
  ],
}
