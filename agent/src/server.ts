import { OpenAICompatibleAdapter } from '@ise/agent-core'
import { FetchNestGateway } from './adapters/nestGateway.ts'
import { createHttpApp } from './api/httpApp.ts'
import { loadConfig } from './config.ts'
import { AgentDatabase } from './persistence/database.ts'
import { AgentRepositories } from './persistence/repositories.ts'
import { ModelConfigStore } from './model/modelConfig.ts'
import { createCredentialProtector } from './model/credentialProtector.ts'

const config = loadConfig(process.env)
const database = await AgentDatabase.open(config.AGENT_DB_PATH, config.AGENT_SQLITE_DRIVER)
const repositories = new AgentRepositories(database)
repositories.recoverInterruptedRuns()
const defaultModel = config.MODEL_BASE_URL && config.MODEL_NAME && config.MODEL_API_KEY
  ? {
      provider: 'custom' as const,
      baseUrl: config.MODEL_BASE_URL,
      model: config.MODEL_NAME,
      apiKey: config.MODEL_API_KEY,
    }
  : undefined
const modelConfigs = new ModelConfigStore(defaultModel, {
  repository: repositories.modelConfigs,
  protector: createCredentialProtector({
    AGENT_CREDENTIAL_KEY_FILE: config.AGENT_CREDENTIAL_KEY_FILE,
  }),
})
const app = await createHttpApp({
  repositories,
  nest: new FetchNestGateway({ baseUrl: config.NEST_API_BASE_URL }),
  modelConfigs,
  modelFactory: ({ sessionId, subject }) => {
    const model = modelConfigs.require(subject)
    return new OpenAICompatibleAdapter({
      apiKey: model.apiKey ?? '',
      model: model.model,
      baseUrl: model.baseUrl,
      headers: { 'x-ise-agent-session-id': sessionId },
    })
  },
})
await app.listen({ host: config.AGENT_HOST, port: config.AGENT_PORT })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().finally(() => database.close()))
}
