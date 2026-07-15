import type { SceneProjectConfig } from '@ise/runtime-contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentArtifactView,
  AgentEvent,
  AgentEventUnit,
  ReviewTuple
} from '@/api/agent';
import { useAgentSessionStore } from '@/stores/agentSessionStore';
import NewScript from './index';

const mocks = vi.hoisted(() => ({
  approveAgentReview: vi.fn(),
  attachAgentFile: vi.fn(),
  createAgentSession: vi.fn(),
  createScene: vi.fn(),
  navigate: vi.fn(),
  rejectAgentReview: vi.fn(),
  reviseEventPlan: vi.fn(),
  sendAgentMessage: vi.fn(),
  updateScript: vi.fn(),
  uploadFile: vi.fn(),
  useAgentSession: vi.fn()
}));

vi.mock('@/api/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/agent')>();
  return {
    ...actual,
    approveAgentReview: mocks.approveAgentReview,
    attachAgentFile: mocks.attachAgentFile,
    createAgentSession: mocks.createAgentSession,
    rejectAgentReview: mocks.rejectAgentReview,
    reviseEventPlan: mocks.reviseEventPlan,
    sendAgentMessage: mocks.sendAgentMessage
  };
});

vi.mock('@/api/file', () => ({ uploadFile: mocks.uploadFile }));
vi.mock('@/api/scene', () => ({ createScene: mocks.createScene }));
vi.mock('@/api/script', () => ({ updateScript: mocks.updateScript }));
vi.mock('@/hooks/useAgentSession', () => ({
  useAgentSession: mocks.useAgentSession
}));

vi.mock('@/components/ui/message', () => ({
  message: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn()
  }
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate
  };
});

const compiledConfig: SceneProjectConfig = {
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'document-1',
  eventPlanArtifactId: 'event-plan-1',
  runtimePlanArtifactId: 'runtime-plan-1',
  totalDurationMs: 10_000,
  entities: [],
  tracks: [
    {
      trackId: 'subtitle-track-1',
      label: '字幕轨',
      type: 'subtitle',
      visible: true,
      items: [
        {
          id: 'subtitle-1',
          eventUnitId: 'event-unit-1',
          startMs: 0,
          durationMs: 5_000,
          evidenceRefs: ['evidence-1'],
          params: {
            text: '建立攻击链',
            position: 'bottom',
            maxWidthPct: 80
          }
        }
      ]
    }
  ],
  diagnostics: []
};

const review: ReviewTuple = {
  reviewId: 'review-1',
  artifactId: 'event-plan-1',
  version: 1,
  fingerprint: `sha256:${'a'.repeat(64)}`
};

const eventUnits: AgentEventUnit[] = [
  {
    eventUnitId: 'event-unit-1',
    title: '建立攻击链',
    worldStateChange: '编队发现目标并建立跟踪',
    participants: ['aircraft-1'],
    locationRefs: ['location-1'],
    evidenceRefs: ['evidence-1'],
    inferenceRefs: [],
    uncertainties: [],
    narrativePurpose: '交代交战起点',
    importance: 'high'
  }
];

function artifact(
  artifactId: string,
  type: string,
  data: unknown
): AgentArtifactView {
  return {
    artifactId,
    type,
    version: 1,
    createdAt: '2026-07-15T00:00:00.000Z',
    createdBy: 'agent',
    superseded: false,
    data
  };
}

const eventPlanArtifact = artifact(
  'event-plan-1',
  'ise.event-plan-draft/v1',
  { eventUnits }
);

const compiledArtifact = artifact(
  'compiled-1',
  'ise.canonical-runtime-plan/v1',
  { sceneProjectConfig: compiledConfig }
);

function emitAgentEvent(event: AgentEvent) {
  act(() => {
    useAgentSessionStore.getState().applyEvent('session-1', event);
  });
}

function hydrateArtifacts(artifacts: AgentArtifactView[]) {
  act(() => {
    useAgentSessionStore.getState().replaceArtifacts('session-1', artifacts);
  });
}

function renderNewScript() {
  return render(
    <MemoryRouter initialEntries={['/new-script?projectId=script-1']}>
      <NewScript />
    </MemoryRouter>
  );
}

function setObjective(objective: string) {
  fireEvent.change(screen.getByPlaceholderText('输入你的问题...'), {
    target: { value: objective }
  });
}

