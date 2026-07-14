# ISE Web and API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock script-to-scene flow with authenticated Agent sessions, reviewable EventPlans, persisted SceneProjectConfig data, and a Web UI wired to the deterministic SceneRuntime.

**Architecture:** NestJS remains the authority for users, files, asset access, and Scene persistence. React consumes the independent Agent service through a typed fetch/SSE client, edits exact EventPlan versions, saves compiled SceneProjectConfig objects, and mounts SceneRuntime in both editor and preview views.

**Tech Stack:** TypeScript 5.9, React 19, Rsbuild, Zustand 5, Vitest 4, Testing Library, NestJS 10, Prisma 7, PostgreSQL, MinIO, Jest 29, Mapbox GL 3, `@ise/runtime-contracts`.

## Global Constraints

- The repository runtime requires Node.js `>=20.19.0`.
- Agent remains an independent TypeScript service; do not move model loops into NestJS.
- NestJS owns authentication, files, MinIO, Script, Scene, and final SceneProjectConfig persistence.
- Web, API, Agent, and SceneRuntime exchange stable IDs and versioned schemas; never exchange local filesystem paths.
- The supported track types are exactly `subtitle`, `image`, `video`, `marker`, `geojson`, `camera`, and `model`.
- EventPlan approval binds the exact `artifactId + version + fingerprint` tuple.
- Web uses fetch-based SSE with a Bearer token and resumes through `Last-Event-ID`.
- SceneProjectConfig is the only authoritative editor, persistence, timeline, and playback data source; mock WarData is not a runtime fallback.
- Agent-visible events must not contain hidden reasoning chains.
- `.env`, credentials, `dist`, caches, `node_modules`, nested `.git`, and large binary assets must not be committed.
- GLB or critical video failures must not be reported as successful generation.
- Do not add TTS, a standalone audio track, collision, physics, skeletal animation, free-path planning, or video export.

---

### Task 1: Secure NestJS File and Asset Access

**Files:**
- Create: `apps/api/src/modules/asset-catalog/asset-catalog.module.ts`
- Create: `apps/api/src/modules/asset-catalog/asset-catalog.controller.ts`
- Create: `apps/api/src/modules/asset-catalog/asset-catalog.service.ts`
- Create: `apps/api/src/modules/asset-catalog/asset-catalog.service.spec.ts`
- Create: `apps/api/src/cli/seed-assets.ts`
- Create: `apps/api/src/cli/seed-assets.spec.ts`
- Modify: `apps/api/src/minio/minio.service.ts`
- Modify: `apps/api/src/modules/file/file.controller.ts`
- Modify: `apps/api/src/modules/file/file.service.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/202607150100_add_file_mime_fingerprint/migration.sql`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: `assetSeedManifestSchema`, `AssetManifestEntry`, `prepareAssetForUpload`, and `resolvedAssetAccessSchema` from `@ise/runtime-contracts`.
- Produces: `GET /asset-catalog`, `GET /asset-catalog/:assetId/access`, and `GET /file/:id/content`, all protected by the existing JWT guard.
- Produces: `MinioService.presignRead(objectName: string, expiresSeconds: number): Promise<string>`.
- Produces: asset access bodies validated by `resolvedAssetAccessSchema`, including model/trajectory/media metadata but excluding `objectName`.

- [ ] **Step 1: Write the failing catalog service tests**

```ts
it('returns metadata without exposing the object key', () => {
  const service = createService([
    {
      assetId: 'model:jf17',
      kind: 'model',
      objectName: 'demo/model/JF-17.glb',
      fingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mediaType: 'model/gltf-binary',
      size: 1466636,
      availability: 'available',
      criticality: 'required',
      sourceRelativePath: 'models/JF-17.glb',
      model: {
        scale: 1,
        rotationOffsetDeg: [0, 0, 90],
        altitudeOffsetM: 0,
        entityTypes: ['aircraft']
      },
      fallbackAssetIds: [],
      allowFallback: false
    }
  ]);

  expect(service.listPublic()).toEqual([
    expect.objectContaining({ assetId: 'model:jf17', kind: 'model' })
  ]);
  expect(service.listPublic()[0]).not.toHaveProperty('objectName');
  expect(service.listPublic()[0]).not.toHaveProperty('sourceRelativePath');
});

it('creates a five minute signed access result', async () => {
  minio.presignRead.mockResolvedValue('https://minio.test/signed');
  await expect(service.createAccess('model:jf17')).resolves.toEqual({
    assetId: 'model:jf17',
    url: 'https://minio.test/signed',
    fingerprint: expect.stringMatching(/^sha256:/),
    mediaType: 'model/gltf-binary',
    size: 1466636,
    model: {
      scale: 1,
      rotationOffsetDeg: [0, 0, 90],
      altitudeOffsetM: 0,
      entityTypes: ['aircraft']
    },
    expiresAt: expect.any(String)
  });
  expect(minio.presignRead).toHaveBeenCalledWith('demo/model/JF-17.glb', 300);
});
```

- [ ] **Step 2: Run the catalog test and verify the missing service failure**

Run: `npm run test -w @ise/api -- --runInBand src/modules/asset-catalog/asset-catalog.service.spec.ts`

Expected: FAIL because `AssetCatalogService` and `presignRead` do not exist.

- [ ] **Step 3: Implement manifest validation and signed access**

```ts
@Injectable()
export class AssetCatalogService {
  readonly #entries: Map<string, AssetManifestEntry>;

  constructor(private readonly minio: MinioService) {
    const parsed = assetSeedManifestSchema.parse(
      JSON.parse(readFileSync(requiredEnv('ASSET_MANIFEST_PATH'), 'utf8'))
    );
    this.#entries = new Map(parsed.assets.map(entry => [entry.assetId, entry]));
  }

  listPublic() {
    return [...this.#entries.values()].map(({
      objectName: _objectName,
      sourceRelativePath: _sourceRelativePath,
      ...entry
    }) => entry);
  }

  async createAccess(assetId: string) {
    const entry = this.#entries.get(assetId);
    if (!entry || entry.availability !== 'available') {
      throw new NotFoundException('资源不存在或不可用');
    }
    const expiresSeconds = 300;
    const metadata = entry.kind === 'model' ? { model: entry.model }
      : entry.kind === 'trajectory' ? { trajectory: entry.trajectory }
      : entry.kind === 'video' ? { video: entry.video }
      : entry.kind === 'image' ? { image: entry.image }
      : {};
    return resolvedAssetAccessSchema.parse({
      assetId,
      url: await this.minio.presignRead(entry.objectName, expiresSeconds),
      fingerprint: entry.fingerprint,
      mediaType: entry.mediaType,
      size: entry.size,
      ...metadata,
      expiresAt: new Date(Date.now() + expiresSeconds * 1000).toISOString()
    });
  }
}
```

