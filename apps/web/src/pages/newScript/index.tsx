import { updateScript } from '@/api/script';
import { EditorProvider } from '@/components/resource-editors';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { message } from '@/components/ui/message';
import { adaptNewToOld } from '@/lib/dataAdapter';
import { cn } from '@/lib/utils';
import type { SpatioTemporalContext } from '@/mock/types';
import { useWarDataStore } from '@/stores/warDataStore';
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
import { type EntityType } from './components/EntityHighlighter';
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

type DescriptionItem = {
  title: string;
  summary?: string;
  mini_scene: any[];
};

type OutlineItem = {
  title: string;
  descriptions: DescriptionItem[];
};

type NormandyData = {
  query: string;
  introduction: string;
  spatio_temporal_context?: SpatioTemporalContext;
  outlineItems: OutlineItem[];
  subtitles: {
    title: string;
    subtitle: string;
    core_content?: string;
    time_range: number | [number, number];
    entities?: Record<EntityType, string[]>;
    resources?: Resource[];
    relation?: {
      entity: string;
      path_type: string;
      instance_property?: Record<string, any>;
    }[];
  }[];
};

function transformChiBiToInternal(warData: any): NormandyData {
  if (!warData) {
    return {
      query: '',
      introduction: '',
      outlineItems: [],
      subtitles: []
    };
  }

  const subtitles: any[] = [];

  if (warData.outline) {
    warData.outline.forEach((outlineItem: any) => {
      if (outlineItem.descriptions) {
        outlineItem.descriptions.forEach((desc: any) => {
          if (desc.mini_scene) {
            desc.mini_scene.forEach((scene: any) => {
              const resources: Resource[] = [];
              if (scene.audio) {
                resources.push({
                  id: uid('res'),
                  type: 'audio',
                  name: scene.audio.file_id || 'Audio',
                  url: scene.audio.src,
                  properties: scene.audio
                });
              }
              if (scene.geojsons && Array.isArray(scene.geojsons)) {
                scene.geojsons.forEach((g: any) => {
                  resources.push({
                    id: uid('res'),
                    type: 'geojson',
                    name: g.id || 'GeoJSON',
                    url: g.file_path,
                    properties: g
                  });
                });
              }

              subtitles.push({
                title: desc.title,
                subtitle:
                  typeof scene.subtitle === 'string'
                    ? scene.subtitle
                    : scene.subtitle?.content || '',
                core_content: scene.core_content,
                time_range: scene.timing
                  ? [scene.timing.start / 1000, scene.timing.finish / 1000]
                  : [0, 0],
                entities: {
                  location:
                    scene.entities?.space || scene.entities?.location || [],
                  person: scene.entities?.person || [],
                  event: Array.isArray(scene.entities?.event)
                    ? scene.entities.event
                    : scene.entities?.event
                      ? [scene.entities.event]
                      : [],
                  time: Array.isArray(scene.entities?.time)
                    ? scene.entities.time
                    : scene.entities?.time
                      ? [scene.entities.time]
                      : [],
                  thing: scene.entities?.thing || []
                },
                resources: resources,
                relation: []
              });
            });
          }
        });
      }
    });
  }

  return {
    query: warData.war_name || '',
    introduction: warData.intro || '',
    spatio_temporal_context: warData.spatio_temporal_context,
    outlineItems: warData.outline || [],
    subtitles
  };
}

