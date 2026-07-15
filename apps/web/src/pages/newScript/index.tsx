import type { SceneProjectConfig } from '@ise/runtime-contracts';
import {
  approveAgentReview,
  attachAgentFile,
  createAgentSession,
  rejectAgentReview,
  reviseEventPlan,
  sendAgentMessage,
  type ReviewTuple,
  type RevisionRequest
} from '@/api/agent';
import { uploadFile } from '@/api/file';
import { updateScript } from '@/api/script';
import { EditorProvider } from '@/components/resource-editors';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { message } from '@/components/ui/message';
import { useAgentSession } from '@/hooks/useAgentSession';
import { cn } from '@/lib/utils';
import {
  type AgentActivity,
  useAgentSessionStore
} from '@/stores/agentSessionStore';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ChevronDown,
  Clapperboard,
  FileText,
  Info,
  Layout,
  ListTree,
  Save,
  Send,
  User,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChatContent } from './components/ChatContent';
import { DataImportButton } from './components/DataImportButton';
import { EventPlanReview } from './components/EventPlanReview';
import { NarrativePanel } from './components/NarrativePanel';
import { ParamsPanel } from './components/ParamsPanel';
import { ResourcePanel } from './components/ResourcePanel';
import { SceneModal } from './components/SceneModal';
import { ThinkingProcess } from './components/ThinkingProcess';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  time: string;
};

const DEFAULT_TARGET_DURATION_MS = 180_000;

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

