import { sceneProjectConfigSchema, type SceneProjectConfig } from '@ise/runtime-contracts'
import type { CanonicalCommand, CanonicalRuntimePlan } from '../contracts/runtimePlan.ts'

type TrackType = SceneProjectConfig['tracks'][number]['type']
type ModelCommand = Extract<CanonicalCommand, { type: `model.${string}` }>
type DataLinkCommand = Extract<CanonicalCommand, { type: 'data_link.show' }>

function assertNever(value: never): never {
  throw new Error(`Unsupported runtime command: ${JSON.stringify(value)}`)
}

function commandTrackType(command: CanonicalCommand): TrackType {
  switch (command.type) {
    case 'image.show': return 'image'
    case 'video.play': return 'video'
    case 'marker.show': return 'marker'
    case 'geojson.show': return 'geojson'
    case 'camera.transition': return 'camera'
    case 'camera.follow_actor':
    case 'camera.follow_group': return 'camera'
    case 'data_link.show': return 'data_link'
    case 'model.spawn':
    case 'model.follow_path':
    case 'model.set_state':
    case 'model.hide': return 'model'
    default: return assertNever(command)
  }
}

function isModelCommand(command: CanonicalCommand): command is ModelCommand {
  return commandTrackType(command) === 'model'
}

function isDataLinkCommand(command: CanonicalCommand): command is DataLinkCommand {
  return command.type === 'data_link.show'
}

function toModelAction(command: ModelCommand) {
  switch (command.type) {
    case 'model.spawn': return { action: 'model.spawn' as const, entityId: command.params.entityId }
    case 'model.follow_path': return {
      action: 'model.follow_path' as const,
      entityId: command.params.entityId,
      trajectoryAssetId: command.params.trajectoryAssetId,
      ...(command.params.timing ? { timing: { ...command.params.timing } } : {}),
    }
    case 'model.set_state': return {
      action: 'model.set_state' as const,
      entityId: command.params.entityId,
      state: command.params.state,
    }
    case 'model.hide': return { action: 'model.hide' as const, entityId: command.params.entityId }
  }
}

function toTrackItem(command: CanonicalCommand): unknown {
  const common = {
    id: command.commandId,
    eventUnitId: command.eventUnitId,
    startMs: command.startMs,
    durationMs: command.durationMs,
    evidenceRefs: command.evidenceRefs,
  }
  switch (command.type) {
    case 'image.show': return {
      ...common,
      assetId: command.params.assetId,
      params: {
        layout: { ...command.params.layout },
        enter: command.params.enter,
        exit: command.params.exit,
      },
    }
    case 'video.play': return {
      ...common,
      assetId: command.params.assetId,
      params: {
        layout: { ...command.params.layout },
        volume: command.params.volume,
        playbackRate: command.params.playbackRate,
        loop: command.params.loop,
      },
    }
    case 'marker.show': return {
      ...common,
      params: {
        coordinates: command.params.coordinates,
        label: command.params.label,
        color: command.params.color,
      },
    }
    case 'geojson.show': return {
      ...common,
      assetId: command.params.assetId,
      params: {
        lineColor: command.params.lineColor,
        lineWidth: command.params.lineWidth,
        fillColor: command.params.fillColor,
        fillOpacity: command.params.fillOpacity,
        circleColor: command.params.circleColor,
        circleRadius: command.params.circleRadius,
        keepAfterEnd: command.params.keepAfterEnd,
      },
    }
    case 'camera.transition': return {
      ...common,
      params: {
        center: command.params.center,
        zoom: command.params.zoom,
        pitch: command.params.pitch,
        bearing: command.params.bearing,
        easing: command.params.easing,
      },
    }
    case 'camera.follow_actor':
    case 'camera.follow_group': return { ...common, params: { ...command.params } }
    case 'data_link.show': return {
      ...common,
      params: {
        sourceEntityId: command.params.sourceEntityId,
        targetEntityId: command.params.targetEntityId,
        linkKind: command.params.linkKind,
      },
    }
    case 'model.spawn':
    case 'model.follow_path':
    case 'model.set_state':
    case 'model.hide': return { ...common, params: toModelAction(command) }
    default: return assertNever(command)
  }
}

