import { ToolRegistry, type AgentTool } from '@ise/agent-core'
import type { AttachmentReader } from '../session/sessionAttachmentReader.ts'
import { createDocumentTools } from '../tools/documentTools.ts'
import { createEventPlanTools } from '../tools/eventPlanTools.ts'

export interface ToolAssemblyOptions {
  attachmentReader: AttachmentReader
  extraTools?: readonly AgentTool[]
}

export function createSessionToolRegistry(options: ToolAssemblyOptions): ToolRegistry {
  return new ToolRegistry([
    ...createDocumentTools(options.attachmentReader),
    ...createEventPlanTools(),
    ...(options.extraTools ?? []),
  ])
}
