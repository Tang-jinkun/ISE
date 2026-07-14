export function renderActiveSkillReminderContent(skillName: string): string {
  return `Skill "${skillName}" is already active; continue using the existing skill instructions.`
}

export function renderActiveSkillReminderHiddenPrompt(skillName: string): string {
  return [
    `[Active skill reminder: ${skillName}]`,
    '',
    'The requested skill is already active. Do not call the skill tool again for this same skill; continue with the next required domain tool.',
  ].join('\n')
}

export function renderActiveSkillHiddenPrompt(input: { skillName: string; skillContent: string }): string {
  return `[Active skill: ${input.skillName}]\n\n${input.skillContent}`
}
