# ISE Agent Foundation And EventPlan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independently installable ISE Agent foundation that converts an uploaded battle-review DOCX into a schema-valid, evidence-linked draft EventPlan and can accept an exact reviewed version.

**Architecture:** Copy the tested, domain-neutral `agent-core` and `skills-core` packages from the approved GSMS snapshot, then remove their only `context-core` type dependency. Assemble a thin ISE host around the copied runtime, deterministic DOCX/evidence tools, schema-gated EventPlan tools, and one progressively disclosed battle-replay Skill.

**Tech Stack:** Node.js 20.19+, TypeScript 5.9, npm workspaces, Zod 4, Mammoth, Cheerio, GSMS-derived AgentRuntime and Skills runtime, Node test runner through `tsx`.

## Global Constraints

- Source snapshot is `E:\Github\GSMS` commit `6f62a067a0c2a490634583483950f7f162ba5e52`.
- Copy only `packages/agent-core` and `packages/skills-core`; do not add a runtime dependency on the GSMS checkout.
- Rename copied packages to `@ise/agent-core` and `@ise/skills-core`.
- Do not copy `context-core`; internalize only `TurnOutcome` and `TurnOutcomeStatus` in `@ise/agent-core`.
- Use one root Agent; do not implement subagents, Coordinator, MCP, arbitrary shell tools, or network resource search.
- All model-produced EventUnits require evidence references or explicit inference references.
- Draft modification creates a new artifact version; accepted inputs are immutable and fingerprint-bound.
- Use UTF-8 and preserve current Chinese source material without rewriting it.
- Do not commit `.env`, provider credentials, runtime state, generated output, `node_modules`, or test caches.
- Keep original user assets unchanged; the only copied test fixture in this phase is the supplied 44 KB DOCX.

---

## Planned File Map

```text
package.json                                      npm workspace and aggregate scripts
tsconfig.base.json                               shared strict TypeScript settings
provenance/GSMS-SNAPSHOT.md                      exact copy provenance and local changes
packages/agent-core/**                           copied provider-neutral Agent runtime
packages/agent-core/src/turnOutcome.ts            local minimal turn outcome contract
packages/skills-core/**                          copied Skill loader/runtime
agent/package.json                               ISE domain package
agent/tsconfig.json                              ISE TypeScript project
agent/src/index.ts                               public ISE exports
agent/src/runtime/IseAgentProfile.ts             domain prompt policy
agent/src/runtime/IseAgentHost.ts                runtime composition boundary
agent/src/contracts/document.ts                  DocumentIR schemas and types
agent/src/contracts/evidence.ts                  EvidenceIR schemas and types
agent/src/contracts/eventPlan.ts                 EventPlan schemas and types
agent/src/contracts/artifactTypes.ts             stable artifact type constants
agent/src/services/attachmentRegistry.ts         safe file-id to local-path lookup
agent/src/services/documentParser.ts             deterministic DOCX parser
agent/src/services/fingerprint.ts                canonical JSON and SHA-256 helpers
agent/src/tools/documentTools.ts                  parse and evidence-read tools
agent/src/tools/eventPlanTools.ts                 draft and exact-accept tools
agent/skills/generate-battle-replay/SKILL.md      model-visible domain procedure
agent/skills/generate-battle-replay/references/evidence-policy.md
agent/test/fixtures/印巴边境空中对抗行动战后复盘报告.docx
agent/test/helpers.ts                             reusable AgentContext test fixture
agent/test/runtime.test.ts                        host/profile contract tests
agent/test/contracts.test.ts                      schema tests
agent/test/document-parser.test.ts                parser and stable-ref tests
agent/test/document-tools.test.ts                 deterministic tool tests
agent/test/event-plan-tools.test.ts               evidence and acceptance gate tests
agent/test/skill.test.ts                          Skill loading tests
agent/test/event-plan-flow.test.ts                FakeModel end-to-end test
```

## Task 1: Create The Independent Runtime Snapshot

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `provenance/GSMS-SNAPSHOT.md`
- Create from approved snapshot: `packages/agent-core/**`
- Create from approved snapshot: `packages/skills-core/**`
- Create: `packages/agent-core/src/turnOutcome.ts`
- Modify: `packages/agent-core/package.json`
- Modify: `packages/agent-core/src/types.ts`
- Modify: `packages/agent-core/src/agent/AgentRuntime.ts`
- Modify: `packages/agent-core/src/index.ts`
- Modify: `packages/skills-core/package.json`

**Interfaces:**
- Consumes: GSMS source commit `6f62a067a0c2a490634583483950f7f162ba5e52`.
- Produces: independently installable `@ise/agent-core` and `@ise/skills-core`; exports `TurnOutcome` and `TurnOutcomeStatus` from `@ise/agent-core`.

- [ ] **Step 1: Verify the approved source packages before copying**

Run:

```powershell
$git = 'C:\Users\t\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
& $git -C E:\Github\GSMS rev-parse HEAD
cd E:\Github\GSMS\packages\agent-core
npm test
npm run typecheck
cd ..\skills-core
npm test
npm run typecheck
```

Expected:

```text
6f62a067a0c2a490634583483950f7f162ba5e52
agent-core: 61 tests passed
skills-core: 13 tests passed
both typechecks exit 0
```

- [ ] **Step 2: Copy the two approved packages without generated dependencies**

Run from `E:\Github\ISE`:

```powershell
New-Item -ItemType Directory -Force packages, provenance | Out-Null
Copy-Item -Recurse E:\Github\GSMS\packages\agent-core packages\agent-core
Copy-Item -Recurse E:\Github\GSMS\packages\skills-core packages\skills-core
Remove-Item -Recurse -Force packages\agent-core\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force packages\skills-core\node_modules -ErrorAction SilentlyContinue
```

