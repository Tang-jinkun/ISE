# ISE Compose Real-Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run PostgreSQL, MinIO, API, Agent, and Web under Docker Compose and pass the real DOCX-to-desktop-replay chain.

**Architecture:** A root Compose project builds three Node 24 targets and reuses the two existing external data volumes. Agent model credentials use AES-256-GCM with a file-mounted master key in Linux, while a Windows migration CLI converts the current DPAPI ciphertext before Compose starts.

**Tech Stack:** Docker Compose, Node.js 24, TypeScript, NestJS, Rsbuild, Fastify, PostgreSQL 17, MinIO, sql.js, AES-256-GCM, PowerShell.

## Global Constraints

- PostgreSQL, MinIO, API, Agent, and Web run in Docker; desktop Chromium remains on the Windows host.
- Published ports remain `55432`, `9000`, `9001`, `3333`, `4444`, and `9999` on `127.0.0.1`.
- Existing named volumes `ise-postgres-data` and `ise-minio-data` are external and are never deleted.
- Model API keys, JWT secrets, database passwords, MinIO credentials, and encryption keys never enter Git, image layers, command output, or test artifacts.
- Model remains exactly `deepseek-v4-pro`; model credentials stay per authenticated subject.
- Web design and responsive code are unchanged; acceptance is only `desktop-chromium`.
- Only real vertical-chain blockers are fixed.

---

### Task 1: Portable Agent Credential Store

**Files:**
- Modify: `agent/src/model/credentialProtector.ts`
- Modify: `agent/src/config.ts`
- Modify: `agent/src/server.ts`
- Create: `agent/src/cli/migrateCredentialStore.ts`
- Modify: `agent/test/credential-protector.test.ts`
- Create: `agent/test/credential-migration.test.ts`

**Interfaces:**
- Consumes: `CredentialProtector`, `SqlJsDatabaseAdapter`, `model_configs.encrypted_api_key`.
- Produces: `AesGcmCredentialProtector`, `createCredentialProtector(env)`, versioned `aesgcm:v1` ciphertext, and a Windows migration CLI.

- [ ] **Step 1: Add failing AES-GCM tests**

Test round-trip encryption, random nonce uniqueness, tamper rejection, invalid key rejection, factory selection, and absence of plaintext in ciphertext/error output.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm test -w @ise/agent -- --test-name-pattern="AES-GCM|credential factory"
```

Expected: FAIL because the portable protector does not exist.

- [ ] **Step 3: Implement the portable protector and factory**

Read exactly 32 key bytes from a base64 key file, use AES-256-GCM with a random 12-byte nonce and fixed associated data, and serialize `aesgcm:v1:<nonce>:<tag>:<ciphertext>`. Select it when `AGENT_CREDENTIAL_KEY_FILE` is set; otherwise retain Windows DPAPI.

- [ ] **Step 4: Add failing migration test**

Create a temporary sql.js database with a legacy ciphertext, run migration with injected source/target protectors, assert one row is converted, and assert rerunning changes zero rows.

- [ ] **Step 5: Implement migration CLI**

Stop on non-Windows legacy ciphertext, skip `aesgcm:v1` rows, update all legacy rows in one database transaction, and print only `MIGRATED_MODEL_CREDENTIALS=<count>`.

- [ ] **Step 6: Run focused Agent verification**

```powershell
npm test -w @ise/agent -- agent/test/credential-protector.test.ts agent/test/credential-migration.test.ts
npm run typecheck -w @ise/agent
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 7: Commit**

```powershell
git add agent/src/model/credentialProtector.ts agent/src/config.ts agent/src/server.ts agent/src/cli/migrateCredentialStore.ts agent/test/credential-protector.test.ts agent/test/credential-migration.test.ts
git commit -m "feat: make agent credentials container portable"
```

