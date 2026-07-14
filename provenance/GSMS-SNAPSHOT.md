# GSMS Agent Runtime Snapshot

- Source repository: `E:\Github\GSMS`
- Source commit: `6f62a067a0c2a490634583483950f7f162ba5e52`
- Captured: `2026-07-14`
- Copied paths: `packages/agent-core`, `packages/skills-core`
- Excluded: dependencies, build output, GSMS domain code, `context-core`

## Mechanical Changes

- Renamed `@gsms/agent-core` to `@ise/agent-core`.
- Renamed `@gsms/skills-core` to `@ise/skills-core`.
- Internalized the minimal `TurnOutcome` contract.
- Removed the inherited unrestricted shell capability.
- Removed stale package-level lockfiles; the root lockfile is authoritative.

## Sync Policy

ISE is an independent line. Future GSMS changes are reviewed and cherry-picked by behavior; copied directories are never overwritten wholesale.
