# Agent Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each authenticated user configure a cloud or local OpenAI-compatible model from the new-script header without persisting or exposing the API key.

**Architecture:** An Agent-owned `ModelConfigStore` keeps validated configurations in process memory keyed by authenticated subject. Authenticated routes expose redacted status, save, clear, model discovery, and connection testing; `SessionAgentRunner` snapshots the selected adapter when a Turn begins. The web dialog consumes these routes and never writes configuration to browser storage.

**Tech Stack:** Fastify, Zod, OpenAI-compatible HTTP, React, TypeScript, Vitest, Node test runner.

## Global Constraints

- Agent startup must not require `MODEL_BASE_URL`, `MODEL_NAME`, or `MODEL_API_KEY`.
- API keys exist only in request memory and `ModelConfigStore`; never database, `.env`, logs, browser storage, test snapshots, or API responses.
- Remote providers require HTTPS. Local providers allow HTTP only for loopback hosts.
- New Turns use the current config snapshot; running Turns retain their existing adapter.
- Every model-config route requires the existing Bearer authentication bridge.
- Remote redirects are rejected and HTTP calls use a 10-second timeout.
- Provider presets must include DeepSeek, OpenAI, Qwen, Kimi, Zhipu, OpenRouter, SiliconFlow, Ollama, LM Studio, vLLM, and custom OpenAI-compatible.

---

### Task 1: Add validated in-memory model configuration

**Files:**
- Create: `agent/src/model/modelConfig.ts`
- Create: `agent/test/model-config.test.ts`
- Modify: `agent/src/config.ts`

**Interfaces:**
- Produces `ModelProviderId`, `StoredModelConfig`, `PublicModelConfig`, `ModelConfigStore`, and `validateModelEndpoint`.

```ts
export type PublicModelConfig = {
  configured: boolean;
  provider: ModelProviderId | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
};

export class ModelConfigStore {
  get(subject: string): PublicModelConfig;
  require(subject: string): StoredModelConfig;
  set(subject: string, input: ModelConfigInput): PublicModelConfig;
  clear(subject: string): void;
}
```

- [ ] **Step 1: Write failing store and validation tests**

Cover redacted GET, per-subject isolation, preserving an existing key when PUT omits it, clear, optional key for loopback providers, required key for remote providers, rejection of remote HTTP, non-loopback local HTTP, credentials, query, and fragment.

- [ ] **Step 2: Run focused Agent test and verify RED**

Run: `npm test -w @ise/agent -- --test-name-pattern="model config"`

Expected: FAIL because `modelConfig.ts` does not exist.

- [ ] **Step 3: Implement strict schemas and store**

Use a Zod discriminated provider definition and normalize Base URL by removing one trailing slash. `PublicModelConfig` must never include an `apiKey` property.

- [ ] **Step 4: Make environment model settings optional**

Change `agentConfigSchema` so all three `MODEL_*` fields are optional as one complete group. When all exist, seed a default configuration available to authenticated subjects until they save their own override; when none exist, Agent still starts.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 1 test command again.

Expected: all model-config unit tests PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add agent/src/model/modelConfig.ts agent/src/config.ts agent/test/model-config.test.ts
git commit -m "feat: add in-memory model configuration"
```

### Task 2: Add authenticated model configuration routes

**Files:**
- Create: `agent/src/api/modelConfigRoutes.ts`
- Create: `agent/test/model-config-api.test.ts`
- Modify: `agent/src/api/httpApp.ts`
- Modify: `agent/src/api/contracts.ts`

**Interfaces:**
- Produces `GET /model-config`, `PUT /model-config`, `DELETE /model-config`, `POST /model-config/models`, and `POST /model-config/test`.
- Consumes existing `requestIdentity` and `ModelConfigStore`.

- [ ] **Step 1: Write failing route tests**

Assert authentication, per-user isolation, exact redacted response shape, PUT status, DELETE reset, `/models` parsing, test success, timeout mapping, redirect rejection, and that serialized responses never contain a submitted secret.

- [ ] **Step 2: Run focused route test and verify RED**

Run: `npm test -w @ise/agent -- --test-name-pattern="model config API"`

Expected: FAIL because routes are not registered.

- [ ] **Step 3: Implement route schemas and provider HTTP client**

Use strict request schemas. Model discovery calls `${baseUrl}/models`; test calls the same endpoint and verifies a successful JSON response. Send Authorization only when an API key exists. Use `redirect: 'manual'` and `AbortSignal.timeout(10_000)`.

- [ ] **Step 4: Register routes through createHttpApp**

Extend `CreateHttpAppOptions` with `modelConfigs?: ModelConfigStore` and `modelFetch?: typeof fetch` for deterministic tests. Register model routes after the standard error handler and before returning the app.

- [ ] **Step 5: Run focused route tests and verify GREEN**

Run the Task 2 test command again.

Expected: all model-config API tests PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add agent/src/api/modelConfigRoutes.ts agent/src/api/httpApp.ts agent/src/api/contracts.ts agent/test/model-config-api.test.ts
git commit -m "feat: expose authenticated model configuration"
```

### Task 3: Snapshot configured adapters at Turn start

**Files:**
- Modify: `agent/src/session/sessionAgentRunner.ts`
- Modify: `agent/src/api/httpApp.ts`
- Modify: `agent/src/server.ts`
- Modify: `agent/test/session-api.test.ts`

**Interfaces:**
- Changes model factory signature to `modelFactory(input: { sessionId: string; subject: string }): ModelAdapter`.
- Consumes `ModelConfigStore.require(subject)`.

- [ ] **Step 1: Write failing runner tests**

