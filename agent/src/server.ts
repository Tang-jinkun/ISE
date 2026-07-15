import { loadEnvFile } from 'node:process'
import { OpenAICompatibleAdapter } from '@ise/agent-core'
import { FetchNestGateway } from './adapters/nestGateway.ts'
import { createHttpApp } from './api/httpApp.ts'
import { loadConfig } from './config.ts'
import { AgentDatabase } from './persistence/database.ts'
import { AgentRepositories } from './persistence/repositories.ts'

try {
  loadEnvFile()
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
}

const config = loadConfig(process.env)
const database = await AgentDatabase.open(config.AGENT_DB_PATH, config.AGENT_SQLITE_DRIVER)
const repositories = new AgentRepositories(database)
repositories.recoverInterruptedRuns()
const app = await createHttpApp({
  repositories,
  nest: new FetchNestGateway({ baseUrl: config.NEST_API_BASE_URL }),
  modelFactory: sessionId => new OpenAICompatibleAdapter({
    apiKey: config.MODEL_API_KEY,
    model: config.MODEL_NAME,
    baseUrl: config.MODEL_BASE_URL,
    headers: { 'x-ise-agent-session-id': sessionId },
  }),
})
await app.listen({ host: config.AGENT_HOST, port: config.AGENT_PORT })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().finally(() => database.close()))
}