export default function Script() {
  const { currentData, switchMockDataset } = useWarDataStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId') || '';
  console.log(projectId); // Use it to avoid unused error if needed, but wait, it IS used below.

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

  useEffect(() => {
    if (currentData) {
      const adapted = adaptNewToOld(currentData);
      setNormandyData(transformChiBiToInternal(adapted));
      setEditableTitle(currentData.war_name);
    }
  }, [currentData]);

  useEffect(() => {
    setSelectedNodeId('n-root');
  }, []);

  const handleSave = async () => {
    if (!projectId) {
      message.error('缺少项目 ID，无法保存脚本');
      return;
    }
    if (saving) return;
    try {
      setSaving(true);
      const title = editableTitle.trim();
      await updateScript(projectId, {
        title: title || undefined,
        conversation: [] // Conversation removed in cleanup
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

  const togglePanel = async () => {
    if (isPanelVisible) {
      setIsPanelVisible(false);
      return;
    }

    setIsLoadingPanel(true);
    setPanelError(null);
    try {
      // Simulate loading analysis data
      await new Promise((resolve) => setTimeout(resolve, 800));
      setIsPanelVisible(true);
    } catch (err) {
      setPanelError('解析面板加载失败，请重试');
    } finally {
      setIsLoadingPanel(false);
    }
  };

  const [density, setDensity] = useState<'compact' | 'comfortable'>(
    'comfortable'
  );
  const [sidebarModules, setSidebarModules] = useState({
    nav: true,
    filter: false,
    tree: false
  });

  const toggleSidebarModule = (module: keyof typeof sidebarModules) => {
    setSidebarModules((prev) => ({ ...prev, [module]: !prev[module] }));
  };
  // Suppress unused warning for now as we might re-enable modules later
  console.log(toggleSidebarModule);

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

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: uid('m'),
      role: 'assistant',
      content: '你好，请问有什么可以帮您？',
      time: nowText()
    }
    // {
    //   id: uid('m'),
    //   role: 'user',
    //   content:
    //     '请你帮我总结归纳《诺曼底登陆战役》场景脚本相关信息，要包含战役介绍、生命周期、OOB等完整的信息，最后给出完整的战役场景信息配置结构',
    //   time: nowText(5)
    // },
    // {
    //   id: uid('m'),
    //   role: 'assistant',
    //   content: '',
    //   time: nowText(7)
    // }
  ]);

  useEffect(() => {
    if (currentData) {
      setMessages((prev) => {
        const newMessages = [...prev];
        // 查找最后一个助手消息，但排除掉第一条欢迎语（index 0）
        const lastAssistantMsgIdx = newMessages.findLastIndex(
          (m, idx) => m.role === 'assistant' && idx > 0
        );
        if (lastAssistantMsgIdx !== -1) {
          const adaptedData = adaptNewToOld(currentData);
          newMessages[lastAssistantMsgIdx] = {
            ...newMessages[lastAssistantMsgIdx],
            content: JSON.stringify(adaptedData)
          };
        }
        return newMessages;
      });
    }
  }, [currentData]);
  const [isSceneModalOpen, setIsSceneModalOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async (overrideContent?: string) => {
    const text =
      typeof overrideContent === 'string' ? overrideContent : input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput('');

    const userMessage: ChatMessage = {
      id: uid('m'),
      role: 'user',
      content: text,
      time: nowText()
    };

    const assistantId = uid('m');
    const startTime = nowText();

    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        thinking: '正在分析用户意图...',
        time: startTime
      }
    ]);

    try {
      // Mock thinking process
      const thinkingSteps = [
        '正在检索相关历史剧本...',
        '正在构建时空上下文...',
        '正在生成战役数据结构...',
        '校验数据完整性...'
      ];

      for (const step of thinkingSteps) {
        await new Promise((resolve) => setTimeout(resolve, 5500));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, thinking: (m.thinking || '') + '\n' + step }
              : m
          )
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Always return mock data as requested
      // 如果没有 currentData，则返回一段说明文字，而不是空 JSON
      const mockResponse = currentData
        ? JSON.stringify(adaptNewToOld(currentData))
        : '抱歉，当前暂无解析数据。您可以尝试提问有关战役的问题。';

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: mockResponse } : m
        )
      );
    } catch (err) {
      console.error(err);
      message.error('智能体接口调用失败');
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: '调用智能体失败，请稍后重试。'
              }
            : m
        )
      );
    } finally {
      setSending(false);
    }
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
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-700 dark:text-cyan-200 transition-colors hover:bg-cyan-500/15"
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
              <DataImportButton />
            </div>

            {/* Chat Messages Area */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4 thin-scrollbar border border-border rounded-xl bg-background/50">
              {messages.map((m, index) => (
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
                    ) : index === 0 ? (
                      <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                        {m.content}
                      </div>
                    ) : (
                      <ChatContent
                        content={m.content}
                        onParse={() => {
                          if (currentData) {
                            const adapted = adaptNewToOld(currentData);
                            setNormandyData(transformChiBiToInternal(adapted));
                            setSelectedNodeId('n-root');
                            setActiveTab('narrative');
                            message.success('解析成功');
                            // 触发右侧解析面板展示
                            if (!isPanelVisible) {
                              void togglePanel();
                            }
                          }
                        }}
                      />
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
                    />
                  )}
                  {activeTab === 'resources' && (
                    <ResourcePanel
                      selectedNode={selectedNode}
                      isAddResourceOpen={isAddResourceOpen}
                      setIsAddResourceOpen={setIsAddResourceOpen}
                      newResource={newResource}
                      setNewResource={setNewResource}
                      handleAddResource={handleAddResource}
                      updateResourceProperty={updateResourceProperty}
                      removeResource={removeResource}
                      setPreviewResource={setPreviewResource}
                      previewResource={previewResource}
                      ResourceEditorAdapter={ResourceEditorAdapter}
                    />
                  )}
                  {activeTab === 'params' && (
                    <ParamsPanel
                      onUpdate={updateNodeData}
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
      />
    </div>
  );
}
