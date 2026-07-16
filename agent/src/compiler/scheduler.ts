import type { EventPlan } from '../contracts/eventPlan.ts'
import type { NarrativePlan } from '../contracts/narrativePlan.ts'
import type { NarrationPlan } from '../contracts/narrationPlan.ts'
import {
  runtimeCommandSchema,
  type CanonicalCommand,
  type CommandDraft,
  type InformationCard,
  type ScheduledSubtitle,
} from '../contracts/runtimePlan.ts'
import type { CapabilityManifest } from './capabilityManifest.ts'
import type { InformationCardDraft } from './templates.ts'
import { CompilationError, diagnostic } from '../services/runtimeDiagnostics.ts'

export interface SchedulerInput {
  eventPlan: EventPlan
  narrativePlan: NarrativePlan
  narrationPlan?: NarrationPlan
  commandDrafts: CommandDraft[]
  informationCardDrafts: InformationCardDraft[]
  capabilities: CapabilityManifest
}

export interface ScheduledPlan {
  subtitles: ScheduledSubtitle[]
  commands: CanonicalCommand[]
  informationCards: InformationCard[]
  totalDurationMs: number
}

export const SUBTITLE_VISUAL_LEAD_MS = 800

export function subtitleDurationMs(text: string, importance: 'high' | 'medium' | 'low'): number {
  const spokenMs = Math.ceil([...text].filter(char => /\p{Script=Han}/u.test(char)).length / 4) * 1_000
  const observationMs = importance === 'high' ? 2_000 : importance === 'medium' ? 1_000 : 0
  return Math.max(4_000, spokenMs) + observationMs
}

function schedule(input: SchedulerInput, removeMediumObservation: boolean): ScheduledPlan {
  const subtitles: ScheduledSubtitle[] = []
  const commands: CanonicalCommand[] = []
  const informationCards: InformationCard[] = []
  const commandEnds = new Map<string, number>()
  let cameraEnd = 0
  const stateEnds = new Map<string, number>()
  let cursorMs = 0
  for (const [unitIndex, eventUnit] of input.eventPlan.eventUnits.entries()) {
    const unitStartMs = cursorMs
    const unitSubtitles = input.narrationPlan
      ? input.narrationPlan.beats
        .filter(item => item.eventUnitId === eventUnit.eventUnitId)
        .map(item => ({
          subtitleId: item.subtitleId,
          eventUnitId: item.eventUnitId,
          text: item.text,
          evidenceRefs: item.evidenceRefs,
          importance: item.importance,
          durationMs: item.estimatedDurationMs,
        }))
      : input.narrativePlan.subtitles
        .filter(item => item.eventUnitId === eventUnit.eventUnitId)
        .map(item => ({ ...item, durationMs: subtitleDurationMs(item.text, item.importance) }))
    const visualLeadStarts: number[] = []
    for (const subtitle of unitSubtitles) {
      let durationMs = subtitle.durationMs
      if (removeMediumObservation && subtitle.importance === 'medium') durationMs = Math.max(4_000, durationMs - 1_000)
      subtitles.push({
        subtitleId: subtitle.subtitleId,
        eventUnitId: subtitle.eventUnitId,
        text: subtitle.text,
        evidenceRefs: [...subtitle.evidenceRefs],
        importance: subtitle.importance,
        startMs: cursorMs,
        durationMs,
        position: 'bottom',
        maxWidthPct: 80,
      })
      visualLeadStarts.push(cursorMs + SUBTITLE_VISUAL_LEAD_MS)
      cursorMs += durationMs
    }
    const visualStartMs = visualLeadStarts.length > 0 ? Math.max(...visualLeadStarts) : unitStartMs
    let unitEndMs = cursorMs
    const drafts = input.commandDrafts.filter(item => item.eventUnitId === eventUnit.eventUnitId)
    for (const draft of drafts) {
      const minimum = input.capabilities.minimumDurations[draft.type]
      const durationMs = Math.max(minimum, draft.desiredDurationMs ?? minimum)
      let startMs = visualStartMs
      for (const dependency of draft.dependsOn) startMs = Math.max(startMs, commandEnds.get(dependency) ?? visualStartMs)
      if (draft.type === 'camera.transition') startMs = Math.max(startMs, cameraEnd)
      if (draft.type === 'model.set_state') startMs = Math.max(startMs, stateEnds.get(draft.targetId) ?? 0)
      const { desiredDurationMs: _desiredDurationMs, ...command } = draft
      const scheduled = runtimeCommandSchema.parse({ ...command, startMs, durationMs })
      commands.push(scheduled)
      const end = startMs + durationMs
      commandEnds.set(scheduled.commandId, end)
      if (scheduled.type === 'camera.transition') cameraEnd = end
      if (scheduled.type === 'model.set_state') stateEnds.set(scheduled.targetId, end)
      unitEndMs = Math.max(unitEndMs, end)
    }
    for (const draft of input.informationCardDrafts.filter(item => item.eventUnitId === eventUnit.eventUnitId)) {
      const durationMs = Math.max(4_000, draft.desiredDurationMs)
      informationCards.push({
        cardId: draft.cardId, eventUnitId: draft.eventUnitId, text: draft.text,
        evidenceRefs: draft.evidenceRefs, startMs: unitStartMs, durationMs,
      })
      unitEndMs = Math.max(unitEndMs, unitStartMs + durationMs)
    }
    cursorMs = unitEndMs
    if (unitIndex < input.eventPlan.eventUnits.length - 1) cursorMs += 1_000
  }
  return { subtitles, commands, informationCards, totalDurationMs: Math.max(1, cursorMs) }
}

export function scheduleNarrative(input: SchedulerInput): ScheduledPlan {
  let scheduled = schedule(input, false)
  if (!input.narrationPlan && scheduled.totalDurationMs > input.narrativePlan.targetDurationMs) {
    scheduled = schedule(input, true)
  }
  if (scheduled.totalDurationMs > input.narrativePlan.targetDurationMs) {
    throw new CompilationError([diagnostic(
      input.narrationPlan ? 'NARRATION_VISUAL_DURATION_CONFLICT' : 'RUNTIME_DURATION_EXCEEDED',
      `${scheduled.totalDurationMs} exceeds ${input.narrativePlan.targetDurationMs}`,
    )])
  }
  return scheduled
}