Add these exact methods to `MinioService`; the seed CLI and file endpoint use the same bucket authority:

```ts
async presignRead(objectName: string, expiresSeconds: number): Promise<string> {
  await this.ensureBucketExists();
  return this.minioClient.presignedGetObject(this.bucketName, objectName, expiresSeconds);
}

async openRead(objectName: string): Promise<NodeJS.ReadableStream> {
  await this.ensureBucketExists();
  return this.minioClient.getObject(this.bucketName, objectName);
}

async putObject(objectName: string, bytes: Buffer, mediaType: string): Promise<void> {
  await this.ensureBucketExists();
  await this.minioClient.putObject(
    this.bucketName,
    objectName,
    bytes,
    bytes.byteLength,
    { 'Content-Type': mediaType }
  );
}
```

The controller uses `@UseGuards(AuthGuard('jwt'))` and wraps responses with `responseMessage`.

- [ ] **Step 4: Add an owner-checked file byte endpoint**

Add `FileService.readOwned(userId, fileId)` that first queries `{ id: fileId, userId }`, then returns `{ stream, name, size, type }` from a new MinIO streaming method. Add `GET /file/:id/content` with `Content-Type`, `Content-Length`, and `Content-Disposition: attachment` headers. Do not accept object names from request parameters.

```ts
async readOwned(userId: string, id: string) {
  const file = await this.prisma.file.findFirst({ where: { id, userId } });
  if (!file) throw new NotFoundException('文件不存在');
  return {
    stream: await this.minioService.openRead(file.src),
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
    fingerprint: file.fingerprint
  };
}

@Get(':id/content')
async content(@Param('id') id: string, @Req() req: Request & { user?: any }, @Res() res: Response) {
  const file = await this.fileService.readOwned(req.user.sub, id);
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', String(file.size));
  if (file.fingerprint) res.setHeader('X-Content-SHA256', file.fingerprint);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  file.stream.pipe(res);
}
```

Add `mimeType String @default("application/octet-stream")` and `fingerprint String?` to Prisma `File`. The upload service stores `file.mimetype` and `sha256:<64 lowercase hex>` computed from `file.buffer`. The migration adds both columns without rewriting existing object data. A newly uploaded DOCX must return `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

```sql
ALTER TABLE "File"
  ADD COLUMN "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
  ADD COLUMN "fingerprint" TEXT;
```

- [ ] **Step 5: Implement the manifest-driven MinIO seed CLI**

```ts
export async function seedAssets(options: {
  manifestPath: string;
  sourceDir: string;
  upload(objectName: string, bytes: Buffer, mediaType: string): Promise<void>;
}) {
  const manifest = assetSeedManifestSchema.parse(
    JSON.parse(await readFile(options.manifestPath, 'utf8'))
  );
  for (const entry of manifest.assets) {
    if (entry.availability !== 'available') {
      if (entry.criticality === 'required') {
        throw new Error(`Required asset is ${entry.availability}: ${entry.assetId}`);
      }
      continue;
    }
    const source = await readFile(resolve(options.sourceDir, entry.sourceRelativePath));
    const prepared = await prepareAssetForUpload(entry, source);
    await options.upload(entry.objectName, Buffer.from(prepared), entry.mediaType);
  }
}
```

The executable uses the application-owned MinIO client and always closes the Nest context:

```ts
async function main() {
  const manifestPath = process.env.ASSET_MANIFEST_PATH;
  const sourceDir = process.env.ASSET_SOURCE_DIR;
  if (!manifestPath || !sourceDir) {
    throw new Error('ASSET_MANIFEST_PATH and ASSET_SOURCE_DIR are required');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const minio = app.get(MinioService);
    await seedAssets({
      manifestPath,
      sourceDir,
      upload: (objectName, bytes, mediaType) => minio.putObject(objectName, bytes, mediaType)
    });
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

Add `"assets:seed": "ts-node -r tsconfig-paths/register src/cli/seed-assets.ts"` to `apps/api/package.json`, plus these non-secret entries to `apps/api/.env.example`:

```dotenv
ASSET_MANIFEST_PATH=../../provenance/assets.seed.json
ASSET_SOURCE_DIR=../../operator-assets/ise-demo
```

The path values are operator examples; neither file is automatically read by Web or Agent. The seed test proves normalized trajectory bytes, fingerprint rejection, exact object keys, and that no local path enters the manifest returned by the API.

- [ ] **Step 6: Enable request validation without breaking existing create DTOs**

```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true
}));
```

Make the existing Script defaults explicit in `CreateScriptDto`:

```ts
@ApiPropertyOptional({ description: '脚本配置', default: '{}' })
@IsOptional()
@IsString()
config?: string;

@ApiPropertyOptional({ description: '脚本类型', default: 'default' })
@IsOptional()
@IsString()
type?: string;

@ApiPropertyOptional({ description: '可见对话记录' })
@IsOptional()
@IsArray()
conversation?: Array<{ role: string; content: string }>;
```

Keep `CreateSceneDto.ownerType`, `type`, and `config` optional, add `@IsObject()` to `config`, and validate the actual runtime contract in both create and update services:

```ts
const config = dto.config === undefined
  ? undefined
  : sceneProjectConfigSchema.parse(dto.config);
return this.prisma.scene.create({
  data: { ...dto, ...(config ? { config } : {}), userId }
});
```

Map `ZodError` to `BadRequestException` in the Scene controller/service boundary. Add controller tests proving unknown fields return 400, invalid `ise-scene/v2` config returns 400, and `{ title, config: validSceneConfig }` remains accepted.

- [ ] **Step 7: Run API tests**

Run: `npm run test -w @ise/api -- --runInBand src/modules/asset-catalog/asset-catalog.service.spec.ts src/cli/seed-assets.spec.ts src/modules/file/file.service.spec.ts src/modules/scene/scene.controller.spec.ts`

Expected: PASS with no failed tests.

- [ ] **Step 8: Commit the API bridge**

```powershell
git add apps/api/src apps/api/prisma apps/api/package.json
git commit -m "feat(api): expose authorized agent and asset reads"
```

### Task 2: Typed Agent Client and Resumable SSE

**Files:**
- Replace: `apps/web/src/api/agent.ts`
- Create: `apps/web/src/api/agent.test.ts`
- Modify: `apps/web/src/api/http.ts`

**Interfaces:**
- Consumes: Agent API DTOs from the Agent service plan.
- Produces: `createAgentSession`, `attachAgentFile`, `sendAgentMessage`, `listAgentArtifacts`, `approveAgentReview`, `rejectAgentReview`, `reviseEventPlan`, `interruptAgentSession`, and `streamAgentEvents`.
- Produces: `createAgentSession(): Promise<CreateSessionResponse>` as `POST /sessions` with no request body. The generation objective is sent only by `sendAgentMessage(sessionId, { content })` to `POST /sessions/:sessionId/messages`.

- [ ] **Step 1: Write the failing SSE parser tests**

```ts
it('parses split SSE frames and remembers the event id', async () => {
  mockFetchStream([
    'id: 7\nevent: artifact.created\nda',
    'ta: {"artifactId":"artifact-1"}\n\n'
  ]);
  const events = [];
  for await (const event of streamAgentEvents('session-1')) events.push(event);
  expect(events).toEqual([{
    id: '7',
    type: 'artifact.created',
    data: { artifactId: 'artifact-1' }
  }]);
});

it('sends bearer and last event id headers', async () => {
  tokenStorage.setToken(tokenStorage.keys.access, 'jwt');
  mockFetchStream([]);
  for await (const _event of streamAgentEvents('session-1', { lastEventId: '6' })) break;
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions/session-1/events'),
    expect.objectContaining({ headers: expect.objectContaining({
      Authorization: 'Bearer jwt',
      'Last-Event-ID': '6'
    }) }));
});

it('creates an empty session with POST and no body', async () => {
  mockJsonResponse(201, { sessionId: 'session-1', status: 'idle' });
  await expect(createAgentSession()).resolves.toEqual({ sessionId: 'session-1', status: 'idle' });
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
  expect(String(url)).toMatch(/\/sessions$/);
  expect(init).toEqual(expect.objectContaining({ method: 'POST' }));
  expect(init).not.toHaveProperty('body');
});

it('sends the objective through the message endpoint', async () => {
  mockJsonResponse(202, { runId: 'run-1', status: 'queued' });
  await sendAgentMessage('session-1', { content: '生成 180 秒复盘' });
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringMatching(/\/sessions\/session-1\/messages$/),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ content: '生成 180 秒复盘' })
    })
  );
});
```

- [ ] **Step 2: Run the client test and verify it fails**

Run: `npm run test -w @ise/web -- --run src/api/agent.test.ts`

Expected: FAIL because the existing client expects newline-delimited `messages` and exports none of the required session functions.

- [ ] **Step 3: Implement JSON requests and fetch-based SSE**

```ts
export type AgentEvent = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        const separator = /^\r\n\r\n/.test(buffer.slice(boundary)) ? 4 : 2;
        buffer = buffer.slice(boundary + separator);
        const fields = frame.split(/\r?\n/);
        const id = fields.find(line => line.startsWith('id:'))?.slice(3).trim();
        const type = fields.find(line => line.startsWith('event:'))?.slice(6).trim();
        const dataText = fields
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n');
        if (id && type && dataText) {
          try {
            yield { id, type, data: JSON.parse(dataText) as Record<string, unknown> };
          } catch {
            throw new AgentProtocolError('INVALID_SSE_JSON', `Malformed SSE data for event ${id}`);
          }
        }
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamAgentEvents(
  sessionId: string,
  options: { lastEventId?: string; signal?: AbortSignal } = {}
): AsyncGenerator<AgentEvent> {
  const response = await fetch(`${AGENT_BASE_URL}/sessions/${sessionId}/events`, {
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${tokenStorage.getToken(tokenStorage.keys.access)}`,
      ...(options.lastEventId ? { 'Last-Event-ID': options.lastEventId } : {})
    },
    signal: options.signal
  });
  if (!response.ok || !response.body) {
    throw new AgentHttpError(response.status, 'SSE_CONNECT_FAILED', 'Agent event stream is unavailable');
  }
  yield* parseSseStream(response.body);
}
```

The parser above buffers partial lines, joins multiple `data:` lines, rejects malformed JSON as `AgentProtocolError`, and releases the reader when fetch aborts.

- [ ] **Step 4: Implement all session/review request functions**

Use this helper and exact route functions. `json` is optional so `createAgentSession` does not synthesize `{}` or a `Content-Type` header:

```ts
type AgentRequestOptions = {
  method?: 'GET' | 'POST';
  json?: unknown;
  signal?: AbortSignal;
};

