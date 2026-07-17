import type { SceneProjectConfig } from '@ise/runtime-contracts';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentArtifactView,
  AgentEvent,
  AgentEventUnit,
  PublicModelConfig,
  ReviewTuple
} from '@/api/agent';
import { useAgentSessionStore } from '@/stores/agentSessionStore';
import NewScript from './index';

const mocks = vi.hoisted(() => ({
  approveAgentReview: vi.fn(),
  attachAgentFile: vi.fn(),
  clearModelConfig: vi.fn(),
  createAgentSession: vi.fn(),
  createScene: vi.fn(),
  getScript: vi.fn(),
  getModelConfig: vi.fn(),
  navigate: vi.fn(),
  projectId: 'script-1',
  rejectAgentReview: vi.fn(),
  reviseEventPlan: vi.fn(),
  saveModelConfig: vi.fn(),
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
    clearModelConfig: mocks.clearModelConfig,
    createAgentSession: mocks.createAgentSession,
    getModelConfig: mocks.getModelConfig,
    rejectAgentReview: mocks.rejectAgentReview,
    reviseEventPlan: mocks.reviseEventPlan,
    saveModelConfig: mocks.saveModelConfig,
    sendAgentMessage: mocks.sendAgentMessage
  };
});

vi.mock('@/api/file', () => ({ uploadFile: mocks.uploadFile }));
vi.mock('@/api/scene', () => ({ createScene: mocks.createScene }));
vi.mock('@/api/script', () => ({
  getScript: mocks.getScript,
  updateScript: mocks.updateScript
}));
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
    useNavigate: () => mocks.navigate,
    useSearchParams: () => [
      new URLSearchParams({ projectId: mocks.projectId }),
      vi.fn()
    ]
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

const configuredModel: PublicModelConfig = {
  configured: true,
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  hasApiKey: true
};

