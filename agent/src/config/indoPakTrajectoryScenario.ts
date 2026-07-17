import {
  scenarioTrajectoryMappingSchema,
  type ScenarioTrajectoryBundle,
} from '../contracts/trajectoryCatalog.ts'

const vampireIds = routeIds('adampur-vampire', 4)
const rafaleIds = routeIds('ambala-rafale', 4)
const ambalaSu30Ids = routeIds('ambala-su30mki', 2)
const minhasIds = routeIds('minhas-j10ce', 4)
const rafikiIds = routeIds('rafiki-j10ce', 4)
const missileAliases = ['missile', 'PL-15E', 'PL-15E\u5bfc\u5f39', '\u5bfc\u5f39']
function routeIds(stem: string, count: number): `trajectory:${string}`[] {
  return Array.from({ length: count }, (_, index) => `trajectory:${stem}-${index + 1}` as const)
}

function bundle(
  bundleId: string,
  modelAssetRef: `model:${string}`,
  routeAssetRefs: readonly `trajectory:${string}`[],
  semanticEntityAliases: readonly string[],
  locationRefs: readonly string[],
  diagnostics: readonly string[] = [],
): ScenarioTrajectoryBundle {
  const behaviorProfileRefs = bundleId === 'weapon:india-first-strike'
    ? ['weapon-launch/india-first-strike/v1']
    : bundleId === 'weapon:pakistan-intercept'
      ? ['weapon-launch/pakistan-intercept/v1']
      : bundleId === 'weapon:pakistan-counterattack'
        ? ['weapon-launch/pakistan-counterattack/v1']
        : ['fighter-formation/v1']
  return {
    bundleId,
    modelAssetRef,
    routeAssetRefs: [...routeAssetRefs],
    semanticEntityAliases: [...semanticEntityAliases],
    behaviorProfileRefs,
    locationRefs: [...locationRefs],
    diagnostics: [...diagnostics],
  }
}

export const indoPakTrajectoryScenario = scenarioTrajectoryMappingSchema.parse({
  schemaVersion: 'ise.scenario-trajectory-mapping/v1',
  scenarioId: 'indo-pak/v1',
  bundles: [
    bundle(
      'formation:india-su30-adampur',
      'model:su30mki',
      vampireIds,
      ['Su-30MKI', 'Su-30MKI编队', '苏-30MKI', '苏-30MKI编队'],
      ['location:adampur', 'ADAMPUR', '阿达姆普尔'],
      ['Vampire is a scenario-local callsign'],
    ),
    bundle(
      'formation:india-rafale-ambala',
      'model:rafale',
      rafaleIds,
      ['Rafale', 'Rafale编队', '阵风', '阵风战斗机', '阵风编队'],
      ['location:ambala', 'AMBALA', '安巴拉'],
    ),
    bundle(
      'formation:pakistan-jf17-minhas',
      'model:jf17',
      minhasIds,
      ['JF-17', 'JF-17战机', 'JF-17编队'],
      ['location:minhas', 'location:minas', 'MINHAS', 'MINAS', '米纳斯'],
      ['Operator route label is J-10CE', 'OPERATOR_ROUTE_LABEL_DIFFERS_FROM_REPORT_ENTITY'],
    ),
    bundle(
      'formation:pakistan-jf17-rafiki',
      'model:jf17',
      rafikiIds,
      ['JF-17', 'JF-17战机', 'JF-17编队'],
      ['location:rafiki', 'RAFIKI', '拉菲基'],
      ['Operator route label is J-10CE', 'OPERATOR_ROUTE_LABEL_DIFFERS_FROM_REPORT_ENTITY'],
    ),
    bundle(
      'reserve:india-su30-ambala',
      'model:su30mki',
      ambalaSu30Ids,
      ['Su-30MKI', '苏-30MKI'],
      ['location:ambala', 'AMBALA', '安巴拉'],
      ['Reserve capacity; does not create actors'],
    ),
    bundle(
      'weapon:india-first-strike',
      'model:pl15e',
      ['trajectory:india-missile-1'],
      ['missile', 'PL-15E', 'PL-15E导弹', '导弹'],
      [
        'location:adampur', 'ADAMPUR', '阿达姆普尔',
        'location:ambala', 'AMBALA', '安巴拉',
        'location:minhas', 'location:minas', 'MINHAS', 'MINAS', '米纳斯',
        'location:rafiki', 'RAFIKI', '拉菲基',
      ],
    ),
    bundle(
      'weapon:pakistan-intercept',
      'model:pl15e',
      ['trajectory:pakistan-missile-1'],
      missileAliases,
      [],
    ),
    bundle(
      'weapon:pakistan-counterattack',
      'model:pl15e',
      ['trajectory:pakistan-strike-missile-2'],
      missileAliases,
      [],
    ),
  ],
})