async function agentRequest<T>(path: string, options: AgentRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${tokenStorage.getToken(tokenStorage.keys.access)}`
  };
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    signal: options.signal
  };
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.json);
  }
  const response = await fetch(`${AGENT_BASE_URL}${path}`, init);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new AgentHttpError(
      response.status,
      String(payload.code ?? 'AGENT_HTTP_ERROR'),
      String(payload.message ?? `Agent request failed with ${response.status}`)
    );
  }
  return payload as T;
}

export const createAgentSession = () =>
  agentRequest<CreateSessionResponse>('/sessions', { method: 'POST' });

export const attachAgentFile = (sessionId: string, body: { fileId: string }) =>
  agentRequest<AttachmentView>(`/sessions/${sessionId}/attachments`, { method: 'POST', json: body });

export const sendAgentMessage = (sessionId: string, body: { content: string }) =>
  agentRequest<QueuedRunResponse>(`/sessions/${sessionId}/messages`, { method: 'POST', json: body });

export const listAgentArtifacts = (sessionId: string) =>
  agentRequest<AgentArtifactView[]>(`/sessions/${sessionId}/artifacts`);

export const approveAgentReview = (sessionId: string, reviewId: string, body: ReviewTupleBody) =>
  agentRequest<QueuedRunResponse>(`/sessions/${sessionId}/reviews/${reviewId}/approve`, { method: 'POST', json: body });

export const rejectAgentReview = (sessionId: string, reviewId: string, body: ReviewTupleBody & { reason?: string }) =>
  agentRequest<{ reviewId: string; status: 'rejected' }>(`/sessions/${sessionId}/reviews/${reviewId}/reject`, { method: 'POST', json: body });

export const reviseEventPlan = (sessionId: string, artifactId: string, body: RevisionRequest) =>
  agentRequest<{ artifact: AgentArtifactView; review: ReviewTuple }>(`/sessions/${sessionId}/event-plans/${artifactId}/revisions`, { method: 'POST', json: body });

export const interruptAgentSession = (sessionId: string) =>
  agentRequest<{ runId: string; status: 'cancelled' }>(`/sessions/${sessionId}/interrupt`, { method: 'POST', json: {} });
```

- [ ] **Step 5: Run the Agent client tests**

Run: `npm run test -w @ise/web -- --run src/api/agent.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the Agent client**

```powershell
git add apps/web/src/api/agent.ts apps/web/src/api/agent.test.ts apps/web/src/api/http.ts
git commit -m "feat(web): add resumable agent session client"
```

### Task 3: Session Store and EventPlan Review UI

**Files:**
- Create: `apps/web/src/stores/agentSessionStore.ts`
- Create: `apps/web/src/stores/agentSessionStore.test.ts`
- Create: `apps/web/src/hooks/useAgentSession.ts`
- Create: `apps/web/src/pages/newScript/components/EventPlanReview.tsx`
- Create: `apps/web/src/pages/newScript/components/EventPlanReview.test.tsx`

**Interfaces:**
- Consumes: functions and `AgentEvent` from `apps/web/src/api/agent.ts`.
- Produces: `useAgentSessionStore`, `useAgentSession(sessionId)`, and `EventPlanReview` with exact approve/revise/reject callbacks.

- [ ] **Step 1: Write store transition tests**

```ts
it('enters awaiting review only for the active session', () => {
  const store = useAgentSessionStore.getState();
  store.open('session-1');
  store.applyEvent({
    id: '4',
    type: 'review.requested',
    data: { reviewId: 'review-1', artifactId: 'draft-1', version: 1, fingerprint: `sha256:${'a'.repeat(64)}` }
  });
  expect(useAgentSessionStore.getState()).toMatchObject({
    status: 'awaiting_review',
    lastEventId: '4',
    activeReview: { reviewId: 'review-1', artifactId: 'draft-1' }
  });
});
```

- [ ] **Step 2: Run the store test and verify it fails**

Run: `npm run test -w @ise/web -- --run src/stores/agentSessionStore.test.ts`

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement a session-scoped Zustand store**

The store must track `sessionId`, `status`, `lastEventId`, visible activities, artifacts, active review, diagnostics, and compiled config. `applyEvent` must ignore duplicate or older numeric event IDs and must never store hidden reasoning fields.

```ts
type AgentSessionState = {
  sessionId: string | null;
  status: 'idle' | 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';
  lastEventId?: string;
  activities: AgentEvent[];
  artifacts: Record<string, AgentArtifactView>;
  activeReview: AgentReviewView | null;
  diagnostics: Diagnostic[];
  compiledConfig: SceneProjectConfig | null;
  open(sessionId: string): void;
  applyEvent(event: AgentEvent): void;
};

const isNewer = (current: string | undefined, incoming: string) =>
  current === undefined || Number(incoming) > Number(current);

const PUBLIC_EVENT_TYPES = new Set([
  'run.started', 'tool.started', 'tool.progress', 'artifact.created',
  'review.requested', 'review.resolved', 'compile.progress',
  'run.completed', 'run.failed'
]);

applyEvent: event => set(state => {
  if (!PUBLIC_EVENT_TYPES.has(event.type) || !isNewer(state.lastEventId, event.id)) return state;
  const next: Partial<AgentSessionState> = {
    lastEventId: event.id,
    activities: [...state.activities, event]
  };
  if (event.type === 'run.started') next.status = 'running';
  if (event.type === 'review.requested') {
    next.status = 'awaiting_review';
    next.activeReview = reviewTupleSchema.parse(event.data);
  }
  if (event.type === 'review.resolved') next.activeReview = null;
  if (event.type === 'run.completed') {
    next.status = 'completed';
    next.compiledConfig = sceneProjectConfigSchema.parse(event.data.sceneProjectConfig);
  }
  if (event.type === 'run.failed') {
    next.status = event.data.status === 'cancelled' ? 'cancelled' : 'failed';
    next.diagnostics = diagnosticArraySchema.parse(event.data.diagnostics ?? []);
  }
  return { ...state, ...next };
})
```

- [ ] **Step 4: Implement the streaming hook**

`useAgentSession` starts `streamAgentEvents` with the stored `lastEventId`, retries recoverable disconnects with bounded exponential delays `250, 500, 1000, 2000` ms, stops on unmount, and does not retry 401/403 responses.

```ts
const RETRY_DELAYS_MS = [250, 500, 1000, 2000] as const;

async function consumeWithRetry(
  consume: () => Promise<void>,
  delays: readonly number[],
  signal: AbortSignal
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await consume();
      return;
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof AgentHttpError && [401, 403].includes(error.status)) throw error;
      if (attempt >= delays.length) throw error;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, delays[attempt]!);
        signal.addEventListener('abort', () => {
          window.clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }
  }
}