const emptyModel: PublicModelConfig = {
  configured: false,
  provider: null,
  baseUrl: null,
  model: null,
  hasApiKey: false
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

const sceneArtifactFingerprint = `sha256:${'d'.repeat(64)}`;

const sceneBlueprintArtifact = artifact(
  'blueprint-1',
  'ise.scene-blueprint/v1',
  {
    schemaVersion: 'ise.scene-blueprint/v1',
    blueprintId: 'blueprint:1',
    sourceNarrationPlanId: 'narration:1',
    sourceNarrationFingerprint: sceneArtifactFingerprint,
    actorGroups: [
      {
        groupId: 'group:india-su30-adampur',
        semanticEntityRef: '苏-30MKI',
        side: 'india',
        locationRef: 'location:adampur',
        platformType: 'fighter',
        role: 'fighter-formation',
        quantityDecision: {
          value: 2,
          constraint: 'exact',
          source: 'evidence',
          evidenceRefs: ['evidence:su30'],
          reason: 'Explicit quantity adjacent to entity'
        },
        formationPattern: 'finger-four',
        leaderPolicy: 'stable-first-member',
        behaviorProfile: 'fighter-formation/v1',
        lifecycle: 'scene-persistent'
      }
    ],
    sceneBeats: [
      {
        sceneBeatId: 'scene-beat:1',
        subtitleId: 'subtitle:1',
        eventUnitId: 'event:1',
        purpose: '建立双方初始态势',
        actorRefs: ['group:india-su30-adampur'],
        behaviorIntents: ['formation_departure'],
        spatialConstraints: ['depart-from:adampur'],
        stateTransitions: ['grounded->airborne'],
        cameraIntent: 'group-frame',
        mediaIntents: [],
        requiredFacts: ['evidence:su30'],
        forbiddenClaims: [],
        fidelity: 'evidence',
        priority: 'high'
      }
    ],
    diagnostics: []
  }
);

const resolvedScenePlanArtifact = artifact(
  'resolved-1',
  'ise.resolved-scene-plan/v1',
  {
    schemaVersion: 'ise.resolved-scene-plan/v1',
    resolvedScenePlanId: 'resolved-scene-plan:1',
    sourceBlueprintId: 'blueprint:1',
    sourceBlueprintFingerprint: sceneArtifactFingerprint,
    trajectoryCatalogFingerprint: sceneArtifactFingerprint,
    scenarioMappingFingerprint: sceneArtifactFingerprint,
    resolvedActors: [
      {
        actorInstanceId: 'actor:india-su30-adampur:leader',
        actorGroupRef: 'group:india-su30-adampur',
        role: 'leader',
        ordinal: 0
      }
    ],
    resolvedLocations: ['location:adampur'],
    resolvedAssets: [
      'model:su30mki',
      'trajectory:adampur-su30-1'
    ],
    resolvedFormationBundles: [
      {
        bundleId: 'formation:india-su30-adampur',
        actorGroupRef: 'group:india-su30-adampur',
        routeAssetRefs: ['trajectory:adampur-su30-1'],
        recommendedActorCount: 1,
        role: 'fighter-formation',
        side: 'india',
        semanticTags: ['su30mki'],
        scenarioBindings: ['indo-pak/v1'],
        mappingAuthority: 'scenario_config',
        diagnostics: []
      }
    ],
    actorRouteAssignments: [
      {
        actorInstanceRef: 'actor:india-su30-adampur:leader',
        formationBundleRef: 'formation:india-su30-adampur',
        trajectoryAssetRef: 'trajectory:adampur-su30-1',
        segmentId: 'segment:india-su30:departure',
        resamplePolicy: 'preserve-source-samples',
        timeMapping: {
          mode: 'fit-window',
          startMs: 800,
          durationMs: 12_000
        },
        spatialPathMode: 'preserve',
        sourceKind: 'catalog',
        matchReason: 'Exact scenario alias and location match',
        lineage: [
          'catalog:indo-pak/v1',
          'formation:india-su30-adampur'
        ]
      }
    ],
    fallbackTrajectoryRecipes: [],
    resolvedBehaviors: ['fighter-formation/v1'],
    resolvedMedia: ['media:satellite-overlay'],
    fallbackDecisions: [],
    diagnostics: []
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
  await sendWhenReady();
  await waitFor(() => expect(mocks.sendAgentMessage).toHaveBeenCalledTimes(1));
  return file;
}

function renderNewScriptStrict() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/new-script?projectId=script-1']}>
        <NewScript />
      </MemoryRouter>
    </StrictMode>
  );
}

async function sendWhenReady() {
  const sendButton = screen.getByRole('button', { name: '发送消息' });
  await waitFor(() => expect(sendButton).toBeEnabled());
  fireEvent.click(sendButton);
}

