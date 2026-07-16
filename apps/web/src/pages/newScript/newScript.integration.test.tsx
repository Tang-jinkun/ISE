import type { SceneProjectConfig } from '@ise/runtime-contracts';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
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
  runtimePlanArtifactId: 'compiled-1',
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

const acceptedEventPlanArtifact = {
  ...eventPlanArtifact,
  type: 'ise.event-plan-accepted/v1'
};

const runtimePlan = {
  schemaVersion: 'canonical-runtime-plan/v1',
  eventPlanArtifactId: 'event-plan-1'
};

const compiledArtifact = artifact(
  'compiled-1',
  'ise.canonical-runtime-plan/v1',
  {
    runtimePlan,
    sceneProjectConfig: compiledConfig
  }
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
  fireEvent.change(screen.getByPlaceholderText('描述你想生成的场景...'), {
    target: { value: objective }
  });
}

function selectReport() {
  const file = new File(['report'], 'report.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  fireEvent.change(
    screen.getByLabelText('添加 DOCX 附件', { selector: 'input' }),
    { target: { files: [file] } }
  );
  return file;
}

async function uploadReport(objective = '生成印巴空战复盘场景') {
  setObjective(objective);
  const file = selectReport();
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
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

  it('keeps the project id when returning to the legacy workspace', () => {
    renderNewScript();

    fireEvent.click(screen.getByRole('button', { name: '退回旧版' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/script?projectId=script-1');
  });

  it('uses the full conversation surface before any artifact exists', () => {
    renderNewScript();

    expect(
      screen.queryByRole('complementary', { name: '场景工作台' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('解析结果')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '生成大纲' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '细化场景' })
    ).not.toBeInTheDocument();
  });

  it('opens EventPlan review in the scene workspace when the artifact arrives', async () => {
    renderNewScript();
    await uploadReport();
    hydrateArtifacts([eventPlanArtifact]);
    emitAgentEvent({ id: '1', type: 'review.requested', data: review });

    const workspace = screen.getByRole('complementary', {
      name: '场景工作台'
    });
    expect(
      within(workspace).getByRole('tab', { name: '事件计划' })
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      within(workspace).getByRole('button', { name: '批准事件计划' })
    ).toBeInTheDocument();
  });

  it('keeps a selected DOCX pending until send, then uploads, attaches, and clears it', async () => {
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
    setObjective('生成印巴空战复盘场景');
    const file = selectReport();

    expect(screen.getByText('report.docx')).toBeInTheDocument();
    expect(screen.getByText('6 B')).toBeInTheDocument();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
    expect(mocks.attachAgentFile).not.toHaveBeenCalled();
    expect(mocks.sendAgentMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(mocks.sendAgentMessage).toHaveBeenCalledTimes(1));

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
    expect(screen.queryByText('report.docx')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('描述你想生成的场景...')).toHaveValue('');
  });

  it('starts a new Agent session from text without requiring a DOCX', async () => {
    const order: string[] = [];
    const initialOpen = useAgentSessionStore.getState().open;
    useAgentSessionStore.setState({
      open: (sessionId) => {
        order.push('open');
        initialOpen(sessionId);
      }
    });
    mocks.createAgentSession.mockImplementation(async () => {
      order.push('session');
      return { sessionId: 'session-1', status: 'idle' as const };
    });
    mocks.sendAgentMessage.mockImplementation(async () => {
      order.push('message');
      return { runId: 'run-1', status: 'queued' as const };
    });

    renderNewScript();
    setObjective('直接根据文字生成港口态势场景');
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => expect(mocks.sendAgentMessage).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['session', 'open', 'message']);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.attachAgentFile).not.toHaveBeenCalled();
    expect(mocks.sendAgentMessage).toHaveBeenCalledWith('session-1', {
      content: expect.stringMatching(/直接根据文字生成港口态势场景[\s\S]*180\s*秒/)
    });
  });

  it('starts a new Agent session from a DOCX without requiring prompt text', async () => {
    renderNewScript();
    const file = selectReport();

    const sendButton = screen.getByRole('button', { name: '发送消息' });
    expect(sendButton).toBeEnabled();
    fireEvent.click(sendButton);

    await waitFor(() => expect(mocks.sendAgentMessage).toHaveBeenCalledTimes(1));
    expect(mocks.uploadFile).toHaveBeenCalledWith(file, {
      fileType: 'application'
    });
    expect(mocks.attachAgentFile).toHaveBeenCalledWith('session-1', {
      fileId: 'file-1'
    });
    expect(mocks.sendAgentMessage).toHaveBeenCalledWith('session-1', {
      content: expect.stringMatching(
        /请解析附件并生成可审核、可播放的场景。[\s\S]*180\s*秒/
      )
    });
  });

  it('renders one durable Agent turn with collapsed activity and a separate final answer', async () => {
    renderNewScript();
    setObjective('生成港口态势场景');
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(mocks.sendAgentMessage).toHaveBeenCalledTimes(1));

    act(() => {
      useAgentSessionStore.getState().replaceTurns('session-1', [{
        id: 'run-1',
        status: 'completed',
        kind: 'generate',
        userMessage: {
          id: 'user-1', role: 'user', content: '生成港口态势场景',
          createdAt: '2026-07-16T00:00:00.000Z'
        },
        assistantMessage: {
          id: 'assistant-1', role: 'assistant', content: '事件计划已生成，请审核。',
          createdAt: '2026-07-16T00:00:01.000Z'
        },
        outcome: { status: 'completed', finalAnswer: '事件计划已生成，请审核。' },
        activities: [
          {
            id: 'thinking-1', type: 'thinking', status: 'completed',
            text: '我先检查当前报告中的证据。'
          },
          {
            id: 'tool-1', type: 'tool', status: 'completed',
            name: 'inspect_report_evidence', summary: '报告证据检查完成'
          }
        ],
        createdAt: '2026-07-16T00:00:00.000Z'
      }]);
    });

    expect(screen.getAllByText('生成港口态势场景')).toHaveLength(1);
    expect(screen.getByText('事件计划已生成，请审核。')).toBeInTheDocument();
    const activityToggle = screen.getByRole('button', { name: /执行过程.*2 步/ });
    expect(screen.queryByText('报告证据检查完成')).not.toBeInTheDocument();
    fireEvent.click(activityToggle);
    expect(screen.getByText('报告证据检查完成')).toBeInTheDocument();
    expect(screen.queryByText('智能体已开始生成场景')).not.toBeInTheDocument();
  });

  it('retains text and the pending DOCX when sending fails', async () => {
    mocks.sendAgentMessage.mockRejectedValueOnce(new Error('智能体暂时不可用'));

    renderNewScript();
    setObjective('生成失败后可以重试');
    selectReport();
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('智能体暂时不可用');
    expect(screen.getByPlaceholderText('描述你想生成的场景...')).toHaveValue(
      '生成失败后可以重试'
    );
    expect(screen.getByText('report.docx')).toBeInTheDocument();

    mocks.sendAgentMessage.mockResolvedValueOnce({
      runId: 'run-retry',
      status: 'queued'
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(mocks.sendAgentMessage).toHaveBeenCalledTimes(2));
    expect(mocks.sendAgentMessage).toHaveBeenLastCalledWith('session-1', {
      content: expect.stringMatching(/生成失败后可以重试[\s\S]*180\s*秒/)
    });
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

    const rejectButton = screen.getByRole('button', { name: '拒绝事件计划' });
    await waitFor(() => expect(rejectButton).toBeEnabled());
    fireEvent.click(rejectButton);
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

  it('does not enable scene conversion when a compiled artifact is hydrated before completion', async () => {
    renderNewScript();
    await uploadReport();
    hydrateArtifacts([compiledArtifact]);

    expect(screen.getByRole('button', { name: '转换为场景' })).toBeDisabled();
    expect(mocks.createScene).not.toHaveBeenCalled();
  });

  it('does not enable scene conversion when a failed run retains a compiled artifact', async () => {
    renderNewScript();
    await uploadReport();
    hydrateArtifacts([compiledArtifact]);
    emitAgentEvent({
      id: '1',
      type: 'run.failed',
      data: {
        runId: 'run-1',
        status: 'failed',
        diagnostics: [
          {
            code: 'GLB_VIDEO_ASSET_FAILED',
            severity: 'error',
            recoverable: false,
            message: 'Critical GLB/video asset preparation failed'
          }
        ]
      }
    });

    expect(useAgentSessionStore.getState().compiledConfig).toEqual(compiledConfig);
    expect(screen.getByRole('button', { name: '转换为场景' })).toBeDisabled();
    expect(mocks.createScene).not.toHaveBeenCalled();
  });

  it('enables exact artifact exports after correlated completion', async () => {
    renderNewScript();
    await uploadReport();
    hydrateArtifacts([acceptedEventPlanArtifact, compiledArtifact]);
    emitAgentEvent({
      id: '1',
      type: 'run.completed',
      data: { runtimeArtifactId: 'compiled-1' }
    });

    expect(screen.getByRole('button', { name: 'EventPlan' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'RuntimePlan' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'SceneProject' })).toBeEnabled();
  });

  it('adopts the review tuple returned by revision before the next action', async () => {
    const revisedReview: ReviewTuple = {
      reviewId: 'review-2',
      artifactId: 'event-plan-2',
      version: 2,
      fingerprint: `sha256:${'c'.repeat(64)}`
    };
    const revisedArtifact: AgentArtifactView = {
      ...eventPlanArtifact,
      artifactId: 'event-plan-2',
      version: 2
    };
    mocks.reviseEventPlan.mockResolvedValue({
      artifact: revisedArtifact,
      review: revisedReview
    });

    renderNewScript();
    await uploadReport();
    hydrateArtifacts([eventPlanArtifact]);
    emitAgentEvent({ id: '1', type: 'review.requested', data: review });

    fireEvent.click(screen.getByRole('button', { name: '提交修改' }));
    await waitFor(() =>
      expect(useAgentSessionStore.getState().activeReview).toEqual(revisedReview)
    );
    fireEvent.click(screen.getByRole('button', { name: '批准事件计划' }));

    await waitFor(() =>
      expect(mocks.approveAgentReview).toHaveBeenLastCalledWith(
        'session-1',
        'review-2',
        {
          artifactId: 'event-plan-2',
          version: 2,
          fingerprint: revisedReview.fingerprint
        }
      )
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
    act(() => {
      useAgentSessionStore.getState().replaceTurns('session-1', [{
        id: 'run-1',
        status: 'completed',
        kind: 'generate',
        userMessage: {
          id: 'user-1', role: 'user', content: '梳理可见战场态势',
          createdAt: '2026-07-16T00:00:00.000Z'
        },
        assistantMessage: {
          id: 'assistant-1', role: 'assistant', content: '已梳理关键事件',
          createdAt: '2026-07-16T00:00:01.000Z'
        },
        outcome: { status: 'completed', finalAnswer: '已梳理关键事件' },
        activities: [{
          id: 'tool-1', type: 'tool', status: 'completed',
          name: 'extract-events', summary: '内部工具进度'
        }],
        createdAt: '2026-07-16T00:00:00.000Z'
      }]);
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
