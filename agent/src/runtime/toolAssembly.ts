import { ToolRegistry, createSkillAgentTool, type AgentTool } from '@ise/agent-core'
import { SkillTool, type SkillRegistry } from '@ise/skills-core'
import type { AttachmentReader } from '../session/sessionAttachmentReader.ts'
import type { AssetRegistrySnapshot } from '../contracts/assetRegistry.ts'
import { createAssetTools } from '../tools/assetTools.ts'
import { createCompilerTools, type CompileProgressPayload } from '../tools/compilerTools.ts'
import { createDocumentTools } from '../tools/documentTools.ts'
import { createEventPlanTools } from '../tools/eventPlanTools.ts'
import { createScenePlanTools } from '../tools/scenePlanTools.ts'

export interface ToolAssemblyOptions {
  attachmentReader: AttachmentReader
  extraTools?: readonly AgentTool[]
  loadAssetSnapshot?: () => Promise<AssetRegistrySnapshot>
  onCompileProgress?: (payload: CompileProgressPayload) => void
  skills?: SkillRegistry
}

export function createSessionToolRegistry(options: ToolAssemblyOptions): ToolRegistry {
  const tools: AgentTool[] = [
    ...createDocumentTools(options.attachmentReader),
    ...createEventPlanTools(),
    ...createScenePlanTools(),
    ...(options.loadAssetSnapshot ? createAssetTools(options.loadAssetSnapshot) : []),
    ...createCompilerTools({ onCompileProgress: options.onCompileProgress }),
    ...(options.extraTools ?? []),
  ]
  const registry = new ToolRegistry(tools)
  if (options.skills) {
    registry.register(createSkillAgentTool(new SkillTool(options.skills), {
      availableTools: () => tools.map(tool => tool.name),
      authorizeProjectSkill: () => true,
    }))
  }
  return registry
}