export class BaseRuntimeAdapter {
  adapt(plan: CanonicalRuntimePlan, runtimePlanArtifactId: string): SceneProjectConfig {
    const items = new Map<TrackType, unknown[]>([
      ['subtitle', [
        ...plan.subtitles.map(subtitle => ({
          id: subtitle.subtitleId,
          eventUnitId: subtitle.eventUnitId,
          startMs: subtitle.startMs,
          durationMs: subtitle.durationMs,
          evidenceRefs: subtitle.evidenceRefs,
          params: { text: subtitle.text, position: subtitle.position, maxWidthPct: subtitle.maxWidthPct },
        })),
        ...plan.informationCards.map(card => ({
          id: card.cardId,
          eventUnitId: card.eventUnitId,
          startMs: card.startMs,
          durationMs: card.durationMs,
          evidenceRefs: card.evidenceRefs,
          params: { text: card.text, position: 'top', maxWidthPct: 70 },
        })),
      ]],
      ['image', []], ['video', []], ['marker', []], ['geojson', []], ['camera', []], ['data_link', []],
    ])
    const modelItems = new Map(plan.entities.map(entity => [entity.entityId, [] as unknown[]]))
    const dataLinkItems = new Map<string, {
      sourceEntityId: string
      targetEntityId: string
      items: unknown[]
    }>()
    for (const command of plan.commands) {
      if (isModelCommand(command)) {
        const entityItems = modelItems.get(command.params.entityId)
        if (!entityItems) throw new Error(`MODEL_COMMAND_ENTITY_NOT_FOUND:${command.params.entityId}`)
        entityItems.push(toTrackItem(command))
      } else if (isDataLinkCommand(command)) {
        const pairKey = `${command.params.sourceEntityId}\u0000${command.params.targetEntityId}`
        const pair = dataLinkItems.get(pairKey) ?? {
          sourceEntityId: command.params.sourceEntityId,
          targetEntityId: command.params.targetEntityId,
          items: [],
        }
        pair.items.push(toTrackItem(command))
        dataLinkItems.set(pairKey, pair)
      } else {
        items.get(commandTrackType(command))!.push(toTrackItem(command))
      }
    }
    const tracks = [
      ...[...items.entries()]
      .filter(([, trackItems]) => trackItems.length > 0)
      .map(([type, trackItems]) => ({
        trackId: `track:${type}`,
        type,
        label: `${type[0]!.toUpperCase()}${type.slice(1)}`,
        visible: true,
        items: trackItems,
      })),
      ...[...dataLinkItems.values()].map(({ sourceEntityId, targetEntityId, items: trackItems }) => {
        return {
          trackId: `track:data_link:${sourceEntityId}:${targetEntityId}`,
          type: 'data_link' as const,
          label: `Data link ${sourceEntityId} to ${targetEntityId}`,
          visible: true,
          items: trackItems,
        }
      }),
      ...plan.entities.flatMap(entity => {
        const trackItems = modelItems.get(entity.entityId)!
        return trackItems.length === 0 ? [] : [{
          trackId: `track:model:${entity.entityId}`,
          type: 'model' as const,
          label: entity.displayName,
          visible: true,
          items: trackItems,
        }]
      }),
    ]
    return sceneProjectConfigSchema.parse({
      schemaVersion: 'ise-scene/v1',
      sourceDocumentId: plan.sourceDocumentId,
      eventPlanArtifactId: plan.eventPlanArtifactId,
      runtimePlanArtifactId,
      totalDurationMs: plan.totalDurationMs,
      entities: plan.entities.map(source => ({
        entityId: source.entityId,
        displayName: source.displayName,
        kind: source.kind,
        ...(source.modelAssetId ? { modelAssetId: source.modelAssetId } : {}),
        ...(source.defaultTrajectoryAssetId ? { defaultTrajectoryAssetId: source.defaultTrajectoryAssetId } : {}),
        initialState: source.initialState,
      })),
      generatedTrajectories: plan.generatedTrajectories,
      tracks,
      interactions: plan.interactions,
      diagnostics: plan.diagnostics,
    })
  }
}