useEffect(() => {
  const controller = new AbortController();
  void consumeWithRetry(async () => {
    for await (const event of streamAgentEvents(sessionId, {
      lastEventId: useAgentSessionStore.getState().lastEventId,
      signal: controller.signal
    })) {
      useAgentSessionStore.getState().applyEvent(event);
    }
  }, RETRY_DELAYS_MS, controller.signal);
  return () => controller.abort();
}, [sessionId]);
```

- [ ] **Step 5: Write EventPlan review component tests**

```tsx
it('submits a new revision after reordering events', async () => {
  render(<EventPlanReview artifact={artifact} onRevise={onRevise} onApprove={onApprove} onReject={onReject} />);
  await user.click(screen.getByRole('button', { name: '下移 建立攻击链' }));
  await user.click(screen.getByRole('button', { name: '提交修改' }));
  expect(onRevise).toHaveBeenCalledWith(expect.objectContaining({
    baseArtifactId: 'draft-1',
    eventUnits: [expect.objectContaining({ eventUnitId: 'eu-2' }), expect.objectContaining({ eventUnitId: 'eu-1' })]
  }));
});

it('approves the exact review tuple', async () => {
  render(<EventPlanReview artifact={artifact} onApprove={onApprove} onRevise={onRevise} onReject={onReject} />);
  await user.click(screen.getByRole('button', { name: '批准事件计划' }));
  expect(onApprove).toHaveBeenCalledWith({
    reviewId: 'review-1', artifactId: 'draft-1', version: 1, fingerprint: `sha256:${'a'.repeat(64)}`
  });
});
```

- [ ] **Step 6: Implement accessible EventPlan editing**

Render event title, state change, importance, evidence links, inference warnings, move up/down icon buttons with tooltips, delete buttons, and explicit approve/reject controls. Edits operate on a local copy and only call `onRevise` when submitted.

```tsx
{draft.eventUnits.map((unit, index) => (
  <EventUnitEditor
    key={unit.eventUnitId}
    unit={unit}
    onChange={next => replaceUnit(index, next)}
    onMoveUp={() => move(index, index - 1)}
    onMoveDown={() => move(index, index + 1)}
    onDelete={() => remove(index)}
  />
))}
<Button onClick={() => onRevise({ baseArtifactId: artifact.artifactId, eventUnits: draft.eventUnits })}>
  提交修改
</Button>
<Button onClick={() => onApprove(exactReviewTuple)}>批准事件计划</Button>
```

- [ ] **Step 7: Run store and review tests**

Run: `npm run test -w @ise/web -- --run src/stores/agentSessionStore.test.ts src/pages/newScript/components/EventPlanReview.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit session state and review UI**

```powershell
git add apps/web/src/stores/agentSessionStore.ts apps/web/src/stores/agentSessionStore.test.ts apps/web/src/hooks/useAgentSession.ts apps/web/src/pages/newScript/components/EventPlanReview.tsx apps/web/src/pages/newScript/components/EventPlanReview.test.tsx
git commit -m "feat(web): review evidence linked event plans"
```

