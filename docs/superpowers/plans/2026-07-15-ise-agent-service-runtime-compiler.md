# ISE Agent Service And Runtime Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the independent authenticated ISE Agent HTTP service that persists reviewable sessions, resumes visible events, and deterministically compiles an accepted EventPlan into a validated SceneProjectConfig.

**Architecture:** Keep `IseAgentHost` and its existing EventPlan tools as the model/tool-loop boundary, then wrap them with a Fastify service, a subject-scoped Nest gateway, and SQLite repositories. Downstream generation produces a schema-checked NarrativePlan, resolves an immutable metadata-only AssetRegistry snapshot, expands only registered scene templates into a CanonicalRuntimePlan, and passes that plan through a strict BaseRuntimeAdapter and `sceneProjectConfigSchema` before publishing one compiled artifact.

**Tech Stack:** Node.js `>=20.19.0` (current supported Codex runtime `24.14.0`), TypeScript 5.9, npm workspaces, Fastify 5, better-sqlite3 11 after a Windows/supported-Node load gate (sql.js 1.13 fallback), Zod 4, `@ise/agent-core`, `@ise/skills-core`, `@ise/runtime-contracts`, Node test runner through `tsx`.

## Global Constraints

- Scope is `agent/**` plus one mechanical root `package-lock.json` update after the Foundation baseline; do not modify the root `package.json`, Web, NestJS, `packages/runtime-contracts`, `packages/agent-core`, or `packages/skills-core`.
- The Agent dependency task is the sole parallel-workflow owner of root `package-lock.json`. Web/API and SceneRuntime workflows must not run dependency installation or modify the lockfile until the Agent lockfile commit is integrated; after that commit they consume the integrated lockfile unchanged.
- Start only after `@ise/runtime-contracts` exports `SceneProjectConfig`, `sceneProjectConfigSchema`, and `AssetManifestEntry` on the implementation branch.
- Preserve the current `IseAgentHost.run(objective)` behavior and the exact `accept_event_plan` confirmation contract; add only host options needed for cancellation and persistent repositories.
- EventPlan approval must bind the exact `artifactId + version + fingerprint` tuple and a trusted host-generated `confirmationId`; never create an accepted artifact directly in SQL.
- Draft edits and deletions create a new EventPlan artifact version through `propose_event_plan`; never mutate an artifact payload in place.
- The Agent remains an independent TypeScript service. NestJS remains authoritative for JWT identity, file ownership, MinIO, asset access, Script, Scene, and final project persistence.
- Every Agent route, including SSE, requires the forwarded Bearer token; the token is validated through Nest `GET /auth/getUserInfo`, and the returned `data.id` is the session subject.
- Agent file access is only `GET /file/:id/content` with the forwarded Bearer token. Inputs are opaque file IDs; reject local paths, object names, arbitrary URLs, redirects to another origin, and caller-supplied storage locations.
- DOCX bytes must jointly pass extension `.docx`, exact MIME `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, ZIP magic, maximum size `26_214_400` bytes, `X-Content-SHA256`, and a locally recomputed SHA-256.
- AssetRegistry artifacts contain catalog metadata and stable `assetId` values only. Strip both `sourceRelativePath` and `objectName` from shared `AssetManifestEntry` values before persistence; never persist or emit signed URLs, Bearer tokens, local paths, or `ResolvedAssetAccess`.
- Asset availability is exactly `available | missing | invalid`; criticality is exactly `required | optional`. Missing or invalid required assets block compilation after explicit compatible fallbacks are exhausted. Optional fallback follows only declared `fallbackAssetIds` and fallback policy.
- Supported Scene track types are exactly `subtitle`, `image`, `video`, `marker`, `geojson`, `camera`, and `model`.
- Supported model actions are exactly `model.spawn`, `model.follow_path`, `model.set_state`, and `model.hide`; unknown command or track types are rejected before an artifact is created.
- Restricted templates are exactly `deployment`, `attack_chain`, `interception`, `electronic_warfare`, `counterattack`, `withdrawal`, `return_and_summary`, `generic_movement`, and `status_explanation`.
- Reality time in EventPlan and trajectory metadata never becomes playback time implicitly; the deterministic scheduler alone assigns millisecond `startMs` and `durationMs`.
- SQLite is the two-day authoritative store for Session, Message, Attachment, Run, Event, Artifact, and Review. Repository interfaces must keep a future PostgreSQL migration outside domain logic.
- `better-sqlite3@11.10.0` has no npm `engines`/`os` declaration and installs through `prebuild-install || node-gyp rebuild --release`; local cache contains no package to prove Windows compatibility offline. Task 1 must pass the real Windows load/transaction gate under the actual implementation Node satisfying `>=20.19.0` (currently bundled Node `24.14.0`) before it becomes the driver. System Node `20.17.0` is recorded as below-floor compatibility evidence only and does not gate or lower the repository floor.
- Run every install, test, typecheck, and start command under Node `>=20.19.0`. In the current machine, commands written as `npm ...` mean invoking npm's CLI with bundled Node `24.14.0` as established in Task 1; do not use system Node `20.17.0` for acceptance evidence.
- `POST /sessions` accepts the strict empty object `{}` only and creates an `idle` session; it never accepts an objective. Every user objective enters through `POST /sessions/:sessionId/messages`.
- NarrativePlan uses `targetDurationMs = 180_000` when the model omits the field; an explicit value must remain within `30_000..600_000` ms.
- Public SSE types are exactly `run.started`, `tool.started`, `tool.progress`, `artifact.created`, `review.requested`, `review.resolved`, `compile.progress`, `run.completed`, and `run.failed`. Do not expose model text deltas, prompts, transcript entries, hidden messages, tool inputs, or chain-of-thought.
- SSE uses numeric SQLite event IDs, accepts `Last-Event-ID`, replays every later event in ascending order, then switches to live delivery without gaps or duplicates.
- A compiled artifact is published only when both CanonicalRuntimePlan validation and `sceneProjectConfigSchema.parse(...)` pass. It contains `{ runtimePlan, sceneProjectConfig }`; the configuration's `runtimePlanArtifactId` equals that artifact's ID.
- Compilation failure preserves the last valid compiled artifact and emits structured diagnostics; it must not emit a successful terminal event or a new playable artifact.
- Do not copy the old Python Agent, LangGraph flow, Threebox player, `front_OLD`, or old mock scene JSON.
- Do not add TTS, standalone audio, collision, physics, skeletal animation, free-path planning, network asset search, or video export.
- Keep Node secrets in process environment only. Commit `agent/.env.example`, never `.env`, database files, logs, credentials, `node_modules`, `dist`, or caches.

---

## Frozen HTTP And Event Interfaces

Implement and export these exact DTOs from `agent/src/api/contracts.ts` so the Web client does not infer response shapes:

```ts
export type SessionStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type CreateSessionResponse = {
  sessionId: string
  status: 'idle'
}

export type SessionView = {
  sessionId: string
  status: SessionStatus
  activeRunId?: string
  createdAt: string
  updatedAt: string
}

export type AttachmentView = {
  attachmentId: string
  fileId: string
  name: string
  mimeType: string
  size: number
  fingerprint: `sha256:${string}`
}

export type QueuedRunResponse = {
  runId: string
  status: 'queued'
}

export type AgentArtifactView = {
  artifactId: string
  type: string
  version: number
  createdAt: string
  createdBy: 'user' | 'agent' | 'tool'
  logicalKey?: string
  supersedes?: string
  superseded: boolean
  data: unknown
  metadata?: Record<string, unknown>
}

export type ReviewTuple = {
  reviewId: string
  artifactId: string
  version: number
  fingerprint: string
}

export type RevisionRequest = {
  baseArtifactId: string
  eventUnits: EventPlan['eventUnits']
}

export type PublicAgentEventType =
  | 'run.started'
  | 'tool.started'
  | 'tool.progress'
  | 'artifact.created'
  | 'review.requested'
  | 'review.resolved'
  | 'compile.progress'
  | 'run.completed'
  | 'run.failed'

export type AgentEventEnvelope = {
  id: string
  type: PublicAgentEventType
  data: Record<string, unknown>
}

export type AgentErrorBody = {
  error: {
    code: string
    message: string
    details?: unknown
  }
}
```

Route bodies and responses are fixed as follows:

```text
POST /sessions
  body: {} (strict; objective and all other properties are rejected)
  201: CreateSessionResponse

POST /sessions/:sessionId/attachments
  body: { fileId: string }
  201: AttachmentView

POST /sessions/:sessionId/messages
  body: { content: string }
  202: QueuedRunResponse

GET /sessions/:sessionId
  200: SessionView

GET /sessions/:sessionId/events
  request header: Last-Event-ID?: decimal integer
  200: text/event-stream frames with id/event/data

GET /sessions/:sessionId/artifacts
  200: { artifacts: AgentArtifactView[] }

POST /sessions/:sessionId/reviews/:reviewId/approve
  body: { artifactId: string, version: number, fingerprint: string }
  202: QueuedRunResponse

POST /sessions/:sessionId/reviews/:reviewId/reject
  body: { artifactId: string, version: number, fingerprint: string, reason?: string }
  200: { reviewId: string, status: 'rejected' }

POST /sessions/:sessionId/event-plans/:artifactId/revisions
  body: RevisionRequest; path artifactId must equal body.baseArtifactId
  201: { artifact: AgentArtifactView, review: ReviewTuple }

POST /sessions/:sessionId/interrupt
  body: {}
  202: { runId: string, status: 'cancelled' }
```

Use `400` for malformed DTOs or `Last-Event-ID`, `401` for missing/invalid Bearer, `404` for missing or foreign-subject resources, `409` for stale review tuples or illegal state transitions, `413` for an oversized file, `415` for file identity mismatch, `422` for compile diagnostics, and `502` for a valid request whose Nest bridge failed.

## Planned File Map

```text
agent/package.json                                  service scripts and dependencies
agent/.env.example                                 non-secret service configuration
agent/src/config.ts                                strict environment parsing
agent/src/api/contracts.ts                         frozen HTTP DTO schemas and types
agent/src/api/errors.ts                            status/code error mapping
agent/src/api/httpApp.ts                           Fastify assembly and error handler
agent/src/api/sessionRoutes.ts                     session, message, attachment, artifact, SSE routes
agent/src/api/reviewRoutes.ts                      approve, reject, revise routes
agent/src/adapters/nestGateway.ts                  fixed-origin identity/file/catalog fetch adapter
agent/src/adapters/baseRuntimeAdapter.ts           CanonicalRuntimePlan to SceneProjectConfig
agent/src/persistence/database.ts                  SQLite connection, migration, transaction boundary
agent/src/persistence/sqlJsDatabase.ts             conditional sql.js file adapter if the native gate fails
agent/src/persistence/schema.ts                    idempotent DDL and row types
agent/src/persistence/repositories.ts              Session/Run/Event/Artifact/Review repositories
agent/src/persistence/persistentArtifactStore.ts   exact ArtifactStore semantics with SQLite snapshots
agent/src/persistence/persistentDomainStateStore.ts persisted DomainStateRepository adapter
agent/src/session/eventBroker.ts                   append, replay, live subscribe, SSE formatting
agent/src/session/publicEventSink.ts               AgentActionEvent allowlist projection
agent/src/session/sessionAttachmentReader.ts       subject/session-scoped remote byte reader
agent/src/session/sessionAgentRunner.ts             queued runs, host assembly, cancellation, recovery
agent/src/session/reviewService.ts                  exact approve/reject/revision orchestration
agent/src/contracts/narrativePlan.ts                strict NarrativePlan schema
agent/src/contracts/assetRegistry.ts                metadata-only registry snapshot schema
agent/src/contracts/runtimePlan.ts                  CanonicalRuntimePlan schema
agent/src/contracts/artifactTypes.ts                downstream artifact constants
agent/src/services/assetRegistry.ts                 catalog validation, alias/fallback resolution
agent/src/services/runtimeDiagnostics.ts            stable compile diagnostic codes and error
agent/src/compiler/capabilityManifest.ts            fixed command capabilities and minimum durations
agent/src/compiler/templates.ts                     nine allowed deterministic template expanders
agent/src/compiler/scheduler.ts                     subtitle timing and conflict-free millisecond windows
agent/src/compiler/sceneCompiler.ts                 deterministic compilation and validation pipeline
agent/src/tools/scenePlanTools.ts                    propose_scene_plan tool
agent/src/tools/assetTools.ts                        inspect_replay_assets tool
agent/src/tools/compilerTools.ts                     compile_replay_runtime tool and compiled artifact
agent/src/tools/documentTools.ts                     consume an AttachmentReader interface
agent/src/runtime/IseAgentHost.ts                    forward AbortSignal and persistent stores
agent/src/runtime/toolAssembly.ts                    one bounded domain tool registry per session
agent/src/server.ts                                  production bootstrap and graceful shutdown
agent/src/index.ts                                   public exports
agent/skills/generate-battle-replay/SKILL.md         downstream tool policy
agent/test/api-contracts.test.ts                     DTO strictness
agent/test/nest-gateway.test.ts                      auth/file/catalog boundary
agent/test/persistence.test.ts                       SQLite ownership, transitions, ledger
agent/test/sse.test.ts                               replay/live race and wire frames
agent/test/session-api.test.ts                       authenticated HTTP/message/interrupt behavior
agent/test/review-api.test.ts                        exact approval and revision behavior
agent/test/narrative-plan.test.ts                    grounding and tool behavior
agent/test/asset-registry.test.ts                    catalog diagnostics and fallback behavior
agent/test/compiler.test.ts                          templates, timing, determinism, failures
agent/test/base-runtime-adapter.test.ts              exact shared-contract mapping
agent/test/agent-service-flow.test.ts                DOCX-to-compiled service acceptance
package-lock.json                                   one coordinated dependency lock update
```

### Task 1: Freeze DTOs And The Restricted Nest Gateway

**Files:**
- Modify: `agent/package.json`
- Create: `agent/.env.example`
- Create: `agent/src/config.ts`
- Create: `agent/src/api/contracts.ts`
- Create: `agent/src/api/errors.ts`
- Create: `agent/src/adapters/nestGateway.ts`
- Create: `agent/src/session/sessionAttachmentReader.ts`
- Modify: `agent/src/tools/documentTools.ts`
- Modify: `agent/src/index.ts`
- Test: `agent/test/api-contracts.test.ts`
- Test: `agent/test/nest-gateway.test.ts`
- Modify mechanically: `package-lock.json`

**Interfaces:**
- Consumes: Nest `GET /auth/getUserInfo`, `GET /file/:id/content`, and `GET /asset-catalog` using the forwarded Bearer token.
- Produces: all DTOs in “Frozen HTTP And Event Interfaces”; `NestGateway.verifyBearer`, `NestGateway.readOwnedFile`, `NestGateway.listAssetMetadata`; `AttachmentReader.readVerified(fileId)`.

- [ ] **Step 1: Write failing strict-contract and bridge tests**

```ts
test('create session response is exact and rejects extra fields', () => {
  assert.deepEqual(createSessionResponseSchema.parse({
    sessionId: '00000000-0000-4000-8000-000000000001',
    status: 'idle',
  }), { sessionId: '00000000-0000-4000-8000-000000000001', status: 'idle' })
  assert.equal(createSessionResponseSchema.safeParse({
    sessionId: '00000000-0000-4000-8000-000000000001', status: 'idle', subject: 'secret',
  }).success, false)
})