Expected: both package directories contain `src`, `test`, `package.json`, and `tsconfig.json`, with no `node_modules`.

- [ ] **Step 3: Add the workspace configuration**

Create `package.json`:

```json
{
  "name": "ise-agent-monorepo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "agent"
  ],
  "engines": {
    "node": ">=20.19.0"
  },
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 4: Add the minimal local turn outcome contract**

Create `packages/agent-core/src/turnOutcome.ts`:

```typescript
export type TurnOutcomeStatus =
  | 'completed'
  | 'awaiting_user'
  | 'awaiting_dependency'
  | 'failed'

export interface TurnOutcomeDiagnostic {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
}

export interface TurnOutcome {
  status: TurnOutcomeStatus
  finalAnswer: string
  diagnostics?: TurnOutcomeDiagnostic[]
  metadata?: Record<string, unknown>
}
```

In `packages/agent-core/src/types.ts`, replace:

```typescript
import type { TurnOutcome } from '@gsms/context-core'
```

with:

```typescript
import type { TurnOutcome } from './turnOutcome.ts'
```

In `packages/agent-core/src/agent/AgentRuntime.ts`, replace the `@gsms/context-core` type import with:

```typescript
import type { TurnOutcome, TurnOutcomeStatus } from '../turnOutcome.ts'
```

Append to `packages/agent-core/src/index.ts`:

```typescript
export * from './turnOutcome.ts'
```

- [ ] **Step 5: Rename packages and remove the unused dependency**

Set these exact values in `packages/agent-core/package.json`:

```json
{
  "name": "@ise/agent-core",
  "version": "0.1.0"
}
```

Preserve all other fields, but remove `@gsms/context-core` from `dependencies` and change `@gsms/skills-core` to:

```json
"@ise/skills-core": "file:../skills-core"
```

Replace all source imports of `@gsms/skills-core` in `packages/agent-core` with `@ise/skills-core`.

Set these exact values in `packages/skills-core/package.json` while preserving its other fields:

```json
{
  "name": "@ise/skills-core",
  "version": "0.1.0"
}
```

- [ ] **Step 6: Record copy provenance**

Create `provenance/GSMS-SNAPSHOT.md`:

```markdown
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

## Sync Policy

ISE is an independent line. Future GSMS changes are reviewed and cherry-picked by behavior; copied directories are never overwritten wholesale.
```

- [ ] **Step 7: Install and verify the copied baseline**

Run:

```powershell
npm install
npm run test --workspace @ise/skills-core
npm run typecheck --workspace @ise/skills-core
npm run test --workspace @ise/agent-core
npm run typecheck --workspace @ise/agent-core
```

Expected: 13 Skill tests and 61 Agent tests pass; both typechecks exit 0; no import references to `@gsms/context-core` remain.

- [ ] **Step 8: Commit the independent runtime snapshot**

```powershell
git add package.json package-lock.json tsconfig.base.json provenance packages
git commit -m "feat: import independent agent runtime"
```

## Task 2: Add The ISE Agent Host And Profile

**Files:**
- Create: `agent/package.json`
- Create: `agent/tsconfig.json`
- Create: `agent/src/index.ts`
- Create: `agent/src/runtime/IseAgentProfile.ts`
- Create: `agent/src/runtime/IseAgentHost.ts`
- Create: `agent/test/helpers.ts`
- Test: `agent/test/runtime.test.ts`

**Interfaces:**
- Consumes: `AgentRuntime`, `AgentProfile`, `ModelAdapter`, `ToolRegistry`, `SkillRegistry` from copied packages.
- Produces: `IseAgentHost.run(objective: string): Promise<AgentRunResult>` and `IseAgentProfile`.

- [ ] **Step 1: Write the failing host/profile test**

Create `agent/test/runtime.test.ts`:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeModelAdapter, ToolRegistry } from '@ise/agent-core'
import { SkillRegistry } from '@ise/skills-core'
import { IseAgentHost } from '../src/runtime/IseAgentHost.ts'
import { IseAgentProfile } from '../src/runtime/IseAgentProfile.ts'

test('ISE host uses the domain profile and completes a natural answer', async () => {
  const model = new FakeModelAdapter([{ content: '已读取当前输入，但还没有可接受的事件计划。' }])
  const host = new IseAgentHost({
    model,
    tools: new ToolRegistry(),
    skills: new SkillRegistry(),
    workspace: process.cwd(),
  })

  const result = await host.run('检查当前输入。')

  assert.equal(result.goal.status, 'completed')
  assert.equal(result.turnOutcome?.finalAnswer, '已读取当前输入，但还没有可接受的事件计划。')
  assert.equal(IseAgentProfile.id, 'ise-battle-replay-agent')
  assert.match(IseAgentProfile.planningPolicy ?? '', /证据/)
})
```

- [ ] **Step 2: Add the Agent package configuration and verify the test fails**

Create `agent/package.json`:

```json
{
  "name": "@ise/agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.19.0"
  },
  "scripts": {
    "test": "tsx --test test/runtime.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ise/agent-core": "file:../packages/agent-core",
    "@ise/skills-core": "file:../packages/skills-core",
    "cheerio": "^1.1.0",
    "mammoth": "^1.9.1",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^24.10.0",
    "tsx": "^4.20.6",
    "typescript": "^5.9.3"
  }
}
```