### Task 4: Replace the Mock New Script Flow

**Files:**
- Modify: `apps/web/src/pages/newScript/index.tsx`
- Modify: `apps/web/src/pages/newScript/components/DataImportButton.tsx`
- Modify: `apps/web/src/pages/newScript/components/SceneModal.tsx`
- Create: `apps/web/src/pages/newScript/newScript.integration.test.tsx`
- Modify: `apps/web/src/api/scene.ts`
- Delete after references are removed: `apps/web/src/stores/warDataStore.ts`

**Interfaces:**
- Consumes: session store/hook from Task 3 and `SceneProjectConfig` from `@ise/runtime-contracts`.
- Produces: real DOCX-to-review-to-Scene navigation with no mock waits or hard-coded IDs.

- [ ] **Step 1: Write the failing page integration test**

```tsx
it('creates a scene from the compiled artifact and navigates to its real id', async () => {
  createAgentSession.mockResolvedValue({ sessionId: 'session-1', status: 'idle' });
  createScene.mockResolvedValue({ data: { id: 'scene-real', title: '印巴复盘', config } });
  renderNewScript({ projectId: 'script-1' });
  await uploadReport('report.docx');
  expect(createAgentSession).toHaveBeenCalledWith();
  expect(sendAgentMessage).toHaveBeenCalledWith('session-1', {
    content: expect.stringMatching(/180 秒/)
  });
  emitAgentEvent('run.completed', { sceneProjectConfig: config });
  await user.click(screen.getByRole('button', { name: '转换为场景' }));
  await user.click(screen.getByRole('button', { name: '确认创建场景' }));
  expect(createScene).toHaveBeenCalledWith({ title: '印巴复盘', config });
  expect(mockNavigate).toHaveBeenCalledWith('/scene?projectId=scene-real');
});
```

- [ ] **Step 2: Run the integration test and verify the hard-coded navigation failure**

Run: `npm run test -w @ise/web -- --run src/pages/newScript/newScript.integration.test.tsx`

Expected: FAIL because the page returns mock data and SceneModal navigates to a fixed localhost UUID.

- [ ] **Step 3: Replace mock send and import behavior**

Remove the four fixed thinking delays, `adaptNewToOld(currentData)`, mock dataset switching, and JSON-in-chat parsing. Upload DOCX through NestJS, create/attach the Agent session, render visible event activity, and show `EventPlanReview` whenever `review.requested` is active.

```ts
const DEFAULT_TARGET_DURATION_MS = 180_000;

const buildGenerationObjective = (
  objective: string,
  targetDurationMs = DEFAULT_TARGET_DURATION_MS
) => `${objective.trim()}\n\n目标演示时长：${Math.round(targetDurationMs / 1000)} 秒。`;

const startGeneration = async (file: File) => {
  const uploaded = await uploadFile(file, { fileType: 'application' });
  const session = await createAgentSession();
  await attachAgentFile(session.sessionId, { fileId: uploaded.data.id });
  useAgentSessionStore.getState().open(session.sessionId);
  await sendAgentMessage(session.sessionId, {
    content: buildGenerationObjective(input)
  });
};
```

`DEFAULT_TARGET_DURATION_MS` is the Web default only. `POST /sessions` remains bodyless; the objective and its 180-second default travel exclusively in the `/messages` `content` string accepted by the Agent contract.

- [ ] **Step 4: Persist real conversation and compiled artifacts**

Update Script with the visible user/assistant activity and artifact references. Do not save an empty conversation. Keep compiled SceneProjectConfig in the session store only until Scene creation succeeds.

```ts
await updateScript(projectId, {
  title: editableTitle.trim() || undefined,
  conversation: visibleMessages.map(({ role, content }) => ({ role, content })),
  config: JSON.stringify({
    agentSessionId: sessionId,
    artifactIds: Object.keys(artifacts)
  })
});
```

- [ ] **Step 5: Create the Scene with an object config**

```ts
export const createScene = (data: { title: string; config: SceneProjectConfig }) =>
  http.post<SceneItem>('scene', data);
```

SceneModal calls `createScene`, closes only after success, and navigates with the returned ID. It must keep the modal open and show the API error on failure.

- [ ] **Step 6: Remove runtime mock store references**

Delete `warDataStore.ts` only after `DataImportButton`, NarrativePanel, ResourcePanel, ParamsPanel, and SceneModal no longer import it. Components that remain useful receive data through props from the session artifacts.

```tsx
<NarrativePanel eventPlan={acceptedEventPlan} narrativePlan={narrativePlan} />
<ResourcePanel sceneConfig={compiledConfig} diagnostics={diagnostics} />
<ParamsPanel sceneConfig={compiledConfig} onUpdate={updateCompiledDraft} />
```

- [ ] **Step 7: Run the page integration tests**

Run: `npm run test -w @ise/web -- --run src/pages/newScript/newScript.integration.test.tsx`

Expected: PASS and complete in under five seconds without fake delays.

- [ ] **Step 8: Commit the real generation flow**

```powershell
git add apps/web/src/pages/newScript apps/web/src/api/scene.ts apps/web/src/stores
git commit -m "feat(web): replace mock generation with agent sessions"
```

### Task 5: Make SceneProjectConfig the Editor Source of Truth

**Files:**
- Modify: `apps/web/src/api/scene.ts`
- Modify: `apps/web/src/stores/sceneStore.ts`
- Modify: `apps/web/src/pages/Scene/index.tsx`
- Modify: `apps/web/src/pages/Scene/components/Timeline.tsx`
- Modify: `apps/web/src/pages/Scene/components/PropertyPanel.tsx`
- Create: `apps/web/src/pages/Scene/sceneConfig.integration.test.tsx`

**Interfaces:**
- Consumes: `sceneProjectConfigSchema`, `SceneProjectConfig`, `SceneTrack`, and `SceneTrackItem`.
- Produces: editor actions that update, save, reload, and render the same validated config object.

- [ ] **Step 1: Write the failing source-of-truth test**

```tsx
it('renders API tracks and saves edits without reading bundled battle JSON', async () => {
  getScene.mockResolvedValue({ data: { id: 'scene-1', title: 'Replay', config } });
  renderScene('/scene?projectId=scene-1');
  expect(await screen.findByText('JF-17 编队')).toBeVisible();
  expect(screen.queryByText('诺曼底登陆')).not.toBeInTheDocument();
  await dragClip('model-jf17-flight', { startMs: 12000, durationMs: 8000 });
  await user.click(screen.getByRole('button', { name: '保存' }));
  expect(updateScene).toHaveBeenCalledWith('scene-1', expect.objectContaining({
    config: expect.objectContaining({ schemaVersion: 'ise-scene/v1' })
  }));
});
```