test('file bridge checks header and byte fingerprints', async () => {
  const bytes = Buffer.from('PK\u0003\u0004docx')
  mockFetchSequence(
    jsonResponse({ code: 200, data: { id: 'user-1' }, msg: 'ok', timestamp: 1 }),
    new Response(bytes, { headers: {
      'content-type': DOCX_MIME,
      'content-length': String(bytes.length),
      'content-disposition': "attachment; filename*=UTF-8''report.docx",
      'x-content-sha256': sha256(bytes),
    }}),
  )
  const gateway = new FetchNestGateway({ baseUrl: 'http://nest.test' })
  assert.deepEqual(await gateway.verifyBearer('Bearer token'), { subject: 'user-1' })
  assert.equal((await gateway.readOwnedFile('file-1', 'Bearer token')).fingerprint, sha256(bytes))
})

test('file bridge rejects a fingerprint header that differs from bytes', async () => {
  mockOwnedFile({ headerFingerprint: `sha256:${'0'.repeat(64)}` })
  await assert.rejects(
    new FetchNestGateway({ baseUrl: 'http://nest.test' }).readOwnedFile('file-1', 'Bearer token'),
    errorWithCode('ATTACHMENT_FINGERPRINT_MISMATCH'),
  )
})
```

- [ ] **Step 2: Run the focused tests and confirm the missing-module failures**

Run: `npm test -w @ise/agent -- test/api-contracts.test.ts test/nest-gateway.test.ts`

Expected: FAIL with `Cannot find module '../src/api/contracts.ts'` and `Cannot find module '../src/adapters/nestGateway.ts'`.

- [ ] **Step 3: Gate the SQLite driver on the actual supported Windows Node**

First check whether an offline package is actually available:

```powershell
npm cache ls better-sqlite3@11.10.0
```

Expected in the current workspace: no output. This means compatibility is unverified offline; npm metadata alone is not acceptance evidence.

Record both runtimes, then run the disposable probe with the bundled supported runtime before editing the repository lockfile:

```powershell
$systemNodeVersion = node --version
$supportedNode = 'C:\Users\t\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$supportedNodeVersion = & $supportedNode --version
"system=$systemNodeVersion supported=$supportedNodeVersion"
if ([version]($supportedNodeVersion.TrimStart('v')) -lt [version]'20.19.0') {
  throw "Implementation Node is below 20.19.0: $supportedNodeVersion"
}
$npmRoot = Split-Path (Get-Command npm).Source
$npmCli = Join-Path $npmRoot 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCli)) { throw "npm CLI not found: $npmCli" }
$probe = Join-Path $env:TEMP 'ise-better-sqlite3-11.10.0-probe'
if (Test-Path $probe) { Remove-Item -LiteralPath $probe -Recurse -Force }
New-Item -ItemType Directory -Path $probe | Out-Null
Push-Location $probe
& $supportedNode $npmCli init -y | Out-Null
& $supportedNode $npmCli install --ignore-scripts=false better-sqlite3@11.10.0
& $supportedNode -e "const assert=require('node:assert/strict'); const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.exec('CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)'); const insert=db.prepare('INSERT INTO probe(value) VALUES (?)'); db.transaction(()=>{insert.run('ok')})(); assert.equal(db.prepare('SELECT value FROM probe').get().value,'ok'); console.log(process.platform, process.arch, process.version, db.pragma('compile_options').length); db.close()"
Pop-Location
Remove-Item -LiteralPath $probe -Recurse -Force
```

Expected in the current environment: `system=v20.17.0 supported=v24.14.0`; install exits `0`; the smoke test prints `win32 x64 v24.14.0` and a positive compile-option count. Only the supported `>=20.19.0` runtime is blocking. Record whether installation used a downloaded prebuild or a successful `node-gyp` build; either is acceptable only when the smoke command passes.

If installation or loading fails under the actual supported implementation Node, do not continue with `better-sqlite3`. Use the repository interface fallback fixed here: replace it with `"sql.js": "1.13.0"` and `"@types/sql.js": "1.4.9"`, set `AGENT_SQLITE_DRIVER=sql.js`, and implement `agent/src/persistence/sqlJsDatabase.ts`. That adapter loads an existing SQLite byte file, executes the same DDL and prepared repository operations, serializes after each outer transaction to `<db>.tmp`, calls `fsync`, and atomically renames it over the database file under one process mutex. It is single-process only and does not claim WAL behavior. Run the full persistence/SSE/API contract suites against the selected driver before Task 3.

Both drivers implement this exact boundary; the fallback's outer transaction is concrete and durable:

```ts
export interface SqliteStatement {
  run(params?: SqlJs.BindParams): { changes: number }
  get(params?: SqlJs.BindParams): Record<string, unknown> | undefined
  all(params?: SqlJs.BindParams): Record<string, unknown>[]
}

export interface SqliteDatabaseAdapter {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  transaction<T>(work: () => T): T
  close(): void
}

export class SqlJsDatabaseAdapter implements SqliteDatabaseAdapter {
  #inTransaction = false
  constructor(private readonly db: SqlJs.Database, private readonly path: string) {}

  exec(sql: string): void { this.db.run(sql) }
  prepare(sql: string): SqliteStatement {
    const execute = (params: SqlJs.BindParams | undefined, firstOnly: boolean) => {
      const statement = this.db.prepare(sql)
      try {
        if (params !== undefined) statement.bind(params)
        const rows: Record<string, unknown>[] = []
        while (statement.step()) {
          rows.push(statement.getAsObject())
          if (firstOnly) break
        }
        return rows
      } finally {
        statement.free()
      }
    }
    return {
      run: params => {
        this.db.run(sql, params)
        return { changes: this.db.getRowsModified() }
      },
      get: params => execute(params, true)[0],
      all: params => execute(params, false),
    }
  }
  close(): void { this.db.close() }

  transaction<T>(work: () => T): T {
    if (this.#inTransaction) return work()
    this.#inTransaction = true
    this.db.run('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.run('COMMIT')
      this.persist()
      return result
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    } finally {
      this.#inTransaction = false
    }
  }

  private persist(): void {
    const temporary = `${this.path}.tmp`
    const handle = openSync(temporary, 'w')
    try {
      writeFileSync(handle, Buffer.from(this.db.export()))
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    renameSync(temporary, this.path)
  }
}
```

- [ ] **Step 4: Add dependencies, environment schema, and exact DTO schemas**

Add scripts `start: "tsx src/server.ts"` and `test:service: "tsx --test test/*api.test.ts test/sse.test.ts test/agent-service-flow.test.ts"`. Always add `"@ise/runtime-contracts": "file:../packages/runtime-contracts"` and `"fastify": "^5.6.2"`. If Step 3 passes, add `"better-sqlite3": "11.10.0"` plus `"@types/better-sqlite3": "7.6.13"`; if it fails, add `"sql.js": "1.13.0"` plus `"@types/sql.js": "1.4.9"` instead. Never keep both drivers. From the repository root, run `& $supportedNode $npmCli install` exactly once so only this Agent task changes the already-established root `package-lock.json`; do not edit root `package.json`.

```ts
export const sessionStatusSchema = z.enum([
  'idle', 'queued', 'running', 'awaiting_review', 'completed', 'failed', 'cancelled',
])

export const createSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.literal('idle'),
}).strict()

