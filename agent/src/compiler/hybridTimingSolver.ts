export interface HybridTrajectoryClock {
  sourceStartMs: number
  sourceEndMs: number
  sourceTimeOriginMs?: number
}

export interface HybridNarrativeWindow {
  startMs: number
  endMs: number
}

export interface HybridTimingResult extends HybridNarrativeWindow {
  solver: 'hybrid'
  status: 'resolved' | 'unresolved'
  sourceStartMs: number
  sourceEndMs: number
}

/**
 * Resolve a trajectory against the narrative clock without throwing away its
 * source-relative timing. Narrative bounds are the hard outer window; source
 * duration is preserved when it fits, otherwise the route is adapted to the
 * available window. A conflict is explicit instead of inventing an anchor.
 */
export function solveHybridTiming(
  trajectory: HybridTrajectoryClock,
  narrative: HybridNarrativeWindow,
  interaction?: { sourceTimeMs?: number },
): HybridTimingResult {
  const sourceStartMs = trajectory.sourceStartMs
  const sourceEndMs = Math.max(sourceStartMs, trajectory.sourceEndMs)
  const sourceDurationMs = sourceEndMs - sourceStartMs
  const narrativeStartMs = narrative.startMs
  const narrativeEndMs = Math.max(narrativeStartMs, narrative.endMs)
  const narrativeDurationMs = narrativeEndMs - narrativeStartMs
  const anchorOutside = interaction?.sourceTimeMs !== undefined
    && (interaction.sourceTimeMs < sourceStartMs || interaction.sourceTimeMs > sourceEndMs)
  if (narrativeDurationMs <= 0 || sourceDurationMs <= 0 || anchorOutside) {
    return { solver: 'hybrid', status: 'unresolved', startMs: narrativeStartMs, endMs: narrativeEndMs, sourceStartMs, sourceEndMs }
  }
  // The subtitle window always wins at the narrative boundary. The runtime
  // uses sourceStart/sourceEnd to interpolate points in the shared source clock.
  return {
    solver: 'hybrid',
    status: 'resolved',
    startMs: narrativeStartMs,
    endMs: narrativeEndMs,
    sourceStartMs,
    sourceEndMs,
  }
}

export function solveSynchronizedHybridTiming(
  trajectories: readonly HybridTrajectoryClock[],
  narrative: HybridNarrativeWindow,
): HybridTimingResult {
  if (trajectories.length === 0) {
    return { solver: 'hybrid', status: 'unresolved', startMs: narrative.startMs, endMs: narrative.endMs, sourceStartMs: 0, sourceEndMs: 0 }
  }
  const result = trajectories.map(item => solveHybridTiming(item, narrative))
  const origin = trajectories[0]!.sourceTimeOriginMs
  const sameClock = trajectories.every(item => item.sourceTimeOriginMs === undefined || origin === undefined || item.sourceTimeOriginMs === origin)
  const sourceStartMs = Math.min(...result.map(item => item.sourceStartMs))
  const sourceEndMs = Math.max(...result.map(item => item.sourceEndMs))
  return {
    ...result[0]!,
    sourceStartMs,
    sourceEndMs,
    status: sameClock && result.every(item => item.status === 'resolved') ? 'resolved' : 'unresolved',
  }
}