Create `agent/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Run:

```powershell
npm install
npm run test --workspace @ise/agent
```

Expected: FAIL because `IseAgentHost.ts` and `IseAgentProfile.ts` do not exist.

- [ ] **Step 3: Implement the profile**

Create `agent/src/runtime/IseAgentProfile.ts`:

```typescript
import type { AgentProfile } from '@ise/agent-core'

export const IseAgentProfile: AgentProfile = {
  id: 'ise-battle-replay-agent',
  rolePrompt: [
    'You are the ISE battle-review scene generation agent.',
    'Convert same-domain battle-review documents into evidence-linked narrative plans using only visible tools and registered assets.',
  ].join('\n'),
  languagePolicy: '所有面向用户的内容使用简体中文；工具名、Schema 字段、资源 ID 和原文引用保持原样。',
  planningPolicy: [
    '- 证据先于叙事。需要事实时读取当前 DocumentIR 或 EvidenceIR。',
    '- 区分 explicit_fact、deterministic_derivation、model_inference 和 illustrative。',
    '- EventUnit 描述世界状态变化，不描述底座命令。',
    '- 不把未核定数量、对白、命中或战果写成确定事实。',
  ].join('\n'),
  toolUsePolicy: [
    '- 只调用当前可见工具，不猜测文件路径、资源 ID 或底座动作。',
    '- 生成 EventPlan 前必须调用匹配的 Skill。',
    '- 模型只能提交结构化草案；接受和编译由确定性工具完成。',
  ].join('\n'),
  completionPolicy: '只有工具产物支持当前结论时才使用完成语气；存在校验错误时必须明确说明。',
  recoveryPolicy: '工具拒绝输入时根据结构化错误修正；两次仍失败则停止并报告真实错误。',
  narrationPolicy: '工具调用前只给一句简短中文活动说明，不展示隐藏推理链。',
}
```

- [ ] **Step 4: Implement the thin host**

Create `agent/src/runtime/IseAgentHost.ts`:

```typescript
import {
  AgentRuntime,
  ArtifactStore,
  DomainStateStore,
  PermissionManager,
  type AgentEventSink,
  type AgentRunResult,
  type ModelAdapter,
  type PermissionDecision,
  type ToolRegistry,
} from '@ise/agent-core'
import type { SkillRegistry } from '@ise/skills-core'
import { IseAgentProfile } from './IseAgentProfile.ts'

export interface IseAgentHostOptions {
  model: ModelAdapter
  tools: ToolRegistry
  skills: SkillRegistry
  workspace: string
  maxTurns?: number
  eventSink?: AgentEventSink
  approve?: (toolName: string, input: unknown) => PermissionDecision | Promise<PermissionDecision>
  artifacts?: ArtifactStore
  domainState?: DomainStateStore
}

export class IseAgentHost {
  constructor(readonly options: IseAgentHostOptions) {}

  run(objective: string): Promise<AgentRunResult> {
    const runtime = new AgentRuntime({
      model: this.options.model,
      tools: this.options.tools,
      skills: this.options.skills,
      workspace: this.options.workspace,
      maxTurns: this.options.maxTurns ?? 12,
      artifacts: this.options.artifacts ?? new ArtifactStore(),
      domainState: this.options.domainState ?? new DomainStateStore(),
      eventSink: this.options.eventSink,
      profile: IseAgentProfile,
      permissions: new PermissionManager({
        approve: (tool, input) => this.options.approve?.(tool.name, input) ?? 'deny',
      }),
    })
    return runtime.run(objective)
  }
}
```

Create `agent/src/index.ts`:

```typescript
export * from './runtime/IseAgentHost.ts'
export * from './runtime/IseAgentProfile.ts'
```

- [ ] **Step 5: Run tests and typecheck**

```powershell
npm run test --workspace @ise/agent
npm run typecheck --workspace @ise/agent
```

Expected: runtime test passes and typecheck exits 0.

- [ ] **Step 6: Commit the host**

```powershell
git add agent package.json package-lock.json
git commit -m "feat: add ISE agent host"
```

## Task 3: Define Document, Evidence, And EventPlan Contracts

**Files:**
- Create: `agent/src/contracts/document.ts`
- Create: `agent/src/contracts/evidence.ts`
- Create: `agent/src/contracts/eventPlan.ts`
- Create: `agent/src/contracts/artifactTypes.ts`
- Modify: `agent/src/index.ts`
- Test: `agent/test/contracts.test.ts`

**Interfaces:**
- Produces: `DocumentIR`, `EvidenceIR`, `EventPlan`, their Zod schemas, and stable artifact type constants.
- Consumes: no domain runtime state; all validation is pure.

- [ ] **Step 1: Write failing contract tests**

Create `agent/test/contracts.test.ts`:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import { evidenceIrSchema } from '../src/contracts/evidence.ts'
import { eventPlanSchema } from '../src/contracts/eventPlan.ts'

test('EventPlan requires evidence or inference on every EventUnit', () => {
  const result = eventPlanSchema.safeParse({
    schemaVersion: 'event-plan/v1',
    planId: 'plan-1',
    documentId: 'doc-1',
    version: 1,
    eventUnits: [{
      eventUnitId: 'eu-1',
      title: '首轮攻击',
      worldStateChange: '双方由对峙进入实质性交锋。',
      participants: ['印度空军'],
      locationRefs: [],
      evidenceRefs: [],
      inferenceRefs: [],
      uncertainties: [],
      narrativePurpose: '说明交锋开始',
      importance: 'high',
    }],
    omittedEvidence: [],
    warnings: [],
  })
  assert.equal(result.success, false)
})

test('EvidenceIR keeps exact source references and fact kind', () => {
  const value = evidenceIrSchema.parse({
    schemaVersion: 'evidence-ir/v1',
    documentId: 'doc-1',
    records: [{
      evidenceId: 'ev-1',
      sourceRef: 'doc:doc-1:paragraph:3',
      claim: '印方预警机建立目标跟踪。',
      kind: 'explicit_fact',
      entities: ['印方预警机'],
      confidence: 1,
      ambiguities: [],
    }],
  })
  assert.equal(value.records[0]?.sourceRef, 'doc:doc-1:paragraph:3')
})
```