export const emptyObjectSchema = z.object({}).strict()
export const sendMessageSchema = z.object({ content: z.string().trim().min(1).max(20_000) }).strict()
export const attachFileSchema = z.object({ fileId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/) }).strict()
export const reviewDecisionSchema = z.object({
  artifactId: z.string().min(1),
  version: z.number().int().positive(),
  fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict()
export const revisionRequestSchema = z.object({
  baseArtifactId: z.string().min(1),
  eventUnits: eventPlanSchema.shape.eventUnits,
}).strict()
```

Use this environment contract in `config.ts` and `.env.example`:

```text
AGENT_HOST=127.0.0.1
AGENT_PORT=4310
AGENT_DB_PATH=./var/ise-agent.sqlite
AGENT_SQLITE_DRIVER=better-sqlite3
NEST_API_BASE_URL=http://127.0.0.1:3000
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-5-mini
MODEL_API_KEY=
```

```ts
export const agentConfigSchema = z.object({
  AGENT_HOST: z.string().min(1).default('127.0.0.1'),
  AGENT_PORT: z.coerce.number().int().min(1).max(65_535).default(4310),
  AGENT_DB_PATH: z.string().min(1).default('./var/ise-agent.sqlite'),
  AGENT_SQLITE_DRIVER: z.enum(['better-sqlite3', 'sql.js']).default('better-sqlite3'),
  NEST_API_BASE_URL: z.url(),
  MODEL_BASE_URL: z.url(),
  MODEL_NAME: z.string().min(1),
  MODEL_API_KEY: z.string().min(1),
}).strict()

export function loadConfig(env: NodeJS.ProcessEnv) {
  return agentConfigSchema.parse({
    AGENT_HOST: env.AGENT_HOST,
    AGENT_PORT: env.AGENT_PORT,
    AGENT_DB_PATH: env.AGENT_DB_PATH,
    AGENT_SQLITE_DRIVER: env.AGENT_SQLITE_DRIVER,
    NEST_API_BASE_URL: env.NEST_API_BASE_URL,
    MODEL_BASE_URL: env.MODEL_BASE_URL,
    MODEL_NAME: env.MODEL_NAME,
    MODEL_API_KEY: env.MODEL_API_KEY,
  })
}
```

- [ ] **Step 5: Implement fixed-origin auth, file, and catalog fetches**

```ts
export interface AttachmentReader {
  readVerified(fileId: string): Promise<Buffer>
}

export interface AuthorizedFile {
  fileId: string
  name: string
  mimeType: string
  size: number
  fingerprint: string
  bytes: Buffer
}

export class FetchNestGateway {
  constructor(readonly options: { baseUrl: string; fetch?: typeof fetch }) {}

  async verifyBearer(authorization: string): Promise<{ subject: string }> {
    const response = await this.request('/auth/getUserInfo', authorization)
    const body = nestUserResponseSchema.parse(await response.json())
    return { subject: body.data.id }
  }

  async readOwnedFile(fileId: string, authorization: string): Promise<AuthorizedFile> {
    assertOpaqueId(fileId)
    const response = await this.request(`/file/${encodeURIComponent(fileId)}/content`, authorization)
    const declaredSize = parseBoundedContentLength(response.headers.get('content-length'), 26_214_400)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length !== declaredSize) throw agentError(415, 'ATTACHMENT_SIZE_MISMATCH')
    const file = validateDocxIdentity({
      fileId,
      name: parseAttachmentFilename(response.headers.get('content-disposition')),
      mimeType: response.headers.get('content-type') ?? '',
      headerFingerprint: response.headers.get('x-content-sha256') ?? '',
      bytes,
    })
    return file
  }

  async listAssetMetadata(authorization: string): Promise<unknown> {
    const response = await this.request('/asset-catalog', authorization)
    return nestUnknownResponseSchema.parse(await response.json()).data
  }

  private async request(path: string, authorization: string): Promise<Response> {
    const url = new URL(path, ensureHttpOrigin(this.options.baseUrl))
    const response = await (this.options.fetch ?? fetch)(url, {
      headers: { authorization }, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    })
    if (response.status >= 300 && response.status < 400) throw agentError(502, 'NEST_REDIRECT_REJECTED')
    if (response.status === 401 || response.status === 403) throw agentError(401, 'INVALID_BEARER')
    if (!response.ok) throw agentError(502, 'NEST_BRIDGE_FAILED')
    return response
  }
}
```

Change only the parameter type of `createDocumentTools` from the concrete local `AttachmentRegistry` to `AttachmentReader`. Keep every tool name, risk, input schema, artifact type, and existing test unchanged. `SessionAttachmentReader` must require a registered `(sessionId, fileId)` row, fetch with the request's Bearer token, and compare the new bytes against the attachment row's stored name, size, MIME, and fingerprint.

- [ ] **Step 6: Run bridge and all existing Agent tests**

Run: `npm test -w @ise/agent -- test/api-contracts.test.ts test/nest-gateway.test.ts test/document-tools.test.ts`

Expected: PASS; the existing `AttachmentRegistry` tests still pass through the structural `AttachmentReader` interface.

- [ ] **Step 7: Commit the boundary**

```powershell
git add agent/package.json agent/.env.example agent/src/config.ts agent/src/api agent/src/adapters/nestGateway.ts agent/src/session/sessionAttachmentReader.ts agent/src/tools/documentTools.ts agent/src/index.ts agent/test/api-contracts.test.ts agent/test/nest-gateway.test.ts package-lock.json
git commit -m "feat(agent): add authenticated Nest bridge contracts"
```

### Task 2: Persist Sessions, Runs, Events, Artifacts, And Reviews In SQLite

**Files:**
- Create: `agent/src/persistence/schema.ts`
- Create: `agent/src/persistence/database.ts`
- Create conditionally when Task 1 selects the fallback: `agent/src/persistence/sqlJsDatabase.ts`
- Create: `agent/src/persistence/repositories.ts`
- Create: `agent/src/persistence/persistentArtifactStore.ts`
- Create: `agent/src/persistence/persistentDomainStateStore.ts`
- Test: `agent/test/persistence.test.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Consumes: `ArtifactStore` and repository interfaces from `@ise/agent-core` without changing that package.
- Produces: `AgentDatabase.open(path, driver)`, `AgentRepositories`, and `new PersistentArtifactStore(sessionId, repository)`.

- [ ] **Step 1: Write failing ownership, transition, event-order, and rehydration tests**

```ts
test('foreign subjects cannot observe whether a session exists', () => {
  const repositories = testRepositories()
  const session = repositories.sessions.create('user-1')
  assert.throws(() => repositories.sessions.requireOwned(session.id, 'user-2'), errorWithStatus(404))
  assert.throws(() => repositories.sessions.requireOwned('missing', 'user-2'), errorWithStatus(404))
})

test('only one queued or running run exists per session', () => {
  const repositories = testRepositories()
  const session = repositories.sessions.create('user-1')
  repositories.runs.createQueued(session.id, 'first')
  assert.throws(() => repositories.runs.createQueued(session.id, 'second'), /ACTIVE_RUN_EXISTS/)
})

test('event ids are durable and replay in ascending order', () => {
  const repositories = testRepositories()
  const session = repositories.sessions.create('user-1')
  const first = repositories.events.append(session.id, undefined, 'run.started', { runId: 'run-1' })
  const second = repositories.events.append(session.id, undefined, 'tool.started', { toolName: 'parse_battle_report' })
  assert.deepEqual(repositories.events.after(session.id, first.id).map(event => event.id), [second.id])
})

test('persistent artifact store retains superseded ledger state after reopen', () => {
  const { database, repositories } = fileRepositories(t)
  const session = repositories.sessions.create('user-1')
  const store = new PersistentArtifactStore(session.id, repositories.artifacts)
  store.create({ id: 'v1', type: 'plan', logicalKey: 'plan:1', createdBy: 'agent', data: { version: 1 } })
  store.create({ id: 'v2', type: 'plan', logicalKey: 'plan:1', createdBy: 'agent', data: { version: 2 } })
  database.close()
  const reopened = reopenPersistentStore(session.id)
  assert.equal(reopened.get('v1')?.superseded, true)
  assert.deepEqual(reopened.list('plan').map(item => item.id), ['v2'])
})
```

- [ ] **Step 2: Run the persistence test and verify it fails**

Run: `npm test -w @ise/agent -- test/persistence.test.ts`

Expected: FAIL with `Cannot find module '../src/persistence/database.ts'`.

- [ ] **Step 3: Add idempotent DDL and strict row types**

For the accepted better-sqlite3 driver use `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, and `busy_timeout = 5000`. For the conditional sql.js fallback use foreign keys plus the atomic export/rename transaction boundary from Task 1; do not assert WAL. Store JSON as canonical UTF-8 text and parse it at repository boundaries.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, subject TEXT NOT NULL, status TEXT NOT NULL,
  active_run_id TEXT, domain_state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_attachments (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), file_id TEXT NOT NULL,
  name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(session_id, file_id)
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), objective TEXT NOT NULL,
  status TEXT NOT NULL, started_at TEXT, finished_at TEXT, error_json TEXT, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run_per_session
  ON runs(session_id) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
  run_id TEXT, type TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_replay ON events(session_id, id);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), run_id TEXT,
  type TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
  data_json TEXT NOT NULL, metadata_json TEXT, logical_key TEXT, scope_key TEXT,
  supersedes TEXT, superseded INTEGER NOT NULL CHECK(superseded IN (0,1))
);
CREATE INDEX IF NOT EXISTS artifacts_by_session ON artifacts(session_id, created_at, id);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), artifact_id TEXT NOT NULL,
  artifact_version INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','superseded')),
  confirmation_id TEXT, reason TEXT, created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_review_per_artifact
  ON reviews(artifact_id) WHERE status = 'pending';
```

- [ ] **Step 4: Implement transaction-safe repositories and exact ArtifactStore rehydration**

```ts
export class PersistentArtifactStore implements ArtifactRepository {
  readonly #memory = new ArtifactStore()
  constructor(readonly sessionId: string, readonly repository: ArtifactRepositorySqlite) {
    this.#memory.createMany(repository.listLedger(sessionId).map(toArtifactInput))
  }
  get currentScopeKey() { return this.#memory.currentScopeKey }
  set currentScopeKey(value: string) { this.#memory.currentScopeKey = value }
  create<T>(input: ArtifactInput<T>): Artifact<T> { return this.createMany([input])[0] as Artifact<T> }
  createMany(inputs: readonly ArtifactInput[]): Artifact[] {
    const created = this.#memory.createMany(inputs)
    this.repository.replaceLedger(this.sessionId, this.#memory.list(undefined, { includeSuperseded: true }))
    return created
  }
  get<T>(id: string) { return this.#memory.get<T>(id) }
  list(type?: string, options?: { scopeKey?: string; includeSuperseded?: boolean }) {
    return this.#memory.list(type, options)
  }
  delete(id: string) {
    const changed = this.#memory.delete(id)
    if (changed) this.repository.replaceLedger(this.sessionId, this.#memory.list(undefined, { includeSuperseded: true }))
    return changed
  }
}
```

Persist DomainState through the generic core interface rather than a concrete class:

```ts
export class PersistentDomainStateStore implements DomainStateRepository {
  readonly #memory: DomainStateStore
  constructor(readonly sessionId: string, readonly sessions: SessionRepository) {
    this.#memory = new DomainStateStore(sessions.readDomainState(sessionId))
  }
  snapshot<T extends DomainState = DomainState>(): T { return this.#memory.snapshot<T>() }
  applyPatch(patch: DomainStatePatch): DomainState {
    const state = this.#memory.applyPatch(patch)
    this.sessions.writeDomainState(this.sessionId, state)
    return state
  }
}
```

`replaceLedger` must run `DELETE + INSERT` in one SQLite transaction. Session transitions must use compare-and-set SQL (`WHERE status IN (...)`) and throw `SESSION_STATE_CONFLICT` when `changes !== 1`. `recoverInterruptedRuns()` changes persisted `queued|running` rows to `failed`, clears `active_run_id`, and records `SERVICE_RESTARTED_DURING_RUN` so restart never leaves an uninterruptible active run.

- [ ] **Step 5: Run persistence tests and typecheck**

Run: `npm test -w @ise/agent -- test/persistence.test.ts && npm run typecheck -w @ise/agent`

Expected: PASS; reopening the database preserves both active and superseded artifact rows.

- [ ] **Step 6: Commit persistence**

```powershell
git add agent/src/persistence agent/src/index.ts agent/test/persistence.test.ts
git commit -m "feat(agent): persist session and artifact ledgers"
```

### Task 3: Add Durable Public Events And Gap-Free SSE Replay

**Files:**
- Create: `agent/src/session/eventBroker.ts`
- Create: `agent/src/session/publicEventSink.ts`
- Test: `agent/test/sse.test.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Consumes: `AgentActionEvent` from `@ise/agent-core` and the SQLite event repository.
- Produces: `EventBroker.append`, `EventBroker.subscribe`, `EventBroker.replayAfter`, `PublicEventSink.emit`, and `writeSseSession`.

- [ ] **Step 1: Write failing replay, race, filtering, and wire-format tests**

```ts
test('replay then live delivery has no gap or duplicate', async () => {
  const broker = testEventBroker()
  broker.append('session-1', 'run-1', 'run.started', { runId: 'run-1', status: 'running' })
  const stream = broker.subscribe('session-1', '0')
  const first = await stream.next()
  broker.append('session-1', 'run-1', 'tool.started', { runId: 'run-1', toolCallId: 'call-1', toolName: 'parse_battle_report' })
  const second = await stream.next()
  assert.deepEqual([first.value.id, second.value.id], ['1', '2'])
  await stream.return(undefined)
})

test('public sink drops model and hidden runtime events', async () => {
  const recorded: string[] = []
  const sink = new PublicEventSink('session-1', brokerThatRecords(recorded))
  await sink.emit(coreEvent('model.streaming'))
  await sink.emit(coreEvent('model.responded'))
  await sink.emit(coreEvent('tool.started', { tool: 'inspect_report_evidence' }))
  assert.deepEqual(recorded, ['tool.started'])
})

test('SSE uses database id, event type, and payload-only data', () => {
  assert.equal(formatSse({ id: '7', type: 'artifact.created', data: { artifactId: 'artifact-1' } }),
    'id: 7\nevent: artifact.created\ndata: {"artifactId":"artifact-1"}\n\n')
})
```

- [ ] **Step 2: Run the SSE test and verify it fails**

Run: `npm test -w @ise/agent -- test/sse.test.ts`

Expected: FAIL with `Cannot find module '../src/session/eventBroker.ts'`.

- [ ] **Step 3: Implement append-before-publish and race-free subscription**

```ts
append(sessionId: string, runId: string | undefined, type: PublicAgentEventType, data: Record<string, unknown>) {
  const row = this.events.append(sessionId, runId, type, data)
  const event = toEnvelope(row)
  this.emitter.emit(sessionId, event)
  return event
}

async *subscribe(sessionId: string, lastEventId: string, signal?: AbortSignal) {
  let highWater = BigInt(lastEventId)
  const queue = new AsyncQueue<AgentEventEnvelope>()
  const onEvent = (event: AgentEventEnvelope) => {
    if (BigInt(event.id) > highWater) queue.push(event)
  }
  this.emitter.on(sessionId, onEvent)
  try {
    for (const event of this.replayAfter(sessionId, lastEventId)) {
      if (BigInt(event.id) <= highWater) continue
      highWater = BigInt(event.id)
      yield event
    }
    for await (const event of queue.iterate(signal)) {
      if (BigInt(event.id) <= highWater) continue
      highWater = BigInt(event.id)
      yield event
    }
  } finally {
    this.emitter.off(sessionId, onEvent)
  }
}
```

Register the listener before the replay query; filter with `highWater` after replay so an event created in the race window is delivered once.

- [ ] **Step 4: Project only public fields from AgentActionEvent**

Map core `run.started`, `tool.started`, `tool.progress`, `artifact.created`, and `run.failed`. Do not pass `event.data` through wholesale. For example:

```ts
case 'tool.started':
  return this.broker.append(this.sessionId, event.runId, 'tool.started', {
    runId: event.runId,
    toolCallId: requiredString(event.toolCallId),
    toolName: requiredString(event.data?.tool),
    summary: event.summary,
  })
case 'artifact.created':
  return this.broker.append(this.sessionId, event.runId, 'artifact.created', {
    runId: event.runId,
    artifactId: requiredString(event.data?.artifactId),
    artifactType: requiredString(event.data?.artifactType),
    logicalKey: optionalString(event.data?.logicalKey),
    metadata: publicArtifactMetadata(event.data?.metadata),
  })
default:
  return undefined
```

The session runner, not the raw core sink, emits `review.*`, `compile.progress`, and successful `run.completed`. Cancellation emits `run.failed` with `{ runId, status: 'cancelled', diagnostics: [{ code: 'RUN_CANCELLED', ... }] }`.

- [ ] **Step 5: Run the SSE tests**

Run: `npm test -w @ise/agent -- test/sse.test.ts`

Expected: PASS with no `model.streaming`, input, token, prompt, or transcript data in persisted events.

- [ ] **Step 6: Commit public events**

```powershell
git add agent/src/session/eventBroker.ts agent/src/session/publicEventSink.ts agent/src/index.ts agent/test/sse.test.ts
git commit -m "feat(agent): replay durable public events over SSE"
```

### Task 4: Expose Authenticated Session, Message, Attachment, Artifact, And Interrupt Routes

**Files:**
- Create: `agent/src/runtime/toolAssembly.ts`
- Create: `agent/src/session/sessionAgentRunner.ts`
- Create: `agent/src/api/sessionRoutes.ts`
- Create: `agent/src/api/httpApp.ts`
- Modify: `agent/src/runtime/IseAgentHost.ts`
- Test: `agent/test/session-api.test.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Consumes: existing `IseAgentHost`, `createDocumentTools`, `createEventPlanTools`, project Skill loader, persistent stores, Nest gateway, and EventBroker.
- Produces: every non-review route in the frozen table and `SessionAgentRunner.enqueue`, `SessionAgentRunner.interrupt`.

- [ ] **Step 1: Write failing authenticated API and cancellation tests**

```ts
test('create session returns only sessionId and idle status', async () => {
  const response = await app.inject({ method: 'POST', url: '/sessions', headers: bearer('user-1'), payload: {} })
  assert.equal(response.statusCode, 201)
  assert.deepEqual(Object.keys(response.json()).sort(), ['sessionId', 'status'])
  assert.equal(response.json().status, 'idle')
  const rejected = await app.inject({
    method: 'POST', url: '/sessions', headers: bearer('user-1'), payload: { objective: '生成复盘' },
  })
  assert.equal(rejected.statusCode, 400)
})

test('session ownership is checked on artifacts and SSE', async () => {
  const sessionId = await createSession(app, 'user-1')
  for (const url of [`/sessions/${sessionId}`, `/sessions/${sessionId}/artifacts`, `/sessions/${sessionId}/events`]) {
    const response = await app.inject({ method: 'GET', url, headers: bearer('user-2') })
    assert.equal(response.statusCode, 404)
  }
})

test('message queues one run and interrupt aborts it', async () => {
  const { app, blockingModel } = testApp()
  const sessionId = await createSession(app, 'user-1')
  const queued = await app.inject({ method: 'POST', url: `/sessions/${sessionId}/messages`, headers: bearer('user-1'), payload: { content: '生成事件计划' } })
  assert.equal(queued.statusCode, 202)
  assert.equal(queued.json().status, 'queued')
  await blockingModel.started
  const interrupted = await app.inject({ method: 'POST', url: `/sessions/${sessionId}/interrupt`, headers: bearer('user-1'), payload: {} })
  assert.deepEqual(interrupted.json(), { runId: queued.json().runId, status: 'cancelled' })
})
```

- [ ] **Step 2: Run the API test and verify it fails**

Run: `npm test -w @ise/agent -- test/session-api.test.ts`

Expected: FAIL because `createHttpApp` and `SessionAgentRunner` do not exist.

- [ ] **Step 3: Add cancellation to IseAgentHost without changing EventPlan semantics**

```ts
export interface IseAgentHostOptions {
  // retain every existing field unchanged
  artifacts?: ArtifactRepository
  domainState?: DomainStateRepository
  signal?: AbortSignal
}

// Add to the AgentRuntime options in IseAgentHost.run:
signal: this.options.signal,
```

Replace the existing concrete `ArtifactStore` and `DomainStateStore` option annotations with their already-exported `ArtifactRepository` and `DomainStateRepository` interfaces; concrete stores remain structurally accepted. Do not add message history, HTTP concerns, or SQL calls to `IseAgentHost`. `toolAssembly.ts` creates a new `ToolRegistry` per run from the session-bound `AttachmentReader`, current project Skill registry, existing document tools, existing EventPlan tools, and downstream tools introduced later.

- [ ] **Step 4: Implement queued background execution with persisted state**

```ts
enqueue(input: { sessionId: string; subject: string; authorization: string; content: string }): QueuedRunResponse {
  const run = this.repositories.transaction(() => {
    this.sessions.requireOwned(input.sessionId, input.subject)
    this.messages.append(input.sessionId, 'user', input.content)
    const created = this.runs.createQueued(input.sessionId, buildBoundedObjective(input.sessionId, input.content))
    this.sessions.transition(input.sessionId, ['idle','awaiting_review','completed','failed','cancelled'], 'queued', created.id)
    return created
  })
  queueMicrotask(() => void this.execute(run.id, input.authorization))
  return { runId: run.id, status: 'queued' }
}

private async execute(runId: string, authorization: string): Promise<void> {
  const controller = new AbortController()
  this.controllers.set(runId, controller)
  const run = this.runs.markRunning(runId)
  this.sessions.transition(run.sessionId, ['queued'], 'running', run.id)
  try {
    const result = await this.hostFactory({
      artifacts: new PersistentArtifactStore(run.sessionId, this.artifacts),
      domainState: new PersistentDomainStateStore(run.sessionId, this.sessions),
      eventSink: new PublicEventSink(run.sessionId, this.events),
      signal: controller.signal,
      authorization,
    }).run(run.objective)
    await this.finishFromResult(run, result)
  } catch (error) {
    await this.finishFromThrownError(run, error, controller.signal.aborted)
  } finally {
    this.controllers.delete(runId)
  }
}
```

`buildBoundedObjective` includes at most the last 12 visible messages plus active Artifact IDs and the current attachment IDs; it never embeds attachment bytes, bearer tokens, hidden messages, or the full artifact ledger. A second message while a run is queued/running returns `409 ACTIVE_RUN_EXISTS`.

`finishFromResult` checks for a pending Review before applying a terminal transition: a draft-producing run marks the Run completed but leaves Session `awaiting_review`; only a run containing a validated compiled artifact may set Session `completed` and emit public `run.completed`.

- [ ] **Step 5: Implement auth pre-handler, routes, SSE, and one error envelope**

Every handler calls `requestIdentity(request)` and then `requireOwned(sessionId, subject)`. SSE parses `Last-Event-ID` with `/^(0|[1-9][0-9]*)$/`, writes replay/live frames with backpressure, sends `: heartbeat\n\n` every 15 seconds, and removes listener/timer on request abort.

```ts
app.setErrorHandler((error, _request, reply) => {
  const mapped = mapAgentError(error)
  void reply.status(mapped.status).send({
    error: { code: mapped.code, message: mapped.message, ...(mapped.details === undefined ? {} : { details: mapped.details }) },
  })
})

app.post('/sessions', async (request, reply) => {
  emptyObjectSchema.parse(request.body)
  const { subject } = await requestIdentity(request)
  const session = repositories.sessions.create(subject)
  return reply.status(201).send({ sessionId: session.id, status: 'idle' })
})
```

`POST attachments` validates the remote file before inserting metadata. `GET artifacts` returns active and superseded rows ordered by `createdAt,id`, so review history is inspectable. `interrupt` aborts only the active in-process run for the same owned session, persists `cancelled`, clears `active_run_id`, and emits terminal `run.failed` with `status: 'cancelled'`.

- [ ] **Step 6: Run API, existing host, and EventPlan tests**

Run: `npm test -w @ise/agent -- test/session-api.test.ts test/runtime.test.ts test/event-plan-tools.test.ts test/sse.test.ts`

Expected: PASS; the four existing exact-confirmation tests remain unchanged.

- [ ] **Step 7: Commit the session service**

```powershell
git add agent/src/runtime agent/src/session/sessionAgentRunner.ts agent/src/api agent/src/index.ts agent/test/session-api.test.ts
git commit -m "feat(agent): serve authenticated cancellable sessions"
```

### Task 5: Reuse EventPlan Tools For Exact Review, Rejection, And Revision

**Files:**
- Create: `agent/src/session/reviewService.ts`
- Create: `agent/src/api/reviewRoutes.ts`
- Modify: `agent/src/session/publicEventSink.ts`
- Test: `agent/test/review-api.test.ts`
- Modify: `agent/src/api/httpApp.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Consumes: `propose_event_plan`, `accept_event_plan`, `executeToolCall`, PersistentArtifactStore, and ReviewTuple.
- Produces: approve/reject/revision routes; `ReviewService.createForDraft`, `approve`, `reject`, and `revise`.

- [ ] **Step 1: Write failing stale-tuple and immutable-revision tests**

```ts
test('approve invokes accept_event_plan with a trusted exact binding', async () => {
  const fixture = await seededReviewApp()
  const response = await fixture.app.inject({
    method: 'POST', url: `/sessions/${fixture.sessionId}/reviews/${fixture.reviewId}/approve`,
    headers: bearer('user-1'), payload: fixture.tuple,
  })
  assert.equal(response.statusCode, 202)
  const accepted = fixture.repositories.artifacts.list(fixture.sessionId)
    .find(item => item.type === EVENT_PLAN_ACCEPTED_ARTIFACT)
  assert.equal(accepted?.createdBy, 'user')
  assert.equal(accepted?.metadata?.confirmationId, `review:${fixture.reviewId}:user-1`)
})

test('approve rejects a stale version or fingerprint without accepting anything', async () => {
  const fixture = await seededReviewApp()
  const response = await fixture.app.inject({
    method: 'POST', url: `/sessions/${fixture.sessionId}/reviews/${fixture.reviewId}/approve`,
    headers: bearer('user-1'), payload: { ...fixture.tuple, version: fixture.tuple.version + 1 },
  })
  assert.equal(response.statusCode, 409)
  assert.equal(fixture.repositories.artifacts.list(fixture.sessionId)
    .some(item => item.type === EVENT_PLAN_ACCEPTED_ARTIFACT), false)
})

test('revision creates version two and supersedes but does not mutate version one', async () => {
  const fixture = await seededReviewApp()
  const before = structuredClone(fixture.draft.data)
  const response = await revise(fixture, reorderedUnits(fixture.draft.data.eventUnits))
  assert.equal(response.statusCode, 201)
  assert.equal(response.json().artifact.version, 2)
  assert.deepEqual(fixture.repositories.artifacts.get(fixture.sessionId, fixture.draft.id)?.data, before)
  assert.equal(fixture.repositories.artifacts.get(fixture.sessionId, fixture.draft.id)?.superseded, true)
})
```

- [ ] **Step 2: Run review tests and verify they fail**

Run: `npm test -w @ise/agent -- test/review-api.test.ts`

Expected: FAIL with missing `ReviewService` and review routes.

- [ ] **Step 3: Create pending reviews from draft artifact events**

When `PublicEventSink` observes `EVENT_PLAN_DRAFT_ARTIFACT`, call `ReviewService.createForDraft` in the same SQLite transaction as the pending review row and `review.requested` event. Supersede any older pending review for the same logical EventPlan before creating the new one.

```ts
const review = this.reviews.createPending({
  sessionId, artifactId: draft.id, artifactVersion: plan.version,
  fingerprint: requiredMetadataString(draft, 'fingerprint'),
})
this.sessions.transition(sessionId, ['running','awaiting_review'], 'awaiting_review')
this.events.append(sessionId, runId, 'review.requested', {
  reviewId: review.id, artifactId: draft.id, version: plan.version, fingerprint: review.fingerprint,
})
```

- [ ] **Step 4: Approve by executing the existing write tool directly through the core host contract**

Do not ask the model to repeat an already explicit user decision. Build an `AgentContext` with the persistent artifact ledger and invoke the existing `accept_event_plan` tool through `executeToolCall`:

```ts
const execution = await executeToolCall({
  tool: requireTool(createEventPlanTools(), 'accept_event_plan'),
  call: { id: `approve-${review.id}`, name: 'accept_event_plan', input: {
    draftArtifactId: review.artifactId, version: review.artifactVersion, fingerprint: review.fingerprint,
  }},
  context,
  eventSink: new PublicEventSink(sessionId, this.events),
  runId,
  turn: 0,
  guard: { check: async () => ({
    decision: 'allow', confirmationId: `review:${review.id}:${subject}`,
  }) },
})
if (execution.outcome !== 'completed') throw agentError(409, 'EVENT_PLAN_APPROVAL_FAILED')
```

Only after accepted artifact creation succeeds, atomically mark the review approved, emit `review.resolved` with the exact tuple and `decision: 'approved'`, and enqueue downstream generation. Reject compares the same exact tuple, marks the review rejected, preserves the draft, emits `decision: 'rejected'`, and sets the session to `completed` without compiling.

- [ ] **Step 5: Revise through the existing derive tool**

Read `baseArtifactId`, require it is the active non-superseded EventPlan draft attached to the pending review owned by the session, construct a full plan with inherited `planId`, `documentId`, `omittedEvidence`, and `warnings`, set `version = base.version + 1`, replace only `eventUnits`, and execute `propose_event_plan`. This reuses evidence validation, fingerprinting, sequential version enforcement, logical-key supersession, and artifact events. Return the persisted new Artifact and ReviewTuple.

```ts
const base = eventPlanSchema.parse(requireActiveDraft(sessionId, request.baseArtifactId).data)
const next = eventPlanSchema.parse({
  ...base,
  version: base.version + 1,
  eventUnits: request.eventUnits,
})
const execution = await executeToolCall({
  tool: requireTool(createEventPlanTools(), 'propose_event_plan'),
  call: { id: `revise-${base.planId}-${next.version}`, name: 'propose_event_plan', input: next },
  context: sessionContext(sessionId),
  eventSink: new PublicEventSink(sessionId, this.events),
  runId: `revision-${review.id}`,
  turn: 0,
  guard: { check: async () => ({ decision: 'allow' }) },
})
if (execution.outcome !== 'completed') throw agentError(409, 'EVENT_PLAN_REVISION_FAILED')
const artifact = requireActiveDraftByPlan(sessionId, next.planId)
return { artifact: toArtifactView(artifact), review: this.reviews.requirePendingForArtifact(artifact.id) }
```

- [ ] **Step 6: Run review and existing EventPlan tests**

Run: `npm test -w @ise/agent -- test/review-api.test.ts test/event-plan-tools.test.ts test/runtime.test.ts`

Expected: PASS; plain `allow` still cannot create a user-authored accepted artifact.

- [ ] **Step 7: Commit review orchestration**

```powershell
git add agent/src/session/reviewService.ts agent/src/session/publicEventSink.ts agent/src/api/reviewRoutes.ts agent/src/api/httpApp.ts agent/src/index.ts agent/test/review-api.test.ts
git commit -m "feat(agent): bind reviews to exact event plans"
```

### Task 6: Add Grounded NarrativePlan Artifacts

**Files:**
- Create: `agent/src/contracts/narrativePlan.ts`
- Create: `agent/src/tools/scenePlanTools.ts`
- Modify: `agent/src/contracts/artifactTypes.ts`
- Modify: `agent/src/runtime/toolAssembly.ts`
- Modify: `agent/skills/generate-battle-replay/SKILL.md`
- Modify: `agent/test/skill.test.ts`
- Test: `agent/test/narrative-plan.test.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Consumes: an active accepted EventPlan artifact and its exact metadata tuple.
- Produces: `narrativePlanSchema`, `NarrativePlan`, `NARRATIVE_PLAN_ARTIFACT = 'ise.narrative-plan/v1'`, and `createScenePlanTools()` with `propose_scene_plan`.

- [ ] **Step 1: Write failing strict-schema and grounding tests**

```ts
test('NarrativePlan contains no commands or exact playback times', () => {
  const result = narrativePlanSchema.safeParse({ ...validNarrativePlan(), commands: [] })
  assert.equal(result.success, false)
})

test('NarrativePlan defaults targetDurationMs to 180 seconds', () => {
  const { targetDurationMs: _omitted, ...withoutDuration } = validNarrativePlan()
  assert.equal(narrativePlanSchema.parse(withoutDuration).targetDurationMs, 180_000)
})

test('propose_scene_plan requires the exact accepted EventPlan tuple', async () => {
  const context = acceptedPlanContext()
  await assert.rejects(
    scenePlanTool().execute({ ...validNarrativePlan(), sourceEventPlan: {
      ...validNarrativePlan().sourceEventPlan, fingerprint: `sha256:${'0'.repeat(64)}`,
    }}, context),
    /Accepted EventPlan fingerprint mismatch/,
  )
})

test('subtitles may cite only refs present on their EventUnit', async () => {
  const context = acceptedPlanContext()
  const input = validNarrativePlan()
  input.subtitles[0]!.evidenceRefs = ['ev-outside-unit']
  await assert.rejects(scenePlanTool().execute(input, context), /Narrative evidence is not linked/)
})
```

- [ ] **Step 2: Run NarrativePlan tests and verify they fail**

Run: `npm test -w @ise/agent -- test/narrative-plan.test.ts test/skill.test.ts`

Expected: FAIL because the contract and `propose_scene_plan` do not exist.

- [ ] **Step 3: Implement the strict NarrativePlan schema**

```ts
export const templateNameSchema = z.enum([
  'deployment', 'attack_chain', 'interception', 'electronic_warfare', 'counterattack',
  'withdrawal', 'return_and_summary', 'generic_movement', 'status_explanation',
])
export type TemplateName = z.infer<typeof templateNameSchema>

export const narrativePlanSchema = z.object({
  schemaVersion: z.literal('narrative-plan/v1'),
  narrativePlanId: z.string().min(1),
  sourceEventPlan: z.object({
    artifactId: z.string().min(1), planId: z.string().min(1),
    version: z.number().int().positive(), fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  }).strict(),
  targetDurationMs: z.number().int().min(30_000).max(600_000).default(180_000),
  subtitles: z.array(z.object({
    subtitleId: z.string().min(1), eventUnitId: z.string().min(1), text: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1), importance: z.enum(['high','medium','low']),
  }).strict()).min(1),
  sceneRequirements: z.array(z.object({
    requirementId: z.string().min(1), eventUnitId: z.string().min(1),
    focusEntities: z.array(z.string().min(1)), spatialRelations: z.array(z.string().min(1)),
    stateChanges: z.array(z.string().min(1)), motionRequirements: z.array(z.string().min(1)),
    attentionRequirements: z.array(z.string().min(1)), requiredFacts: z.array(z.string().min(1)),
    forbiddenClaims: z.array(z.string().min(1)), preferredTemplate: templateNameSchema.optional(),
  }).strict()).min(1),
}).strict()
export type NarrativePlan = z.infer<typeof narrativePlanSchema>
export const narrativePlanInputJsonSchema = z.toJSONSchema(narrativePlanSchema, { target: 'draft-2020-12' })
export const NARRATIVE_PLAN_ARTIFACT = 'ise.narrative-plan/v1' as const
```

- [ ] **Step 4: Implement proposal validation and artifact creation**

Resolve the accepted artifact by `sourceEventPlan.artifactId`; compare plan ID, version, metadata fingerprint, and locally recomputed fingerprint. Require every subtitle and requirement event ID to exist. Require subtitle `evidenceRefs` to be a subset of that unit's `evidenceRefs`; inference text remains covered by EventPlan `uncertainties` and must not be placed in subtitle `evidenceRefs`.

Create one artifact with `createdBy: 'agent'`, `logicalKey: narrative-plan:<accepted-artifact-id>`, metadata containing the exact accepted tuple, and no runtime command fields.

```ts
export function createScenePlanTools(): AgentTool[] {
  return [{
    name: 'propose_scene_plan',
    description: 'Validate a grounded NarrativePlan for an accepted EventPlan',
    risk: 'derive',
    inputSchema: narrativePlanInputJsonSchema, // required excludes targetDurationMs so Zod applies 180_000
    async execute(input, context) {
      const plan = narrativePlanSchema.parse(input)
      const accepted = requireAcceptedEventPlan(context, plan.sourceEventPlan.artifactId)
      assertExactAcceptedTuple(accepted, plan.sourceEventPlan)
      const units = new Map(accepted.data.eventUnits.map(unit => [unit.eventUnitId, unit]))
      for (const subtitle of plan.subtitles) {
        const unit = units.get(subtitle.eventUnitId)
        if (!unit) throw new Error(`Unknown EventUnit in NarrativePlan: ${subtitle.eventUnitId}`)
        const allowed = new Set(unit.evidenceRefs)
        if (subtitle.evidenceRefs.some(ref => !allowed.has(ref))) {
          throw new Error(`Narrative evidence is not linked: ${subtitle.subtitleId}`)
        }
      }
      for (const requirement of plan.sceneRequirements) {
        if (!units.has(requirement.eventUnitId)) {
          throw new Error(`Unknown EventUnit in scene requirement: ${requirement.eventUnitId}`)
        }
      }
      return {
        content: JSON.stringify({ narrativePlanId: plan.narrativePlanId }),
        artifacts: [{
          type: NARRATIVE_PLAN_ARTIFACT,
          createdBy: 'agent',
          logicalKey: `narrative-plan:${accepted.id}`,
          data: plan,
          metadata: { sourceEventPlan: plan.sourceEventPlan },
        }],
      }
    }
  }]
}
```

- [ ] **Step 5: Extend the Skill's bounded tool list**

Append `inspect_replay_assets`, `propose_scene_plan`, `compile_replay_runtime`, and `validate_replay_runtime` to `allowed-tools`. Add instructions that NarrativePlan contains semantic requirements only and that the model must never invent asset IDs, timestamps, commands, URLs, or local paths.

```yaml
allowed-tools:
  - parse_battle_report
  - inspect_report_evidence
  - propose_event_plan
  - accept_event_plan
  - inspect_replay_assets
  - propose_scene_plan
  - compile_replay_runtime
  - validate_replay_runtime
```

```markdown
NarrativePlan contains evidence-linked subtitles and semantic scene requirements only.
Do not supply asset IDs, playback timestamps, runtime commands, URLs, object names, or file paths.
Only deterministic tools may resolve assets, schedule playback, compile commands, and adapt SceneProjectConfig.
```

- [ ] **Step 6: Run contract, tool, and Skill tests**

Run: `npm test -w @ise/agent -- test/narrative-plan.test.ts test/skill.test.ts test/event-plan-flow.test.ts`

Expected: PASS; the existing DOCX-to-draft flow stays unchanged.

- [ ] **Step 7: Commit NarrativePlan**

```powershell
git add agent/src/contracts agent/src/tools/scenePlanTools.ts agent/src/runtime/toolAssembly.ts agent/src/index.ts agent/skills/generate-battle-replay/SKILL.md agent/test/narrative-plan.test.ts agent/test/skill.test.ts
git commit -m "feat(agent): create grounded narrative plans"
```

### Task 7: Build A Metadata-Only AssetRegistry With Explicit Diagnostics

**Files:**
- Create: `agent/src/contracts/assetRegistry.ts`
- Create: `agent/src/services/assetRegistry.ts`
- Create: `agent/src/services/runtimeDiagnostics.ts`
- Create: `agent/src/tools/assetTools.ts`
- Modify: `agent/src/contracts/artifactTypes.ts`
- Modify: `agent/src/runtime/toolAssembly.ts`
- Test: `agent/test/asset-registry.test.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Consumes: Nest catalog metadata compatible with `AssetManifestEntry`; never consumes `ResolvedAssetAccess`.
- Produces: `AssetRegistrySnapshot`, `AssetRegistry.resolve`, `AssetRegistry.resolveFallback`, `createAssetTools`, and `CompilationDiagnostic`.

- [ ] **Step 1: Write failing URL rejection, collision, trajectory, and fallback tests**

```ts
test('registry rejects access URLs and object names from artifact data', () => {
  assert.equal(assetRegistryEntrySchema.safeParse({ ...validEntry(), url: 'https://signed' }).success, false)
  assert.equal(assetRegistryEntrySchema.safeParse({ ...validEntry(), objectName: 'private/model.glb' }).success, false)
})

test('alias collisions are explicit errors rather than guessed mappings', () => {
  const registry = createRegistry([
    modelEntry('model:jf17', ['JF-17']), modelEntry('model:j10ce', ['JF-17']),
  ])
  assert.deepEqual(registry.diagnostics.map(item => item.code), ['ASSET_ALIAS_CONFLICT'])
  assert.throws(() => registry.resolveAlias('JF-17'), /ASSET_ALIAS_CONFLICT/)
})

test('an invalid required trajectory blocks resolution', () => {
  const registry = createRegistry([trajectoryEntry({ availability: 'invalid', criticality: 'required' })])
  assert.throws(() => registry.resolve('trajectory:ambala-1'), /REQUIRED_ASSET_INVALID/)
})

test('optional image follows only declared fallback ids', () => {
  const registry = createRegistry([
    imageEntry('image:primary', { availability: 'missing', criticality: 'optional', fallbackAssetIds: ['image:fallback'] }),
    imageEntry('image:fallback', { availability: 'available', criticality: 'optional' }),
  ])
  assert.equal(registry.resolveFallback('image:primary')?.assetId, 'image:fallback')
})
```

- [ ] **Step 2: Run registry tests and verify they fail**

Run: `npm test -w @ise/agent -- test/asset-registry.test.ts`

Expected: FAIL with missing AssetRegistry contract and service.

- [ ] **Step 3: Define the strict metadata snapshot**

```ts
import { diagnosticSchema, type Diagnostic } from '@ise/runtime-contracts'

export const compilationDiagnosticSchema = diagnosticSchema
export type CompilationDiagnostic = Diagnostic
export class CompilationError extends Error {
  constructor(readonly diagnostics: CompilationDiagnostic[]) {
    super(diagnostics.map(item => `${item.code}: ${item.message}`).join('; '))
    this.name = 'CompilationError'
  }
}

const catalogCommon = {
  displayName: z.string().min(1), aliases: z.array(z.string().min(1)),
  fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(), availability: z.enum(['available','missing','invalid']),
  criticality: z.enum(['required','optional']), fallbackAssetIds: z.array(z.string().min(1)),
}
export const assetRegistryEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...catalogCommon,
    assetId: z.string().regex(/^model:[a-z0-9][a-z0-9._-]*$/),
    kind: z.literal('model'), mediaType: z.literal('model/gltf-binary'), model: z.strictObject({
    scale: z.number().positive(), rotationOffsetDeg: z.tuple([z.number(),z.number(),z.number()]),
    altitudeOffsetM: z.number(), entityTypes: z.array(z.enum(['aircraft','missile','other'])).min(1),
  }) }),
  z.strictObject({ ...catalogCommon,
    assetId: z.string().regex(/^trajectory:[a-z0-9][a-z0-9._-]*$/),
    kind: z.literal('trajectory'), mediaType: z.literal('application/vnd.ise.trajectory+json'),
    trajectory: z.strictObject({
    format: z.literal('ise-trajectory/v1'), timeUnit: z.literal('ms'),
    coordinateOrder: z.literal('lng-lat-alt'), startTimeMs: z.number().int().nonnegative(),
    endTimeMs: z.number().int().nonnegative(), monotonic: z.literal(true),
  }) }),
  z.strictObject({ ...catalogCommon,
    assetId: z.string().regex(/^video:[a-z0-9][a-z0-9._-]*$/),
    kind: z.literal('video'), mediaType: z.literal('video/mp4'),
    video: z.strictObject({ durationMs: z.number().int().positive(), codec: z.string().min(1) }),
  }),
  z.strictObject({ ...catalogCommon,
    assetId: z.string().regex(/^image:[a-z0-9][a-z0-9._-]*$/),
    kind: z.literal('image'), mediaType: z.enum(['image/png','image/jpeg']),
    image: z.strictObject({
      width: z.number().int().positive(), height: z.number().int().positive(), fit: z.enum(['contain','cover']),
    }),
  }),
  z.strictObject({ ...catalogCommon,
    assetId: z.string().regex(/^geojson:[a-z0-9][a-z0-9._-]*$/),
    kind: z.literal('geojson'), mediaType: z.literal('application/geo+json'),
  }),
])

