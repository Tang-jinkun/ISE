import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';
import {
  ModelConfigStore,
  validateModelEndpoint
} from '../src/model/modelConfig.ts';

const remoteConfig = {
  provider: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com/v1/',
  model: 'deepseek-chat',
  apiKey: 'test-secret'
};

test('model config is isolated by subject and public views never expose the key', () => {
  const store = new ModelConfigStore();
  assert.deepEqual(store.get('user-1'), {
    configured: false,
    provider: null,
    baseUrl: null,
    model: null,
    hasApiKey: false
  });

  const view = store.set('user-1', remoteConfig);
  assert.deepEqual(view, {
    configured: true,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hasApiKey: true
  });
  assert.equal('apiKey' in view, false);
  assert.equal(JSON.stringify(view).includes('test-secret'), false);
  assert.equal(store.get('user-2').configured, false);
});

test('model config preserves an existing key when an update omits it', () => {
  const store = new ModelConfigStore();
  store.set('user-1', remoteConfig);

  store.set('user-1', {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-reasoner'
  });

  assert.equal(store.require('user-1').apiKey, 'test-secret');
  assert.equal(store.require('user-1').model, 'deepseek-reasoner');
});

test('clearing a subject disables an environment default only for that subject', () => {
  const store = new ModelConfigStore(remoteConfig);
  assert.equal(store.get('user-1').configured, true);
  assert.equal(store.get('user-2').configured, true);

  store.clear('user-1');

  assert.equal(store.get('user-1').configured, false);
  assert.equal(store.get('user-2').configured, true);
});

test('local providers allow keyless loopback HTTP endpoints', () => {
  const store = new ModelConfigStore();
  const view = store.set('user-1', {
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1/',
    model: 'qwen3:8b'
  });

  assert.equal(view.baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(view.hasApiKey, false);
  assert.equal(store.require('user-1').apiKey, undefined);
});

test('remote providers require HTTPS and an API key', () => {
  const store = new ModelConfigStore();
  assert.throws(
    () =>
      store.set('user-1', {
        provider: 'openai',
        baseUrl: 'http://api.openai.com/v1',
        model: 'gpt-5'
      }),
    /HTTPS/i
  );
  assert.throws(
    () =>
      store.set('user-1', {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5'
      }),
    /API key/i
  );
});

test('local HTTP endpoints must be loopback and endpoint URLs reject hidden components', () => {
  assert.throws(
    () => validateModelEndpoint('ollama', 'http://192.168.1.20:11434/v1'),
    /loopback/i
  );
  for (const value of [
    'https://user:pass@example.com/v1',
    'https://example.com/v1?token=secret',
    'https://example.com/v1#secret'
  ]) {
    assert.throws(() => validateModelEndpoint('custom', value), /URL/i);
  }
});

test('requiring an unconfigured subject returns a stable failure code', () => {
  const store = new ModelConfigStore();
  assert.throws(
    () => store.require('user-1'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'MODEL_NOT_CONFIGURED'
  );
});

test('agent startup accepts either a complete environment model or no model', () => {
  const unconfigured = loadConfig({
    NEST_API_BASE_URL: 'http://127.0.0.1:3000'
  });
  assert.equal(unconfigured.MODEL_BASE_URL, undefined);
  assert.equal(unconfigured.MODEL_NAME, undefined);
  assert.equal(unconfigured.MODEL_API_KEY, undefined);

  const configured = loadConfig({
    NEST_API_BASE_URL: 'http://127.0.0.1:3000',
    MODEL_BASE_URL: 'https://api.openai.com/v1',
    MODEL_NAME: 'gpt-5-mini',
    MODEL_API_KEY: 'test-key'
  });
  assert.equal(configured.MODEL_NAME, 'gpt-5-mini');

  assert.throws(() =>
    loadConfig({
      NEST_API_BASE_URL: 'http://127.0.0.1:3000',
      MODEL_BASE_URL: 'https://api.openai.com/v1'
    })
  );
});

test('agent startup never consults a disk .env for MODEL_API_KEY', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ise-agent-env-'));
  const previousDirectory = process.cwd();
  try {
    await writeFile(
      join(directory, '.env'),
      [
        'MODEL_BASE_URL=https://disk.example/v1',
        'MODEL_NAME=disk-model',
        'MODEL_API_KEY=disk-secret'
      ].join('\n')
    );
    process.chdir(directory);

    const config = loadConfig({
      NEST_API_BASE_URL: 'http://127.0.0.1:3000'
    });
    assert.equal(config.MODEL_API_KEY, undefined);

    const serverSource = await readFile(
      new URL('../src/server.ts', import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(serverSource, /loadEnvFile/);
  } finally {
    process.chdir(previousDirectory);
    await rm(directory, { recursive: true, force: true });
  }
});
