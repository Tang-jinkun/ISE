import type { SkillRegistry } from '@ise/skills-core'
import { DefaultSoftwareAgentProfile } from '../profiles/DefaultSoftwareAgentProfile.ts'
import type { AgentProfile } from '../profiles/AgentProfile.ts'
import type { GoalState } from '../types.ts'

export function buildSystemPrompt(
  goal: GoalState,
  skills: SkillRegistry,
  profile: AgentProfile = DefaultSoftwareAgentProfile,
): string {
  const listing = skills.formatForModel()
  return [
    profile.rolePrompt,
    '',
    'Current objective:',
    goal.objective,
    '',
    'Available skills:',
    listing || '(none)',
    '',
    renderSection('Language:', profile.languagePolicy),
    renderSection('Planning:', profile.planningPolicy),
    renderSection('Rules:', joinPolicy([
      profile.toolUsePolicy,
      profile.recoveryPolicy,
      profile.completionPolicy,
    ])),
    renderSection('Narration:', profile.narrationPolicy),
  ].filter(Boolean).join('\n')
}

function renderSection(title: string, content: string | undefined): string | undefined {
  if (!content?.trim()) return undefined
  return `${title}\n${content.trim()}`
}

function joinPolicy(items: Array<string | undefined>): string | undefined {
  const content = items
    .map(item => item?.trim())
    .filter((item): item is string => Boolean(item))
    .join('\n')
  return content || undefined
}