export const assetRegistrySnapshotSchema = z.object({
  schemaVersion: z.literal('asset-registry/v1'),
  registryVersion: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  assets: z.array(assetRegistryEntrySchema), diagnostics: z.array(compilationDiagnosticSchema),
}).strict()
export type AssetRegistryEntry = z.infer<typeof assetRegistryEntrySchema>
export type AssetRegistrySnapshot = z.infer<typeof assetRegistrySnapshotSchema>
export const ASSET_REGISTRY_ARTIFACT = 'ise.asset-registry/v1' as const
```

Implement the production schema as a `kind`-discriminated union with the exact shared metadata names and media-type literals, after projecting away `sourceRelativePath` and `objectName`. Add cross-field refinements: metadata must match `kind`; trajectories require `startTimeMs <= endTimeMs`, the fixed millisecond/coordinate format, and `monotonic === true`; fallback IDs must exist, cannot cycle, and must keep the same kind. An optional image with no valid fallback may become an information card with a warning. A model may become a Marker only when CapabilityManifest explicitly permits Marker fallback for that entity kind; catalog metadata alone never grants it.

- [ ] **Step 4: Implement deterministic resolution and bounded inspection**

Normalize aliases with Unicode NFKC, trim, and lowercase, but never fuzzy-match. Exact `assetId` wins; a normalized alias must resolve to exactly one entry; `model.entityTypes` may resolve only when it has one available candidate after stable `assetId` sort. Otherwise produce `ASSET_ALIAS_CONFLICT` or `ASSET_SELECTION_AMBIGUOUS`.

`inspect_replay_assets` accepts `{ assetIds?: string[], aliases?: string[], entityTypes?: string[], limit?: number }`, is risk `read`, clamps limit to 50, and returns metadata plus diagnostics without URL, `sourceRelativePath`, or `objectName`. Sort the projected entries and compute `registryVersion = fingerprint(entries)` because the current Nest catalog response is an array. Persist each fetched catalog version as `ise.asset-registry/v1` with logical key `asset-registry:<registryVersion>`.

```ts
export class AssetRegistry {
  readonly entries: Map<string, AssetRegistryEntry>
  readonly aliases = new Map<string, string[]>()
  readonly diagnostics: CompilationDiagnostic[]