### Task 2: Container Images And Compose Network

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`
- Create: `compose.yaml`
- Modify: `apps/web/rsbuild.config.ts`
- Modify: `apps/api/src/minio/minio.service.ts`
- Create: `apps/api/src/minio/minio.service.spec.ts`

**Interfaces:**
- Consumes: root npm workspaces, existing external volumes, public Web proxy paths.
- Produces: Docker targets `api`, `agent`, and `web`; Compose services `postgres`, `minio`, `api`, `agent`, and `web`.

- [ ] **Step 1: Add failing public MinIO endpoint test**

Mock the MinIO client constructor, configure internal `minio` and public `127.0.0.1` endpoints, call `presignRead`, and assert signing uses the public client while bucket operations use the internal client.

- [ ] **Step 2: Run focused API test and verify RED**

```powershell
npm test -w @ise/api -- --runInBand src/minio/minio.service.spec.ts
```

Expected: FAIL because only one MinIO client exists.

- [ ] **Step 3: Implement internal/public MinIO clients**

Add `MINIO_PUBLIC_ENDPOINT` and `MINIO_PUBLIC_PORT`, preserve current internal operations, and generate signed URLs against the desktop-reachable public origin.

- [ ] **Step 4: Parameterize Web proxy targets**

Use `API_PROXY_TARGET` and `AGENT_PROXY_TARGET`, defaulting to the existing host URLs. Keep browser paths `/SceneBack` and `/SceneAgent` unchanged.

- [ ] **Step 5: Add Docker build targets and Compose**

Use Node `24-bookworm-slim`, root `npm ci`, Prisma generation, and the existing workspace commands. Pin PostgreSQL to major 17 and MinIO to the currently running digest. Declare the two existing named volumes as external, add health checks, and bind every published port to loopback.

- [ ] **Step 6: Validate configuration**

```powershell
docker compose --env-file .ise/docker.env config --quiet
docker build --target api -t ise-api:local .
docker build --target agent -t ise-agent:local .
docker build --target web -t ise-web:local .
```

Expected: Compose config and all three image builds succeed without secret-like build arguments.

- [ ] **Step 7: Commit**

```powershell
git add .dockerignore Dockerfile compose.yaml apps/web/rsbuild.config.ts apps/api/src/minio/minio.service.ts apps/api/src/minio/minio.service.spec.ts
git commit -m "feat: compose the ISE service runtime"
```

### Task 3: Idempotent Docker Startup

**Files:**
- Create: `scripts/start-docker.ps1`
- Create: `scripts/test-start-docker.ps1`
- Modify: `.gitignore` only if the existing `.ise/` rule does not cover generated runtime files.

**Interfaces:**
- Consumes: `compose.yaml`, existing legacy containers and volumes, host Agent SQLite database.
- Produces: one-command, repeatable startup and stable secret-free failure codes.

- [ ] **Step 1: Add static and fixture tests**

Cover missing Mapbox token, first-run secret generation, reuse on second run, exact legacy container/volume verification, refusal to stop unrelated port owners, Agent database copy, credential migration invocation, Compose invocation, and secret-free output.

- [ ] **Step 2: Run launcher tests and verify RED**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-start-docker.ps1
```

Expected: FAIL because `start-docker.ps1` does not exist.

- [ ] **Step 3: Implement startup script**

Generate `.ise/docker.env` and `.ise/docker-secrets/agent-model-key` without printing values; safely capture legacy PostgreSQL/MinIO credentials; stop only verified ISE listeners and containers; preserve external volumes; migrate the copied Agent database; invoke Compose; wait for five healthy services.

- [ ] **Step 4: Run launcher tests and Compose config**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-start-docker.ps1
docker compose --env-file .ise/docker.env config --quiet
```

Expected: tests and configuration validation pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/start-docker.ps1 scripts/test-start-docker.ps1 .gitignore
git commit -m "feat: start the docker runtime safely"
```

### Task 4: Real DOCX And Desktop Replay Acceptance

**Files:**
- Generated only: `.superpowers/sdd/real-demo/*.json`
- Generated only: `apps/web/test-results/**`

**Interfaces:**
- Consumes: healthy Compose stack, persisted `deepseek-v4-pro` configuration, real DOCX, existing Mapbox token and media assets.
- Produces: seven fresh JSON artifacts, persisted Scene ID, and desktop Chromium evidence.

- [ ] **Step 1: Start all containers**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-docker.ps1
docker compose ps
```

Expected: all five services are running and healthy.

- [ ] **Step 2: Run the real DOCX flow**

Run `.superpowers/sdd/run-real-docx-flow.ps1` with an in-process access token for the same model-config subject. Do not print or persist the token.

- [ ] **Step 3: Verify seven fresh artifacts**

Check exact schemas, timestamps after flow start, non-empty EventUnits, subtitle-first timing, image/video tracks, multi-actor formations, trajectory references, and heading/pitch behavior.

- [ ] **Step 4: Run desktop Chromium only**

```powershell
npm run test:e2e -w @ise/web -- e2e/generated-replay.spec.ts --project=desktop-chromium
```

Expected: one desktop project passes; no mobile project runs.

- [ ] **Step 5: Commit only source changes caused by real blockers**

Generated acceptance outputs remain ignored. Fix and commit only issues that actually block the real chain.
