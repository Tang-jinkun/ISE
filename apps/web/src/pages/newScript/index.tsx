import type { SceneProjectConfig } from '@ise/runtime-contracts';
import {
  approveAgentReview,
  attachAgentFile,
  createAgentSession,
  getModelConfig,
  rejectAgentReview,
  reviseEventPlan,
  sendAgentMessage,
  type PublicModelConfig,
  type ReviewTuple,
  type RevisionRequest
} from '@/api/agent';
import { uploadFile } from '@/api/file';
import { updateScript } from '@/api/script';
import { EditorProvider } from '@/components/resource-editors';
import { message } from '@/components/ui/message';
import { useAgentSession } from '@/hooks/useAgentSession';
import { cn } from '@/lib/utils';
import { useAgentSessionStore } from '@/stores/agentSessionStore';
import {
  ArrowRight,
  Bot,
  User
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { selectArtifactExports } from './artifactExports';
import { AgentTurn } from './components/AgentTurn';
import { ChatComposer } from './components/ChatComposer';
import { EventPlanReview } from './components/EventPlanReview';
import { ModelConfigDialog } from './components/ModelConfigDialog';
import { NarrativePanel } from './components/NarrativePanel';
import { NewScriptHeader } from './components/NewScriptHeader';
import { ParamsPanel } from './components/ParamsPanel';
import { ResourcePanel } from './components/ResourcePanel';
import { SceneModal } from './components/SceneModal';
import { SceneWorkspace } from './components/SceneWorkspace';
import { modelProvider } from './modelProviders';
import {
  selectWorkspaceState,
  type WorkspaceTab
} from './workspaceStage';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  runId?: string;
  time: string;
};

function UserMessageBubble({ content, time }: { content: string; time: string }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[85%] rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2.5 text-cyan-950 shadow-sm dark:text-cyan-50">
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
        <div className="mt-1.5 text-[10px] text-cyan-900 dark:text-cyan-100/70">{time}</div>
      </div>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
        <User className="h-4 w-4 text-foreground" />
      </div>
    </div>
  );
}

function messageTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const DEFAULT_TARGET_DURATION_MS = 180_000;

const EMPTY_MODEL_CONFIG: PublicModelConfig = {
  configured: false,
  provider: null,
  baseUrl: null,
  model: null,
  hasApiKey: false
};

const buildGenerationObjective = (
  objective: string,
  targetDurationMs = DEFAULT_TARGET_DURATION_MS
) =>
  `${objective.trim()}\n\n目标演示时长：${Math.round(targetDurationMs / 1000)} 秒。`;

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const reviewBody = ({
  artifactId,
  version,
  fingerprint
}: ReviewTuple) => ({ artifactId, version, fingerprint });

function AgentSessionBridge({ sessionId }: { sessionId: string }) {
  useAgentSession(sessionId);
  return null;
}

function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

