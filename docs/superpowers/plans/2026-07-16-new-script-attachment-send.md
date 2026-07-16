# New Script Attachment Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make text-only and optional-DOCX Agent messages explicit user sends, fix Session request validation, and make the new script workspace the default.

**Architecture:** Keep the Agent protocol unchanged and correct the web client to send its required empty JSON body. Store one pending `File` in the new script page, upload and attach it only inside the existing send command, and route script projects to the new workspace while preserving `/script` as a legacy fallback.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library, React Router, Fastify Agent API.

## Global Constraints

- DOCX is optional; a non-empty text objective can start a Session without a file.
- Selecting or removing a DOCX must not perform a network request.
- Only one pending DOCX is shown; a new selection replaces it.
- Failed sends retain text and attachment; successful sends clear both.
- Existing `/script` behavior and scene contracts remain unchanged.
- Do not modify unrelated scene player files already dirty in the worktree.

---

### Task 1: Correct the create-Session wire contract

**Files:**
- Modify: `apps/web/src/api/agent.test.ts`
- Modify: `apps/web/src/api/agent.ts`

**Interfaces:**
- Consumes: Agent `POST /sessions` strict empty-object request schema.
- Produces: `createAgentSession(): Promise<CreateSessionResponse>` sending JSON `{}`.

- [ ] **Step 1: Change the client test to require an empty JSON body**

```ts
it('creates an empty session with the required JSON body', async () => {
  mockJsonResponse(201, { sessionId: 'session-1', status: 'idle' });
  await createAgentSession();
  expect(fetchMock).toHaveBeenLastCalledWith(
    expect.stringMatching(/\/sessions$/),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({}),
      headers: expect.objectContaining({ 'Content-Type': 'application/json' })
    })
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test -w @ise/web -- src/api/agent.test.ts`

Expected: FAIL because `createAgentSession` has no body or Content-Type.

- [ ] **Step 3: Send the strict empty object**

```ts
export const createAgentSession = (): Promise<CreateSessionResponse> =>
  agentRequest<CreateSessionResponse>('/sessions', {
    method: 'POST',
    json: {}
  });
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm run test -w @ise/web -- src/api/agent.test.ts`

Expected: PASS.

### Task 2: Add a pending DOCX composer and text-only first send

**Files:**
- Modify: `apps/web/src/pages/newScript/newScript.integration.test.tsx`
- Modify: `apps/web/src/pages/newScript/index.tsx`
- Modify: `apps/web/src/pages/newScript/components/DataImportButton.tsx`

**Interfaces:**
- Consumes: `uploadFile`, `createAgentSession`, `attachAgentFile`, `sendAgentMessage`.
- Produces: local `pendingAttachment: File | null`; `selectAttachment(file)`; unified `send(content?)` command.

- [ ] **Step 1: Replace the auto-upload test with explicit-send tests**

Add tests that select `report.docx`, assert its name and formatted size are visible, and assert all four API mocks remain untouched. After entering an objective and clicking the `发送消息` button, assert order `upload, session, attach, open, message` and that the pending attachment disappears.

Add a separate test that enters an objective without selecting a file, clicks `发送消息`, and asserts order `session, open, message` while `uploadFile` and `attachAgentFile` remain untouched.

Add a rejected-send test that asserts the textarea value and `report.docx` remain visible after `sendAgentMessage` rejects.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `npm run test -w @ise/web -- src/pages/newScript/newScript.integration.test.tsx`

Expected: FAIL because file selection currently sends immediately and text-only first send is blocked.

- [ ] **Step 3: Implement pending attachment state and unified send flow**

Use `const [pendingAttachment, setPendingAttachment] = useState<File | null>(null)`. Change `DataImportButton` to call `setPendingAttachment` only. In `send`, create a Session when `agentSessionId` is empty; upload and attach only when `pendingAttachment` exists; open the Session before sending; clear input and attachment only after `sendAgentMessage` resolves.

The first-send sequence is:

```ts
const uploaded = pendingAttachment
  ? await uploadFile(pendingAttachment, { fileType: 'application' })
  : null;
const sessionId = agentSessionId || (await createAgentSession()).sessionId;
if (uploaded) await attachAgentFile(sessionId, { fileId: uploaded.data.id });
if (!agentSessionId) {
  useAgentSessionStore.getState().open(sessionId);
  setAgentSessionId(sessionId);
}
await sendAgentMessage(sessionId, {
  content: !agentSessionId ? buildGenerationObjective(text) : text
});
```

- [ ] **Step 4: Render the attachment UI**

