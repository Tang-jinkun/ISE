import { ToolRegistry, type AgentTool } from '@ise/agent-core'
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
}

export function createSessionToolRegistry(options: ToolAssemblyOptions): ToolRegistry {
  return new ToolRegistry([
    ...createDocumentTools(options.attachmentReader),
    ...createEventPlanTools(),
    ...createScenePlanTools(),
    ...(options.loadAssetSnapshot ? createAssetTools(options.loadAssetSnapshot) : []),
    ...createCompilerTools({ onCompileProgress: options.onCompileProgress }),
    ...(options.extraTools ?? []),
  ])
}