function nowText(addMinutes = 0) {
  const now = new Date();
  now.setMinutes(now.getMinutes() + addMinutes);
  return `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

const ResourceEditorAdapter = ({
  resource,
  onUpdate
}: {
  resource: Resource;
  onUpdate: (id: string, updates: Partial<ResourceProperties>) => void;
}) => {
  console.log('ResourceEditorAdapter props:', resource.id, !!onUpdate);
  return (
    <EditorProvider value={{ embedded: true }}>
      <div className="p-4 text-xs text-muted-foreground">
        资源属性编辑 (适配器) - {resource.name}
      </div>
    </EditorProvider>
  );
};

type ScriptNode = {
  id: string;
  title: string;
  summary: string;
  children?: ScriptNode[];
  type?: 'default' | 'subtitle';
  originalData?: any;
};

export type ResourceType = 'image' | 'video' | 'audio' | 'geojson';

export type ResourceProperties = {
  // Visual (Image/Video)
  opacity?: number;
  scale?: number;
  brightness?: number;
  contrast?: number;

  // Audio
  volume?: number;
  speed?: number;
  fadeInTime?: number;
  fadeOutTime?: number;
  muted?: boolean;
  loop?: boolean;

  // GeoJSON / Symbol / Line / Fill
  textSize?: number;
  textColor?: string;
  textOpacity?: number;
  lineColor?: string;
  lineWidth?: number;
  fillColor?: string;
  fillOpacity?: number;

  // Common
  startTime?: number;
  endTime?: number;
};

export type Resource = {
  id: string;
  name: string;
  type: ResourceType;
  url?: string;
  relatedEntity?: string;
  properties?: ResourceProperties;
  config?: any;
};

type NormandyData = {
  query: string;
  introduction: string;
  outlineItems: Array<{
    title: string;
    descriptions: Array<{ title: string; summary?: string; mini_scene: any[] }>;
  }>;
  subtitles: {
    title: string;
    subtitle: string;
    core_content?: string;
    time_range: number | [number, number];
    entities?: Record<string, string[]>;
    resources?: Resource[];
    relation?: {
      entity: string;
      path_type: string;
      instance_property?: Record<string, any>;
    }[];
  }[];
};

export default function Script() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId') || '';
  const [agentSessionId, setAgentSessionId] = useState('');
  const sessionState = useAgentSessionStore();
  const isCurrentSession = sessionState.sessionId === agentSessionId;
  const turns = isCurrentSession ? sessionState.turns : [];
  const artifacts = isCurrentSession ? sessionState.artifacts : {};
  const activeReview = isCurrentSession ? sessionState.activeReview : null;
  const compiledConfig = isCurrentSession
    ? sessionState.compiledConfig
    : null;
  const completedRuntimeArtifactId = isCurrentSession
    ? sessionState.latestCompletedRuntimeArtifactId
    : null;
  const completedRuntimeArtifact = completedRuntimeArtifactId
    ? artifacts[completedRuntimeArtifactId]
    : undefined;
  const completedSceneConfig =
    sessionState.status === 'completed' &&
    completedRuntimeArtifact?.type === 'ise.canonical-runtime-plan/v1'
      ? compiledConfig
      : null;
  const artifactExports = isCurrentSession
    ? selectArtifactExports(sessionState)
    : {};

  const [saving, setSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('n-root');
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);
  const [isAddResourceOpen, setIsAddResourceOpen] = useState(false);
  const [newResource, setNewResource] = useState<Partial<Resource>>({
    name: '',
    type: 'image',
    url: ''
  });

  const handleAddResource = () => {
    if (!newResource.name || !newResource.type) {
      message.error('请填写必要信息');
      return;
    }

    // Mock ID generation
    const id = `r-${Date.now()}`;
    const resource: Resource = {
      id,
      name: newResource.name,
      type: newResource.type as ResourceType,
      url: newResource.url || '',
      properties: {}
    };

    // Update node data (Mock implementation as we don't have a direct setter for deep state here)
    // In a real scenario, this should trigger a state update for 'nodes' or call an API.
    // For now, we update the selectedNode.originalData which is a reference if it comes from state.
    if (!selectedNode.originalData.resources) {
      selectedNode.originalData.resources = [];
    }
    selectedNode.originalData.resources.push(resource);

    // Force re-render (hacky but works for mock)
    setNormandyData({ ...normandyData });

    message.success('资源添加成功');
    setIsAddResourceOpen(false);
    setNewResource({ name: '', type: 'image', url: '' });
  };

  const [editableTitle, setEditableTitle] = useState('');
  const [modelConfig, setModelConfig] = useState<PublicModelConfig>(
    EMPTY_MODEL_CONFIG
  );
  const [modelConfigOpen, setModelConfigOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void getModelConfig()
      .then((config) => {
        if (active) setModelConfig(config);
      })
      .catch(() => {
        if (active) setModelConfig(EMPTY_MODEL_CONFIG);
      });
    return () => {
      active = false;
    };
  }, []);

  const [normandyData, setNormandyData] = useState<NormandyData>({
    query: '',
    introduction: '',
    outlineItems: [],
    subtitles: []
  });

  const updateResourceProperty = (
    resourceId: string,
    updates: Partial<ResourceProperties>
  ) => {
    setNormandyData((prev) => {
      const newData = { ...prev };
      newData.subtitles = newData.subtitles.map((sub) => {
        if (!sub.resources) return sub;
        const resourceIndex = sub.resources.findIndex(
          (r) => r.id === resourceId
        );
        if (resourceIndex === -1) return sub;

        const newResources = [...sub.resources];
        newResources[resourceIndex] = {
          ...newResources[resourceIndex],
          properties: {
            ...newResources[resourceIndex].properties,
            ...updates
          }
        };
        return { ...sub, resources: newResources };
      });
      return newData;
    });
  };

  const removeResource = (resourceId: string) => {
    setNormandyData((prev) => {
      const newData = { ...prev };
      newData.subtitles = newData.subtitles.map((sub) => {
        if (!sub.resources) return sub;
        return {
          ...sub,
          resources: sub.resources.filter((r) => r.id !== resourceId)
        };
      });
      return newData;
    });
  };

  const updateNodeData = (nodeId: string, newData: any) => {
    setNormandyData((prev) => {
      const next = { ...prev };
      if (nodeId.startsWith('n-timeline-')) {
        const index = parseInt(nodeId.split('-')[2]);
        if (next.subtitles[index]) {
          next.subtitles[index] = { ...next.subtitles[index], ...newData };
        }
      } else if (nodeId.startsWith('n-outline-')) {
        const parts = nodeId.split('-');
        if (parts.length === 4) {
          const i = parseInt(parts[2]);
          const j = parseInt(parts[3]);
          if (next.outlineItems[i]?.descriptions[j]) {
            next.outlineItems[i].descriptions[j] = {
              ...next.outlineItems[i].descriptions[j],
              ...newData
            };
          }
        }
      }
      return next;
    });
  };

  const buildNodesFromData = (data: NormandyData): ScriptNode[] => {
    const outlines = data.outlineItems || [];
    const outlineChildren: ScriptNode[] = outlines.map((o, i) => ({
      id: `n-outline-${i}`,
      title: o.title,
      summary: o.descriptions.map((d) => d.title).join('；'),
      children: o.descriptions.map((d, j) => ({
        id: `n-outline-${i}-${j}`,
        title: d.title,
        summary: d.summary || '',
        originalData: d
      }))
    }));

    const timelineChildren: ScriptNode[] = (data.subtitles || []).map(
      (s, i) => ({
        id: `n-timeline-${i}`,
        title: s.subtitle || s.core_content || '未命名片段',
        summary: `${s.title}${s.core_content && s.subtitle ? `\n${s.core_content}` : ''}（${s.time_range}）`,
        type: 'subtitle',
        originalData: s
      })
    );

    return [
      {
        id: 'n-root',
        title: data.query,
        summary: data.introduction,
        children: [
          {
            id: 'n-outline',
            title: '提要与结构',
            summary: '按提要分解的结构层级',
            children: outlineChildren
          },
          {
            id: 'n-timeline',
            title: '片段时间轴',
            summary: '关键片段与时间范围',
            children: timelineChildren
          }
        ]
      }
    ];
  };

  const nodes = useMemo<ScriptNode[]>(
    () => buildNodesFromData(normandyData),
    [normandyData]
  );

  const nodeIndex = useMemo(() => {
    const map = new Map<string, ScriptNode>();
    const walk = (arr: ScriptNode[]) => {
      for (const n of arr) {
        map.set(n.id, n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(nodes);
    return map;
  }, [nodes]);

  const selectedNode = nodeIndex.get(selectedNodeId) ?? nodes[0];
  const artifactList = Object.values(artifacts);
  const workspaceState = useMemo(
    () =>
      selectWorkspaceState({
        artifacts: artifactList,
        activeReview,
        latestTurnStatus: turns.at(-1)?.status,
        completedRuntimeArtifactId
      }),
    [activeReview, artifacts, completedRuntimeArtifactId, turns]
  );
  const eventPlanArtifact = workspaceState.eventPlan;
  const narrativePlanArtifact = workspaceState.narration;
  const activeReviewArtifact = activeReview
    ? artifacts[activeReview.artifactId]
    : undefined;

  useEffect(() => {
    setSelectedNodeId('n-root');
  }, []);

  const handleSave = async () => {
    if (!projectId) {
      message.error('缺少项目 ID，无法保存脚本');
      return;
    }
    if (saving) return;
    const conversation = [
      ...turns.flatMap((turn) => [
        ...(turn.userMessage
          ? [{ role: 'user' as const, content: turn.userMessage.content }]
          : []),
        ...(turn.assistantMessage?.content
          ? [{ role: 'assistant' as const, content: turn.assistantMessage.content }]
          : [])
      ]),
      ...messages
        .filter((item) => !item.runId || !turns.some((turn) => turn.id === item.runId))
        .map(({ role, content }) => ({ role, content }))
    ].filter(({ content }) => content.trim().length > 0);
    if (!agentSessionId || conversation.length === 0) {
      message.error('请先导入报告并生成可保存的对话');
      return;
    }
    try {
      setSaving(true);
      const title = editableTitle.trim();
      await updateScript(projectId, {
        title: title || undefined,
        conversation,
        config: JSON.stringify({
          agentSessionId,
          artifactIds: Object.keys(artifacts)
        })
      });
      message.success('已保存');
    } catch (err) {
      console.error(err);
      message.error('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const [activeTab, setActiveTab] = useState<WorkspaceTab | null>(null);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState(42);
  const hadWorkspaceRef = useRef(false);

  useEffect(() => {
    if (!workspaceState.visible) {
      setActiveTab(null);
    } else if (
      !activeTab ||
      !workspaceState.availableTabs.includes(activeTab)
    ) {
      setActiveTab(workspaceState.defaultTab);
    }
  }, [activeTab, workspaceState]);

  useEffect(() => {
    if (workspaceState.visible && !hadWorkspaceRef.current) {
      setWorkspaceCollapsed(false);
    }
    hadWorkspaceRef.current = workspaceState.visible;
  }, [workspaceState.visible]);

  const copySelectedSummary = async () => {
    const text = `${selectedNode.title}\n${selectedNode.summary}`;
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制节点信息');
    } catch {
      message.error('复制失败');
    }
  };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSceneModalOpen, setIsSceneModalOpen] = useState(false);
  const [input, setInput] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const [hasSentInitialMessage, setHasSentInitialMessage] = useState(false);
  const [sending, setSending] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const pendingMessages = useMemo(
    () => messages.filter((item) => !item.runId || !turns.some((turn) => turn.id === item.runId)),
    [messages, turns]
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [pendingMessages.length, turns.length]);

  const appendUserMessage = (content: string, runId: string) => {
    setMessages((current) => [
      ...current,
      { id: uid('m'), role: 'user', content, runId, time: nowText() }
    ]);
  };

  const send = async (overrideContent?: string) => {
    const text =
      typeof overrideContent === 'string' ? overrideContent : input.trim();
    const attachment = pendingAttachment;
    if ((!text && !attachment) || sending) return;
    const objective = text || '请解析附件并生成可审核、可播放的场景。';

    setSending(true);
    setOperationError(null);

    try {
      const uploaded = attachment
        ? await uploadFile(attachment, { fileType: 'application' })
        : null;
      const needsSession = !agentSessionId;
      const sessionId = needsSession
        ? (await createAgentSession()).sessionId
        : agentSessionId;

      if (uploaded) {
        await attachAgentFile(sessionId, { fileId: uploaded.data.id });
      }
      if (needsSession) {
        useAgentSessionStore.getState().open(sessionId);
        setAgentSessionId(sessionId);
      }
      const queued = await sendAgentMessage(sessionId, {
        content: hasSentInitialMessage
          ? objective
          : buildGenerationObjective(objective)
      });
      setHasSentInitialMessage(true);
      appendUserMessage(text || `附件：${attachment!.name}`, queued.runId);
      setInput('');
      setPendingAttachment(null);
    } catch (error) {
      const content = errorText(error, '智能体接口调用失败');
      setOperationError(content);
      message.error(content);
    } finally {
      setSending(false);
    }
  };

  const runReviewAction = async (action: () => Promise<unknown>) => {
    if (reviewLoading) return;
    setReviewLoading(true);
    setReviewError(null);
    try {
      await action();
    } catch (error) {
      setReviewError(errorText(error, '审核操作失败，请稍后重试'));
    } finally {
      setReviewLoading(false);
    }
  };

  const approveReview = (nextReview: ReviewTuple) =>
    runReviewAction(() =>
      approveAgentReview(
        agentSessionId,
        nextReview.reviewId,
        reviewBody(nextReview)
      )
    );

  const rejectReview = (nextReview: ReviewTuple) =>
    runReviewAction(() =>
      rejectAgentReview(
        agentSessionId,
        nextReview.reviewId,
        reviewBody(nextReview)
      )
    );

  const reviseReview = (revision: RevisionRequest) =>
    runReviewAction(async () => {
      const response = await reviseEventPlan(
        agentSessionId,
        revision.baseArtifactId,
        revision
      );
      useAgentSessionStore
        .getState()
        .ingestArtifacts(agentSessionId, [response.artifact]);
      useAgentSessionStore
        .getState()
        .setActiveReview(agentSessionId, response.review);
    });

  const updateCompiledDraft = (config: SceneProjectConfig) => {
    if (useAgentSessionStore.getState().sessionId !== agentSessionId) return;
    useAgentSessionStore.setState({ compiledConfig: config });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = workspaceWidth;
    const windowWidth = window.innerWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = ((startX - moveEvent.clientX) / windowWidth) * 100;
      setWorkspaceWidth(Math.min(58, Math.max(34, startWidth + deltaX)));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {agentSessionId ? (
        <AgentSessionBridge sessionId={agentSessionId} />
      ) : null}
      <NewScriptHeader
        title={editableTitle}
        onTitleChange={setEditableTitle}
        onBack={() => navigate(-1)}
        onOpenLegacy={() =>
          navigate(
            projectId
              ? `/script?projectId=${encodeURIComponent(projectId)}`
              : '/script'
          )
        }
        onConfigureModel={() => setModelConfigOpen(true)}
        modelLabel={
          modelConfig.configured && modelConfig.provider && modelConfig.model
            ? `${modelProvider(modelConfig.provider).label} · ${modelConfig.model}`
            : '配置模型'
        }
        exports={artifactExports}
        saving={saving}
        onSave={() => void handleSave()}
        previewEnabled={Boolean(completedSceneConfig)}
        onPreview={() => setIsSceneModalOpen(true)}
      />
      <ModelConfigDialog
        open={modelConfigOpen}
        onOpenChange={setModelConfigOpen}
        config={modelConfig}
        onConfigChange={setModelConfig}
      />

      <div className="flex-1 min-h-0 flex gap-0 px-4 py-4 overflow-hidden relative">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-full flex-col gap-3 overflow-hidden rounded-md border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Bot className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                智能问答
              </div>
            </div>

            {/* Chat Messages Area */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4 thin-scrollbar border border-border rounded-xl bg-background/50">
              {turns.map((turn) => (
                <div key={turn.id} className="space-y-4">
                  {turn.userMessage && (
                    <UserMessageBubble
                      content={turn.userMessage.content}
                      time={messageTime(turn.userMessage.createdAt)}
                    />
                  )}
                  <AgentTurn turn={turn} />
                </div>
              ))}
              {pendingMessages.map((item) => (
                <UserMessageBubble key={item.id} content={item.content} time={item.time} />
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            <div className="flex-none pt-3">
              <ChatComposer
                value={input}
                attachment={pendingAttachment}
                disabled={sending}
                error={operationError}
                onValueChange={setInput}
                onAttachmentChange={setPendingAttachment}
                onSend={() => void send()}
              />
            </div>
          </div>
        </div>

        {workspaceState.visible && !workspaceCollapsed && (
          <div
            role="separator"
            aria-label="调整场景工作台宽度"
            aria-orientation="vertical"
            className="mx-1 hidden w-1 cursor-col-resize bg-transparent transition-colors hover:bg-cyan-500/40 md:block"
            onMouseDown={handleMouseDown}
          />
        )}

        <SceneWorkspace
          state={workspaceState}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          widthPct={workspaceWidth}
          collapsed={workspaceCollapsed}
          onCollapsedChange={setWorkspaceCollapsed}
          panels={{
            'event-plan': eventPlanArtifact ? (
              activeReview && activeReviewArtifact ? (
                <fieldset disabled={reviewLoading} className="space-y-2 p-4">
                  <EventPlanReview
                    artifact={activeReviewArtifact}
                    review={activeReview}
                    onApprove={(nextReview) => void approveReview(nextReview)}
                    onRevise={(revision) => void reviseReview(revision)}
                    onReject={(nextReview) => void rejectReview(nextReview)}
                  />
                  {reviewLoading && (
                    <p role="status" className="text-xs text-muted-foreground">
                      正在提交审核...
                    </p>
                  )}
                  {reviewError && (
                    <p role="alert" className="text-xs text-destructive">
                      {reviewError}
                    </p>
                  )}
                </fieldset>
              ) : (
                <NarrativePanel
                  selectedNode={selectedNode}
                  nowText={nowText}
                  onCopy={copySelectedSummary}
                  eventPlan={eventPlanArtifact}
                />
              )
            ) : undefined,
            narration: narrativePlanArtifact ? (
              <NarrativePanel
                selectedNode={selectedNode}
                nowText={nowText}
                onCopy={copySelectedSummary}
                eventPlan={eventPlanArtifact}
                narrativePlan={narrativePlanArtifact}
              />
            ) : undefined,
            assets: workspaceState.runtime ? (
              <ResourcePanel
                sceneConfig={compiledConfig}
                diagnostics={sessionState.diagnostics}
              />
            ) : undefined,
            params: workspaceState.runtime ? (
              <ParamsPanel
                sceneConfig={compiledConfig}
                onUpdate={updateCompiledDraft}
              />
            ) : undefined,
            preview: workspaceState.runtime ? (
              <div className="flex h-full items-center justify-center p-6">
                <button
                  type="button"
                  onClick={() => setIsSceneModalOpen(true)}
                  disabled={!completedSceneConfig}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 text-sm text-cyan-700 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-cyan-200"
                >
                  <ArrowRight className="h-4 w-4" />
                  打开场景预览
                </button>
              </div>
            ) : undefined
          }}
        />
      </div>
      <SceneModal
        isOpen={isSceneModalOpen}
        onClose={() => setIsSceneModalOpen(false)}
        title={editableTitle.trim() || '未命名场景'}
        config={completedSceneConfig}
      />
    </div>
  );
}
