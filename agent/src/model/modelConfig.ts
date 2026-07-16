import { z } from 'zod';
import { agentError } from '../api/errors.ts';

export const modelProviderIdSchema = z.enum([
  'deepseek',
  'openai',
  'qwen',
  'kimi',
  'zhipu',
  'openrouter',
  'siliconflow',
  'ollama',
  'lm-studio',
  'vllm',
  'custom'
]);

export type ModelProviderId = z.infer<typeof modelProviderIdSchema>;

const localProviders = new Set<ModelProviderId>([
  'ollama',
  'lm-studio',
  'vllm'
]);

export const modelConfigInputSchema = z
  .object({
    provider: modelProviderIdSchema,
    baseUrl: z.string().trim().min(1),
    model: z.string().trim().min(1).max(256),
    apiKey: z.string().max(4096).nullable().optional()
  })
  .strict();

export type ModelConfigInput = z.infer<typeof modelConfigInputSchema>;

export type StoredModelConfig = {
  provider: ModelProviderId;
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export type PublicModelConfig = {
  configured: boolean;
  provider: ModelProviderId | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
};

const unconfiguredView: PublicModelConfig = {
  configured: false,
  provider: null,
  baseUrl: null,
  model: null,
  hasApiKey: false
};

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '[::1]' ||
    normalized === '::1'
  );
}

export function validateModelEndpoint(
  provider: ModelProviderId,
  value: string
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw agentError(400, 'MODEL_URL_INVALID', 'Model URL is invalid');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw agentError(400, 'MODEL_URL_INVALID', 'Model URL cannot contain credentials, query, or fragment');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw agentError(400, 'MODEL_URL_INVALID', 'Model URL protocol is invalid');
  }
  if (url.protocol === 'http:') {
    if (!localProviders.has(provider)) {
      throw agentError(400, 'MODEL_HTTPS_REQUIRED', 'Remote model providers require HTTPS');
    }
    if (!isLoopback(url.hostname)) {
      throw agentError(400, 'MODEL_LOOPBACK_REQUIRED', 'Local HTTP model endpoints must use loopback');
    }
  }

  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function publicView(config: StoredModelConfig | undefined): PublicModelConfig {
  if (!config) return { ...unconfiguredView };
  return {
    configured: true,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: Boolean(config.apiKey)
  };
}

function normalizeConfig(
  raw: ModelConfigInput,
  previous?: StoredModelConfig
): StoredModelConfig {
  const input = modelConfigInputSchema.parse(raw);
  const baseUrl = validateModelEndpoint(input.provider, input.baseUrl);
  const mayPreserveKey =
    previous?.provider === input.provider && previous.baseUrl === baseUrl;
  const submittedKey = input.apiKey?.trim() || undefined;
  const apiKey =
    input.apiKey === undefined && mayPreserveKey
      ? previous?.apiKey
      : submittedKey;

  if (!localProviders.has(input.provider) && !apiKey) {
    throw agentError(400, 'MODEL_API_KEY_REQUIRED', 'Remote model providers require an API key');
  }

  return {
    provider: input.provider,
    baseUrl,
    model: input.model,
    ...(apiKey ? { apiKey } : {})
  };
}

export class ModelConfigStore {
  readonly #values = new Map<string, StoredModelConfig | null>();
  readonly #defaultConfig?: StoredModelConfig;

  constructor(defaultConfig?: ModelConfigInput) {
    this.#defaultConfig = defaultConfig
      ? normalizeConfig(defaultConfig)
      : undefined;
  }

  get(subject: string): PublicModelConfig {
    return publicView(this.#stored(subject));
  }

  require(subject: string): StoredModelConfig {
    const value = this.#stored(subject);
    if (!value) {
      throw agentError(409, 'MODEL_NOT_CONFIGURED', 'Model is not configured');
    }
    return { ...value };
  }

  set(subject: string, raw: ModelConfigInput): PublicModelConfig {
    const value = normalizeConfig(raw, this.#stored(subject));
    this.#values.set(subject, value);
    return publicView(value);
  }

  resolve(subject: string, raw: ModelConfigInput): StoredModelConfig {
    return { ...normalizeConfig(raw, this.#stored(subject)) };
  }

  clear(subject: string): void {
    this.#values.set(subject, null);
  }

  #stored(subject: string): StoredModelConfig | undefined {
    if (this.#values.has(subject)) {
      return this.#values.get(subject) ?? undefined;
    }
    return this.#defaultConfig;
  }
}