- [ ] **Step 2: Run the test and verify the bundled JSON failure**

Run: `npm run test -w @ise/web -- --run src/pages/Scene/sceneConfig.integration.test.tsx`

Expected: FAIL because Timeline ignores its `tracks` prop and renders imported mock JSON.

- [ ] **Step 3: Validate config at load and save boundaries**

Parse `getScene().data.config` with `sceneProjectConfigSchema.safeParse`. On failure show a blocking diagnostic and do not initialize the editor. Save the object directly; do not `JSON.stringify` it.

```ts
const parsed = sceneProjectConfigSchema.safeParse(response.data.config);
if (!parsed.success) {
  setBlockingError(parsed.error.issues.map(issue => issue.message).join('; '));
  return;
}
setConfig(parsed.data);

await updateScene(sceneId, { title, config: sceneProjectConfigSchema.parse(config) });
```

- [ ] **Step 4: Render the supplied tracks**

Remove imports of `mock/OLD/*.json`, `mapCompletedDataToTracks`, `currentConfigId`, and `mappedTracks`. Timeline renders the supplied `SceneTrack[]`. Convert milliseconds to pixels only at the visual boundary; callbacks return milliseconds.

```tsx
export function Timeline({ tracks, onItemChange, ...props }: TimelineProps) {
  return tracks.map(track => (
    <TrackRow key={track.trackId} track={track} onItemChange={onItemChange} {...props} />
  ));
}

const leftPx = (item.startMs / 1000) * pixelsPerSecond;
const widthPx = (item.durationMs / 1000) * pixelsPerSecond;
```

- [ ] **Step 5: Update immutable track items**

Scene store exposes:

```ts
updateTrackItem(trackId: string, itemId: string, update: Partial<SceneTrackItem>): void
removeTrackItem(trackId: string, itemId: string): void
setConfig(config: SceneProjectConfig): void
```

Implement both item mutations through the discriminated track union and re-parse the result before storing it:

```ts
updateTrackItem: (trackId, itemId, update) => set(state => ({
  config: sceneProjectConfigSchema.parse({
    ...state.config,
    tracks: state.config.tracks.map(track => track.trackId !== trackId ? track : ({
      ...track,
      items: track.items.map(item => item.id === itemId ? { ...item, ...update } : item)
    }))
  })
})),
removeTrackItem: (trackId, itemId) => set(state => ({
  config: sceneProjectConfigSchema.parse({
    ...state.config,
    tracks: state.config.tracks.map(track => track.trackId !== trackId ? track : ({
      ...track,
      items: track.items.filter(item => item.id !== itemId)
    }))
  })
})),
setConfig: config => set({ config: sceneProjectConfigSchema.parse(config) })
```

PropertyPanel receives the selected item from this store and removes its default mock clip fallback.

- [ ] **Step 6: Run editor tests**

Run: `npm run test -w @ise/web -- --run src/pages/Scene/sceneConfig.integration.test.tsx src/stores/sceneStore.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the single data source editor**

```powershell
git add apps/web/src/api/scene.ts apps/web/src/stores/sceneStore.ts apps/web/src/pages/Scene
git commit -m "fix(web): make scene config the editor source of truth"
```

### Task 6: Wire SceneRuntime into Editor and Preview

**Files:**
- Modify: `apps/web/src/pages/Scene/components/SceneCanvas.tsx`
- Modify: `apps/web/src/pages/Scene/index.tsx`
- Modify: `apps/web/src/pages/Preview/index.tsx`
- Modify: `apps/web/src/pages/Scene/components/SceneHeader.tsx`
- Create: `apps/web/src/hooks/useSceneRuntime.ts`
- Create: `apps/web/src/hooks/useSceneRuntime.test.tsx`
- Create: `apps/web/src/pages/RuntimeHarness.tsx`
- Modify: `apps/web/src/router/index.tsx`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/generated-replay.spec.ts`

**Interfaces:**
- Consumes: `createSceneRuntime(options)` and `SceneRuntime` from `apps/web/src/runtime`.
- Consumes: `GET /asset-catalog/:assetId/access` through `resolveAsset(assetId, signal): Promise<ResolvedAssetAccess>`.
- Produces: one runtime instance per mounted Mapbox canvas and editor/preview controls backed by the same runtime.
- Produces: `/runtime-harness?fixture=<name>` with `[data-testid="runtime-map"]` and `[data-testid="runtime-overlay"]` for the SceneRuntime workstream's browser pixel tests.

- [ ] **Step 1: Write the failing lifecycle hook test**

```tsx
it('loads once, seeks with the editor playhead, and disposes on unmount', async () => {
  const runtime = mockRuntime();
  const { rerender, unmount } = renderHook(
    ({ timeMs }) => useSceneRuntime({ map, overlayRoot, config, timeMs, runtimeFactory: () => runtime }),
    { initialProps: { timeMs: 0 } }
  );
  await waitFor(() => expect(runtime.load).toHaveBeenCalledWith(config));
  rerender({ timeMs: 4200 });
  await waitFor(() => expect(runtime.seek).toHaveBeenCalledWith(4200));
  unmount();
  expect(runtime.dispose).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the hook test and verify it fails**

Run: `npm run test -w @ise/web -- --run src/hooks/useSceneRuntime.test.tsx`

Expected: FAIL because no runtime lifecycle hook exists.

- [ ] **Step 3: Implement runtime lifecycle and asset resolution**

Create the runtime only after Mapbox emits `load` and both the canvas and overlay root exist. Abort pending asset requests on config changes. Serialize seek calls so an older seek cannot overwrite a newer one.

```ts
const runtime = createSceneRuntime({
  map,
  overlayRoot,
  resolveAsset: async (assetId, signal) => {
    const response = await fetchAssetAccess(assetId, { signal });
    return resolvedAssetAccessSchema.parse(response.data);
  }
});
await runtime.load(sceneProjectConfigSchema.parse(config));

let seekGeneration = 0;
let seekQueue = Promise.resolve();
const seekLatest = (timeMs: number) => {
  const generation = ++seekGeneration;
  seekQueue = seekQueue.then(async () => {
    if (generation !== seekGeneration) return;
    await runtime.seek(timeMs);
  });
  return seekQueue;
};
```

- [ ] **Step 4: Wire editor controls**

SceneCanvas exposes `onMapReady(map, overlayRoot)`. Scene page sends timeline changes to `runtime.seek`. SceneHeader play/pause/replay controls call runtime methods and display the authoritative runtime time.

```tsx
<SceneCanvas onMapReady={(map, overlayRoot) => setRuntimeTarget({ map, overlayRoot })} />
<Timeline currentTimeMs={currentTimeMs} onTimeChange={timeMs => runtime?.seek(timeMs)} />
<SceneHeader
  onPlay={() => runtime?.play()}
  onPause={() => runtime?.pause()}
  onReplay={() => runtime?.replay()}
