# Two-day replay demo runbook

This runbook covers the operator path from the prepared asset manifest and an air-combat DOCX report to a reviewed, persisted Scene replay.

## Prerequisites

- Node.js `>=20.19.0` and the repository dependencies installed.
- PostgreSQL, Redis, and MinIO available to the API.
- The prepared source assets referenced by `provenance/assets.seed.json` available at the relative `ASSET_SOURCE_DIR` configured for the API seed command.
- A public Mapbox token supplied as `PUBLIC_MAPBOX_TOKEN` using `apps/web/.env.example` as the Web template.
- A model API key supplied to the Agent as `MODEL_API_KEY` by the operator's approved secret provider. The key is required; do not put it in this runbook, source control, or terminal output.
- The air-combat DOCX report available to the operator.

## Local configuration

Create untracked local environment files from the repository templates:

```powershell
Copy-Item apps/web/.env.example apps/web/.env
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item agent/.env.example agent/.env
```

Keep the following integrated configuration while replacing all credential fields through the operator's local secret provider:

- Web: keep `PUBLIC_WEB_URL` on port `9999` and set `PUBLIC_MAPBOX_TOKEN`.
- API: keep `PORT=3333`, `VITE_WEB_URL=http://localhost:9999`, `ASSET_MANIFEST_PATH=../../provenance/assets.seed.json`, and the relative operator asset directory in `ASSET_SOURCE_DIR`. Configure the PostgreSQL, MinIO, and JWT fields locally.
- Agent: keep `AGENT_HOST=127.0.0.1`, set `AGENT_PORT=4444` and `NEST_API_BASE_URL=http://127.0.0.1:3333`, select the approved model endpoint/name, and supply `MODEL_API_KEY` at runtime.

Never commit the generated `.env` files. The demo registration flow does not require an email verification code.

## Prepare data and services

Start PostgreSQL, Redis, and MinIO, then prepare the API database and asset registry from the repository root:

```powershell
npm run prisma:generate
npm run prisma:migrate -w @ise/api
npm run assets:validate -- provenance/assets.seed.json
npm run assets:seed -w @ise/api
```

The manifest validator and seed importer must both exit successfully. Do not continue if a required asset is missing, invalid, or fails its fingerprint check.

## Start the stack

Keep PostgreSQL, Redis, and MinIO running. Start the application services in this order, using a separate terminal for each service.

API:

```powershell
npm run dev:api
```

Confirm the API is listening on port `3333` before starting the Agent.

Agent:

```powershell
$env:AGENT_PORT='4444'
$env:NEST_API_BASE_URL='http://127.0.0.1:3333'
npm run dev:agent
```

Confirm the Agent is listening on port `4444` before starting Web.

Web:

```powershell
npm run dev:web
```

Open the URL printed by Rsbuild. The preferred Web port is `9999`; if it is occupied, use the next available port reported in the terminal.

## Demo Sequence

1. Validate the manifest with `npm run assets:validate -- provenance/assets.seed.json`, then import it with `npm run assets:seed -w @ise/api`.
2. Start PostgreSQL, Redis, and MinIO. In separate terminals run `npm run dev:api`, `npm run dev:agent`, and `npm run dev:web`.
3. Register or sign in at `/login`. Registration does not require an email verification code. Open `/new-script` and enter this generation objective: `Generate an evidence-backed replay from the attached air-combat report with JF-17, Rafale, and PL-15E missile movement, an image track, and video:target-lock and video:missile-impact video tracks.` Select **Import data** and upload the air-combat DOCX. The selected file must be a `.docx`; choosing it submits the objective and starts the Agent run.
4. Wait for **事件计划审核**. Inspect every **证据来源** link, edit one EventUnit, and select **提交修改**. Confirm that the displayed version increases, review the revised unit, and select **批准事件计划**.
5. Wait for the visible completion message **场景配置已生成**. Download **EventPlan**, **RuntimePlan**, and **SceneProject** and confirm the browser saves `event-plan.json`, `canonical-runtime-plan.json`, and `scene-project.json`. Select **转换为场景**, inspect the generated model, image, and video tracks, then select **确认创建场景**. Record the persisted Scene ID from the resulting `/scene?projectId=<id>` URL and open `/runtime-harness?sceneId=<id>` on the same Web origin.
6. Wait until the runtime status reads `ready`. Select **播放**, **暂停**, enter `24000` in the millisecond time control, and select **重播**. Confirm that replay returns the displayed runtime time to zero before advancing again.

## Playback acceptance

- The persisted harness loads the same Scene ID created by **确认创建场景**; it does not use a fixture.
- The Scene timeline contains visible `model`, `image`, and `video` tracks. The image overlay resolves from the seeded catalog and remains inside its configured frame.
- JF-17, Rafale, and missile (PL-15E) GLB models appear during their scheduled items. A model does not appear before its spawn item and hides or changes state only when its track commands require it.
- Each GLB `model.follow_path` item advances along its assigned trajectory. The model nose follows the route heading through turns, and its pitch follows climb and descent rather than staying level, moving sideways, or flipping abruptly.
- The target-lock video (`video:target-lock`) and missile-impact video (`video:missile-impact`) both appear in the video track at their scheduled times, show real decoded frames, and remain synchronized after play, pause, seek, and replay.
- Seeking to `24000` updates models and overlays to the 24-second state without stale items from the previous time. Replay from zero restores the initial state before time advances.
- No blocking runtime error is visible, and the Mapbox and Three.js canvases contain non-background pixels.

## Verification commands

After the complete asset/calibration work and services are available, run static/unit verification and browser verification from the repository root:

```powershell
npm run verify
npm run verify:e2e
```

For the persisted browser replay, provide `ISE_E2E_SCENE_ID` from the created Scene and inject `PUBLIC_MAPBOX_TOKEN` into the verification terminal through the approved local environment. `npm run verify` must finish without typecheck, test, or build failures. `npm run verify:e2e` must pass all configured Playwright projects with non-background Mapbox and Three.js canvases.
