import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ModelAdapter } from '@ise/agent-core';
import type { AuthorizedFile, NestGateway } from '../src/adapters/nestGateway.ts';
import { createHttpApp } from '../src/api/httpApp.ts';
import { AgentDatabase } from '../src/persistence/database.ts';
import { AgentRepositories } from '../src/persistence/repositories.ts';
import { ModelConfigStore } from '../src/model/modelConfig.ts';
import type { CredentialProtector } from '../src/model/credentialProtector.ts';

class IdentityNest implements NestGateway {
  async verifyBearer(authorization: string): Promise<{ subject: string }> {
    const match = /^Bearer\s+(.+)$/.exec(authorization);
    if (!match) throw new Error('INVALID_BEARER');
    return { subject: match[1]! };
  }

  async readOwnedFile(): Promise<AuthorizedFile> {
    throw new Error('not used');
  }

  async listAssetMetadata(): Promise<unknown> {
    return [];
  }
}

const model: ModelAdapter = {
  complete: async () => ({ content: 'done' })
};

const remoteBody = {
  provider: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: 'test-secret'
};

async function fixture(
  modelFetch?: typeof fetch,
  options: { databasePath?: string; protector?: CredentialProtector } = {}
) {
  const database = await AgentDatabase.open(options.databasePath ?? ':memory:', 'sql.js');
  const repositories = new AgentRepositories(database);
  const modelConfigs = options.protector
    ? new ModelConfigStore(undefined, {
        repository: repositories.modelConfigs,
        protector: options.protector
      })
    : new ModelConfigStore();
  const app = await createHttpApp({
    repositories,
    nest: new IdentityNest(),
    modelFactory: () => model,
    modelConfigs,
    modelFetch
  });
  return { app, database, modelConfigs };
}

const bearer = (subject: string) => ({ authorization: `Bearer ${subject}` });

test('model config API authenticates and isolates redacted user configuration', async () => {
  const f = await fixture();
  const unauthenticated = await f.app.inject({ method: 'GET', url: '/model-config' });
  assert.equal(unauthenticated.statusCode, 401);

  const empty = await f.app.inject({
    method: 'GET',
    url: '/model-config',
    headers: bearer('user-1')
  });
  assert.deepEqual(empty.json(), {
    configured: false,
    provider: null,
    baseUrl: null,
    model: null,
    hasApiKey: false
  });

  const saved = await f.app.inject({
    method: 'PUT',
    url: '/model-config',
    headers: bearer('user-1'),
    payload: remoteBody
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json(), {
    configured: true,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hasApiKey: true
  });
  assert.equal(saved.body.includes('test-secret'), false);

  const other = await f.app.inject({
    method: 'GET',
    url: '/model-config',
    headers: bearer('user-2')
  });
  assert.equal(other.json().configured, false);

  await f.app.close();
  f.database.close();
});

test('model discovery uses transient input without persisting or returning its key', async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const f = await fixture(async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization')
    });
    return new Response(
      JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  const response = await f.app.inject({
    method: 'POST',
    url: '/model-config/models',
    headers: bearer('user-1'),
    payload: remoteBody
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    models: ['deepseek-chat', 'deepseek-reasoner']
  });
  assert.deepEqual(requests, [
    {
      url: 'https://api.deepseek.com/v1/models',
      authorization: 'Bearer test-secret'
    }
  ]);
  assert.equal(response.body.includes('test-secret'), false);
  assert.equal(f.modelConfigs.get('user-1').configured, false);

  await f.app.close();
  f.database.close();
});

test('model connection test reports whether the configured model is discoverable', async () => {
  const f = await fixture(async () =>
    new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  );

  const response = await f.app.inject({
    method: 'POST',
    url: '/model-config/test',
    headers: bearer('user-1'),
    payload: remoteBody
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    model: 'deepseek-chat',
    modelAvailable: true
  });

  await f.app.close();
  f.database.close();
});

test('clearing model config resets only the authenticated subject', async () => {
  const f = await fixture();
  f.modelConfigs.set('user-1', remoteBody);
  f.modelConfigs.set('user-2', remoteBody);

  const response = await f.app.inject({
    method: 'DELETE',
    url: '/model-config',
    headers: bearer('user-1')
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    configured: false,
    provider: null,
    baseUrl: null,
    model: null,
    hasApiKey: false
  });
  assert.equal(f.modelConfigs.get('user-2').configured, true);

  await f.app.close();
  f.database.close();
});

test('model config API restores the same redacted response after database reopen', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ise-model-config-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'agent.sqlite');
  const protector: CredentialProtector = {
    protect: value => `protected:${Buffer.from(value).toString('base64')}`,
    unprotect: value => Buffer.from(value.slice('protected:'.length), 'base64').toString()
  };

  const first = await fixture(undefined, { databasePath, protector });
  const saved = await first.app.inject({
    method: 'PUT',
    url: '/model-config',
    headers: bearer('user-1'),
    payload: remoteBody
  });
  assert.equal(saved.statusCode, 200);
  await first.app.close();
  first.database.close();

  const reopened = await fixture(undefined, { databasePath, protector });
  const restored = await reopened.app.inject({
    method: 'GET',
    url: '/model-config',
    headers: bearer('user-1')
  });
  assert.equal(restored.statusCode, 200);
  assert.deepEqual(restored.json(), saved.json());
  assert.equal(restored.body.includes(remoteBody.apiKey), false);
  await reopened.app.close();
  reopened.database.close();
});

test('production server wires persisted model configs through the Windows protector', async () => {
  const source = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.match(source, /new WindowsDpapiCredentialProtector\(\)/);
  assert.match(source, /repository:\s*repositories\.modelConfigs/);
});