/>
```

- [ ] **Step 5: Wire preview route with the project ID**

Navigate to `/preview?projectId=<sceneId>`. Preview loads the Scene from NestJS, validates config, mounts the same SceneCanvas/runtime, and removes its local icon-only `isPlaying` behavior.

```tsx
const projectId = new URLSearchParams(location.search).get('projectId');
const scene = await getScene(projectId!);
const config = sceneProjectConfigSchema.parse(scene.data.config);
return <RuntimePreview title={scene.data.title} config={config} />;
```

- [ ] **Step 6: Add the generated replay browser test**

First add the deterministic test harness and Playwright server configuration:

```tsx
export function RuntimeHarness() {
  const fixture = new URLSearchParams(location.search).get('fixture') ?? 'runtime-main';
  if (!['runtime-main', 'runtime-catalog'].includes(fixture)) {
    return <div role="alert">Unknown runtime fixture.</div>;
  }
  return (
    <div className="fixed inset-0">
      <div data-testid="runtime-map" className="absolute inset-0" />
      <div data-testid="runtime-overlay" className="pointer-events-none absolute inset-0" />
      <RuntimeHarnessController fixture={fixture} />
    </div>
  );
}
```

The route is enabled only when `import.meta.env.DEV || import.meta.env.MODE === 'test'`. It renders controls with test IDs `runtime-play`, `runtime-pause`, `runtime-seek` (millisecond input), `runtime-replay`, `runtime-time`, and `runtime-status`. It accepts exactly `fixture=runtime-main` and `fixture=runtime-catalog`. `playwright.config.ts` starts `npm run dev -- --host 127.0.0.1` and uses desktop Chromium plus mobile Chromium projects.

```ts
test('plays and seeks a generated replay', async ({ page }) => {
  await seedAuthenticatedScene(page, 'scene-e2e');
  await page.goto('/preview?projectId=scene-e2e');
  await expect(page.getByTestId('scene-runtime-ready')).toHaveAttribute('data-status', 'ready');
  await page.getByRole('button', { name: '播放' }).click();
  await expect(page.getByTestId('model-jf17')).toHaveAttribute('data-visible', 'true');
  await page.getByTestId('timeline-seek').fill('24000');
  await expect(page.locator('video[data-track-item="video-impact"]')).toHaveJSProperty('currentTime', 2);
  await expect(page.getByText('巴方完成反击')).toBeVisible();
});
```

- [ ] **Step 7: Run hook and browser tests**

Run: `npm run test -w @ise/web -- --run src/hooks/useSceneRuntime.test.tsx`

Expected: PASS.

Run: `npm run test:e2e -w @ise/web -- generated-replay.spec.ts`

Expected: PASS on desktop and configured mobile projects, with nonblank canvas pixel assertions supplied by the SceneRuntime plan.

- [ ] **Step 8: Commit runtime integration**

```powershell
git add apps/web/src/pages/Scene apps/web/src/pages/Preview apps/web/src/pages/RuntimeHarness.tsx apps/web/src/hooks apps/web/src/router/index.tsx apps/web/e2e apps/web/playwright.config.ts
git commit -m "feat(web): run generated scenes in editor and preview"
```

### Task 7: Integration Verification and Operator Flow

**Files:**
- Create: `apps/api/src/cli/build-asset-manifest.ts`
- Create: `apps/api/src/cli/build-asset-manifest.spec.ts`
- Create: `apps/web/e2e/runtime-catalog.metadata.spec.ts`
- Create: `provenance/asset-source-map.json`
- Create: `provenance/asset-browser-metadata.json` through the catalog test when `ffprobe` is unavailable
- Create: `provenance/asset-model-calibration.json` through the runtime-catalog calibration flow
- Create: `provenance/assets.seed.json` through the manifest builder
- Create: `docs/runbooks/two-day-demo.md`
- Modify: `package.json`
- Test: all Web/API tests and `apps/web/e2e/generated-replay.spec.ts`

**Interfaces:**
- Consumes: all prior plans and tasks.
- Produces: a real, schema-valid `provenance/assets.seed.json`, one root command for verification, and a deterministic operator sequence.

- [ ] **Step 1: Write the failing real-manifest builder tests**

Create `apps/api/src/cli/build-asset-manifest.spec.ts`. The fixtures use a 1x1 PNG, a minimal valid GLB, a small MP4 metadata probe record, one monotonic trajectory, and one reversed trajectory. Assert:

```ts
it('hashes prepared bytes and marks reversed optional trajectories invalid', async () => {
  const manifest = await buildAssetManifest(fixtureOptions());
  const valid = manifest.assets.find(asset => asset.assetId === 'trajectory:ambala-rafale-1')!;
  const reversed = manifest.assets.find(asset => asset.assetId === 'trajectory:ambala-su30mki-1')!;
  expect(valid).toMatchObject({
    availability: 'available',
    fingerprint: `sha256:${sha256(canonicalTrajectoryBytes)}`,
    size: canonicalTrajectoryBytes.byteLength,
    trajectory: { monotonic: true }
  });
  expect(reversed).toMatchObject({
    availability: 'invalid',
    criticality: 'optional'
  });
  expect(assetSeedManifestSchema.parse(manifest)).toEqual(manifest);
});

it('uses measured PNG dimensions, probed video metadata, and all six model calibrations', async () => {
  const manifest = await buildAssetManifest(fixtureOptions());
  expect(manifest.assets.find(asset => asset.assetId === 'image:ground-radar')?.image)
    .toEqual({ width: 1, height: 1, fit: 'contain' });
  expect(manifest.assets.find(asset => asset.assetId === 'video:missile-impact')?.video)
    .toEqual({ durationMs: 2400, codec: 'avc1.640028' });
  expect(manifest.assets.filter(asset => asset.kind === 'model')).toHaveLength(6);
  expect(manifest.assets.filter(asset => asset.kind === 'model').every(asset =>
    asset.kind === 'model' && asset.model.scale > 0 && asset.model.rotationOffsetDeg.length === 3
  )).toBe(true);
});
```

Run: `npm run test -w @ise/api -- --runInBand src/cli/build-asset-manifest.spec.ts`

Expected: FAIL because `buildAssetManifest` does not exist.

- [ ] **Step 2: Implement source mapping, byte probes, calibration inputs, and manifest output**

Create `provenance/asset-source-map.json` with these exact stable mappings and source-relative paths: six models under `印巴glb（修改6.0）`, eight named MP4 files and four named PNG files under `素材`, and trajectories `json/AMBALA Rafale-1.json`, `json/MINAS J-10CE-1.json`, `json/巴方导弹1.json`, and `json/AMBALA Su-30MKI-1.json`. Use the stable IDs frozen in `provenance/ASSET-SEED.md`; assign `trajectory:ambala-su30mki-1` `criticality: "optional"`.

Implement `buildAssetManifest({ sourceRoot, sourceMapPath, browserMetadataPath, calibrationPath, outputPath })` with these exact rules:

```ts
const prepared = entry.kind === 'trajectory'
  ? new TextEncoder().encode(JSON.stringify(normalizeTrajectorySamples(JSON.parse(bytes.toString('utf8')))))
  : bytes;