Change the `agent/package.json` test script to:

```json
"test": "tsx --test test/runtime.test.ts test/contracts.test.ts"
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
npm run test --workspace @ise/agent
```

Expected: FAIL because contract modules do not exist.

- [ ] **Step 3: Implement DocumentIR**

Create `agent/src/contracts/document.ts` with strict Zod objects for:

```typescript
import { z } from 'zod'

export const documentParagraphSchema = z.object({
  paragraphId: z.string().min(1),
  sourceRef: z.string().min(1),
  sectionPath: z.array(z.string().min(1)),
  text: z.string().min(1),
}).strict()

export const documentTableSchema = z.object({
  tableId: z.string().min(1),
  sourceRef: z.string().min(1),
  sectionPath: z.array(z.string().min(1)),
  rows: z.array(z.array(z.string())),
}).strict()

export const documentSectionSchema = z.object({
  sectionId: z.string().min(1),
  level: z.number().int().min(1).max(6),
  title: z.string().min(1),
  sourceRef: z.string().min(1),
}).strict()

export const documentIrSchema = z.object({
  schemaVersion: z.literal('document-ir/v1'),
  documentId: z.string().min(1),
  title: z.string().min(1),
  sourceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  sections: z.array(documentSectionSchema),
  paragraphs: z.array(documentParagraphSchema),
  tables: z.array(documentTableSchema),
  warnings: z.array(z.string()),
}).strict()

export type DocumentIR = z.infer<typeof documentIrSchema>
```

- [ ] **Step 4: Implement EvidenceIR**

Create `agent/src/contracts/evidence.ts`:

```typescript
import { z } from 'zod'

export const evidenceKindSchema = z.enum([
  'explicit_fact',
  'deterministic_derivation',
  'model_inference',
  'illustrative',
])

export const evidenceRecordSchema = z.object({
  evidenceId: z.string().min(1),
  sourceRef: z.string().min(1),
  claim: z.string().min(1),
  kind: evidenceKindSchema,
  entities: z.array(z.string().min(1)),
  timeExpression: z.string().min(1).optional(),
  locationExpression: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string()),
}).strict()

export const evidenceIrSchema = z.object({
  schemaVersion: z.literal('evidence-ir/v1'),
  documentId: z.string().min(1),
  records: z.array(evidenceRecordSchema),
}).strict()

export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>
export type EvidenceIR = z.infer<typeof evidenceIrSchema>
```

- [ ] **Step 5: Implement EventPlan with the evidence invariant**

Create `agent/src/contracts/eventPlan.ts`:

```typescript
import { z } from 'zod'

export const eventUnitSchema = z.object({
  eventUnitId: z.string().min(1),
  title: z.string().min(1),
  worldStateChange: z.string().min(1),
  participants: z.array(z.string().min(1)),
  locationRefs: z.array(z.string().min(1)),
  realWorldTime: z.string().min(1).optional(),
  evidenceRefs: z.array(z.string().min(1)),
  inferenceRefs: z.array(z.string().min(1)),
  uncertainties: z.array(z.string()),
  narrativePurpose: z.string().min(1),
  importance: z.enum(['high', 'medium', 'low']),
}).strict().refine(
  unit => unit.evidenceRefs.length > 0 || unit.inferenceRefs.length > 0,
  { message: 'EventUnit requires evidenceRefs or inferenceRefs' },
)

export const eventPlanSchema = z.object({
  schemaVersion: z.literal('event-plan/v1'),
  planId: z.string().min(1),
  documentId: z.string().min(1),
  version: z.number().int().positive(),
  eventUnits: z.array(eventUnitSchema).min(1).max(10),
  omittedEvidence: z.array(z.string()),
  warnings: z.array(z.string()),
}).strict()

export type EventUnit = z.infer<typeof eventUnitSchema>
export type EventPlan = z.infer<typeof eventPlanSchema>
```

Create `agent/src/contracts/artifactTypes.ts`:

```typescript
export const DOCUMENT_IR_ARTIFACT = 'ise.document-ir/v1'
export const EVIDENCE_IR_ARTIFACT = 'ise.evidence-ir/v1'
export const EVENT_PLAN_DRAFT_ARTIFACT = 'ise.event-plan-draft/v1'
export const EVENT_PLAN_ACCEPTED_ARTIFACT = 'ise.event-plan-accepted/v1'
```

Export all four modules from `agent/src/index.ts`.

- [ ] **Step 6: Run contract tests and typecheck**

```powershell
npm run test --workspace @ise/agent
npm run typecheck --workspace @ise/agent
```

Expected: contract tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit contracts**

```powershell
git add agent/src/contracts agent/src/index.ts agent/test/contracts.test.ts agent/package.json
git commit -m "feat: define evidence and event plan contracts"
```

## Task 4: Parse DOCX Into Stable Document And Evidence Records

**Files:**
- Create: `agent/src/services/documentParser.ts`
- Create: `agent/src/services/fingerprint.ts`
- Create: `agent/test/fixtures/印巴边境空中对抗行动战后复盘报告.docx`
- Test: `agent/test/document-parser.test.ts`

**Interfaces:**
- Consumes: `parseBattleReport(buffer: Buffer): Promise<ParsedBattleReport>`.
- Produces: `ParsedBattleReport = { document: DocumentIR; evidence: EvidenceIR }` with deterministic IDs for identical bytes.