  constructor(snapshot: AssetRegistrySnapshot) {
    const parsed = assetRegistrySnapshotSchema.parse(snapshot)
    this.entries = new Map(parsed.assets.map(entry => [entry.assetId, entry]))
    this.diagnostics = [...parsed.diagnostics]
    for (const entry of parsed.assets) {
      for (const value of [entry.displayName, ...entry.aliases]) {
        const key = normalizeAssetName(value)
        this.aliases.set(key, [...(this.aliases.get(key) ?? []), entry.assetId].sort())
      }
    }
    for (const [alias, assetIds] of this.aliases) {
      if (assetIds.length > 1) this.diagnostics.push(diagnostic('ASSET_ALIAS_CONFLICT', `Alias ${alias} maps to ${assetIds.join(', ')}`))
    }
  }

  resolveAlias(value: string): AssetRegistryEntry | undefined {
    const ids = this.aliases.get(normalizeAssetName(value)) ?? []
    if (ids.length !== 1) throw new CompilationError([
      diagnostic(ids.length === 0 ? 'ASSET_NOT_FOUND' : 'ASSET_ALIAS_CONFLICT', `Cannot resolve ${value}`),
    ])
    return this.resolveFallback(ids[0]!)
  }

  resolve(assetId: string): AssetRegistryEntry | undefined {
    return this.resolveFallback(assetId)
  }

