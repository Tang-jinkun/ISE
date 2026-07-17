# API Scene Body Limit Report

## Scope

- Disabled Nest's default Express body parsers during bootstrap.
- Registered JSON and URL-encoded parsers with a `2mb` limit before request middleware and validation pipes.
- Left Scene services, schemas, and multipart upload handling unchanged.

## TDD Evidence

- RED: `main.spec.ts` failed because `NestFactory.create` received only `AppModule`; 4 tests passed and 1 failed.
- GREEN: focused `main.spec.ts` passed 5/5.

## Verification

- API build: passed (`Rspack compiled successfully`).
- API typecheck: blocked by 7 pre-existing TS2550 errors caused by use of `Array.prototype.at` / `Uint8Array.prototype.at` while the API TypeScript target remains ES2021. No typecheck error points to `main.ts` or `main.spec.ts`.
- Prisma Client was regenerated before the final typecheck so stale generated types were excluded as a cause.
- `git diff --check`: see commit verification.
