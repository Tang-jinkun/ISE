# Agent Turn Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw Agent event chat log with durable, GSMS-style turns that show one collapsible activity timeline and one final answer, while allowing evidence-backed read-only questions to complete without creating a new scene artifact.

**Architecture:** Existing `runs` become the durable turn identity. Runs link their user and assistant messages and persist a `TurnOutcome`; public runtime events are sanitized and folded into UI activities. The web hydrates turns, applies live SSE deltas by `runId`, and renders activity separately from the final answer.

**Tech Stack:** TypeScript, Fastify, sql.js, React 19, Zustand, Vitest, Node test runner.

## Global Constraints

- Preserve the existing DOCX/text -> EventPlan -> review -> runtime compiler pipeline.
- Never expose prompts, tool input, model identifiers, hidden reasoning, or private chain-of-thought.
- User-visible activity is concise Simplified Chinese narration and tool status only.
- The desktop new-script page is the acceptance surface; retain existing responsive code without new mobile work.
- Do not copy GSMS SceneRepo-specific tools or Python backend code.

---

### Task 1: Durable Turn Contract

**Files:**
- Modify: `agent/src/persistence/schema.ts`
- Modify: `agent/src/persistence/database.ts`
- Modify: `agent/src/persistence/repositories.ts`
- Modify: `agent/src/api/contracts.ts`
- Modify: `agent/src/api/sessionRoutes.ts`
- Modify: `agent/src/session/sessionAgentRunner.ts`
- Test: `agent/test/persistence.test.ts`
- Test: `agent/test/session-api.test.ts`

**Interfaces:**
- Produces: `GET /sessions/:sessionId/turns -> { turns: AgentTurnView[] }`.
- Produces: each run links `userMessageId`, optional `assistantMessageId`, `kind`, and optional `outcome`.

- [ ] Add failing persistence tests for run/message/outcome linkage and turn ordering.
- [ ] Run the focused tests and confirm they fail because turn fields and APIs are absent.
- [ ] Add additive run columns and repository methods for linked messages, request kind, outcome, and session run listing.
- [ ] Add failing API tests for owned turn hydration and cross-user rejection.
- [ ] Implement the turns endpoint with public messages, status, outcome, and activities.
- [ ] Run persistence and session API tests to green.

### Task 2: Public Activity Projection

**Files:**
- Modify: `agent/src/api/contracts.ts`
- Modify: `agent/src/session/publicEventSink.ts`
- Create: `agent/src/session/turnActivities.ts`
- Modify: `agent/src/session/sessionAgentRunner.ts`
- Test: `agent/test/sse.test.ts`
- Test: `agent/test/session-api.test.ts`

**Interfaces:**
- Produces: `AgentTurnActivity` with `thinking`, `tool`, and `diagnostic` variants.
- Produces: public events `model.streaming`, `tool.completed`, `tool.failed`, and `diagnostic.created`.

- [ ] Add failing tests that consecutive model text coalesces and tool lifecycle updates one activity.
- [ ] Add failing tests that sensitive event fields never reach the public stream.
- [ ] Implement the allowlisted public event projection and activity folding.
- [ ] Include the final answer in the persisted outcome and terminal event.
- [ ] Run SSE and session API tests to green.

### Task 3: Read-Only Answer Turns

**Files:**
- Create: `agent/src/session/requestKind.ts`
- Modify: `agent/src/session/sessionAgentRunner.ts`
- Modify: `agent/src/runtime/IseAgentHost.ts`
- Test: `agent/test/agent-service-flow.test.ts`
- Test: `agent/test/session-api.test.ts`

**Interfaces:**
- Produces: `classifyRequestKind(content, hasSceneArtifacts): 'answer' | 'generate'`.
- Consumes: persisted `RunRecord.kind` from Task 1.

- [ ] Add failing tests: first request is generation; a factual question with existing scene artifacts is answer-only; mutation wording remains generation.
- [ ] Implement conservative deterministic classification and include the mode in the initial turn packet.
- [ ] Restrict answer turns to read-only inspection tools.
- [ ] Permit a successful answer turn without new artifacts; retain `RUN_OUTPUT_MISSING` for generation turns.
- [ ] Run focused Agent flow tests to green.

### Task 4: Turn-Based Web Experience

**Files:**
- Modify: `apps/web/src/api/agent.ts`
- Modify: `apps/web/src/hooks/useAgentSession.ts`
- Modify: `apps/web/src/stores/agentSessionStore.ts`
- Create: `apps/web/src/pages/newScript/agentTurns.ts`
- Create: `apps/web/src/pages/newScript/components/AgentTurn.tsx`
- Modify: `apps/web/src/pages/newScript/index.tsx`
- Remove: `apps/web/src/pages/newScript/components/ThinkingProcess.tsx`
- Test: `apps/web/src/api/agent.test.ts`
- Test: `apps/web/src/stores/agentSessionStore.test.ts`
- Create: `apps/web/src/pages/newScript/agentTurns.test.ts`
- Modify: `apps/web/src/pages/newScript/newScript.integration.test.tsx`

**Interfaces:**
- Consumes: durable turns from Task 1 and live public events from Task 2.
- Produces: one assistant Turn containing a collapsible activity panel, review UI, and separate final answer.

- [ ] Add failing API/store tests for turn hydration and live activity updates by `runId`.
- [ ] Add failing projection tests proving protocol events and artifacts do not become chat bubbles.
- [ ] Implement API types, hydration, and immutable live Turn updates.
- [ ] Implement `AgentTurn` using existing neutral/cyan visual language, expanded while running and collapsed when complete.
- [ ] Replace `activityMessages`/`visibleMessages` with user messages plus Agent turns; keep EventPlan review as its existing dedicated block.
- [ ] Run focused web tests, typecheck, and build.

### Task 5: Verification

**Files:**
- Verify only; no planned production edits.

**Interfaces:**
- Verifies all outputs from Tasks 1-4.

- [ ] Run `npm run test -w @ise/agent`.
- [ ] Run `npm run test -w @ise/web`.
- [ ] Run Agent and Web typechecks.
- [ ] Run the Web production build.
- [ ] Review `git diff --check` and the final diff for hidden reasoning or unrelated changes.