- [ ] **Step 1: Copy the approved DOCX fixture**

```powershell
New-Item -ItemType Directory -Force agent\test\fixtures | Out-Null
Copy-Item '印巴边境空中对抗行动战后复盘报告.docx' 'agent\test\fixtures\印巴边境空中对抗行动战后复盘报告.docx'
```

- [ ] **Step 2: Write the failing parser test**

Create `agent/test/document-parser.test.ts`:

```typescript
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseBattleReport } from '../src/services/documentParser.ts'

const fixture = new URL('./fixtures/印巴边境空中对抗行动战后复盘报告.docx', import.meta.url)

test('parser preserves headings, tables, and stable source references', async () => {
  const buffer = await readFile(fixture)
  const first = await parseBattleReport(buffer)
  const second = await parseBattleReport(buffer)

  assert.equal(first.document.title, '印巴边境空中对抗行动')
  assert.ok(first.document.sections.some(section => section.title.includes('行动经过')))
  assert.ok(first.document.tables.length >= 2)
  assert.ok(first.document.paragraphs.every(item => item.sourceRef.startsWith(`doc:${first.document.documentId}:paragraph:`)))
  assert.equal(first.document.documentId, second.document.documentId)
  assert.deepEqual(first.evidence, second.evidence)
})

test('parser evidence quotes source text without inventing claims', async () => {
  const parsed = await parseBattleReport(await readFile(fixture))
  const claim = parsed.evidence.records.find(record => record.claim.includes('实际出动架次'))
  assert.ok(claim)
  assert.equal(claim.kind, 'explicit_fact')
  assert.match(claim.sourceRef, /^doc:.+:paragraph:\d+$/)
})
```

Change the `agent/package.json` test script to:

```json
"test": "tsx --test test/runtime.test.ts test/contracts.test.ts test/document-parser.test.ts"
```

- [ ] **Step 3: Run the parser test to verify it fails**

```powershell
npx tsx --test agent/test/document-parser.test.ts
```

Expected: FAIL because `documentParser.ts` does not exist.

- [ ] **Step 4: Implement canonical fingerprints**

Create `agent/src/services/fingerprint.ts`:

```typescript
import { createHash } from 'node:crypto'

export function sha256(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

export function fingerprint(value: unknown): string {
  return sha256(canonicalJson(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  )
}
```

- [ ] **Step 5: Implement deterministic DOCX parsing**

Create `agent/src/services/documentParser.ts`. Use `mammoth.convertToHtml({ buffer })`, load the returned HTML with Cheerio, walk top-level `h1` to `h6`, `p`, `ul > li`, `ol > li`, and `table` nodes in document order, and implement these exact rules:

```typescript
export interface ParsedBattleReport {
  document: DocumentIR
  evidence: EvidenceIR
}

export async function parseBattleReport(buffer: Buffer): Promise<ParsedBattleReport>
```

ID rules:

```typescript
const sourceHash = sha256(buffer)
const documentId = `doc-${sourceHash.slice('sha256:'.length, 'sha256:'.length + 16)}`
const paragraphRef = `doc:${documentId}:paragraph:${paragraphIndex}`
const tableRef = `doc:${documentId}:table:${tableIndex}`
const evidenceId = `ev-${sha256(`${sourceRef}\n${text}`).slice('sha256:'.length, 'sha256:'.length + 16)}`
```

Parsing rules:

- The first non-empty text before the first heading is the title.
- Heading tags update a level-indexed section path.
- Non-empty paragraphs and list items become `DocumentParagraph` records.
- Each table becomes one `DocumentTable`; trim every cell but preserve empty cells.
- Each paragraph becomes one `explicit_fact` EvidenceRecord quoting the exact paragraph text.
- Entity extraction is dictionary-based for the current fixed domain: `苏-30MKI`, `阵风`, `JF-17`, `J-10CE`, `预警机`, `地面雷达`, `阿达姆普尔`, `安巴拉`, `米纳斯`, `拉菲基`, `印度`, `巴方`, `印方`.
- Time expressions use `/\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}/`.
- Missing headings produce a warning; they do not discard paragraphs.
- Validate final objects with `documentIrSchema.parse` and `evidenceIrSchema.parse`.

- [ ] **Step 6: Run parser tests and typecheck**

```powershell
npx tsx --test agent/test/document-parser.test.ts
npm run typecheck --workspace @ise/agent
```

Expected: both parser tests pass; typecheck exits 0.

- [ ] **Step 7: Commit the parser**

```powershell
git add agent/package.json package-lock.json agent/src/services agent/test/document-parser.test.ts agent/test/fixtures
git commit -m "feat: parse battle reports into evidence"
```

## Task 5: Expose Document Parsing And Evidence Inspection Tools

