import type { AssetRegistryEntry, AssetRegistrySnapshot } from '../contracts/assetRegistry.ts'
import type { ActorGroup } from '../contracts/sceneBlueprint.ts'
import type { ScenarioPack } from '../contracts/scenarioPack.ts'
import { normalizeAssetName } from './assetRegistry.ts'
import { diagnostic, type CompilationDiagnostic } from './runtimeDiagnostics.ts'

export type ActorAssetResolutionStatus = 'exact' | 'compatible' | 'static-fallback' | 'unresolved'

export interface ActorAssetResolution {
  actorGroupId: string
  modelAssetId?: `model:${string}`
  trajectoryAssetIds: Array<`trajectory:${string}`>
  mediaAssetIds: string[]
  status: ActorAssetResolutionStatus
  diagnostics: CompilationDiagnostic[]
}

function modelId(assetId: string): `model:${string}` {
  return assetId as `model:${string}`
}

function trajectoryId(assetId: string): `trajectory:${string}` {
  return assetId as `trajectory:${string}`
}

function comparable(value: string): string {
  return normalizeAssetName(value).replace(/[\s_.-]+/g, '')
}

function available<T extends AssetRegistryEntry['kind']>(
  registry: AssetRegistrySnapshot,
  kind: T,
): Extract<AssetRegistryEntry, { kind: T }>[] {
  return registry.assets.filter((entry): entry is Extract<AssetRegistryEntry, { kind: T }> =>
    entry.kind === kind && entry.availability === 'available')
    .sort((left, right) => left.assetId.localeCompare(right.assetId))
}

function exactBundle(actor: ActorGroup, pack: ScenarioPack) {
  const entity = comparable(actor.semanticEntityRef)
  const location = comparable(actor.locationRef)
  const behavior = comparable(actor.behaviorProfile)
  const candidates = pack.routeBundles.filter(bundle =>
    bundle.semanticEntityAliases.some(alias => comparable(alias) === entity)
    && bundle.behaviorProfileRefs.some(profile => comparable(profile) === behavior)
    && (bundle.locationRefs.length === 0 || bundle.locationRefs.some(value => comparable(value) === location)))
  return candidates.length === 1 ? candidates[0] : undefined
}

function grounded(locationRef: string): boolean {
  const value = comparable(locationRef)
  return value.length > 0 && value !== 'unknown' && value !== 'locationunknown' && value !== 'unresolved'
}

function compatibleModel(actor: ActorGroup, registry: AssetRegistrySnapshot) {
  const kind = actor.role.includes('weapon') || actor.platformType === 'missile' ? 'missile' : 'aircraft'
  const candidates = available(registry, 'model').filter(entry => entry.model.entityTypes.includes(kind))
  return candidates.length === 1 ? candidates[0] : candidates.length === 0 ? undefined : null
}

/** Resolves existing assets only; it never invents a trajectory or an interaction. */
export function resolveActorAssets(
  actor: ActorGroup,
  pack: ScenarioPack,
  registry: AssetRegistrySnapshot,
): ActorAssetResolution {
  const bundle = exactBundle(actor, pack)
  const models = available(registry, 'model')
  const routes = available(registry, 'trajectory')
  if (bundle) {
    const model = models.find(entry => entry.assetId === bundle.modelAssetRef)
    const trajectoryAssetIds = bundle.routeAssetRefs.filter(id => routes.some(route => route.assetId === id))
    if (model && trajectoryAssetIds.length === bundle.routeAssetRefs.length) {
      return { actorGroupId: actor.groupId, modelAssetId: modelId(model.assetId), trajectoryAssetIds: trajectoryAssetIds.map(trajectoryId), mediaAssetIds: [], status: 'exact', diagnostics: [] }
    }
  }

  const model = compatibleModel(actor, registry)
  if (model === null) return {
    actorGroupId: actor.groupId, trajectoryAssetIds: [], mediaAssetIds: [], status: 'unresolved',
    diagnostics: [diagnostic('ACTOR_MODEL_AMBIGUOUS', `${actor.groupId}: multiple compatible models`, 'warning')],
  }
  if (!model) return {
    actorGroupId: actor.groupId, trajectoryAssetIds: [], mediaAssetIds: [], status: 'unresolved',
    diagnostics: [diagnostic('ACTOR_MODEL_UNRESOLVED', `${actor.groupId}: no compatible model`, 'warning')],
  }
  if (routes.length === 1) return {
    actorGroupId: actor.groupId, modelAssetId: modelId(model.assetId), trajectoryAssetIds: [trajectoryId(routes[0]!.assetId)], mediaAssetIds: [], status: 'compatible', diagnostics: [],
  }
  if (grounded(actor.locationRef)) return {
    actorGroupId: actor.groupId, modelAssetId: modelId(model.assetId), trajectoryAssetIds: [], mediaAssetIds: [], status: 'static-fallback',
    diagnostics: [diagnostic('ACTOR_TRAJECTORY_STATIC_FALLBACK', `${actor.groupId}: no reliable trajectory; using grounded static fallback`, 'warning')],
  }
  return {
    actorGroupId: actor.groupId, modelAssetId: modelId(model.assetId), trajectoryAssetIds: [], mediaAssetIds: [], status: 'unresolved',
    diagnostics: [diagnostic('ACTOR_TRAJECTORY_UNRESOLVED', `${actor.groupId}: no reliable trajectory or grounded location`, 'warning')],
  }
}
