export interface InteractionPoint {
  longitudeDeg: number
  latitudeDeg: number
  altitudeM: number
}

export interface InteractionIntent {
  interactionId: string
  weaponRef: string
  targetRef: string
  interactionTimeMs: number
}

export interface ResolvedInteractionGeometry {
  interactionId: string
  interactionTimeMs: number
  interactionPoint?: InteractionPoint
  status: 'resolved' | 'unresolved'
  reason?: 'missing-target-geometry' | 'geometry-mismatch' | 'dependency-cycle' | 'ambiguous-target-chain'
  propagatedFromInteractionId?: string
}

export interface InteractionSolveInput {
  intents: readonly InteractionIntent[]
  directPoints: ReadonlyMap<string, InteractionPoint | undefined>
}

/**
 * Resolve interaction geometry from the dependency graph rather than from
 * each target route independently. A weapon used as another engagement's
 * target inherits the interaction point that terminates its own engagement.
 * Cycles and ambiguous producers remain unresolved instead of being guessed.
 */
export function solveInteractionGeometry(
  input: InteractionSolveInput,
): Map<string, ResolvedInteractionGeometry> {
  const byId = new Map(input.intents.map(intent => [intent.interactionId, intent]))
  const producers = new Map<string, InteractionIntent[]>()
  for (const intent of input.intents) {
    const entries = producers.get(intent.weaponRef) ?? []
    entries.push(intent)
    producers.set(intent.weaponRef, entries)
  }
  const resolved = new Map<string, ResolvedInteractionGeometry>()
  const visiting = new Set<string>()

  const resolve = (interactionId: string): ResolvedInteractionGeometry => {
    const cached = resolved.get(interactionId)
    if (cached) return cached
    const intent = byId.get(interactionId)
    if (!intent) {
      const missing: ResolvedInteractionGeometry = {
        interactionId,
        interactionTimeMs: 0,
        status: 'unresolved',
        reason: 'missing-target-geometry',
      }
      resolved.set(interactionId, missing)
      return missing
    }
    if (visiting.has(interactionId)) {
      const cycle: ResolvedInteractionGeometry = {
        interactionId,
        interactionTimeMs: intent.interactionTimeMs,
        status: 'unresolved',
        reason: 'dependency-cycle',
      }
      resolved.set(interactionId, cycle)
      return cycle
    }

    visiting.add(interactionId)
    const candidates = producers.get(intent.targetRef) ?? []
    const directPoint = input.directPoints.get(interactionId)
    const missingDirectReason = input.directPoints.has(interactionId)
      ? 'geometry-mismatch' as const
      : 'missing-target-geometry' as const
    let result: ResolvedInteractionGeometry
    if (candidates.length > 1) {
      result = {
        interactionId,
        interactionTimeMs: intent.interactionTimeMs,
        status: 'unresolved',
        reason: 'ambiguous-target-chain',
      }
    } else if (candidates.length === 1 && candidates[0]!.interactionId !== interactionId) {
      const upstream = directPoint ? resolve(candidates[0]!.interactionId) : undefined
      result = directPoint && upstream?.status === 'resolved' && upstream.interactionPoint
        ? {
          interactionId,
          interactionTimeMs: intent.interactionTimeMs,
          interactionPoint: upstream.interactionPoint,
          status: 'resolved',
          propagatedFromInteractionId: upstream.interactionId,
        }
        : {
          interactionId,
          interactionTimeMs: intent.interactionTimeMs,
          status: 'unresolved',
          reason: upstream?.reason ?? missingDirectReason,
        }
    } else {
      result = directPoint
        ? {
          interactionId,
          interactionTimeMs: intent.interactionTimeMs,
          interactionPoint: directPoint,
          status: 'resolved',
        }
        : {
          interactionId,
          interactionTimeMs: intent.interactionTimeMs,
          status: 'unresolved',
          reason: missingDirectReason,
        }
    }
    visiting.delete(interactionId)
    resolved.set(interactionId, result)
    return result
  }

  for (const intent of input.intents) resolve(intent.interactionId)
  return resolved
}