Create two user configs and assert factories receive the owning subject. Start a controllable Turn, update the stored config while it runs, and assert its adapter does not change; assert the next Turn receives the new model.

- [ ] **Step 2: Run focused test and verify RED**

Run: `npm test -w @ise/agent -- --test-name-pattern="model snapshot"`

Expected: FAIL because the factory receives only `sessionId`.

- [ ] **Step 3: Pass authenticated subject into adapter creation**

At execution start, read the owned Session record, call the factory once with `{ sessionId, subject }`, and pass that adapter into the runtime. Do not look up configuration again during that Turn.

- [ ] **Step 4: Wire server defaults and unconfigured failure**

Construct one `ModelConfigStore` in `server.ts`, seed it from complete optional environment config, and build `OpenAICompatibleAdapter` from `store.require(subject)`. Use stable error code `MODEL_NOT_CONFIGURED` when absent.

- [ ] **Step 5: Run focused and full Agent tests**

Run:

```powershell
npm test -w @ise/agent -- --test-name-pattern="model snapshot"
npm test -w @ise/agent
```

Expected: zero failures.

- [ ] **Step 6: Commit Task 3**

```powershell
git add agent/src/session/sessionAgentRunner.ts agent/src/api/httpApp.ts agent/src/server.ts agent/test/session-api.test.ts
git commit -m "feat: snapshot user model per agent turn"
```

### Task 4: Add the web model-config client and dialog

**Files:**
- Modify: `apps/web/src/api/agent.ts`
- Modify: `apps/web/src/api/agent.test.ts`
- Create: `apps/web/src/pages/newScript/modelProviders.ts`
- Create: `apps/web/src/pages/newScript/components/ModelConfigDialog.tsx`
- Create: `apps/web/src/pages/newScript/components/ModelConfigDialog.test.tsx`
- Modify: `apps/web/src/pages/newScript/components/NewScriptHeader.tsx`
- Modify: `apps/web/src/pages/newScript/index.tsx`

**Interfaces:**
- Produces `getModelConfig`, `putModelConfig`, `clearModelConfig`, `discoverModels`, and `testModelConfig`.
- Produces controlled `ModelConfigDialog` and provider presets.

- [ ] **Step 1: Write failing API client tests**

Assert exact methods, paths, authorization, JSON bodies, and redacted response parsing for all five endpoints.

- [ ] **Step 2: Run API tests and verify RED**

Run: `npm test -w @ise/web -- --run apps/web/src/api/agent.test.ts`

Expected: FAIL because model-config functions do not exist.

- [ ] **Step 3: Implement API client functions and provider presets**

Add `DELETE` to `AgentRequestOptions`. Presets contain provider ID, label, default Base URL, local flag, and whether API key is required. Do not include secrets in preset data.

- [ ] **Step 4: Write failing dialog tests**

Cover initial load, preset selection, password input, model discovery, test, save, clear, local URL defaults, error retention, and ensuring the API key value is never rendered after save.

- [ ] **Step 5: Implement ModelConfigDialog**

Use a standard modal with provider menu, Base URL input, model combobox/input, password field, discover button, test button, save, and clear. Do not use browser storage. Close only after successful save or explicit cancel.

- [ ] **Step 6: Integrate header status**

Load public model status on page mount. Show `配置模型` when absent and the configured provider/model when present. Refresh status after save or clear.

- [ ] **Step 7: Run focused and integration tests**

Run:

```powershell
npm test -w @ise/web -- --run apps/web/src/api/agent.test.ts apps/web/src/pages/newScript/components/ModelConfigDialog.test.tsx apps/web/src/pages/newScript/newScript.integration.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 8: Commit Task 4**

```powershell
git add apps/web/src/api/agent.ts apps/web/src/api/agent.test.ts apps/web/src/pages/newScript/modelProviders.ts apps/web/src/pages/newScript/components/ModelConfigDialog.tsx apps/web/src/pages/newScript/components/ModelConfigDialog.test.tsx apps/web/src/pages/newScript/components/NewScriptHeader.tsx apps/web/src/pages/newScript/index.tsx apps/web/src/pages/newScript/newScript.integration.test.tsx
git commit -m "feat: configure agent models from new script"
```

### Task 5: Cross-layer verification

**Files:**
- Modify only for defects found by verification.

**Interfaces:**
- Consumes all model-config slice outputs.
- Produces an Agent that can start unconfigured and a web UI that can configure it securely.

- [ ] **Step 1: Run Agent typecheck, tests, and build**

```powershell
npm run typecheck -w @ise/agent
npm test -w @ise/agent
npm run build -w @ise/agent --if-present
```

Expected: zero failures.

- [ ] **Step 2: Run web typecheck, tests, and build**

```powershell
npm run typecheck -w @ise/web
npm test -w @ise/web
npm run build -w @ise/web
```

Expected: zero failures.

- [ ] **Step 3: Start Agent without MODEL variables**

Launch Agent with only host, port, database, and Nest URL. Assert it listens successfully, `GET /model-config` reports `configured: false`, and starting a Turn fails with `MODEL_NOT_CONFIGURED` without exposing internal values.

- [ ] **Step 4: Configure a local test server through the UI**

Use a deterministic local OpenAI-compatible stub. Save configuration, discover models, test it, start a Turn, clear the configuration, and assert the key never appears in browser storage, logs, network responses, or persisted SQLite content.

- [ ] **Step 5: Run desktop Playwright only**

Run: `npm run test:e2e -w @ise/web -- --project=desktop-chromium`

Expected: desktop model configuration flow passes; do not run mobile projects.

- [ ] **Step 6: Commit verification-only fixes if required**

```powershell
git add agent apps/web
git commit -m "fix: harden model configuration flow"
```
