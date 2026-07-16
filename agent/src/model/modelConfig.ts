import { z } from 'zod';
import { agentError } from '../api/errors.ts';
import type { CredentialProtector } from './credentialProtector.ts';
import type { ModelConfigRepository } from '../persistence/modelConfigRepository.ts';

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

export type ModelConfigPersistenceOptions = {
  repository: ModelConfigRepository;
  protector: CredentialProtector;
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
  readonly #ciphertexts = new Map<string, string | null>();
  readonly #loadFailures = new Map<string, Error>();
  readonly #defaultConfig?: StoredModelConfig;
  readonly #persistence?: ModelConfigPersistenceOptions;

  constructor(
    defaultConfig?: ModelConfigInput,
    persistence?: ModelConfigPersistenceOptions
  ) {
    this.#defaultConfig = defaultConfig
      ? normalizeConfig(defaultConfig)
      : undefined;
    this.#persistence = persistence;
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
    let encryptedApiKey: string | null = null;
    if (this.#persistence) {
      try {
        const preservedCiphertext = raw.apiKey === undefined
          ? this.#ciphertexts.get(subject)
          : undefined;
        encryptedApiKey = value.apiKey
          ? preservedCiphertext ?? this.#persistence.protector.protect(value.apiKey)
          : null;
        this.#persistence.repository.save({
          subject,
          provider: value.provider,
          baseUrl: value.baseUrl,
          model: value.model,
          encryptedApiKey,
          cleared: false
        });
      } catch {
        throw agentError(
          500,
          'MODEL_CREDENTIAL_STORAGE_UNAVAILABLE',
          'Model credential storage is unavailable'
        );
      }
    }
    this.#values.set(subject, value);
    if (this.#persistence) this.#ciphertexts.set(subject, encryptedApiKey);
    return publicView(value);
  }

  resolve(subject: string, raw: ModelConfigInput): StoredModelConfig {
    return { ...normalizeConfig(raw, this.#stored(subject)) };
  }

  clear(subject: string): void {
    if (this.#persistence) {
      try {
        this.#persistence.repository.clear(subject);
      } catch {
        throw agentError(
          500,
          'MODEL_CREDENTIAL_STORAGE_UNAVAILABLE',
          'Model credential storage is unavailable'
        );
      }
    }
    this.#values.set(subject, null);
    this.#ciphertexts.set(subject, null);
    this.#loadFailures.delete(subject);
  }

  #stored(subject: string): StoredModelConfig | undefined {
    if (this.#values.has(subject)) {
      return this.#values.get(subject) ?? undefined;
    }
    const previousFailure = this.#loadFailures.get(subject);
    if (previousFailure) throw previousFailure;
    if (this.#persistence) {
      try {
        const record = this.#persistence.repository.get(subject);
        if (!record) {
          this.#values.set(subject, this.#defaultConfig ?? null);
          this.#ciphertexts.set(subject, null);
          return this.#defaultConfig;
        }
        if (record.cleared) {
          this.#values.set(subject, null);
          this.#ciphertexts.set(subject, null);
          return undefined;
        }
        if (!record.provider || !record.baseUrl || !record.model) {
          throw new Error('INVALID_PERSISTED_MODEL_CONFIG');
        }
        const apiKey = record.encryptedApiKey
          ? this.#persistence.protector.unprotect(record.encryptedApiKey)
          : undefined;
        const value = normalizeConfig({
          provider: modelProviderIdSchema.parse(record.provider),
          baseUrl: record.baseUrl,
          model: record.model,
          ...(apiKey ? { apiKey } : {})
        });
        this.#values.set(subject, value);
        this.#ciphertexts.set(subject, record.encryptedApiKey);
        return value;
      } catch {
        const failure = agentError(
          500,
          'MODEL_CREDENTIAL_UNAVAILABLE',
          'Model credential is unavailable'
        );
        this.#loadFailures.set(subject, failure);
        throw failure;
      }
    }
    return this.#defaultConfig;
  }
}