  resolveFallback(assetId: string, visited = new Set<string>()): AssetRegistryEntry | undefined {
    if (visited.has(assetId)) throw new CompilationError([diagnostic('ASSET_FALLBACK_CYCLE', assetId)])
    visited.add(assetId)
    const entry = this.entries.get(assetId)
    if (!entry) throw new CompilationError([diagnostic('ASSET_NOT_FOUND', assetId)])
    if (entry.availability === 'available') return entry
    for (const fallbackId of entry.fallbackAssetIds) {
      const fallback = this.resolveFallback(fallbackId, new Set(visited))
      if (fallback?.kind === entry.kind) return fallback
    }
    if (entry.criticality === 'optional') {
      this.diagnostics.push(diagnostic('OPTIONAL_ASSET_UNAVAILABLE', assetId, 'warning'))
      return undefined
    }
    throw new CompilationError([diagnostic(
      entry.availability === 'invalid' ? 'REQUIRED_ASSET_INVALID' : 'REQUIRED_ASSET_MISSING', assetId,
    )])
  }
}

export function createAssetTools(loadSnapshot: () => Promise<AssetRegistrySnapshot>): AgentTool[] {
  return [{
    name: 'inspect_replay_assets', description: 'Inspect registered replay asset metadata',
    risk: 'read', isConcurrencySafe: true, inputSchema: inspectReplayAssetsInputJsonSchema,
    async execute(input) {
      const query = inspectReplayAssetsInputSchema.parse(input)
      const snapshot = await loadSnapshot()
      const registry = new AssetRegistry(snapshot)
      const limit = Math.min(50, Math.max(1, query.limit ?? 20))
      const assets = selectRegistryEntries(registry, query).slice(0, limit)
      return { content: JSON.stringify({ registryVersion: snapshot.registryVersion, assets, diagnostics: registry.diagnostics }) }
    },
  }]
}
```

- [ ] **Step 5: Run registry tests and a secret scan assertion**

Run: `npm test -w @ise/agent -- test/asset-registry.test.ts`

Expected: PASS; serialized registry test values do not match `/https?:|objectName|authorization|Bearer/i`.

- [ ] **Step 6: Commit AssetRegistry**

```powershell
git add agent/src/contracts/assetRegistry.ts agent/src/contracts/artifactTypes.ts agent/src/services/assetRegistry.ts agent/src/services/runtimeDiagnostics.ts agent/src/tools/assetTools.ts agent/src/runtime/toolAssembly.ts agent/src/index.ts agent/test/asset-registry.test.ts
git commit -m "feat(agent): validate replay asset registry metadata"
```

### Task 8: Deterministically Compile Restricted Templates And Playback Time

**Files:**
- Create: `agent/src/contracts/runtimePlan.ts`
- Create: `agent/src/compiler/capabilityManifest.ts`
- Create: `agent/src/compiler/templates.ts`
- Create: `agent/src/compiler/scheduler.ts`
- Create: `agent/src/compiler/sceneCompiler.ts`
- Test: `agent/test/compiler.test.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Consumes: accepted EventPlan, NarrativePlan, AssetRegistrySnapshot, and fixed CapabilityManifest.
- Produces: `canonicalRuntimePlanSchema`, `CanonicalRuntimePlan`, `compileScene`, and deterministic `scheduleNarrative`.

- [ ] **Step 1: Write failing timing, template, determinism, and blocking tests**

```ts
test('subtitle duration uses four Chinese characters per second and a four second floor', () => {
  assert.equal(subtitleDurationMs('短句', 'low'), 4_000)
  assert.equal(subtitleDurationMs('一二三四五六七八九十六个汉字', 'high'), 6_000)
})

test('the same frozen inputs compile byte-identically', () => {
  const first = compileScene(validCompilerInput())
  const second = compileScene(validCompilerInput())
  assert.equal(canonicalJson(first), canonicalJson(second))
})

test('unknown template names and command types are rejected', () => {
  assert.equal(templateNameSchema.safeParse('free_form_code').success, false)
  assert.equal(runtimeCommandSchema.safeParse({ ...validCommand(), type: 'shell.execute' }).success, false)
})

test('required missing trajectory creates diagnostics and no plan', () => {
  assert.throws(() => compileScene(inputWithMissingRequiredTrajectory()), (error: unknown) =>
    error instanceof CompilationError && error.diagnostics.some(item => item.code === 'REQUIRED_ASSET_MISSING'))
})

test('camera and same-target state commands never overlap', () => {
  const plan = compileScene(validCompilerInput())
  assertNoOverlap(plan.commands.filter(item => item.type === 'camera.transition'))
  for (const targetId of new Set(plan.commands.map(item => item.targetId))) {
    assertNoOverlap(plan.commands.filter(item => item.targetId === targetId && item.type === 'model.set_state'))
  }
})
```

- [ ] **Step 2: Run compiler tests and verify they fail**

Run: `npm test -w @ise/agent -- test/compiler.test.ts`

Expected: FAIL because runtime contracts, templates, and scheduler do not exist.

- [ ] **Step 3: Define strict CanonicalRuntimePlan and capability types**