const activitySummary = (activity: AgentActivity): string | null => {
  switch (activity.type) {
    case 'run.started':
      return '智能体已开始生成场景';
    case 'tool.started':
    case 'tool.progress':
      return typeof activity.data.summary === 'string'
        ? activity.data.summary
        : '正在处理报告内容';
    case 'artifact.created':
      return '已生成新的场景产物';
    case 'review.requested':
      return '事件计划等待审核';
    case 'review.resolved':
      return '事件计划审核已提交';
    case 'compile.progress':
      return typeof activity.data.message === 'string'
        ? activity.data.message
        : '正在编译场景配置';
    case 'run.completed':
      return '场景配置已生成';
    case 'run.failed':
      return '场景生成失败';
  }
  return null;
};

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
  const activities = isCurrentSession ? sessionState.activities : [];
  const artifacts = isCurrentSession ? sessionState.artifacts : {};
  const activeReview = isCurrentSession ? sessionState.activeReview : null;
  const compiledConfig = isCurrentSession
    ? sessionState.compiledConfig
    : null;

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
  const eventPlanArtifact = artifactList.find((artifact) =>
    artifact.type.includes('event-plan')
  );
  const narrativePlanArtifact = artifactList.find((artifact) =>
    artifact.type.includes('narrative-plan')
  );
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
      ...messages.map(({ role, content }) => ({ role, content })),
      ...activities.flatMap((activity) => {
        const content = activitySummary(activity);
        return content ? [{ role: 'assistant' as const, content }] : [];
      })
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

  const [activeTab, setActiveTab] = useState<
    'narrative' | 'resources' | 'params'
  >('narrative');
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [isLoadingPanel, setIsLoadingPanel] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const togglePanel = () => {
    if (isPanelVisible) {
      setIsPanelVisible(false);
      return;
    }
    setPanelError(null);
    setIsLoadingPanel(false);
    setIsPanelVisible(true);
  };

  const [density, setDensity] = useState<'compact' | 'comfortable'>(
    'comfortable'
  );
  const copySelectedSummary = async () => {
    const text = `${selectedNode.title}\n${selectedNode.summary}`;
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制节点信息');
    } catch {
      message.error('复制失败');
    }
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(50); // percentage

  // 左右分栏最小安全宽度阈值 (像素)
  const MIN_SIDEBAR_PX = 650; // 确保左侧文字、图标与按钮不挤压

  // 计算初始安全宽度并监听窗口 resize
  useEffect(() => {
    const updateInitialWidth = () => {
      const windowWidth = window.innerWidth;
      // 计算左侧所需的最小百分比
      const minWidthPercent = (MIN_SIDEBAR_PX / windowWidth) * 100;
      // 初始分配：取 20% 与最小百分比的较大值，但不超过 35% (防止挤占右侧)
      setSidebarWidth(Math.min(35, Math.max(20, minWidthPercent)));
    };

    updateInitialWidth();
    window.addEventListener('resize', updateInitialWidth);
    return () => window.removeEventListener('resize', updateInitialWidth);
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSceneModalOpen, setIsSceneModalOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const activityMessages = useMemo<ChatMessage[]>(
    () =>
      activities.flatMap((activity) => {
        const content = activitySummary(activity);
        return content
          ? [
              {
                id: `agent-event-${activity.id}`,
                role: 'assistant' as const,
                content,
                time: nowText()
              }
            ]
          : [];
      }),
    [activities]
  );
  const visibleMessages = useMemo(
    () => [...messages, ...activityMessages],
    [activityMessages, messages]
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages.length]);

  const appendUserMessage = (content: string) => {
    setMessages((current) => [
      ...current,
      { id: uid('m'), role: 'user', content, time: nowText() }
    ]);
  };

  const startGeneration = async (file: File) => {
    const objective = input.trim();
    if (!objective || sending) {
      if (!objective) message.error('请先输入场景生成目标');
      return;
    }

    setSending(true);
    setOperationError(null);
    appendUserMessage(objective);
    setInput('');
    try {
      const uploaded = await uploadFile(file, { fileType: 'application' });
      const session = await createAgentSession();
      await attachAgentFile(session.sessionId, { fileId: uploaded.data.id });
      useAgentSessionStore.getState().open(session.sessionId);
      setAgentSessionId(session.sessionId);
      await sendAgentMessage(session.sessionId, {
        content: buildGenerationObjective(objective)
      });
    } catch (error) {
      const content = errorText(error, '智能体接口调用失败');
      setOperationError(content);
      message.error(content);
    } finally {
      setSending(false);
    }
  };

  const send = async (overrideContent?: string) => {
    const text =
      typeof overrideContent === 'string' ? overrideContent : input.trim();
    if (!text || sending) return;
    if (!agentSessionId) {
      message.error('请先导入 DOCX 报告');
      return;
    }

    setSending(true);
    setOperationError(null);
    setInput('');
    appendUserMessage(text);

    try {
      await sendAgentMessage(agentSessionId, { content: text });
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
    });

  const updateCompiledDraft = (config: SceneProjectConfig) => {
    if (useAgentSessionStore.getState().sessionId !== agentSessionId) return;
    useAgentSessionStore.setState({ compiledConfig: config });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const windowWidth = window.innerWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = ((moveEvent.clientX - startX) / windowWidth) * 100;
      // 计算左侧最小百分比，确保内容不挤压
      const minWidthPercent = (MIN_SIDEBAR_PX / windowWidth) * 100;
      // 设置最大宽度限制为 45% (防止挤占右侧解析区)
      const newWidth = Math.min(
        45,
        Math.max(minWidthPercent, startWidth + deltaX)
      );
      setSidebarWidth(newWidth);
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
      <div className="flex-none px-4 sm:px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background text-foreground transition-colors hover:bg-accent"
            >
              <Layout className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background text-foreground transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-cyan-600 dark:text-cyan-300" />
                <input
                  type="text"
                  value={editableTitle}
                  onChange={(e) => setEditableTitle(e.target.value)}
                  placeholder="赤壁之战脚本项目"
                  className="bg-transparent border-none text-lg font-semibold text-foreground placeholder:text-muted-foreground outline-none focus:ring-0 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
                void handleSave();
              }}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground transition-colors hover:bg-accent"
            >
              <Save className="h-3.5 w-3.5" />
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSceneModalOpen(true);
              }}
              disabled={!compiledConfig}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-700 dark:text-cyan-200 transition-colors hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              转换为场景
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-0 px-4 py-4 overflow-hidden relative">
        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <div
              className="w-[280px] h-full bg-card border-r border-border p-4 animate-in slide-in-from-left duration-300"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="font-bold">信息架构</div>
                <button onClick={() => setSidebarOpen(false)}>
                  <ChevronDown className="h-4 w-4 rotate-90" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="p-3 bg-accent rounded-xl">快速导航</div>
                <div className="p-3 bg-accent rounded-xl">过滤面板</div>
                <div className="p-3 bg-accent rounded-xl">折叠树</div>
              </div>
            </div>
          </div>
        )}

        {/* Desktop Sidebar */}
        <div
          style={{ width: `${sidebarWidth}%` }}
          className="hidden md:flex flex-col shrink-0"
        >
          <div
            className={cn(
              'h-full flex flex-col rounded-2xl border border-border bg-card overflow-hidden',
              density === 'compact' ? 'gap-2 p-2' : 'gap-4 p-4'
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Bot className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                智能问答
              </div>
              <DataImportButton onImport={startGeneration} isLoading={sending} />
            </div>

            {/* Chat Messages Area */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4 thin-scrollbar border border-border rounded-xl bg-background/50">
              {visibleMessages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'flex gap-3',
                    m.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {m.role === 'assistant' && (
                    <div className="h-8 w-8 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                      <Bot className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl border px-3 py-2.5 shadow-sm',
                      m.role === 'user'
                        ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-950 dark:text-cyan-50'
                        : 'border-border bg-muted/50 text-foreground'
                    )}
                  >
                    {m.thinking && <ThinkingProcess content={m.thinking} />}
                    {m.role === 'assistant' && !m.content && !m.thinking ? (
                      <div className="flex items-center gap-1.5 h-6 px-1">
                        <div className="w-1.5 h-1.5 bg-cyan-500/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-1.5 h-1.5 bg-cyan-500/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-1.5 h-1.5 bg-cyan-500/60 rounded-full animate-bounce" />
                      </div>
                    ) : (
                      <ChatContent content={m.content} />
                    )}
                    <div
                      className={cn(
                        'mt-1.5 text-[10px] flex items-center justify-between',
                        m.role === 'user'
                          ? 'text-cyan-900 dark:text-cyan-100/70'
                          : 'text-muted-foreground'
                      )}
                    >
                      <span>{m.time}</span>
                    </div>
                  </div>
                  {m.role === 'user' && (
                    <div className="h-8 w-8 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                      <User className="h-4 w-4 text-foreground" />
                    </div>
                  )}
                </div>
              ))}
              {operationError && (
                <p role="alert" className="text-xs text-destructive">
                  {operationError}
                </p>
              )}
              {activeReview && activeReviewArtifact && (
                <fieldset disabled={reviewLoading} className="space-y-2">
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
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            <div className="flex-none pt-3">
              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder="输入你的问题..."
                    className="min-h-[40px] max-h-32 w-full resize-none rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-cyan-500/40"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending || !input.trim()}
                  className={cn(
                    'inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors',
                    sending || !input.trim()
                      ? 'border-border bg-muted text-muted-foreground'
                      : 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/15'
                  )}
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[
                  {
                    icon: ListTree,
                    label: '生成大纲',
                    color: 'text-blue-500 bg-blue-500/10'
                  },
                  {
                    icon: Clapperboard,
                    label: '细化场景',
                    color: 'text-purple-500 bg-purple-500/10'
                  }
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => void send(item.label)}
                    disabled={sending}
                    className="group flex items-center gap-2.5 rounded-xl border border-border bg-card/50 px-3 py-2.5 text-left text-xs transition-all hover:border-cyan-500/30 hover:bg-accent"
                  >
                    <div
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                        item.color
                      )}
                    >
                      <item.icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Resizer Handle */}
        <div
          className="hidden md:block w-1 hover:bg-cyan-500/40 cursor-col-resize transition-colors mx-1"
          onMouseDown={handleMouseDown}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {/* 右侧解析面板 */}
          <div className="h-full flex flex-col rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex-none px-4 py-3 border-b border-border flex items-center justify-between bg-card shadow-sm">
              <button
                onClick={togglePanel}
                className={cn(
                  'flex items-center gap-2 text-sm font-black transition-all duration-300 px-3 py-1.5 rounded-xl border',
                  isPanelVisible
                    ? 'border-red-500/20 bg-red-500/10 text-red-600 hover:bg-red-500/15'
                    : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/15'
                )}
              >
                {isPanelVisible ? (
                  <>
                    <X className="h-4 w-4" />
                    收起解析
                  </>
                ) : (
                  <>
                    <Bot className="h-4 w-4" />
                    解析结果
                  </>
                )}
              </button>

              {isPanelVisible && (
                <div
                  className="flex items-center gap-2"
                  role="tablist"
                  onKeyDown={(e) => {
                    const tabs = ['narrative', 'resources', 'params'];
                    const currentIndex = tabs.indexOf(activeTab);
                    let nextIndex = -1;

                    if (e.key === 'ArrowRight') {
                      nextIndex = (currentIndex + 1) % tabs.length;
                    } else if (e.key === 'ArrowLeft') {
                      nextIndex =
                        (currentIndex - 1 + tabs.length) % tabs.length;
                    }

                    if (nextIndex !== -1) {
                      e.preventDefault();
                      setActiveTab(tabs[nextIndex] as any);
                      // Focus the new tab button
                      const nextTabButton = (
                        e.currentTarget as HTMLElement
                      ).querySelector(`[data-tab-id="${tabs[nextIndex]}"]`);
                      (nextTabButton as HTMLElement)?.focus();
                    }
                  }}
                >
                  {['narrative', 'resources', 'params'].map((tab) => (
                    <button
                      key={tab}
                      id={`tab-${tab}`}
                      role="tab"
                      aria-selected={activeTab === tab}
                      aria-controls={`panel-${tab}`}
                      data-tab-id={tab}
                      onClick={() => setActiveTab(tab as any)}
                      className={cn(
                        'relative px-4 py-2 text-xs font-bold rounded-xl transition-all duration-200 ease-in-out',
                        'focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2',
                        activeTab === tab
                          ? 'bg-cyan-500 text-white shadow-md'
                          : 'text-muted-foreground hover:bg-muted/50'
                      )}
                    >
                      {tab === 'narrative'
                        ? '叙事规划'
                        : tab === 'resources'
                          ? '资源匹配'
                          : '参数解算'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 thin-scrollbar relative">
              {isLoadingPanel && (
                <div className="space-y-4 animate-pulse">
                  <div className="h-8 bg-muted rounded-xl w-3/4" />
                  <div className="h-32 bg-muted rounded-2xl w-full" />
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded-lg w-full" />
                    <div className="h-4 bg-muted rounded-lg w-5/6" />
                    <div className="h-4 bg-muted rounded-lg w-4/6" />
                  </div>
                  <div className="h-40 bg-muted rounded-2xl w-full" />
                </div>
              )}

              {panelError && !isLoadingPanel && (
                <div className="flex flex-col items-center justify-center h-full space-y-4 text-center">
                  <div className="p-4 rounded-full bg-red-500/10 text-red-500">
                    <Info className="h-8 w-8" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {panelError}
                  </p>
                  <button
                    onClick={togglePanel}
                    className="px-4 py-2 text-xs font-bold bg-cyan-500 text-white rounded-xl hover:bg-cyan-600 transition-colors"
                  >
                    重试加载
                  </button>
                </div>
              )}

              {isPanelVisible && !isLoadingPanel && !panelError && (
                <div className="transition-opacity duration-200 ease-in-out">
                  {activeTab === 'narrative' && (
                    <NarrativePanel
                      selectedNode={selectedNode}
                      nowText={nowText}
                      onCopy={copySelectedSummary}
                      eventPlan={eventPlanArtifact}
                      narrativePlan={narrativePlanArtifact}
                    />
                  )}
                  {activeTab === 'resources' && (
                    <ResourcePanel
                      sceneConfig={compiledConfig}
                      diagnostics={sessionState.diagnostics}
                    />
                  )}
                  {activeTab === 'params' && (
                    <ParamsPanel
                      sceneConfig={compiledConfig}
                      onUpdate={updateCompiledDraft}
                    />
                  )}
                </div>
              )}

              {!isPanelVisible && !isLoadingPanel && !panelError && (
                <div className="flex flex-col items-center justify-center h-full opacity-30 select-none grayscale">
                  <Bot className="h-16 w-16 mb-4 text-cyan-500" />
                  <p className="text-sm font-bold tracking-tight">
                    点击“解析结果”开始数据分析
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <SceneModal
        isOpen={isSceneModalOpen}
        onClose={() => setIsSceneModalOpen(false)}
        title={editableTitle.trim() || '未命名场景'}
        config={compiledConfig}
      />
    </div>
  );
}
