import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NestGateway } from '../adapters/nestGateway.ts';
import {
  modelConfigInputSchema,
  type ModelConfigStore,
  type StoredModelConfig
} from '../model/modelConfig.ts';
import { agentError, AgentServiceError } from './errors.ts';
import { requestIdentity } from './sessionRoutes.ts';

const modelListSchema = z
  .object({
    data: z.array(z.object({ id: z.string().min(1) }).passthrough())
  })
  .passthrough();

export type ModelConfigRouteOptions = {
  nest: NestGateway;
  modelConfigs: ModelConfigStore;
  fetch?: typeof fetch;
};

async function listProviderModels(
  config: StoredModelConfig,
  request: typeof fetch
): Promise<string[]> {
  let response: Response;
  try {
    response = await request(`${config.baseUrl}/models`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(config.apiKey
          ? { authorization: `Bearer ${config.apiKey}` }
          : {})
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw agentError(
      502,
      'MODEL_PROVIDER_UNAVAILABLE',
      'Model provider is unavailable'
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw agentError(
      502,
      'MODEL_PROVIDER_REDIRECT',
      'Model provider redirects are not allowed'
    );
  }
  if (!response.ok) {
    throw agentError(
      502,
      'MODEL_PROVIDER_UNAVAILABLE',
      'Model provider is unavailable'
    );
  }

  try {
    const payload = modelListSchema.parse(await response.json());
    return [...new Set(payload.data.map((item) => item.id))].sort();
  } catch (error) {
    if (error instanceof AgentServiceError) throw error;
    throw agentError(
      502,
      'MODEL_PROVIDER_INVALID_RESPONSE',
      'Model provider returned an invalid response'
    );
  }
}

export async function registerModelConfigRoutes(
  app: FastifyInstance,
  options: ModelConfigRouteOptions
): Promise<void> {
  app.get('/model-config', async (request) => {
    const { subject } = await requestIdentity(request, options.nest);
    return options.modelConfigs.get(subject);
  });

  app.put('/model-config', async (request) => {
    const { subject } = await requestIdentity(request, options.nest);
    return options.modelConfigs.set(
      subject,
      modelConfigInputSchema.parse(request.body)
    );
  });

  app.delete('/model-config', async (request) => {
    const { subject } = await requestIdentity(request, options.nest);
    options.modelConfigs.clear(subject);
    return options.modelConfigs.get(subject);
  });

  app.post('/model-config/models', async (request) => {
    const { subject } = await requestIdentity(request, options.nest);
    const config = options.modelConfigs.resolve(
      subject,
      modelConfigInputSchema.parse(request.body)
    );
    return {
      models: await listProviderModels(config, options.fetch ?? fetch)
    };
  });

  app.post('/model-config/test', async (request) => {
    const { subject } = await requestIdentity(request, options.nest);
    const config = options.modelConfigs.resolve(
      subject,
      modelConfigInputSchema.parse(request.body)
    );
    const models = await listProviderModels(config, options.fetch ?? fetch);
    return {
      ok: true,
      model: config.model,
      modelAvailable: models.includes(config.model)
    };
  });
}