```ts
export const runtimeEntitySchema = z.strictObject({
  entityId: z.string().min(1), displayName: z.string().min(1),
  kind: z.enum(['aircraft','missile','location','other']),
  modelAssetId: z.string().regex(/^model:[a-z0-9][a-z0-9._-]*$/).optional(),
  defaultTrajectoryAssetId: z.string().regex(/^trajectory:[a-z0-9][a-z0-9._-]*$/).optional(),
  initialState: z.enum(['normal','warning','disabled','hidden']),
})
export const scheduledSubtitleSchema = z.strictObject({
  subtitleId: z.string().min(1), eventUnitId: z.string().min(1), text: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1), importance: z.enum(['high','medium','low']),
  startMs: z.number().int().nonnegative(), durationMs: z.number().int().positive(),
  position: z.enum(['top','bottom']), maxWidthPct: z.number().positive().max(100),
})
export const informationCardSchema = z.strictObject({
  cardId: z.string().min(1), eventUnitId: z.string().min(1), text: z.string().min(1),
  startMs: z.number().int().nonnegative(), durationMs: z.number().int().positive(),
  evidenceRefs: z.array(z.string().min(1)).min(1),
})
export const lineageSchema = z.strictObject({
  outputId: z.string().min(1), sourceArtifactIds: z.array(z.string().min(1)).min(1),
  evidenceRefs: z.array(z.string().min(1)),
})

export const runtimeCommandTypeSchema = z.enum([
  'image.show','video.play','marker.show','geojson.show','camera.transition',
  'model.spawn','model.follow_path','model.set_state','model.hide',
])

const overlayLayoutSchema = z.object({
  xPct: z.number().min(0).max(100), yPct: z.number().min(0).max(100),
  widthPct: z.number().positive().max(100), heightPct: z.number().positive().max(100),
  zIndex: z.number().int(), opacity: z.number().min(0).max(1), fit: z.enum(['contain','cover']),
}).strict()
const commandBase = z.object({
  commandId: z.string().min(1), eventUnitId: z.string().min(1),
  targetId: z.string().min(1), startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  dependsOn: z.array(z.string().min(1)), onFailure: z.enum(['abort','warn','skip']),
  evidenceRefs: z.array(z.string().min(1)),
}).strict()
export const runtimeCommandSchema = z.discriminatedUnion('type', [
  commandBase.extend({ type: z.literal('image.show'), params: z.object({
    assetId: z.string().min(1), layout: overlayLayoutSchema,
    enter: z.enum(['none','fade']), exit: z.enum(['none','fade']),
  }).strict() }),
  commandBase.extend({ type: z.literal('video.play'), params: z.object({
    assetId: z.string().min(1), layout: overlayLayoutSchema,
    volume: z.number().min(0).max(1), playbackRate: z.number().positive().max(4), loop: z.boolean(),
  }).strict() }),
  commandBase.extend({ type: z.literal('marker.show'), params: z.object({
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    label: z.string().min(1), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }).strict() }),
  commandBase.extend({ type: z.literal('geojson.show'), params: z.object({
    assetId: z.string().min(1), lineColor: z.string().min(1), lineWidth: z.number().nonnegative(),
    fillColor: z.string().min(1), fillOpacity: z.number().min(0).max(1),
    circleColor: z.string().min(1), circleRadius: z.number().nonnegative(), keepAfterEnd: z.boolean(),
  }).strict() }),
  commandBase.extend({ type: z.literal('camera.transition'), params: z.object({
    center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    zoom: z.number().min(0).max(24), pitch: z.number().min(0).max(85),
    bearing: z.number().min(-360).max(360), easing: z.enum(['linear','easeInOut']),
  }).strict() }),
  commandBase.extend({ type: z.literal('model.spawn'), params: z.object({
    action: z.literal('model.spawn'), entityId: z.string().min(1), modelAssetId: z.string().min(1),
  }).strict() }),
  commandBase.extend({ type: z.literal('model.follow_path'), params: z.object({
    action: z.literal('model.follow_path'), entityId: z.string().min(1), trajectoryAssetId: z.string().min(1),
  }).strict() }),
  commandBase.extend({ type: z.literal('model.set_state'), params: z.object({
    action: z.literal('model.set_state'), entityId: z.string().min(1),
    state: z.enum(['normal','warning','disabled','hidden']),
  }).strict() }),
  commandBase.extend({ type: z.literal('model.hide'), params: z.object({
    action: z.literal('model.hide'), entityId: z.string().min(1),
  }).strict() }),
])
export type CanonicalCommand = z.infer<typeof runtimeCommandSchema>

export const canonicalRuntimePlanSchema = z.object({
  schemaVersion: z.literal('canonical-runtime-plan/v1'), planId: z.string().min(1),
  sourceDocumentId: z.string().min(1), eventPlanArtifactId: z.string().min(1),
  eventPlanId: z.string().min(1), narrativePlanId: z.string().min(1),
  capabilityManifestVersion: z.literal('ise-capabilities/v1'), assetRegistryVersion: z.string().min(1),
  totalDurationMs: z.number().int().positive(), entities: z.array(runtimeEntitySchema),
  subtitles: z.array(scheduledSubtitleSchema), commands: z.array(runtimeCommandSchema),
  informationCards: z.array(informationCardSchema), lineage: z.array(lineageSchema),
  diagnostics: z.array(compilationDiagnosticSchema),
}).strict()
export type CanonicalRuntimePlan = z.infer<typeof canonicalRuntimePlanSchema>
```

CapabilityManifest lists only the command enum above, model actions `model.spawn|model.follow_path|model.set_state|model.hide`, minimum command durations, and whether marker fallback is legal. Information cards remain in `informationCards[]`; they are not executable commands. Parse every template output through the discriminated command schema before constructing the plan.

- [ ] **Step 4: Implement the nine registered template expanders**

Use a closed record, not `eval`, script text, dynamic import, generated code, or model-generated command JSON:

```ts
export const restrictedTemplates: Record<TemplateName, TemplateExpander> = {
  deployment: expandDeployment,
  attack_chain: expandAttackChain,
  interception: expandInterception,
  electronic_warfare: expandElectronicWarfare,
  counterattack: expandCounterattack,
  withdrawal: expandWithdrawal,
  return_and_summary: expandReturnAndSummary,
  generic_movement: expandGenericMovement,
  status_explanation: expandStatusExplanation,
}

export function expandRequirement(requirement: SceneRequirement, context: TemplateContext) {
  const templateName = requirement.preferredTemplate ?? inferTemplateFromStateChange(requirement)
  return restrictedTemplates[templateName](requirement, context)
}
```

`inferTemplateFromStateChange` uses a fixed priority table of normalized requirement terms and falls back to `status_explanation`; it cannot choose outside the enum. Each expander receives assets already resolved by AssetRegistry, uses stable IDs derived from `eventUnitId + requirementId + ordinal`, and emits semantic command drafts without absolute time.

- [ ] **Step 5: Implement deterministic scheduling and validation**

`subtitleDurationMs` is `max(4000, ceil(hanCharacterCount / 4) * 1000) + observation`, where observation is `2000` high, `1000` medium, `0` low. Schedule EventUnits in accepted EventPlan order, add `1000` ms transitions, enforce CapabilityManifest minima, serialize cameras, and serialize mutually exclusive state commands per target.

If total duration exceeds `targetDurationMs`, first remove low-importance observation time, then medium observation time, without reducing the four-second subtitle floor or capability minima. If it still exceeds the target, throw `RUNTIME_DURATION_EXCEEDED` and do not discard EventUnits silently.

After scheduling, validate unique IDs, all dependency IDs, acyclic dependencies, nonnegative millisecond time, `end <= totalDurationMs`, command evidence subset of its EventUnit, asset availability, and no camera/state conflicts. Sort entities, commands, lineage, and diagnostics by stable IDs before parsing the final schema.

```ts
export function subtitleDurationMs(text: string, importance: 'high' | 'medium' | 'low'): number {
  const spokenMs = Math.ceil([...text].filter(char => /\p{Script=Han}/u.test(char)).length / 4) * 1_000
  const observationMs = importance === 'high' ? 2_000 : importance === 'medium' ? 1_000 : 0
  return Math.max(4_000, spokenMs) + observationMs
}

export function scheduleNarrative(input: SchedulerInput): ScheduledPlan {
  const subtitles: ScheduledSubtitle[] = []
  const commands: CanonicalCommand[] = []
  let cursorMs = 0
  for (const [unitIndex, eventUnit] of input.eventPlan.eventUnits.entries()) {
    const unitSubtitles = input.narrativePlan.subtitles.filter(item => item.eventUnitId === eventUnit.eventUnitId)
    const unitStartMs = cursorMs
    for (const subtitle of unitSubtitles) {
      const durationMs = subtitleDurationMs(subtitle.text, subtitle.importance)
      subtitles.push({ ...subtitle, startMs: cursorMs, durationMs })
      cursorMs += durationMs
    }
    const drafts = input.commandDrafts.filter(item => item.eventUnitId === eventUnit.eventUnitId)
    commands.push(...placeCommands(drafts, {
      windowStartMs: unitStartMs,
      windowEndMs: cursorMs,
      minimumDurations: input.capabilities.minimumDurations,
      occupiedCameraWindows: commands.filter(item => item.type === 'camera.transition'),
      occupiedTargetStateWindows: commands.filter(item => item.type === 'model.set_state'),
    }))
    if (unitIndex < input.eventPlan.eventUnits.length - 1) cursorMs += 1_000
  }
  const compressed = compressObservationTime({ subtitles, commands, totalDurationMs: cursorMs }, input.narrativePlan.targetDurationMs)
  if (compressed.totalDurationMs > input.narrativePlan.targetDurationMs) {
    throw new CompilationError([diagnostic('RUNTIME_DURATION_EXCEEDED',
      `${compressed.totalDurationMs} exceeds ${input.narrativePlan.targetDurationMs}`)])
  }
  validateScheduledPlan(compressed, input)
  return compressed
}
```

- [ ] **Step 6: Run compiler tests**

Run: `npm test -w @ise/agent -- test/compiler.test.ts`

Expected: PASS including byte-identical repeated compilation and all nine template fixtures.

- [ ] **Step 7: Commit the deterministic compiler**

```powershell
git add agent/src/contracts/runtimePlan.ts agent/src/compiler agent/src/index.ts agent/test/compiler.test.ts
git commit -m "feat(agent): compile restricted replay templates"
```

### Task 9: Map CanonicalRuntimePlan Exactly To SceneProjectConfig And Publish The Compiled Artifact

**Files:**
- Create: `agent/src/adapters/baseRuntimeAdapter.ts`
- Create: `agent/src/tools/compilerTools.ts`
- Modify: `agent/src/contracts/artifactTypes.ts`
- Modify: `agent/src/runtime/toolAssembly.ts`
- Test: `agent/test/base-runtime-adapter.test.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Consumes: `CanonicalRuntimePlan`, `SceneProjectConfig`, and `sceneProjectConfigSchema`.
- Produces: `BaseRuntimeAdapter.adapt`, `COMPILED_RUNTIME_ARTIFACT = 'ise.canonical-runtime-plan/v1'`, `createCompilerTools()` with compile/validate tools.

- [ ] **Step 1: Write failing exact entity, track, self-ID, and failure-retention tests**

```ts
test('adapter produces the exact shared entity shape', () => {
  const config = adapter.adapt(validRuntimePlan(), 'runtime-artifact-1')
  assert.deepEqual(config.entities[0], {
    entityId: 'entity:jf17-1', displayName: 'JF-17 1', kind: 'aircraft',
    modelAssetId: 'model:jf17', defaultTrajectoryAssetId: 'trajectory:jf17-1', initialState: 'normal',
  })
})

test('adapter groups all seven discriminated tracks and passes shared schema', () => {
  const config = adapter.adapt(runtimePlanWithEveryTrack(), 'runtime-artifact-1')
  assert.deepEqual(config.tracks.map(track => track.type).sort(),
    ['camera','geojson','image','marker','model','subtitle','video'])
  assert.deepEqual(sceneProjectConfigSchema.parse(config), config)
})

test('compiled artifact contains its self-referencing validated config', async () => {
  const result = await compileTool().execute(validCompileInput(), compilerContext())
  const artifact = result.artifacts?.find(item => item.type === COMPILED_RUNTIME_ARTIFACT)
  assert.ok(artifact?.id)
  assert.equal((artifact.data as CompiledRuntimeArtifactData).sceneProjectConfig.runtimePlanArtifactId, artifact.id)
  assert.deepEqual(sceneProjectConfigSchema.parse((artifact.data as CompiledRuntimeArtifactData).sceneProjectConfig),
    (artifact.data as CompiledRuntimeArtifactData).sceneProjectConfig)
})

test('failed recompile creates no artifact and preserves the last valid one', async () => {
  const context = compilerContextWithLastValidArtifact()
  await assert.rejects(compileTool().execute(invalidCompileInput(), context), /REQUIRED_ASSET_MISSING/)
  assert.deepEqual(context.artifacts.list(COMPILED_RUNTIME_ARTIFACT).map(item => item.id), ['last-valid'])
})
```

- [ ] **Step 2: Run adapter tests and verify they fail**

Run: `npm test -w @ise/agent -- test/base-runtime-adapter.test.ts`

Expected: FAIL because BaseRuntimeAdapter and compiler tools do not exist.

- [ ] **Step 3: Map shared entities and common track fields exactly**

Create each entity as:

```ts
const entity: SceneEntity = {
  entityId: source.entityId,
  displayName: source.displayName,
  kind: source.kind, // aircraft | missile | location | other
  ...(source.modelAssetId ? { modelAssetId: source.modelAssetId } : {}),
  ...(source.defaultTrajectoryAssetId ? { defaultTrajectoryAssetId: source.defaultTrajectoryAssetId } : {}),
  initialState: source.initialState, // normal | warning | disabled | hidden
}
```

Every track uses `{ trackId, type, label, visible, items }`; every item uses `{ id, eventUnitId, startMs, durationMs, assetId?, evidenceRefs, params }`. Emit no extra keys.

- [ ] **Step 4: Map every discriminated params shape and reject unknown commands**

Use exhaustive functions with `assertNever`:

```ts
function toTrackItem(command: CanonicalCommand): SceneTrackItem {
  const assetId = assetIdForCommand(command)
  const common = {
    id: command.commandId, eventUnitId: command.eventUnitId,
    startMs: command.startMs, durationMs: command.durationMs,
    ...(assetId ? { assetId } : {}), evidenceRefs: command.evidenceRefs,
  }
  switch (command.type) {
    case 'image.show': return { ...common, params: { layout: toOverlayLayout(command.params.layout), enter: command.params.enter, exit: command.params.exit } }
    case 'video.play': return { ...common, params: { layout: toOverlayLayout(command.params.layout), volume: command.params.volume, playbackRate: command.params.playbackRate, loop: command.params.loop } }
    case 'marker.show': return { ...common, params: { coordinates: command.params.coordinates, label: command.params.label, color: command.params.color } }
    case 'geojson.show': return { ...common, params: {
      lineColor: command.params.lineColor, lineWidth: command.params.lineWidth,
      fillColor: command.params.fillColor, fillOpacity: command.params.fillOpacity,
      circleColor: command.params.circleColor, circleRadius: command.params.circleRadius,
      keepAfterEnd: command.params.keepAfterEnd,
    } }
    case 'camera.transition': return { ...common, params: { center: command.params.center, zoom: command.params.zoom, pitch: command.params.pitch, bearing: command.params.bearing, easing: command.params.easing } }
    case 'model.spawn':
    case 'model.follow_path':
    case 'model.set_state':
    case 'model.hide': return { ...common, params: toModelAction(command) }
    default: return assertNever(command)
  }
}

