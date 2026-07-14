export type AgentProfile = {
  id: string
  rolePrompt: string
  languagePolicy?: string
  planningPolicy?: string
  toolUsePolicy?: string
  completionPolicy?: string
  recoveryPolicy?: string
  narrationPolicy?: string
}