Above the textarea, render a compact un-nested attachment row with `FileText`, file name, `formatFileSize(file.size)`, and an icon-only `X` button with `aria-label="移除附件"`. Add `aria-label="发送消息"` to the send button and disable composer controls while sending.

- [ ] **Step 5: Run integration tests and verify GREEN**

Run: `npm run test -w @ise/web -- src/pages/newScript/newScript.integration.test.tsx`

Expected: PASS.

### Task 3: Default scripts to the new workspace and preserve legacy fallback

**Files:**
- Create: `apps/web/src/pages/User/views/HomePage/HomePage.test.tsx`
- Modify: `apps/web/src/pages/User/views/HomePage/index.tsx`
- Modify: `apps/web/src/pages/newScript/newScript.integration.test.tsx`
- Modify: `apps/web/src/pages/newScript/index.tsx`

**Interfaces:**
- Consumes: `projectId` query parameter and React Router `navigate`.
- Produces: default `/new-script?projectId=<id>` navigation and explicit `/script?projectId=<id>` fallback.

- [ ] **Step 1: Write failing route tests**

In the HomePage test, mock project APIs and `useNavigate`; verify creating a script navigates to `/new-script?projectId=script-new`, and clicking an existing script named `Existing script` navigates directly to `/new-script?projectId=script-existing` without a version dialog.

In the new script integration test, click the `退回旧版` button and expect `navigate('/script?projectId=script-1')`.

- [ ] **Step 2: Run route tests and verify RED**

Run: `npm run test -w @ise/web -- src/pages/User/views/HomePage/HomePage.test.tsx src/pages/newScript/newScript.integration.test.tsx`

Expected: FAIL because HomePage uses the old route/version dialog and the fallback button is absent.

- [ ] **Step 3: Implement default and fallback navigation**

Remove `confirmNewScript` and its dialog. Navigate new and existing scripts directly to `/new-script`. Add a compact `退回旧版` button in the new script header that preserves the encoded `projectId` and is disabled or omitted when no ID exists.

- [ ] **Step 4: Run route tests and verify GREEN**

Run: `npm run test -w @ise/web -- src/pages/User/views/HomePage/HomePage.test.tsx src/pages/newScript/newScript.integration.test.tsx`

Expected: PASS.

### Task 4: Ground text-only sessions in a user brief

**Files:**
- Modify: `agent/test/session-api.test.ts`
- Modify: `agent/test/skill.test.ts`
- Modify: `agent/src/session/sessionAgentRunner.ts`
- Modify: `agent/skills/generate-battle-replay/SKILL.md`

**Interfaces:**
- Consumes: the first user message, Session attachments, persistent artifact ledger.
- Produces: one user-created DocumentIR and EvidenceIR when a Session has neither an attachment nor existing evidence.

- [ ] **Step 1: Write failing text-only grounding tests**

Require a zero-attachment message to persist DocumentIR/EvidenceIR containing the user text before model execution. Require the replay skill to document its no-attachment text-brief path.

- [ ] **Step 2: Run tests and verify RED**

Run: `tsx --test agent/test/session-api.test.ts agent/test/skill.test.ts`

Expected: FAIL because no brief artifacts exist and the skill always instructs DOCX parsing.

- [ ] **Step 3: Seed and document user text briefs**

Before creating the first run, create a user-authored DocumentIR and EvidenceIR only when the Session has no attachments and no active EvidenceIR. Mark the source as a user-provided, independently unverified text brief. Update the skill to inspect this evidence directly when no attachment ID is present.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `tsx --test agent/test/session-api.test.ts agent/test/skill.test.ts`

Expected: PASS.

### Task 5: Regression verification

**Files:**
- Verify only; no planned production changes.

**Interfaces:**
- Consumes: all outputs from Tasks 1-3.
- Produces: evidence that the web package remains type-correct and tested.

- [ ] **Step 1: Run focused tests**

Run: `npm run test -w @ise/web -- src/api/agent.test.ts src/pages/newScript/newScript.integration.test.tsx src/pages/User/views/HomePage/HomePage.test.tsx`

Expected: PASS with no unhandled errors.

- [ ] **Step 2: Run web typecheck**

Run: `npm run typecheck -w @ise/web`

Expected: exit code 0.

- [ ] **Step 3: Run the full web test suite**

Run: `npm run test -w @ise/web`

Expected: PASS.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check` and `git diff -- apps/web/src/api/agent.ts apps/web/src/api/agent.test.ts apps/web/src/pages/newScript apps/web/src/pages/User/views/HomePage`

Expected: no whitespace errors and no changes outside the approved scope.
