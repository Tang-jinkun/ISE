import type { ActorGroup, ActorInstance } from '../contracts/sceneBlueprint.ts'
import { fingerprint } from '../services/fingerprint.ts'

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function groupSlug(group: ActorGroup): string {
  const slug = group.groupId.replace(/^group:/, '').normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fingerprint(group.groupId).slice('sha256:'.length, 'sha256:'.length + 12)
}

export function expandActorGroups(groups: readonly ActorGroup[]): ActorInstance[] {
  return [...groups]
    .sort((left, right) => compareText(left.groupId, right.groupId))
    .flatMap(group => Array.from({ length: group.quantityDecision.value }, (_, ordinal) => ({
      actorInstanceId: ordinal === 0
        ? `actor:${groupSlug(group)}:leader`
        : `actor:${groupSlug(group)}:wingman-${ordinal}`,
      actorGroupRef: group.groupId,
      role: ordinal === 0 ? 'leader' as const : 'wingman' as const,
      ordinal,
    })))
}
