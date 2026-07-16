# New Script Scene Workspace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed empty analysis panel with a conversation-first, artifact-driven scene workspace while preserving the existing Agent flow and legacy route.

**Architecture:** Keep `newScript/index.tsx` as the page orchestrator, move terminal status, composer, workspace-stage selection, header, and workspace rendering into focused components. A pure `selectWorkspaceState` compatibility layer maps current v1 artifacts and future v2 artifact names to UI stages without importing backend contracts.

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind CSS, Vitest, Testing Library, Playwright desktop-chromium.

## Global Constraints

- DOCX and plain text are independent valid scene inputs.
- Selecting an attachment performs no network request; only explicit send uploads it.
- The workspace is absent before the first inspectable artifact and opens automatically afterward.
- Failed Agent Turns must say `执行失败`, stay expanded, and never say `已完成 N 步`.
- Existing v1 artifacts remain usable; future v2 artifacts enter through one compatibility selector.
- Keep the legacy `/script?projectId=<id>` route and its header action.
- Do not add mobile-specific development or mobile Playwright coverage.
- Do not change runtime compiler contracts in this plan.

---

### Task 1: Correct Agent Turn terminal status semantics

**Files:**
- Create: `apps/web/src/pages/newScript/components/AgentTurn.test.tsx`
- Modify: `apps/web/src/pages/newScript/components/AgentTurn.tsx`

**Interfaces:**
- Consumes: `AgentTurnView` from `@/api/agent`.
- Produces: `AgentTurn` with status-specific labels and initial expansion.

- [ ] **Step 1: Write failing component tests**

Add tests that render completed and failed turns. Assert that a failed turn exposes an expanded activity region, contains `执行失败`, and does not contain `已完成`. Assert that a completed turn remains collapsed and says `已完成 2 步`.

```tsx
render(<AgentTurn turn={{ ...baseTurn, status: 'failed', activities: [failedActivity] }} />);
expect(screen.getByRole('button', { name: /执行失败/ })).toHaveAttribute('aria-expanded', 'true');
expect(screen.queryByText(/已完成/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -w @ise/web -- --run apps/web/src/pages/newScript/components/AgentTurn.test.tsx`

Expected: FAIL because the current component treats every non-running turn as completed and initializes it collapsed.

- [ ] **Step 3: Implement status-specific presentation**

Introduce helpers with exact signatures:

```ts
function isActiveStatus(status: AgentTurnView['status']): boolean;
function turnActivitySummary(turn: AgentTurnView): string;
```

Initialize expansion with `isActiveStatus(turn.status) || turn.status === 'failed'`. Use `执行中 · N 步`, `执行失败 · N 步`, `已取消 · N 步`, or `已完成 N 步` as appropriate.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 command again.

Expected: all AgentTurn component tests PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add apps/web/src/pages/newScript/components/AgentTurn.tsx apps/web/src/pages/newScript/components/AgentTurn.test.tsx
git commit -m "fix: show accurate agent turn status"
```

### Task 2: Add the artifact-to-workspace compatibility selector

**Files:**
- Create: `apps/web/src/pages/newScript/workspaceStage.ts`
- Create: `apps/web/src/pages/newScript/workspaceStage.test.ts`

**Interfaces:**
- Consumes: `AgentArtifactView[]`, `ReviewTuple | null`, latest Turn status, and completed runtime artifact ID.
- Produces: `selectWorkspaceState(input: WorkspaceStateInput): WorkspaceState`.

```ts
export type WorkspaceTab = 'event-plan' | 'narration' | 'blueprint' | 'assets' | 'params' | 'preview';

