import type { AgentTool } from '../types.ts'

export function renderNoToolCallSteeringPrompt(): string {
  return '继续推进当前目标。如果已经有足够证据，请直接用简体中文回答用户；如果缺少信息，请调用可用工具或提出简短澄清问题。'
}

export function renderEmptyToolInputSteeringPrompt(input: {
  toolName: string
  tool?: AgentTool
  requiredToolInputSummary: (schema: AgentTool['inputSchema']) => unknown
}): string {
  return [
    `工具 ${input.toolName} 因为空输入对象调用而失败。`,
    '只有当你能从当前目标、工具结果、artifacts 或 domain state 中提供所有必需参数时，才可以重试。',
    input.tool ? `Required arguments/schema: ${JSON.stringify(input.requiredToolInputSummary(input.tool.inputSchema))}` : '',
    '不要重复同一个空输入工具调用。继续保持面向用户输出为简体中文。',
  ].filter(Boolean).join('\n')
}

export function renderFinalAnswerGuardSteeringPrompt(reason: string): string {
  return [
    `你刚才给出的总结不适合直接展示给用户：${reason}`,
    '不要描述内部编号、工具实现、证据结构、持久化过程或系统契约。',
    '请直接用简体中文回答用户真正关心的结果；如果仍然无法直接回答，就简洁说明缺什么。',
    '请直接重新回答用户。',
  ].join('\n')
}
