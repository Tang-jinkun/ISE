import { z } from 'zod'

export const agentConfigSchema = z
  .object({
    AGENT_HOST: z.string().min(1).default('127.0.0.1'),
    AGENT_PORT: z.coerce.number().int().min(1).max(65_535).default(4310),
    AGENT_DB_PATH: z.string().min(1).default('./var/ise-agent.sqlite'),
    AGENT_SQLITE_DRIVER: z.enum(['better-sqlite3', 'sql.js']).default('sql.js'),
    AGENT_CREDENTIAL_KEY_FILE: z.string().trim().min(1).optional(),
    NEST_API_BASE_URL: z.url(),
    MODEL_BASE_URL: z.url().optional(),
    MODEL_NAME: z.string().min(1).optional(),
    MODEL_API_KEY: z.string().min(1).optional()
  })
  .strict()
  .superRefine((value, context) => {
    const count = [
      value.MODEL_BASE_URL,
      value.MODEL_NAME,
      value.MODEL_API_KEY
    ].filter(Boolean).length;
    if (count !== 0 && count !== 3) {
      context.addIssue({
        code: 'custom',
        path: ['MODEL_BASE_URL'],
        message: 'MODEL_BASE_URL, MODEL_NAME, and MODEL_API_KEY must be configured together'
      });
    }
  })

export type AgentConfig = z.infer<typeof agentConfigSchema>

export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  return agentConfigSchema.parse({
    AGENT_HOST: env.AGENT_HOST,
    AGENT_PORT: env.AGENT_PORT,
    AGENT_DB_PATH: env.AGENT_DB_PATH,
    AGENT_SQLITE_DRIVER: env.AGENT_SQLITE_DRIVER,
    AGENT_CREDENTIAL_KEY_FILE: env.AGENT_CREDENTIAL_KEY_FILE,
    NEST_API_BASE_URL: env.NEST_API_BASE_URL,
    MODEL_BASE_URL: env.MODEL_BASE_URL,
    MODEL_NAME: env.MODEL_NAME,
    MODEL_API_KEY: env.MODEL_API_KEY,
  })
}