**Files:**
- Create: `agent/src/services/attachmentRegistry.ts`
- Create: `agent/src/tools/documentTools.ts`
- Create: `agent/test/helpers.ts`
- Test: `agent/test/document-tools.test.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Produces: `AttachmentRegistry.register(path): Promise<AttachmentRecord>` and `createDocumentTools(registry): AgentTool[]`.
- Tool names: `parse_battle_report`, `inspect_report_evidence`.

- [ ] **Step 1: Write failing document-tool tests**

Create `agent/test/document-tools.test.ts` with two tests:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import { AttachmentRegistry } from '../src/services/attachmentRegistry.ts'
import { createDocumentTools } from '../src/tools/documentTools.ts'
import { testAgentContext } from './helpers.ts'

const fixturePath = new URL('./fixtures/印巴边境空中对抗行动战后复盘报告.docx', import.meta.url)

test('parse_battle_report stores DocumentIR and EvidenceIR artifacts', async () => {
  const attachments = new AttachmentRegistry()
  const attachment = await attachments.register(fixturePath)
  const tools = createDocumentTools(attachments)
  const parse = tools.find(tool => tool.name === 'parse_battle_report')!
  const context = testAgentContext()

  const result = await parse.execute({ fileId: attachment.fileId }, context)

  assert.equal(result.artifacts?.map(item => item.type).sort().join(','), 'ise.document-ir/v1,ise.evidence-ir/v1')
  assert.match(result.content, /documentId/)
})

test('inspect_report_evidence returns bounded evidence selected by section text', async () => {
  const attachments = new AttachmentRegistry()
  const attachment = await attachments.register(fixturePath)
  const tools = createDocumentTools(attachments)
  const context = testAgentContext()
  const parsed = await tools[0]!.execute({ fileId: attachment.fileId }, context)
  context.artifacts.createMany(parsed.artifacts ?? [])

  const inspect = tools.find(tool => tool.name === 'inspect_report_evidence')!
  const result = await inspect.execute({ query: '电子对抗', limit: 5 }, context)

  const payload = JSON.parse(result.content) as { records: unknown[] }
  assert.ok(payload.records.length > 0)
  assert.ok(payload.records.length <= 5)
})
```

Change the `agent/package.json` test script to:

```json
"test": "tsx --test test/runtime.test.ts test/contracts.test.ts test/document-parser.test.ts test/document-tools.test.ts"
```

- [ ] **Step 2: Create a reusable test AgentContext and verify failure**

Create `agent/test/helpers.ts`:

```typescript
import {
  ArtifactStore,
  DomainStateStore,
  type AgentContext,
} from '@ise/agent-core'

export function testAgentContext(): AgentContext {
  return {
    workspace: process.cwd(),
    goal: {
      objective: 'test',
      status: 'active',
      turnCount: 0,
      maxTurns: 10,
      evidence: [],
      remainingIssues: [],
      startedAt: new Date(0).toISOString(),
    },
    artifacts: new ArtifactStore(),
    domainState: new DomainStateStore(),
  }
}
```

Run:

```powershell
npx tsx --test agent/test/document-tools.test.ts
```

Expected: FAIL because the registry and tools do not exist.

- [ ] **Step 3: Implement the safe attachment registry**

Create `agent/src/services/attachmentRegistry.ts`:

```typescript
import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256 } from './fingerprint.ts'

export interface AttachmentRecord {
  fileId: string
  path: string
  name: string
  size: number
  fingerprint: string
}

export class AttachmentRegistry {
  readonly #items = new Map<string, AttachmentRecord>()

  async register(input: string | URL): Promise<AttachmentRecord> {
    const path = resolve(input instanceof URL ? fileURLToPath(input) : input)
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`Attachment is not a file: ${path}`)
    const content = await readFile(path)
    const fingerprint = sha256(content)
    const fileId = `file-${fingerprint.slice('sha256:'.length, 'sha256:'.length + 16)}`
    const record = { fileId, path, name: basename(path), size: info.size, fingerprint }
    this.#items.set(fileId, record)
    return record
  }

  require(fileId: string): AttachmentRecord {
    const record = this.#items.get(fileId)
    if (!record) throw new Error(`Unknown attachment: ${fileId}`)
    return { ...record }
  }
}
```

- [ ] **Step 4: Implement the two tools**

Create `agent/src/tools/documentTools.ts` using `AgentTool` objects with these contracts:

```typescript
parse_battle_report
inputSchema: {
  type: 'object',
  additionalProperties: false,
  required: ['fileId'],
  properties: { fileId: { type: 'string', minLength: 1 } },
}
risk: 'derive'
```

Execution reads the registered file, calls `parseBattleReport`, and returns two artifacts:

```typescript
{
  type: DOCUMENT_IR_ARTIFACT,
  createdBy: 'tool',
  logicalKey: `document:${document.documentId}`,
  data: document,
  metadata: { documentId: document.documentId, sourceHash: document.sourceHash },
}
{
  type: EVIDENCE_IR_ARTIFACT,
  createdBy: 'tool',
  logicalKey: `evidence:${document.documentId}`,
  data: evidence,
  metadata: { documentId: document.documentId },
}
```

`inspect_report_evidence` accepts `{ documentId?: string, query?: string, evidenceIds?: string[], limit?: number }`, requires an active EvidenceIR artifact, performs case-insensitive substring matching over claim, entity, and sourceRef, clamps `limit` to 1 through 20, and returns only matching records. Set `risk: 'read'` and `isConcurrencySafe: true`.

- [ ] **Step 5: Run tool tests and typecheck**

```powershell
npx tsx --test agent/test/document-tools.test.ts
npm run typecheck --workspace @ise/agent
```

Expected: both tool tests pass and typecheck exits 0.

- [ ] **Step 6: Export and commit document tools**

Export the registry and tool factory from `agent/src/index.ts`, then run:

```powershell
git add agent/src agent/test
git commit -m "feat: expose report evidence tools"
```

## Task 6: Gate Draft And Accepted EventPlans

**Files:**
- Create: `agent/src/tools/eventPlanTools.ts`
- Test: `agent/test/event-plan-tools.test.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Produces: `createEventPlanTools(): AgentTool[]`.
- Tool names: `propose_event_plan`, `accept_event_plan`.
- Accepted input is `{ draftArtifactId: string; version: number; fingerprint: string }`.

- [ ] **Step 1: Write failing EventPlan gate tests**

Create tests that seed an EvidenceIR artifact and assert:

```typescript
test('propose_event_plan rejects an unknown evidence reference', async () => {
  // Seed EvidenceIR containing only ev-known.
  // Execute propose_event_plan with evidenceRefs: ['ev-missing'].
  await assert.rejects(() => propose.execute(input, context), /Unknown evidence reference: ev-missing/)
})

