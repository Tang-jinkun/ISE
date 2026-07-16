# ISE Compose Real-Chain Design

Date: 2026-07-17

## Goal

Run the complete ISE service stack with Docker Compose and prove the real desktop chain:

`DOCX -> API -> MinIO -> Agent/DeepSeek -> seven artifacts -> PostgreSQL Scene -> Web replay`

Desktop Chromium remains on the Windows host. PostgreSQL, MinIO, API, Agent, and Web run in Docker.

## Architecture

One root `compose.yaml` defines five services on an internal `ise` network. Only the user-facing ports are published to loopback: API `3333`, Agent `4444`, Web `9999`, MinIO `9000/9001`, and PostgreSQL `55432`.

The existing `ise-postgres-data` and `ise-minio-data` named volumes are declared as external volumes. The first managed startup captures the current container credentials without printing them, removes only the two verified legacy containers, and reattaches the existing volumes. Compose never deletes these volumes.

The Web container runs the existing Rsbuild development server on `0.0.0.0:9999`. Its `/SceneBack` and `/SceneAgent` proxies target the Compose service names `api` and `agent`; browser URLs remain same-origin. `PUBLIC_MAPBOX_TOKEN` is injected at Web startup and persisted only in the ignored operator environment file.

The API container runs Prisma migrations before `dist/main.js`. It talks to PostgreSQL and MinIO over the Compose network. MinIO operations use the internal `minio:9000` endpoint, while signed asset URLs use a second public endpoint at `127.0.0.1:9000`, so desktop browsers can load images, videos, trajectories, and GLB models.

The Agent container listens on `0.0.0.0:4444`, validates bearer tokens through `http://api:3333`, stores its SQLite database in `.ise/agent-data`, and calls the configured OpenAI-compatible model over outbound HTTPS.

## Credential Portability

Windows DPAPI cannot decrypt inside a Linux container. The Agent therefore gains an AES-256-GCM credential protector selected by `AGENT_CREDENTIAL_KEY_FILE`. The 32-byte master key is generated once under ignored `.ise/docker-secrets`, mounted read-only, and never written into Compose, logs, images, or Git.

Persisted ciphertext uses a versioned envelope. A Windows-only migration command converts existing unversioned DPAPI ciphertext in a copied Agent database before Docker starts. It never prints plaintext or ciphertext. Host Agent operation continues to use DPAPI when no key file is configured.

## Operator Flow

`scripts/start-docker.ps1` is the supported entry point. It:

1. Creates ignored runtime directories and secrets when absent.
2. Reuses approved environment values and legacy container credentials without printing them.
3. Copies the existing Agent database into `.ise/agent-data` when needed.
4. Stops only verified ISE host listeners and legacy data containers.
5. Migrates legacy DPAPI model credentials to AES-GCM.
6. Runs `docker compose up --build -d` and waits for all five health checks.

The script is idempotent. Subsequent runs reuse the same secrets, external volumes, and Agent database.

## Health And Failure Handling

PostgreSQL uses `pg_isready`; MinIO uses `/minio/health/live`; API uses `/`; Agent accepts the expected unauthenticated `401` from `/model-config`; Web uses `/`. Dependent services start only after their dependencies are healthy.

Startup fails with stable, secret-free codes for missing Docker, missing Mapbox configuration, unexpected port owners, unexpected legacy container mounts, credential migration failure, or unhealthy services. It never removes named volumes.

## Real-Chain Acceptance

Acceptance uses the existing real DOCX and the persisted model configuration. It must freshly export:

- `event-plan.json`
- `narration-plan.json`
- `scene-blueprint.json`
- `resolved-scene-plan.json`
- `choreography-plan.json`
- `canonical-runtime-plan.json`
- `scene-project.json`

The final command is desktop-only Playwright:

```powershell
npm run test:e2e -w @ise/web -- e2e/generated-replay.spec.ts --project=desktop-chromium
```

The replay must show subtitle-led sequencing, image and video tracks, and multi-aircraft GLB formations following trajectory heading and pitch. Only failures that block this chain are fixed during this delivery.

## Scope Boundaries

- No mobile acceptance or new mobile development.
- No Docker socket is mounted into Agent.
- No host-wide filesystem mount is granted to Agent.
- No production orchestration platform is introduced.
- No unrelated UI redesign or infrastructure hardening is included.
