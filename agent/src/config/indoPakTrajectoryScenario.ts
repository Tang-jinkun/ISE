import { scenarioTrajectoryMappingSchema } from '../contracts/trajectoryCatalog.ts'
import { indoPakScenarioPack } from './indoPakScenarioPack.ts'

/** Compatibility view for callers that still consume the legacy mapping contract. */
export const indoPakRouteBundles = indoPakScenarioPack.routeBundles

export const indoPakTrajectoryScenario = scenarioTrajectoryMappingSchema.parse({
  schemaVersion: 'ise.scenario-trajectory-mapping/v1',
  scenarioId: 'indo-pak/v1',
  bundles: indoPakScenarioPack.routeBundles,
})