test('propose_event_plan creates a fingerprinted draft and supersedes the prior version', async () => {
  // Execute version 1 and store it, then execute version 2 with the same planId.
  // Assert the second draft has metadata.fingerprint and supersedes the first logical entity.
})

test('accept_event_plan requires exact draft version and fingerprint', async () => {
  // Store one draft, reject a mismatched fingerprint, then accept the exact tuple.
  // Assert accepted artifact type is ise.event-plan-accepted/v1.
})
```

Use complete valid EventPlan fixtures in the test; do not bypass Zod parsing with casts.

Change the `agent/package.json` test script to:

```json
"test": "tsx --test test/runtime.test.ts test/contracts.test.ts test/document-parser.test.ts test/document-tools.test.ts test/event-plan-tools.test.ts"
```

- [ ] **Step 2: Run tests to verify failure**

```powershell
npx tsx --test agent/test/event-plan-tools.test.ts
```

Expected: FAIL because `eventPlanTools.ts` does not exist.

- [ ] **Step 3: Implement `propose_event_plan`**

Create `agent/src/tools/eventPlanTools.ts` and implement:

```typescript
function activeEvidenceIds(context: AgentContext, documentId: string): Set<string>
function requireDraft(context: AgentContext, artifactId: string): Artifact<EventPlan>
export function createEventPlanTools(): AgentTool[]
```

`propose_event_plan` rules:

1. Parse input with `eventPlanSchema`.
2. Load the active EvidenceIR for the same `documentId`.
3. Reject every `evidenceRef` not present in that EvidenceIR.
4. Reject every `inferenceRef` unless it points to EvidenceIR with `kind=model_inference` or is prefixed `inference:` and the EventUnit contains a non-empty uncertainty.
5. Calculate `fingerprint(plan)`.
6. Return a draft artifact with:

```typescript
{
  type: EVENT_PLAN_DRAFT_ARTIFACT,
  createdBy: 'agent',
  logicalKey: `event-plan:${plan.planId}`,
  data: plan,
  metadata: {
    planId: plan.planId,
    documentId: plan.documentId,
    version: plan.version,
    fingerprint: fingerprint(plan),
    status: 'draft',
  },
}
```

Set tool risk to `derive`.

- [ ] **Step 4: Implement exact acceptance**

`accept_event_plan` rules:

1. Set risk to `write`.
2. Resolve the exact draft artifact by ID.
3. Compare requested version with `draft.data.version`.
4. Compare requested fingerprint with `draft.metadata.fingerprint`.
5. Recalculate the fingerprint from draft data and compare again.
6. Return a new accepted artifact; do not mutate the draft:

```typescript
{
  type: EVENT_PLAN_ACCEPTED_ARTIFACT,
  createdBy: 'user',
  logicalKey: `accepted-event-plan:${draft.data.planId}`,
  data: draft.data,
  metadata: {
    planId: draft.data.planId,
    documentId: draft.data.documentId,
    version: draft.data.version,
    fingerprint: requestedFingerprint,
    acceptedDraftArtifactId: draft.id,
    status: 'accepted',
  },
}
```

- [ ] **Step 5: Run tests and typecheck**

```powershell
npx tsx --test agent/test/event-plan-tools.test.ts
npm run typecheck --workspace @ise/agent
```

Expected: all evidence, supersession, version, fingerprint, and acceptance tests pass.

- [ ] **Step 6: Export and commit EventPlan tools**

```powershell
git add agent/src/tools/eventPlanTools.ts agent/src/index.ts agent/test/event-plan-tools.test.ts
git commit -m "feat: gate reviewed event plans"
```

## Task 7: Add The Battle-Replay Skill And End-To-End Flow

**Files:**
- Create: `agent/skills/generate-battle-replay/SKILL.md`
- Create: `agent/skills/generate-battle-replay/references/evidence-policy.md`
- Test: `agent/test/skill.test.ts`
- Test: `agent/test/event-plan-flow.test.ts`
- Modify: `agent/src/index.ts`

**Interfaces:**
- Produces: a loadable `generate-battle-replay` Skill and a tested root-Agent path from attachment to draft EventPlan.
- Consumes: document tools, EventPlan tools, IseAgentHost, and `FakeModelAdapter`.

- [ ] **Step 1: Write failing Skill and flow tests**

In `agent/test/skill.test.ts`, load the project Skill directory and assert:

```typescript
assert.equal(skill.name, 'generate-battle-replay')
assert.equal(skill.execution, 'inline')
assert.deepEqual(skill.allowedTools, [
  'parse_battle_report',
  'inspect_report_evidence',
  'propose_event_plan',
  'accept_event_plan',
])
assert.match(skill.instructions, /EventUnit/)
```

In `agent/test/event-plan-flow.test.ts`:

1. Parse the fixture once to obtain a real `documentId` and at least five real evidence IDs.
2. Register the fixture in `AttachmentRegistry`.
3. Construct `FakeModelAdapter` responses that call, in order:
   - `skill` with `generate-battle-replay`;
   - `parse_battle_report` with the registered file ID;
   - `inspect_report_evidence` with `limit: 20`;
   - `propose_event_plan` with five EventUnits referencing the real evidence IDs;
   - a natural Chinese answer saying the draft is ready for review.
4. Run `IseAgentHost` with a ToolRegistry containing the Skill tool plus document and EventPlan tools.
5. Assert one active `ise.event-plan-draft/v1` artifact exists, it contains five EventUnits, and no accepted artifact exists.

Change the `agent/package.json` test script to:

```json
"test": "tsx --test test/runtime.test.ts test/contracts.test.ts test/document-parser.test.ts test/document-tools.test.ts test/event-plan-tools.test.ts test/skill.test.ts test/event-plan-flow.test.ts"
```

- [ ] **Step 2: Run tests to verify failure**

```powershell
npx tsx --test agent/test/skill.test.ts agent/test/event-plan-flow.test.ts
```

Expected: FAIL because the Skill files do not exist.

- [ ] **Step 3: Write the Skill frontmatter and instructions**

Create `agent/skills/generate-battle-replay/SKILL.md`:

```markdown
---
name: generate-battle-replay
description: Convert a same-domain battle-review document into an evidence-linked EventPlan for geographic scene generation.
when-to-use: Use when the user uploads or references an air-combat review report and asks to extract, revise, or prepare replay events.
allowed-tools:
  - parse_battle_report
  - inspect_report_evidence
  - propose_event_plan
  - accept_event_plan