async function uploadReport(objective = '生成印巴空战复盘场景') {
  setObjective(objective);
  const file = new File(['report'], 'report.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  fireEvent.change(screen.getByLabelText('导入 DOCX 报告'), {
    target: { files: [file] }
  });
  await waitFor(() => expect(mocks.sendAgentMessage).toHaveBeenCalledTimes(1));
  return file;
}

describe('NewScript real Agent flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentSessionStore.setState(useAgentSessionStore.getInitialState(), true);

    mocks.uploadFile.mockResolvedValue({
      data: {
        id: 'file-1',
        name: 'report.docx',
        fileType: 'application'
      }
    });
    mocks.createAgentSession.mockResolvedValue({
      sessionId: 'session-1',
      status: 'idle'
    });
    mocks.attachAgentFile.mockResolvedValue({
      attachmentId: 'attachment-1',
      fileId: 'file-1',
      name: 'report.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 6,
      fingerprint: `sha256:${'b'.repeat(64)}`
    });
    mocks.sendAgentMessage.mockResolvedValue({
      runId: 'run-1',
      status: 'queued'
    });
    mocks.approveAgentReview.mockResolvedValue({
      runId: 'run-2',
      status: 'queued'
    });
    mocks.reviseEventPlan.mockResolvedValue({
      artifact: eventPlanArtifact,
      review
    });
    mocks.rejectAgentReview.mockResolvedValue({
      reviewId: review.reviewId,
      status: 'rejected'
    });
    mocks.updateScript.mockResolvedValue({ data: { id: 'script-1' } });
    mocks.createScene.mockResolvedValue({
      data: {
        id: 'scene-real',
        title: '印巴复盘',
        ownerType: 'PERSON',
        type: 'PRIVATE',
        config: compiledConfig,
        userId: 'user-1',
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z'
      }
    });
  });

  it('never opens an Agent stream for an empty session id', () => {
    renderNewScript();

    expect(mocks.useAgentSession).not.toHaveBeenCalled();
  });

  it('uploads, creates, attaches, opens, and sends the objective in exact order', async () => {
    const order: string[] = [];
    const initialOpen = useAgentSessionStore.getState().open;
    useAgentSessionStore.setState({
      open: (sessionId) => {
        order.push('open');
        initialOpen(sessionId);
      }
    });
    mocks.uploadFile.mockImplementation(async () => {
      order.push('upload');
      return {
        data: { id: 'file-1', name: 'report.docx', fileType: 'application' }
      };
    });
    mocks.createAgentSession.mockImplementation(async () => {
      order.push('session');
      return { sessionId: 'session-1', status: 'idle' as const };
    });
    mocks.attachAgentFile.mockImplementation(async () => {
      order.push('attach');
      return {
        attachmentId: 'attachment-1',
        fileId: 'file-1',
        name: 'report.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 6,
        fingerprint: `sha256:${'b'.repeat(64)}`
      };
    });
    mocks.sendAgentMessage.mockImplementation(async () => {
      order.push('message');
      expect(useAgentSessionStore.getState().sessionId).toBe('session-1');
      return { runId: 'run-1', status: 'queued' as const };
    });

    renderNewScript();
    const file = await uploadReport();

    expect(order).toEqual(['upload', 'session', 'attach', 'open', 'message']);
    expect(mocks.uploadFile).toHaveBeenCalledWith(file, {
      fileType: 'application'
    });
    expect(mocks.createAgentSession).toHaveBeenCalledWith();
    expect(mocks.attachAgentFile).toHaveBeenCalledWith('session-1', {
      fileId: 'file-1'
    });
    expect(mocks.sendAgentMessage).toHaveBeenCalledWith('session-1', {
      content: expect.stringMatching(/生成印巴空战复盘场景[\s\S]*180\s*秒/)
    });
    expect(mocks.useAgentSession).toHaveBeenCalledWith('session-1');
    expect(mocks.useAgentSession).not.toHaveBeenCalledWith('');
  });

  it('calls approve, revise, and reject with exact contracts and exposes progress', async () => {
    let resolveApprove: ((value: { runId: string; status: 'queued' }) => void) | undefined;
    mocks.approveAgentReview.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApprove = resolve;
        })
    );

    renderNewScript();
    await uploadReport();
    hydrateArtifacts([eventPlanArtifact]);
    emitAgentEvent({ id: '1', type: 'review.requested', data: review });

    fireEvent.click(screen.getByRole('button', { name: '批准事件计划' }));
    expect(screen.getByRole('status')).toHaveTextContent('正在提交审核');
    expect(mocks.approveAgentReview).toHaveBeenCalledWith(
      'session-1',
      'review-1',
      {
        artifactId: 'event-plan-1',
        version: 1,
        fingerprint: review.fingerprint
      }
    );
    await act(async () => {
      resolveApprove?.({ runId: 'run-2', status: 'queued' });
    });

    fireEvent.click(screen.getByRole('button', { name: '提交修改' }));
    await waitFor(() =>
      expect(mocks.reviseEventPlan).toHaveBeenCalledWith(
        'session-1',
        'event-plan-1',
        {
          baseArtifactId: 'event-plan-1',
          eventUnits
        }
      )
    );

    fireEvent.click(screen.getByRole('button', { name: '拒绝事件计划' }));
    await waitFor(() =>
      expect(mocks.rejectAgentReview).toHaveBeenCalledWith(
        'session-1',
        'review-1',
        {
          artifactId: 'event-plan-1',
          version: 1,
          fingerprint: review.fingerprint
        }
      )
    );
  });

  it('shows review API errors without hiding the active review', async () => {
    mocks.approveAgentReview.mockRejectedValue(new Error('审核服务不可用'));

    renderNewScript();
    await uploadReport();
    hydrateArtifacts([eventPlanArtifact]);
    emitAgentEvent({ id: '1', type: 'review.requested', data: review });
    fireEvent.click(screen.getByRole('button', { name: '批准事件计划' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('审核服务不可用');
    expect(
      screen.getByRole('button', { name: '批准事件计划' })
    ).toBeInTheDocument();
  });

  it('hydrates the compiled artifact, creates a scene, and navigates to its real id', async () => {
    renderNewScript();
    await uploadReport();
    hydrateArtifacts([compiledArtifact]);
    emitAgentEvent({
      id: '1',
      type: 'run.completed',
      data: {
        runId: 'run-1',
        status: 'completed',
        runtimeArtifactId: 'compiled-1'
      }
    });
    fireEvent.change(screen.getByPlaceholderText('赤壁之战脚本项目'), {
      target: { value: '印巴复盘' }
    });

    fireEvent.click(screen.getByRole('button', { name: '转换为场景' }));
    fireEvent.click(screen.getByRole('button', { name: '确认创建场景' }));

    await waitFor(() =>
      expect(mocks.createScene).toHaveBeenCalledWith({
        title: '印巴复盘',
        config: compiledConfig
      })
    );
    expect(mocks.navigate).toHaveBeenCalledWith('/scene?projectId=scene-real');
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: '确认创建场景' })
      ).not.toBeInTheDocument()
    );
  });

  it('keeps the scene modal open and displays the API error when creation fails', async () => {
    mocks.createScene.mockRejectedValue(new Error('场景创建失败'));
    renderNewScript();
    await uploadReport();
    hydrateArtifacts([compiledArtifact]);
    emitAgentEvent({
      id: '1',
      type: 'run.completed',
      data: { runtimeArtifactId: 'compiled-1' }
    });

    fireEvent.click(screen.getByRole('button', { name: '转换为场景' }));
    fireEvent.click(screen.getByRole('button', { name: '确认创建场景' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('场景创建失败');
    expect(
      screen.getByRole('button', { name: '确认创建场景' })
    ).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('persists visible conversation and metadata-only artifact references', async () => {
    renderNewScript();
    await uploadReport('梳理可见战场态势');
    hydrateArtifacts([eventPlanArtifact, compiledArtifact]);
    emitAgentEvent({
      id: '1',
      type: 'tool.progress',
      data: {
        toolName: 'extract-events',
        summary: '已梳理关键事件',
        hiddenReasoning: '不得保存'
      }
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.updateScript).toHaveBeenCalledTimes(1));
    const [, payload] = mocks.updateScript.mock.calls[0];
    expect(payload.conversation).toEqual([
      { role: 'user', content: '梳理可见战场态势' },
      { role: 'assistant', content: '已梳理关键事件' }
    ]);
    expect(payload.conversation).not.toEqual([]);
    expect(JSON.parse(payload.config)).toEqual({
      agentSessionId: 'session-1',
      artifactIds: ['event-plan-1', 'compiled-1']
    });
    expect(payload.config).not.toContain('sceneProjectConfig');
    expect(JSON.stringify(payload.conversation)).not.toContain('不得保存');
  });
});