export type WorkspaceState = {
  visible: boolean;
  defaultTab: WorkspaceTab | null;
  availableTabs: WorkspaceTab[];
  eventPlan?: AgentArtifactView;
  narration?: AgentArtifactView;
  blueprint?: AgentArtifactView;
  runtime?: AgentArtifactView;
  failed: boolean;
};
```

- [ ] **Step 1: Write failing selector tests**

Cover no artifacts, v1 draft EventPlan, v1 NarrativePlan, v1 compiled runtime, v2 NarrationPlan, v2 SceneBlueprint, superseded artifacts, and a failed latest Turn.

```ts
assert.deepEqual(selectWorkspaceState(emptyInput), {
  visible: false,
  defaultTab: null,
  availableTabs: [],
  failed: false,
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -w @ise/web -- --run apps/web/src/pages/newScript/workspaceStage.test.ts`

Expected: FAIL because `workspaceStage.ts` does not exist.

- [ ] **Step 3: Implement deterministic artifact role mapping**

Use exact type-role sets in one file. Ignore superseded artifacts and choose the newest artifact by `createdAt`, then `version`.

```ts
const ROLE_TYPES = {
  eventPlan: ['ise.event-plan-draft/v1', 'ise.event-plan-accepted/v1', 'ise.event-plan/v2'],
  narration: ['ise.narrative-plan/v1', 'ise.narration-plan/v1'],
  blueprint: ['ise.scene-blueprint/v1', 'ise.resolved-scene-plan/v1'],
  runtime: ['ise.canonical-runtime-plan/v1', 'ise.scene-project-config/v2'],
} as const;
```

If the latest Turn failed, retain all available tabs and select the furthest available stage instead of hiding prior artifacts.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 2 command again.

Expected: all workspace selector tests PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add apps/web/src/pages/newScript/workspaceStage.ts apps/web/src/pages/newScript/workspaceStage.test.ts
git commit -m "feat: map agent artifacts to workspace stages"
```

### Task 3: Extract the explicit-send Chat Composer

**Files:**
- Create: `apps/web/src/pages/newScript/components/ChatComposer.tsx`
- Create: `apps/web/src/pages/newScript/components/ChatComposer.test.tsx`
- Modify: `apps/web/src/pages/newScript/index.tsx`

**Interfaces:**
- Consumes: controlled `value`, `attachment`, `disabled`, `error`, and callbacks.
- Produces: `ChatComposer(props: ChatComposerProps)`.

```ts
export type ChatComposerProps = {
  value: string;
  attachment: File | null;
  disabled: boolean;
  error?: string | null;
  onValueChange(value: string): void;
  onAttachmentChange(file: File | null): void;
  onSend(): void;
};
```

- [ ] **Step 1: Write failing composer tests**

Assert that selecting DOCX only calls `onAttachmentChange`, attachment-only enables send, remove clears it, `Enter` sends, `Shift+Enter` does not, and disabled state blocks controls.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -w @ise/web -- --run apps/web/src/pages/newScript/components/ChatComposer.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement ChatComposer with stable dimensions**

Use `DataImportButton`, `FileText`, `X`, and `Send`. Keep the editor unframed inside the conversation surface, use an attachment row inside the composer, and disable send only when both trimmed text and attachment are absent.

- [ ] **Step 4: Update page send orchestration**

Change `send()` to accept attachment-only requests. Use a neutral default objective when text is empty:

```ts
const objective = input.trim() || '请解析附件并生成可审核、可播放的场景。';
```

Keep the existing upload -> session -> attach -> store open -> message order and retain input plus attachment on any failure.

- [ ] **Step 5: Run focused and integration tests**

Run:

```powershell
npm test -w @ise/web -- --run apps/web/src/pages/newScript/components/ChatComposer.test.tsx apps/web/src/pages/newScript/newScript.integration.test.tsx
```

Expected: all tests PASS, including new attachment-only coverage.

- [ ] **Step 6: Commit Task 3**

```powershell
git add apps/web/src/pages/newScript/index.tsx apps/web/src/pages/newScript/components/ChatComposer.tsx apps/web/src/pages/newScript/components/ChatComposer.test.tsx apps/web/src/pages/newScript/newScript.integration.test.tsx
git commit -m "feat: add explicit-send chat composer"
```

### Task 4: Build the adaptive Scene Workspace

**Files:**
- Create: `apps/web/src/pages/newScript/components/SceneWorkspace.tsx`
- Create: `apps/web/src/pages/newScript/components/SceneWorkspace.test.tsx`
- Modify: `apps/web/src/pages/newScript/index.tsx`
- Modify: `apps/web/src/pages/newScript/components/NarrativePanel.tsx`

**Interfaces:**
- Consumes: `WorkspaceState`, review controls, current `SceneProjectConfig`, diagnostics, and parameter update callback.
- Produces: `SceneWorkspace` with controlled tab and width.

```ts
export type SceneWorkspaceProps = {
  state: WorkspaceState;
  activeTab: WorkspaceTab | null;
  onTabChange(tab: WorkspaceTab): void;
  widthPct: number;
  collapsed: boolean;
  onCollapsedChange(value: boolean): void;
  // Existing review, config, diagnostics, and preview props remain explicitly typed.
};
```

- [ ] **Step 1: Write failing workspace tests**

Assert the component renders no panel for `visible: false`; renders title `场景工作台`; only renders available tabs; exposes collapse; renders EventPlan review in the event tab; and marks a failed state without discarding the last artifact.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -w @ise/web -- --run apps/web/src/pages/newScript/components/SceneWorkspace.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement workspace shell and tabs**

Use a restrained header, tab row, and one content region. Do not nest page-section cards. Reuse `EventPlanReview`, `NarrativePanel`, `ResourcePanel`, and `ParamsPanel`. Hide unavailable v2 tabs instead of rendering explanatory placeholders.

- [ ] **Step 4: Remove decorative mock layouts from NarrativePanel**

Keep the chronological event/subtitle inspection view. Remove simulated loading, carousel, waterfall, grid switcher, and the duplicate import button so the panel reflects actual artifacts only.

- [ ] **Step 5: Replace fixed page split with state-driven layout**

In `index.tsx`, derive workspace state using `selectWorkspaceState`. When invisible, give the conversation pane `flex: 1`. When visible and expanded, use a resizable workspace clamped to 34-58%. Move EventPlan review from the chat stream into the workspace.

- [ ] **Step 6: Run focused and integration tests**

Run:

```powershell
npm test -w @ise/web -- --run apps/web/src/pages/newScript/components/SceneWorkspace.test.tsx apps/web/src/pages/newScript/newScript.integration.test.tsx
```

Expected: all tests PASS and no test searches for the old `解析结果` empty state.

- [ ] **Step 7: Commit Task 4**

```powershell
git add apps/web/src/pages/newScript/index.tsx apps/web/src/pages/newScript/components/SceneWorkspace.tsx apps/web/src/pages/newScript/components/SceneWorkspace.test.tsx apps/web/src/pages/newScript/components/NarrativePanel.tsx apps/web/src/pages/newScript/newScript.integration.test.tsx
git commit -m "feat: add adaptive scene workspace"
```

### Task 5: Extract the quiet New Script header

**Files:**
- Create: `apps/web/src/pages/newScript/components/NewScriptHeader.tsx`
- Create: `apps/web/src/pages/newScript/components/NewScriptHeader.test.tsx`
- Modify: `apps/web/src/pages/newScript/index.tsx`

**Interfaces:**
- Consumes: title state, save state, preview availability, export controls, legacy navigation, and a model-config trigger callback.
- Produces: `NewScriptHeader`.

- [ ] **Step 1: Write failing header tests**

Assert title editing, icon tooltips, legacy navigation callback, disabled preview, enabled preview, model configuration trigger, and save callback.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -w @ise/web -- --run apps/web/src/pages/newScript/components/NewScriptHeader.test.tsx`

Expected: FAIL because the header component does not exist.

- [ ] **Step 3: Implement and integrate NewScriptHeader**

Use icon buttons where the action is familiar, icon plus text for `返回旧版`, `保存`, and `预览`, and a compact model status button labeled `配置模型` until the model-config slice provides live status.

- [ ] **Step 4: Run focused and integration tests**

Run:

```powershell
npm test -w @ise/web -- --run apps/web/src/pages/newScript/components/NewScriptHeader.test.tsx apps/web/src/pages/newScript/newScript.integration.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 5**

```powershell
git add apps/web/src/pages/newScript/index.tsx apps/web/src/pages/newScript/components/NewScriptHeader.tsx apps/web/src/pages/newScript/components/NewScriptHeader.test.tsx
git commit -m "refactor: extract new script workspace header"
```

### Task 6: Full web verification and desktop visual acceptance

**Files:**
- Modify only if verification reveals a blocking UI defect.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a tested production build and desktop screenshots.

- [ ] **Step 1: Run the full web test suite**

Run: `npm test -w @ise/web`

Expected: zero failures.

- [ ] **Step 2: Run typecheck and production build**

Run:

```powershell
npm run typecheck -w @ise/web
npm run build -w @ise/web
```

Expected: both commands exit 0.

- [ ] **Step 3: Run desktop Playwright only**

Run: `npm run test:e2e -w @ise/web -- --project=desktop-chromium`

Expected: desktop-chromium passes; do not run mobile projects.

- [ ] **Step 4: Inspect desktop screenshots**

Verify at 1440x900 and 1920x1080 that the empty state is full-width chat, the workspace opens without overlap, the composer remains visible, tabs do not overflow, and no nested cards or empty analysis panel remain.

- [ ] **Step 5: Commit verification-only fixes if required**

```powershell
git add apps/web
git commit -m "fix: polish adaptive scene workspace"
```