const fingerprint = `sha256:${createHash('sha256').update(prepared).digest('hex')}`;
const size = prepared.byteLength;
```

- PNG dimensions come from the IHDR width/height big-endian fields after validating the eight-byte PNG signature.
- GLB entries validate header/version/declared length, then take `scale`, `rotationOffsetDeg`, `altitudeOffsetM`, and `entityTypes` only from `asset-model-calibration.json`.
- Video metadata first invokes `ffprobe -v error -show_entries stream=codec_name,codec_tag_string:format=duration -of json <file>`. It converts duration seconds to rounded integer milliseconds and uses `codec_tag_string` when present, otherwise `codec_name`.
- When `ffprobe` is unavailable or exits nonzero, the builder requires a successful record from `asset-browser-metadata.json`; absence or an `error` result fails generation. It never inserts a guessed duration or codec.
- Monotonic trajectories use canonical prepared bytes for fingerprint/size. The known reversed `AMBALA Su-30MKI-1` remains an optional `availability: "invalid"` record; its fingerprint/size identify the rejected raw bytes and it is never passed to `prepareAssetForUpload` or uploaded. Every `availability: "available"` entry uses prepared-byte fingerprint/size.
- The output is parsed with `assetSeedManifestSchema`, sorted by `assetId`, written as UTF-8 JSON with a trailing newline, and contains only relative `sourceRelativePath` values. Reject drive-letter paths, secrets, Bearer tokens, and `http:`, `https:`, or signed URL fields.

Add `"assets:build-manifest": "ts-node -r tsconfig-paths/register src/cli/build-asset-manifest.ts"` to `apps/api/package.json`. The executable requires absolute `ISE_ASSET_SOURCE_ROOT` from the operator environment but never serializes it.

- [ ] **Step 3: Measure fallback video metadata and all six model calibrations in runtime-catalog**

Extend `fixture=runtime-catalog` with a model selector and numeric controls for `scale`, rotation X/Y/Z degrees, and altitude meters. It loads each real GLB through a Blob URL, displays Mapbox axes and a fixed 100-meter reference line, and enables “记录校准” only after the model is visible, upright, nose-aligned with the heading line, and grounded at the reference altitude. The Playwright flow visits all six IDs and writes exactly:

```json
{
  "model:j10": { "scale": 1, "rotationOffsetDeg": [0, 0, 0], "altitudeOffsetM": 0, "entityTypes": ["aircraft"] }
}
```

The object shape above is normative, but the numeric values are the values measured in runtime-catalog, not the example numbers shown. The test fails unless the output contains all six model IDs, finite rotations/altitude, positive scale, screenshots for every model, and non-background canvas pixels.

When `ffprobe` is unavailable, `runtime-catalog.metadata.spec.ts` reads each of the eight MP4 files from `ISE_ASSET_SOURCE_ROOT`, transfers bytes to the page as Blob URLs, waits for `loadedmetadata` or `error`, compares browser duration with the deterministic MP4 box parser within `50ms`, checks `video.canPlayType` for the parsed codec string, and writes `{ assetId, status: 'loadedmetadata', durationMs, codec }[]` to `provenance/asset-browser-metadata.json`. Any `error`, unsupported codec, missing video, or absent codec fails the test; the report is not written partially.

Run:

```powershell
$env:ISE_ASSET_SOURCE_ROOT='E:\Github\ISE'
npm run test:e2e -w @ise/web -- runtime-catalog.metadata.spec.ts
npm run assets:build-manifest -w @ise/api
npm run assets:validate -- provenance/assets.seed.json
```

Expected: `provenance/asset-model-calibration.json` contains six measured models; browser metadata contains eight successful videos when used; `provenance/assets.seed.json` contains six GLB, eight MP4, four images, the three usable selected trajectories, and `trajectory:ambala-su30mki-1` marked invalid. The validator passes, and no absolute source root, key, token, URL, MP4, GLB, or image bytes are tracked.

- [ ] **Step 4: Add root verification scripts**

```json
{
  "scripts": {
    "dev:agent": "npm run start -w @ise/agent",
    "verify": "npm run prisma:generate && npm run typecheck --workspaces --if-present && npm run test --workspaces --if-present && npm run build --workspaces --if-present",
    "verify:e2e": "npm run test:e2e -w @ise/web"
  }
}
```

- [ ] **Step 5: Write the exact demo runbook**

Document Node `>=20.19.0`, PostgreSQL/Redis/MinIO prerequisites, `PUBLIC_MAPBOX_TOKEN` configuration from `apps/web/.env.example`, API/Agent environment template commands, seed manifest import, service start order, report upload, EventPlan review, Scene creation, playback controls, expected JF-17/Rafale/missile model appearances, two expected videos, and the commands below. Do not include credentials or local absolute paths.

```markdown
## Demo Sequence

1. Validate the manifest with `npm run assets:validate -- provenance/assets.seed.json`, then import it with `npm run assets:seed -w @ise/api`.
2. Start PostgreSQL, Redis, and MinIO. In separate terminals run `npm run dev:api`, `npm run dev:agent`, and `npm run dev:web`.
3. Upload the air-combat DOCX and submit the generation objective.
4. Review evidence links, revise one EventUnit, and approve the new version.
5. Create the generated Scene and verify JF-17, Rafale, missile, image, and video tracks.
6. Play, pause, seek to 24 seconds, and replay from zero.
```

- [ ] **Step 6: Run full static and unit verification**

Run: `npm run verify`

Expected: exit code 0 with no typecheck, test, or build failures.

- [ ] **Step 7: Run browser verification**

Run: `npm run verify:e2e`

Expected: exit code 0 on all configured Playwright projects; Mapbox and Three.js canvases contain non-background pixels.

- [ ] **Step 8: Inspect the final repository scope**

Run: `git status --short`

Expected: no `.env`, large MP4/GLB, `dist`, cache, `node_modules`, or nested `.git` is staged or tracked.

- [ ] **Step 9: Commit the real manifest and operator flow**

```powershell
git add apps/api/src/cli/build-asset-manifest.ts apps/api/src/cli/build-asset-manifest.spec.ts apps/api/package.json apps/web/e2e/runtime-catalog.metadata.spec.ts provenance/asset-source-map.json provenance/asset-browser-metadata.json provenance/asset-model-calibration.json provenance/assets.seed.json package.json docs/runbooks/two-day-demo.md
git commit -m "docs: add replay demo verification runbook"
```