user-invocable: true
model-invocable: true
execution: inline
version: 1.0.0
---

# Battle Replay Event Planning

Read the document through `parse_battle_report`. Inspect bounded evidence before selecting events.

Build 5 to 10 EventUnits when the document supports them. Each EventUnit must describe one complete world-state change, not a camera shot or editor command.

Use `evidenceRefs` for explicit source facts. Use `inferenceRefs` plus `uncertainties` when an interpretation is necessary. Never convert unverified counts, dialogue, equipment damage, hits, or victory claims into facts.

Submit the complete draft through `propose_event_plan`. Do not call `accept_event_plan` until the user has reviewed the exact draft version and fingerprint.

Keep preparation, engagement, withdrawal, and summary content proportional to the user's target duration. Omit repetitive background and record the omitted evidence IDs.
```

Create `references/evidence-policy.md` with four sections and exact examples:

- Explicit fact: quote and sourceRef from the report.
- Deterministic derivation: a normalization such as relative ordering, with source refs.
- Model inference: an interpretation explicitly marked uncertain.
- Illustrative expression: a non-factual route or camera choice that must never appear as a report fact.

Include the current SRT mistakes as negative examples: invented pilot dialogue, `XX` quantities, “准确命中”, “全面溃败”, and equipment naming that conflicts with registered assets.

- [ ] **Step 4: Assemble the Skill and Tool registries in the flow test**

Use:

```typescript
const loader = new SkillLoader({ projectSkillsDir: resolve('agent/skills') })
const loaded = await loader.load()
const skills = new SkillRegistry()
skills.replace(loaded.skills)
const registered = [
  ...createDocumentTools(attachments),
  ...createEventPlanTools(),
]
const tools = new ToolRegistry(registered)
tools.register(createSkillAgentTool(new SkillTool(skills), {
  availableTools: registered.map(tool => tool.name),
}))
```

Use `approve: () => 'defer'` in the host. The flow must finish with only a draft because no user acceptance has occurred.

- [ ] **Step 5: Run the entire Phase 1 verification suite**

```powershell
npm test
npm run typecheck
git diff --check
```

Expected:

- copied Skill tests: 13 pass;
- copied Agent tests: 61 pass;
- all ISE host, contract, parser, tool, Skill, and flow tests pass;
- all workspace typechecks exit 0;
- `git diff --check` has no errors.

- [ ] **Step 6: Perform the real fixture smoke test**

Add a small non-network CLI entry in `agent/src/smoke-event-plan.ts` that parses the fixture, prints JSON containing `documentId`, section count, evidence count, and warnings, and never calls a real model.

Run:

```powershell
npx tsx agent/src/smoke-event-plan.ts agent/test/fixtures/印巴边境空中对抗行动战后复盘报告.docx
```

Expected: valid JSON, non-empty `documentId`, at least six sections, at least thirty evidence records, and no stack trace.

Remove `smoke-event-plan.ts` after the smoke check; it is a temporary verification entry, not a product surface.

- [ ] **Step 7: Commit the complete Phase 1 vertical slice**

```powershell
git add agent package.json package-lock.json
git commit -m "feat: generate evidence-linked event plans"
```

## Phase 1 Completion Gate

Before moving to the RuntimePlan compiler plan, verify all of the following:

- [ ] `npm test` passes from repository root.
- [ ] `npm run typecheck` passes from repository root.
- [ ] No code or package manifest references `E:\Github\GSMS` at runtime.
- [ ] Provenance records the exact GSMS source commit.
- [ ] The supplied DOCX produces stable DocumentIR and EvidenceIR IDs.
- [ ] A FakeModel run creates a five-EventUnit draft with real evidence references.
- [ ] Unknown evidence references are rejected.
- [ ] Accepted EventPlans require exact artifact ID, version, and fingerprint.
- [ ] No RuntimePlan, bottom-player adapter, network asset search, or subagent code has been added in this phase.

## Subsequent Independent Plans

After this gate passes, create and execute these plans against the approved Phase 1 interfaces:

1. `ISE NarrativePlan And Runtime Compiler`: AssetRegistry normalization, NarrativePlan, constrained templates, deterministic scheduling, RuntimePlan validation, and canonical adapter output.
2. `ISE Bottom-System Integration`: concrete upload, Session, SSE, review UI, capability manifest, and final RuntimePlan adapter after inspecting the delivered bottom system.

Neither downstream plan may change the evidence-reference or exact EventPlan acceptance contracts without revising the approved design specification first.