function assetIdForCommand(command: CanonicalCommand): string | undefined {
  switch (command.type) {
    case 'image.show':
    case 'video.play':
    case 'geojson.show': return command.params.assetId
    case 'model.spawn': return command.params.modelAssetId
    case 'model.follow_path': return command.params.trajectoryAssetId
    case 'marker.show':
    case 'camera.transition':
    case 'model.set_state':
    case 'model.hide': return undefined
    default: return assertNever(command)
  }
}

function toModelAction(command: Extract<CanonicalCommand, { type: `model.${string}` }>) {
  switch (command.type) {
    case 'model.spawn': return { action: 'model.spawn' as const, entityId: command.params.entityId }
    case 'model.follow_path': return {
      action: 'model.follow_path' as const,
      entityId: command.params.entityId,
      trajectoryAssetId: command.params.trajectoryAssetId,
    }
    case 'model.set_state': return {
      action: 'model.set_state' as const,
      entityId: command.params.entityId,
      state: command.params.state,
    }
    case 'model.hide': return { action: 'model.hide' as const, entityId: command.params.entityId }
  }
}
```

Subtitle params are `{ text, position: 'top'|'bottom', maxWidthPct }`. `OverlayLayout` is exactly `{ xPct, yPct, widthPct, heightPct, zIndex, opacity, fit: 'contain'|'cover' }`. GeoJSON params are exactly `{ lineColor, lineWidth, fillColor, fillOpacity, circleColor, circleRadius, keepAfterEnd }`; camera easing is exactly `linear | easeInOut`. Model params use `action: 'model.spawn'|'model.follow_path'|'model.set_state'|'model.hide'` and always include `entityId`; follow-path also includes `trajectoryAssetId`, and set-state also includes `state`. Information cards compile to evidence-linked subtitle or marker items; BaseRuntimeAdapter must not invent an eighth track.

- [ ] **Step 5: Build and validate the final configuration**

```ts
return sceneProjectConfigSchema.parse({
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: plan.sourceDocumentId,
  eventPlanArtifactId: plan.eventPlanArtifactId,
  runtimePlanArtifactId,
  totalDurationMs: plan.totalDurationMs,
  entities: plan.entities.map(toSceneEntity),
  tracks: groupTracks(plan),
  diagnostics: plan.diagnostics.map(toSceneDiagnostic),
})
```

`compile_replay_runtime` requires exact accepted EventPlan and NarrativePlan artifact IDs plus capability and registry versions. Construct it with `createCompilerTools({ onCompileProgress })`; `toolAssembly.ts` binds that callback to `EventBroker.append(sessionId, runId, 'compile.progress', payload)`. Emit stages `narrative`, `assets`, `schedule`, `validate`, `adapt` at percentages `10, 30, 60, 85, 100`. Preallocate the artifact UUID, compile, adapt with that ID, parse both schemas, then return exactly one `ise.canonical-runtime-plan/v1` artifact with data `{ runtimePlan, sceneProjectConfig }` and logical key `compiled-runtime:<accepted-event-plan-artifact-id>`.

```ts
export const COMPILED_RUNTIME_ARTIFACT = 'ise.canonical-runtime-plan/v1' as const
export type CompiledRuntimeArtifactData = {
  runtimePlan: CanonicalRuntimePlan
  sceneProjectConfig: SceneProjectConfig
}
```

`validate_replay_runtime` reparses both stored values and returns `{ valid: true, artifactId, diagnostics }`. It never repairs data or returns playable state for invalid input.

- [ ] **Step 6: Run adapter, compiler, and shared contract tests**

Run: `npm test -w @ise/agent -- test/base-runtime-adapter.test.ts test/compiler.test.ts && npm test -w @ise/runtime-contracts`

Expected: PASS; every produced SceneProjectConfig passes the shared schema and contains stable asset IDs only.

- [ ] **Step 7: Commit adaptation and compiler tools**

```powershell
git add agent/src/adapters/baseRuntimeAdapter.ts agent/src/tools/compilerTools.ts agent/src/contracts/artifactTypes.ts agent/src/runtime/toolAssembly.ts agent/src/index.ts agent/test/base-runtime-adapter.test.ts
git commit -m "feat(agent): publish validated scene configurations"
```

### Task 10: Complete Downstream Runs, Bootstrap The Service, And Prove The Full Flow

**Files:**
- Create: `agent/src/server.ts`
- Test: `agent/test/agent-service-flow.test.ts`
- Modify: `agent/src/session/sessionAgentRunner.ts`
- Modify: `agent/src/api/httpApp.ts`
- Modify: `agent/package.json`

**Interfaces:**
- Consumes: all prior tasks and a `ModelAdapter` factory.
- Produces: runnable Agent service and the terminal compiled event `{ runId, status: 'completed', runtimeArtifactId, sceneProjectConfig }`.

- [ ] **Step 1: Write the failing service-level acceptance test**

```ts
test('DOCX to revision to exact approval to compiled scene survives SSE reconnect', async () => {
  const service = await startTestService({ modelResponses: fullFlowResponses() })
  const session = await service.request('POST', '/sessions', 'user-1', {})
  const attachment = await service.request('POST', `/sessions/${session.sessionId}/attachments`, 'user-1', { fileId: 'file-report-1' })
  const firstRun = await service.request('POST', `/sessions/${session.sessionId}/messages`, 'user-1', { content: `解析 ${attachment.fileId} 并生成 EventPlan` })
  const firstEvents = await service.eventsUntil(session.sessionId, '0', 'review.requested')
  const review = firstEvents.at(-1)!.data as ReviewTuple
  const draft = await service.artifact(session.sessionId, review.artifactId)
  const revision = await service.request('POST', `/sessions/${session.sessionId}/event-plans/${draft.artifactId}/revisions`, 'user-1', {
    baseArtifactId: draft.artifactId, eventUnits: reverseFirstTwo((draft.data as EventPlan).eventUnits),
  })
  const approval = await service.request('POST', `/sessions/${session.sessionId}/reviews/${revision.review.reviewId}/approve`, 'user-1', {
    artifactId: revision.review.artifactId, version: revision.review.version, fingerprint: revision.review.fingerprint,
  })
  const resumed = await service.eventsUntil(session.sessionId, firstEvents.at(-1)!.id, 'run.completed')
  const completed = resumed.at(-1)!
  assert.equal(completed.data.runId, approval.runId)
  assert.deepEqual(sceneProjectConfigSchema.parse(completed.data.sceneProjectConfig), completed.data.sceneProjectConfig)
  const compiled = await service.artifact(session.sessionId, completed.data.runtimeArtifactId as string)
  assert.deepEqual((compiled.data as CompiledRuntimeArtifactData).sceneProjectConfig, completed.data.sceneProjectConfig)
  assert.equal(JSON.stringify(compiled).includes('https://'), false)
})

test('required asset failure emits run.failed and keeps prior compiled artifact active', async () => {
  const fixture = await serviceWithLastValidCompileAndMissingRequiredAsset()
  const terminal = await fixture.eventsUntil('run.failed')
  assert.equal(terminal.data.status, 'failed')
  assert.ok((terminal.data.diagnostics as CompilationDiagnostic[]).some(item => item.code === 'REQUIRED_ASSET_MISSING'))
  assert.deepEqual(fixture.activeCompiledArtifacts().map(item => item.id), ['last-valid'])
})
```

- [ ] **Step 2: Run the acceptance test and verify it fails**

Run: `npm test -w @ise/agent -- test/agent-service-flow.test.ts`

Expected: FAIL because downstream approved runs and production bootstrap are not connected.

- [ ] **Step 3: Complete approved downstream execution**

After `ReviewService.approve` creates the accepted EventPlan, enqueue a run whose bounded objective names the accepted artifact and instructs the root Agent to create one NarrativePlan through `propose_scene_plan`. The runner detects the resulting NarrativePlan artifact, refreshes the catalog snapshot through the current Bearer token, and invokes `compile_replay_runtime` deterministically. The model never supplies CanonicalRuntimePlan commands or SceneProjectConfig.

At success, atomically mark Run and Session completed, clear `active_run_id`, persist one assistant-visible summary message, and emit:

```ts
events.append(sessionId, runId, 'run.completed', {
  runId,
  status: 'completed',
  runtimeArtifactId: compiled.id,
  sceneProjectConfig: sceneProjectConfigSchema.parse(compiled.data.sceneProjectConfig),
})
```

When NarrativePlan, catalog, compilation, or adapter validation fails, persist the structured diagnostics, mark Run/Session failed, leave earlier artifacts intact, and emit `run.failed`; do not fall back to a preset scene.

- [ ] **Step 4: Add production bootstrap and graceful shutdown**

Replace the Agent package's `test` script with the complete deterministic list so the final workspace command cannot omit a new suite:

```json
{
  "test": "tsx --test test/runtime.test.ts test/contracts.test.ts test/document-parser.test.ts test/document-tools.test.ts test/event-plan-tools.test.ts test/skill.test.ts test/event-plan-flow.test.ts test/api-contracts.test.ts test/nest-gateway.test.ts test/persistence.test.ts test/sse.test.ts test/session-api.test.ts test/review-api.test.ts test/narrative-plan.test.ts test/asset-registry.test.ts test/compiler.test.ts test/base-runtime-adapter.test.ts test/agent-service-flow.test.ts"
}
```

```ts
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
```

Model headers contain only the opaque Agent session ID and service API key configured inside Agent. Never forward the user's Nest Bearer token to the model provider.

- [ ] **Step 5: Run every Agent and package regression test**

Run:

```powershell
npm test -w @ise/agent
npm run typecheck -w @ise/agent
npm test -w @ise/agent-core
npm test -w @ise/skills-core
npm test -w @ise/runtime-contracts
```

Expected: all commands exit `0`; current baseline remains at least Agent `43 passed / 1 skipped`, agent-core `65 passed`, and skills-core `13 passed`, plus the new service/compiler tests.

- [ ] **Step 6: Run the HTTP service smoke test**

Run in terminal one:

```powershell
Copy-Item agent\.env.example agent\.env
$env:MODEL_API_KEY='test-key-from-local-secret-store'
npm start -w @ise/agent
```

Run in terminal two with a real Nest access token:

```powershell
$headers = @{ Authorization = "Bearer $env:ISE_TEST_ACCESS_TOKEN" }
$session = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4310/sessions -Headers $headers -ContentType application/json -Body '{}'
$session | ConvertTo-Json -Compress
```

Expected: `{"sessionId":"<uuid>","status":"idle"}`. Remove the local `agent/.env` after the smoke test; it remains ignored and uncommitted.

- [ ] **Step 7: Scan for forbidden dependencies and inspect worktree scope**

Run:

```powershell
Get-ChildItem agent\src,agent\test -Recurse -File | Select-String -Pattern 'front_OLD|LangGraph|Threebox|ResolvedAssetAccess'
git status --short
```

Expected: the search produces no matches; Git status contains only the intended Agent files and coordinated `package-lock.json` change.

- [ ] **Step 8: Commit the integrated service**

```powershell
git add agent/src/server.ts agent/src/session/sessionAgentRunner.ts agent/src/api/httpApp.ts agent/test/agent-service-flow.test.ts agent/package.json
git commit -m "feat(agent): complete reviewed replay compilation service"
```

## Final Verification Gate

The implementation is complete only when all of the following are demonstrated in tests and command output:

1. `POST /sessions` returns exactly `{ sessionId, status }`, every later route rejects a foreign subject with the same `404` as a missing resource, and no route trusts a caller-supplied subject.
2. The Agent reads a DOCX only through the owner-checked Nest byte endpoint and independently verifies filename, MIME, magic, size, header fingerprint, and byte fingerprint.
3. A first EventPlan draft pauses the session at `awaiting_review`; revision creates a sequential new Artifact and Review while the old artifact remains immutable and superseded.
4. Approval executes the existing `accept_event_plan` tool with a trusted confirmation ID bound to the exact ReviewTuple.
5. SSE reconnect with `Last-Event-ID` returns every missed event once, then live events, with only the nine allowed public types.
6. NarrativePlan has evidence-linked subtitles and semantic scene requirements but no commands or exact playback timing.
7. AssetRegistry artifacts have stable metadata only, make JF-17/J-10CE collisions explicit, and never contain URLs, object names, or credentials.
8. All nine restricted templates compile deterministically; subtitle floors, transitions, capability minima, camera serialization, state serialization, dependencies, and duration limits are validated.
9. BaseRuntimeAdapter emits the exact shared `SceneEntity`, discriminated `SceneTrack`, common item, OverlayLayout, and seven params shapes, then passes `sceneProjectConfigSchema`.
10. The compiled artifact contains both CanonicalRuntimePlan and its validated SceneProjectConfig, and `runtimePlanArtifactId` equals the artifact ID.
11. Required asset or schema failure creates no playable artifact, emits structured diagnostics, and leaves the last validated runtime artifact active.
12. Existing EventPlan, `IseAgentHost`, agent-core, and skills-core regression suites remain green without copying or modifying their domain-neutral packages.
