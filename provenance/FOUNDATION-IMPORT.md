# Foundation import provenance

Date: 2026-07-15

## Sources

| Target | Source | Nested Git state | Source package name |
| --- | --- | --- | --- |
| `apps/web` | `intelligents_sceneditor_front` | `master` is unborn; all source files were untracked | `intelligents_sceneditor_front` |
| `apps/api` | `intelligents_sceneditor_back` | `master` is unborn; all source files were untracked | `intelligents_sceneditor_back` |

The original source drops remain local and ignored. They are not workspace members and are not authoritative after this import.

## Included

- Web: `src`, non-legacy `public` assets, Rsbuild, TypeScript, Vitest, PostCSS, and Biome configuration.
- `src/pages/User/views/battles-extended.json` is retained knowledge-base UI data. It is not a Scene runtime mock and remains part of the existing frontend design.
- The retained first-screen UI rasters `section_bg1.png` (2,995,666 bytes) and `section_bg2.png` (5,596,471 bytes) are product interface backgrounds, not demo runtime assets. They remain byte-identical because lossy or format-changing optimization requires a separate visual-regression review.
- API: `src`, `test`, Prisma schema and migrations, Nest/Rspack/TypeScript/ESLint/Prettier configuration.
- Package manifests were renamed to `@ise/web` and `@ise/api`; repository-local Husky prepare scripts and nested locks were removed in favor of the root npm workspace.

## Excluded

- All `.env`, `.git`, `.husky`, `.vscode`, `node_modules`, `dist`, logs, caches, coverage, nested locks, old project directories, and repository-management files.
- `public/plot_utils`, `public/fonts_threejs`, `public/jmp.data`, `public/GBK.data`, `public/symbols_icon`, and `public/symbols_json` because they are unreferenced legacy Threebox/plot payloads and are not part of the new Mapbox Custom Layer runtime. `public/maps` and the favicons remain.
- `src/pages/Plot` and its router, navigation, and embedded-page entry points because the excluded Threebox payload made those retained entry points fail at runtime. Intelligent plotting is deferred to the new runtime rather than preserving a broken route.
- `src/hooks/scene-instance-player-hooks.ts`, `src/hooks/scene-instance-run-hooks.ts`, and `src/hooks/scene-player-hooks.ts` because they import missing legacy stores/managers and are not called by the current Scene page; the new SceneRuntime replaces them.
- `src/mock/scene`, `src/mock/new_model`, `src/mock/Normand_war.ts`, the source `src/mock/ChiBi_War.ts`, the large files from `src/mock/OLD`, and the three large files from `src/mock/313mock`. All large legacy scene JSON and TypeScript battle payloads are absent. Four `{ "paths": [] }` compatibility modules, three minimal typed `313mock` modules, and one inert typed `ChiBi_War.ts` default export keep the mechanical import buildable without committing geographic or narrative payloads; Web integration removes these imports rather than treating the empty modules as runtime data.
- `intelligents_sceneditor_agent` and `intelligents_sceneditor_front_OLD`; both are reference-only.
- Root demo MP4, GLB, trajectory JSON, images, DOCX, and SRT. Later asset seeding reads operator-provided local bytes through a validated manifest.

## Security transformations

- Removed hardcoded JWT and mail credential fallbacks before staging.
- Removed hardcoded Mapbox tokens and exposed only `PUBLIC_MAPBOX_TOKEN` and `PUBLIC_WEB_URL` as explicit public Web variables.
- Replaced `react-helmet-async` with React 19's native `<title>` metadata rendering because the former package's peer contract stops at React 18.
- Restored Axios `1.13.2` from the source pnpm lock receipt instead of allowing its imported range to drift to an incompatible upload-progress signature.
- Restored Rspack CLI/core `1.5.6` from the API source pnpm lock receipt; the imported ranges drifted to `1.7.12`, whose CLI exited before producing the expected `dist/main.js` for the retained configuration.
- Added `.env.example` files containing variable names and inert local example values only.
- Added `three@0.185.1`, `@types/three@0.185.1`, and `@playwright/test@1.61.1` to the Web baseline so runtime worktrees do not contend on manifests or the root lockfile.
- Added `@types/pg` to keep the retained API source closed under TypeScript checking.
- Kept API package imports external in the Node Rspack build while bundling relative and `@/` application source; this preserves native and optional dependency loading at runtime instead of parsing platform binaries as JavaScript.
- The source pnpm lock receipt fixes the strong peer group at Nest common/core/platform/testing `10.4.22`, config `4.0.2`, CLI `10.4.9`, schematics `10.2.3`, JWT `11.0.2`, Passport `11.0.5`, Prisma client/adapter/CLI `7.2.0`, mailer `2.0.2`, Nodemailer `7.0.12`, and TypeScript `5.9.3`. The source lock's Swagger `11.2.4` has an invalid Nest `^11.0.1` peer against that Nest 10 baseline, so migration pins Swagger `8.1.1`, whose published peer contract supports Nest 9 or 10. Ordinary leaf dependency ranges remain unchanged; the root npm lock freezes their selected versions.
- The imported Web baseline did not pass its own `noUnusedLocals`, `noUnusedParameters`, and `verbatimModuleSyntax` noise flags. Migration disables only those three flags and raises the target/library to ES2023 for APIs already used by retained source; `strict` remains enabled and all business and test source stays inside the typecheck.

## File receipt

`provenance/foundation-import.files.json` records a fixed source label plus source-relative path, target-relative path, byte count, and SHA-256 source hash. It never records `ISE_WEB_SOURCE_ROOT`, `ISE_API_SOURCE_ROOT`, drive letters, or absolute paths. Generated environment examples, compatibility modules (including `ChiBi_War.ts`), normalized package manifests, excluded Plot entry points, and secret-removal edits are documented above rather than represented as byte-identical copies.