describe('NewScript real Agent flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectId = 'script-1';
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
    mocks.getModelConfig.mockResolvedValue(configuredModel);
    mocks.getScript.mockResolvedValue({
      data: {
        id: 'script-1',
        title: '已保存脚本',
        config: '{}',
        conversation: []
      }
    });
    mocks.saveModelConfig.mockResolvedValue(configuredModel);
    mocks.clearModelConfig.mockResolvedValue(emptyModel);
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

  it('sends normally after the StrictMode effect setup cycle', async () => {
    renderNewScriptStrict();
    setObjective('StrictMode generation');
    await sendWhenReady();

    await waitFor(() => expect(mocks.sendAgentMessage).toHaveBeenCalledTimes(1));
    expect(mocks.sendAgentMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ content: expect.stringContaining('StrictMode generation') })
    );
  });

  it('reopens the Agent session persisted with the script project', async () => {
    mocks.getScript.mockResolvedValueOnce({
      data: {
        id: 'script-1',
        title: '印巴空战复盘',
        config: JSON.stringify({
          agentSessionId: 'session-restored',
          artifactIds: ['event-plan-1', 'compiled-1']
        }),
        conversation: [
          { role: 'user', content: '生成印巴空战复盘' },
          { role: 'assistant', content: '场景已经生成。' }
        ]
      }
    });

    renderNewScript();

    await waitFor(() => {
      expect(mocks.getScript).toHaveBeenCalledWith('script-1');
      expect(mocks.useAgentSession).toHaveBeenCalledWith('session-restored');
    });
    expect(screen.getByDisplayValue('印巴空战复盘')).toBeInTheDocument();
  });

  it('persists a newly created Agent session before the user leaves the project', async () => {
    renderNewScript();

    await uploadReport();

    await waitFor(() => {
      expect(mocks.updateScript).toHaveBeenCalledWith('script-1', {
        config: JSON.stringify({
          agentSessionId: 'session-1',
          artifactIds: []
        })
      });
    });
  });

  it('blocks generation until the current project identity has loaded', async () => {
    let resolveProject!: (value: unknown) => void;
    mocks.getScript.mockReturnValueOnce(new Promise((resolve) => {
      resolveProject = resolve;
    }));
    renderNewScript();

    setObjective('生成场景');
    selectReport();

    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
    expect(mocks.updateScript).not.toHaveBeenCalled();

    resolveProject({
      data: { id: 'script-1', title: '脚本一', config: '{}', conversation: [] }
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled();
    });
  });

  it('keeps generation blocked when project restore fails and exposes retry', async () => {
    mocks.getScript.mockRejectedValueOnce(new Error('加载失败'));
    renderNewScript();

    expect(await screen.findByRole('alert')).toHaveTextContent('加载脚本项目失败');
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重试加载项目' })).toBeInTheDocument();
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
    expect(mocks.updateScript).not.toHaveBeenCalled();
  });

  it('clears the previous Agent binding when projectId changes', async () => {
    mocks.getScript.mockResolvedValueOnce({
      data: {
        id: 'script-1', title: '脚本一',
        config: JSON.stringify({ agentSessionId: 'session-old' }),
        conversation: []
      }
    });
    const view = renderNewScript();
    await waitFor(() => {
      expect(mocks.useAgentSession).toHaveBeenCalledWith('session-old');
    });

    let resolveNext!: (value: unknown) => void;
    mocks.getScript.mockReturnValueOnce(new Promise((resolve) => {
      resolveNext = resolve;
    }));
    mocks.projectId = 'script-2';
    view.rerender(
      <MemoryRouter initialEntries={['/new-script?projectId=script-2']}>
        <NewScript />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mocks.getScript).toHaveBeenCalledWith('script-2');
      expect(useAgentSessionStore.getState().sessionId).toBeNull();
    });
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();

    resolveNext({
      data: { id: 'script-2', title: '脚本二', config: '{}', conversation: [] }
    });
  });

  it('abandons an in-flight send when switching to another project', async () => {
    mocks.getScript.mockResolvedValueOnce({
      data: { id: 'script-1', title: '脚本一', config: '{}', conversation: [] }
    });
    let resolveSession!: (value: { sessionId: string; status: 'idle' }) => void;
    mocks.createAgentSession.mockReturnValueOnce(new Promise((resolve) => {
      resolveSession = resolve;
    }));
    const view = renderNewScript();
    setObjective('P1 生成请求');
    selectReport();
    await sendWhenReady();
    await waitFor(() => expect(mocks.createAgentSession).toHaveBeenCalledTimes(1));

    mocks.getScript.mockResolvedValueOnce({
      data: {
        id: 'script-2', title: '脚本二',
        config: JSON.stringify({ agentSessionId: 'session-p2' }),
        conversation: []
      }
    });
    mocks.projectId = 'script-2';
    view.rerender(
      <MemoryRouter initialEntries={['/new-script?projectId=script-2']}>
        <NewScript />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(mocks.useAgentSession).toHaveBeenCalledWith('session-p2');
      expect(useAgentSessionStore.getState().sessionId).toBe('session-p2');
    });

    resolveSession({ sessionId: 'session-p1', status: 'idle' });
    await act(async () => Promise.resolve());

    expect(useAgentSessionStore.getState().sessionId).toBe('session-p2');
    expect(mocks.updateScript).not.toHaveBeenCalledWith(
      'script-1',
      expect.objectContaining({ config: expect.stringContaining('session-p1') })
    );
    expect(mocks.sendAgentMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('report.docx')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('描述你想生成的场景...')).toHaveValue('');
  });

  it('keeps the project id when returning to the legacy workspace', () => {
    renderNewScript();

    fireEvent.click(screen.getByRole('button', { name: '返回旧版' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/script?projectId=script-1');
  });

  it('loads, edits, and clears the redacted model status from the header', async () => {
    renderNewScript();

    const modelButton = await screen.findByRole('button', {
      name: 'DeepSeek · deepseek-chat'
    });
    expect(mocks.getModelConfig).toHaveBeenCalledTimes(1);

    fireEvent.click(modelButton);
    expect(
      screen.getByRole('dialog', { name: '模型配置' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'transient-secret' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(mocks.saveModelConfig).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('transient-secret')).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    fireEvent.click(
      screen.getByRole('button', { name: 'DeepSeek · deepseek-chat' })
    );
    fireEvent.click(screen.getByRole('button', { name: '清除配置' }));

    await waitFor(() => expect(mocks.clearModelConfig).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(
      screen.getByRole('button', { name: '配置模型' })
    ).toBeInTheDocument();
  });

  it('shows a distinct warning when model configuration status cannot load', async () => {
    mocks.getModelConfig.mockRejectedValueOnce(new Error('认证服务不可用'));

    renderNewScript();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '模型配置状态加载失败'
    );
    expect(
      screen.getByRole('button', { name: '模型状态异常' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '配置模型' })
    ).not.toBeInTheDocument();
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

  it('forces a newly pending EventPlan review over an existing Preview tab', async () => {
    renderNewScript();
    await uploadReport();
    hydrateArtifacts([compiledArtifact]);
    emitAgentEvent({
      id: '1',
      type: 'run.completed',
      data: { runtimeArtifactId: 'compiled-1' }
    });

    const workspace = screen.getByRole('complementary', {
      name: '场景工作台'
    });
    await waitFor(() =>
      expect(within(workspace).getByRole('tab', { name: '预览' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );

    hydrateArtifacts([compiledArtifact, eventPlanArtifact]);
    emitAgentEvent({ id: '2', type: 'review.requested', data: review });

    await waitFor(() =>
      expect(
        within(workspace).getByRole('tab', { name: '事件计划' })
      ).toHaveAttribute('aria-selected', 'true')
    );
  });

  it('renders actual resolved scene artifacts across all pre-runtime workspace tabs', async () => {
    renderNewScript();
    await uploadReport();
    hydrateArtifacts([sceneBlueprintArtifact, resolvedScenePlanArtifact]);

    const workspace = screen.getByRole('complementary', {
      name: '场景工作台'
    });
    expect(
      within(workspace).getByRole('tab', { name: '场景蓝图' })
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      within(workspace).getByText('actor:india-su30-adampur:leader')
    ).toBeInTheDocument();

    fireEvent.click(within(workspace).getByRole('tab', { name: '资源' }));
    expect(within(workspace).getByText('model:su30mki')).toBeInTheDocument();
    expect(
      within(workspace).getByText('trajectory:adampur-su30-1')
    ).toBeInTheDocument();

    fireEvent.click(within(workspace).getByRole('tab', { name: '参数' }));
    expect(
      within(workspace).getByText('fighter-formation/v1')
    ).toBeInTheDocument();
    expect(
      within(workspace).getByText('actor:india-su30-adampur:leader')
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

    await sendWhenReady();
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
    await sendWhenReady();

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

    await sendWhenReady();

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
    await sendWhenReady();
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
    await sendWhenReady();

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
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
    expect(mocks.attachAgentFile).toHaveBeenCalledTimes(1);
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
    fireEvent.change(screen.getByPlaceholderText('未命名脚本项目'), {
      target: { value: '印巴复盘' }
    });

    fireEvent.click(screen.getByRole('button', { name: '预览' }));
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

    expect(screen.getByRole('button', { name: '预览' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: '预览' })).toBeDisabled();
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

    fireEvent.click(screen.getByRole('button', { name: '预览' }));
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

    await waitFor(() => expect(mocks.updateScript).toHaveBeenCalledTimes(2));
    const [, payload] = mocks.updateScript.mock.calls.at(-1)!;
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
