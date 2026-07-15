import { getScript, updateScript } from '@/api/script';
import { PreAudio } from '@/components/common/preview/PreAudio';
import { PreImage } from '@/components/common/preview/PreImage';
import { PreMap } from '@/components/common/preview/PreMap';
import { PreVideo } from '@/components/common/preview/PreVideo';
import {
  AudioDetail,
  EditorProvider,
  GeojsonDetail,
  PictureDetail,
  VideoDetail
} from '@/components/resource-editors';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown';
import { message } from '@/components/ui/message';
import { cn } from '@/lib/utils';
import chiBiWar from '@/mock/ChiBi_War';
import type { SpatioTemporalContext } from '@/mock/types';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Copy,
  Eye,
  FileText,
  Folder,
  Image as ImageIcon,
  Info,
  Layers,
  ListTree,
  Loader2,
  MapPin,
  PanelRight,
  Pencil,
  Plus,
  Save,
  Search,
  Send,
  Sparkles,
  Tags,
  Trash2,
  User,
  Users,
  Video,
  Volume2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChatContent } from './components/ChatContent';
import {
  ENTITY_STYLES,
  EntityHighlighter,
  type EntityType
} from './components/EntityHighlighter';
import { MapMini, type MapMarker } from './components/MapMini';
import { TimelineTransition } from './components/TimelineTransition';

type AnalysisStage = {
  id: string;
  name: string;
  duration: string;
  fields: Record<string, string>;
  status: 'pending' | 'loading' | 'completed';
};

const ANALYSIS_STAGES: Omit<AnalysisStage, 'status'>[] = [
  {
    id: 'task',
    name: '任务规划',
    duration: '450ms',
    fields: { 任务目标: '生成赤壁之战剧本大纲', 优先级: '高' }
  },
  {
    id: 'narrative',
    name: '叙事规划',
    duration: '320ms',
    fields: { 叙事模板ID: 'HIST_WAR_001', 情感基调: '宏大叙事' }
  },
  {
    id: 'resource',
    name: '资源匹配',
    duration: '580ms',
    fields: { 资源URI: 'oss://assets/war/chibi/', 匹配率: '98%' }
  },
  {
    id: 'params',
    name: '参数解算',
    duration: '210ms',
    fields: { 关键帧密度: '24fps', 渲染质量: '4K' }
  }
];

const ThinkingProcess = ({
  content,
  stages = [],
  onCancel
}: {
  content: string;
  stages?: AnalysisStage[];
  onCancel?: () => void;
}) => {
  const [expanded, setExpanded] = useState(true);
  const steps = content.split('\n').filter(Boolean);
  const isFinished =
    (steps.length > 0 && !content.endsWith('...')) ||
    stages.every((s) => s.status === 'completed');

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-cyan-500/20 bg-cyan-500/5 dark:bg-cyan-500/10">
      <div className="flex items-center justify-between px-3 py-2 bg-cyan-500/5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs font-medium text-cyan-700 dark:text-cyan-300 transition-colors"
        >
          {isFinished ? (
            <Sparkles className="h-3.5 w-3.5" />
          ) : (
            <Brain className="h-3.5 w-3.5 animate-pulse" />
          )}
          <span>思考过程 & 解析流</span>
          {!isFinished && (
            <span className="flex gap-0.5">
              <span className="h-1 w-1 rounded-full bg-cyan-500 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1 w-1 rounded-full bg-cyan-500 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1 w-1 rounded-full bg-cyan-500 animate-bounce" />
            </span>
          )}
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 opacity-50" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 opacity-50" />
          )}
        </button>
        {!isFinished && onCancel && (
          <button
            onClick={onCancel}
            className="text-[10px] text-red-500 hover:text-red-600 transition-colors font-bold"
          >
            取消解析
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-cyan-500/10 px-3 py-2.5">
          {/* 阶段性解析卡片 */}
          <div className="grid grid-cols-1 gap-2 mb-4">
            {stages.map((stage, idx) => (
              <div
                key={stage.id}
                className={cn(
                  'relative overflow-hidden rounded-lg border p-2 transition-all duration-300 animate-in fade-in slide-in-from-left-2',
                  stage.status === 'completed'
                    ? 'border-cyan-500/30 bg-cyan-500/10'
                    : stage.status === 'loading'
                      ? 'border-cyan-500/50 bg-cyan-500/20 ring-1 ring-cyan-500/50'
                      : 'border-border bg-muted/30 opacity-50'
                )}
                style={{ animationDelay: `${idx * 200}ms` }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {stage.status === 'completed' ? (
                      <div className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                    ) : stage.status === 'loading' ? (
                      <Loader2 className="h-3 w-3 animate-spin text-cyan-500" />
                    ) : (
                      <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                    )}
                    <span className="text-[11px] font-black text-foreground">
                      {stage.name}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {stage.duration}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {Object.entries(stage.fields).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className="text-[9px] text-muted-foreground shrink-0">
                        {key}:
                      </span>
                      <span className="text-[9px] font-medium text-foreground truncate">
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
                {stage.status === 'loading' && (
                  <div className="absolute bottom-0 left-0 h-0.5 bg-cyan-500 w-full animate-pulse" />
                )}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {steps.map((step, i) => {
              const isLast = i === steps.length - 1;
              const isCurrent = isLast && !isFinished;

              return (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <div className="mt-0.5 shrink-0">
                    {isCurrent ? (
                      <Loader2 className="h-3 w-3 animate-spin text-cyan-500" />
                    ) : (
                      <div className="h-1.5 w-1.5 rounded-full bg-cyan-500/40 mt-1" />
                    )}
                  </div>
                  <span
                    className={cn(
                      'leading-relaxed',
                      isCurrent
                        ? 'text-cyan-700 dark:text-cyan-200'
                        : 'text-muted-foreground'
                    )}
                  >
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const ResourceEditorAdapter = ({
  resource,
  onUpdate
}: {
  resource: Resource;
  onUpdate: (id: string, updates: Partial<ResourceProperties>) => void;
}) => {
  const handleUpdate = (updates: any) => {
    onUpdate(resource.id, updates);
  };

  const commonProps = {
    data: {
      id: resource.id,
      ...resource.properties
    } as any,
    onUpdate: handleUpdate
  };

  return (
    <EditorProvider value={{ embedded: true }}>
      {resource.type === 'audio' && <AudioDetail {...commonProps} />}
      {resource.type === 'video' && <VideoDetail {...commonProps} />}
      {resource.type === 'image' && <PictureDetail {...commonProps} />}
      {resource.type === 'geojson' && <GeojsonDetail {...commonProps} />}
      {!['audio', 'video', 'image', 'geojson'].includes(resource.type) && (
        <div className="p-4 text-xs text-muted-foreground">
          暂不支持此类型资源的编辑
        </div>
      )}
    </EditorProvider>
  );
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  stages?: AnalysisStage[];
  time: string;
};

type ScriptNode = {
  id: string;
  title: string;
  summary: string;
  children?: ScriptNode[];
  type?: 'default' | 'subtitle';
  originalData?: any;
};

type SceneEntitiesRaw = {
  time?: string | string[];
  space?: string[];
  person?: string[];
  thing?: string[];
  event?: string | string[];
};

type ResourceType = 'image' | 'video' | 'audio' | 'geojson';

type ResourceProperties = {
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

type Resource = {
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

type RelationItem = {
  entity: string;
  path_type: string;
  instance_property?: Record<string, any>;
};

function getMiniSceneTimeRange(
  miniScenes: any[] | undefined
): [number, number] | undefined {
  if (!Array.isArray(miniScenes) || miniScenes.length === 0) return undefined;
  const starts: number[] = [];
  const ends: number[] = [];
  miniScenes.forEach((m) => {
    if (!m || !Array.isArray(m.time_range) || m.time_range.length < 2) return;
    const [start, end] = m.time_range;
    if (typeof start === 'number') starts.push(start);
    if (typeof end === 'number') ends.push(end);
  });
  if (!starts.length || !ends.length) return undefined;
  return [Math.min(...starts), Math.max(...ends)];
}

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

function nowText() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createMarkersFromNames(names: string[], seed: number): MapMarker[] {
  return names.map((name, i) => {
    // Generate deterministic pseudo-random coordinates based on name and seed
    // Use a simple hash of the name + seed to generate offsets
    const hash =
      name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) +
      seed +
      i;
    const random = (n: number) => {
      const x = Math.sin(hash + n) * 10000;
      return x - Math.floor(x);
    };

    // Center roughly around Chibi/Wuhan (approx 30N, 114E) for this context
    // or generic if unknown.
    return {
      name,
      lat: 29.0 + random(1) * 2, // 29.0 - 31.0
      lng: 113.0 + random(2) * 2, // 113.0 - 115.0
      level: 1
    };
  });
}

const DEDUCTION_ITEMS = [
  {
    id: '1',
    title: '遭遇战推演-方案A',
    time: '2023-10-27 10:30',
    status: 'completed'
  },
  {
    id: '2',
    title: '遭遇战推演-方案B',
    time: '2023-10-27 11:15',
    status: 'processing'
  },
  {
    id: '3',
    title: '撤退路线推演',
    time: '2023-10-27 14:00',
    status: 'pending'
  }
];

export default function Script() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setSending(false);
      message.info('解析已取消');
    }
  };

  const [saving, setSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('n-root');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    'n-root': true,
    'n-outline': true,
    'n-timeline': true,
    'n-outline-0': true
  });
  const [showSidePanels, setShowSidePanels] = useState(false);
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

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [mapEaseConfig, setMapEaseConfig] = useState<Record<string, string>>(
    {}
  );

  const projectTitle = useMemo(() => {
    if (projectId) return '';
    return '';
  }, [projectId]);
  const [editableTitle, setEditableTitle] = useState(projectTitle);

  function normalizeEntities(
    e: SceneEntitiesRaw | undefined
  ): Record<EntityType, string[]> | undefined {
    if (!e) return undefined;
    const toArray = (val: string | string[] | undefined): string[] =>
      !val ? [] : Array.isArray(val) ? val : [val];
    const out: Record<EntityType, string[]> = {
      location: e.space || [],
      person: e.person || [],
      event: toArray(e.event),
      time: toArray(e.time),
      thing: e.thing || []
    };
    return out;
  }

  const [normandyData, setNormandyData] = useState<NormandyData>({
    query: '',
    introduction: '',
    outlineItems: [],
    subtitles: []
  });

  const formatTimeRange = (tr: number | [number, number]) => {
    if (Array.isArray(tr)) {
      const [start, end] = tr;
      const dur = Math.max(0, (end ?? 0) - (start ?? 0));
      return `${start}-${end}s（${dur}s）`;
    }
    return `${tr}s`;
  };

  const buildInitialMessages = (data: any): ChatMessage[] => [
    {
      id: uid('m'),
      role: 'assistant',
      content:
        '把你的目标告诉我：想生成什么样的剧本结构？我可以帮你拆成主线、事件链和分支条件。',
      time: nowText()
    },
    {
      id: uid('m'),
      role: 'assistant',
      content: JSON.stringify(data),
      time: nowText()
    }
  ];

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

  const updateSubtitleContent = (index: number, newContent: string) => {
    setNormandyData((prev) => {
      const newData = { ...prev };
      if (index >= 0 && index < newData.subtitles.length) {
        const newSubtitles = [...newData.subtitles];
        newSubtitles[index] = {
          ...newSubtitles[index],
          subtitle: newContent
        };
        newData.subtitles = newSubtitles;
      }
      return newData;
    });
  };

  const addRelation = (subtitleTitle: string) => {
    setNormandyData((prev) => {
      const newData = { ...prev };
      newData.subtitles = newData.subtitles.map((sub) => {
        if (sub.title !== subtitleTitle) return sub;
        const newRelations = [...(sub.relation || [])];
        newRelations.push({
          entity: 'New Entity',
          path_type: 'default',
          instance_property: {}
        });
        return { ...sub, relation: newRelations };
      });
      return newData;
    });
  };

  const removeRelation = (subtitleTitle: string, relationIndex: number) => {
    setNormandyData((prev) => {
      const newData = { ...prev };
      newData.subtitles = newData.subtitles.map((sub) => {
        if (sub.title !== subtitleTitle) return sub;
        const newRelations = [...(sub.relation || [])];
        if (relationIndex >= 0 && relationIndex < newRelations.length) {
          newRelations.splice(relationIndex, 1);
        }
        return { ...sub, relation: newRelations };
      });
      return newData;
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
        summary: `${s.title}${s.core_content && s.subtitle ? `\n${s.core_content}` : ''}（${formatTimeRange(s.time_range)}）`,
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

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    buildInitialMessages(chiBiWar)
  );

  useEffect(() => {
    if (!projectId) {
      setEditableTitle('');
      return;
    }
    (async () => {
      try {
        const res = await getScript(projectId);
        const data = res.data || {};
        const title =
          data.title?.trim() || data.name?.trim() || '未命名的脚本项目';
        setEditableTitle(title);

        const conv = (data as any).conversation;
        if (Array.isArray(conv) && conv.length > 0) {
          const restored: ChatMessage[] = conv
            .filter((item) => item && typeof item === 'object')
            .map((item: any) => ({
              id: uid('m'),
              role: item.role === 'user' ? 'user' : 'assistant',
              content:
                typeof item.content === 'string'
                  ? item.content
                  : JSON.stringify(item.content),
              time: nowText()
            }));
          if (restored.length > 0) {
            setMessages(restored);
            return;
          }
        }
        setMessages(buildInitialMessages(chiBiWar));
      } catch (err) {
        console.error(err);
      }
    })();
  }, [projectId, normandyData]);

  const handleSave = async () => {
    if (!projectId) {
      message.error('缺少项目 ID，无法保存脚本');
      return;
    }
    if (saving) return;
    try {
      setSaving(true);
      const conversation = messages.map((m) => ({
        role: m.role,
        content: m.content
      }));
      const title = editableTitle.trim();
      await updateScript(projectId, {
        title: title || undefined,
        conversation
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
  }, [messages.length]);

  const send = async (overrideContent?: string) => {
    const text =
      typeof overrideContent === 'string' ? overrideContent : input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput('');

    // Create abort controller for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const userMessage: ChatMessage = {
      id: uid('m'),
      role: 'user',
      content: text,
      time: nowText()
    };

    const assistantId = uid('m');
    const startTime = nowText();

    const initialStages: AnalysisStage[] = ANALYSIS_STAGES.map((s) => ({
      ...s,
      status: 'pending' as const
    }));

    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        thinking: '正在启动智能解析流...',
        stages: initialStages,
        time: startTime
      }
    ]);

    try {
      // 模拟四级解析流程
      for (let i = 0; i < initialStages.length; i++) {
        if (controller.signal.aborted) return;

        // Set current stage to loading
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  stages: m.stages?.map((s, idx) =>
                    idx === i ? { ...s, status: 'loading' as const } : s
                  )
                }
              : m
          )
        );

        // Simulated work for 200ms as per requirement
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          controller.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
          });
        });

        // Set current stage to completed
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  stages: m.stages?.map((s, idx) =>
                    idx === i ? { ...s, status: 'completed' as const } : s
                  )
                }
              : m
          )
        );
      }

      if (controller.signal.aborted) return;

      // Final Thinking process
      const thinkingSteps = [
        '正在整合解析结果...',
        '正在生成最终剧本数据...',
        '校验数据关联性...'
      ];

      for (const step of thinkingSteps) {
        if (controller.signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, 300));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, thinking: (m.thinking || '') + '\n' + step }
              : m
          )
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Mock answer data as JSON
      const mockResponse = JSON.stringify(
        {
          ...chiBiWar,
          _analysis_metadata: {
            task_goal: '生成赤壁之战剧本大纲',
            narrative_template: 'HIST_WAR_001',
            resource_uri: 'oss://assets/war/chibi/',
            render_params: { quality: '4K', density: '24fps' }
          }
        },
        null,
        2
      );

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: mockResponse } : m
        )
      );
    } catch (err: any) {
      if (err.message === 'Aborted') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, thinking: '解析已由用户取消。', stages: [] }
              : m
          )
        );
      } else {
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
      }
    } finally {
      if (!controller.signal.aborted) {
        setSending(false);
        abortControllerRef.current = null;
      }
    }
  };

  const copySelectedSummary = async () => {
    const text = `${selectedNode.title}\n${selectedNode.summary}`;
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制节点信息');
    } catch {
      message.error('复制失败');
    }
  };

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  function deriveEntityType(
    e: SceneEntitiesRaw | Record<EntityType, string[]> | undefined,
    term: string
  ): EntityType | undefined {
    const norm = normalizeEntities(e as SceneEntitiesRaw);
    if (!norm) return undefined;
    if (norm.location.includes(term)) return 'location';
    if (norm.person.includes(term)) return 'person';
    if (norm.event.includes(term)) return 'event';
    if (norm.time.includes(term)) return 'time';
    return undefined;
  }

  function deriveEntityBg(
    e: SceneEntitiesRaw | Record<EntityType, string[]> | undefined,
    term: string
  ) {
    const t = deriveEntityType(e, term);
    if (!t) return 'bg-muted';
    const style = ENTITY_STYLES[t];
    return style ? style.split(' ')[0].replace('text-', 'bg-') : 'bg-muted';
  }

  const renderTree = (arr: ScriptNode[], depth = 0) => {
    return arr.map((n) => {
      const hasChildren = Boolean(n.children?.length);
      const open = expanded[n.id] ?? false;
      const active = n.id === selectedNodeId;

      return (
        <div key={n.id} className="select-none">
          <div
            className={cn(
              'flex items-start gap-2 rounded-xl border px-3 py-2.5 transition-colors',
              active
                ? 'border-cyan-500/30 bg-cyan-500/10'
                : 'border-border bg-muted/50 hover:bg-accent'
            )}
            style={{ marginLeft: depth * 12 }}
          >
            <button
              type="button"
              onClick={() => (hasChildren ? toggle(n.id) : undefined)}
              className={cn(
                'mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-lg border transition-colors',
                hasChildren
                  ? 'border-border bg-muted text-foreground hover:bg-accent'
                  : 'border-transparent bg-transparent text-transparent'
              )}
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
                  open ? 'rotate-0' : '-rotate-90'
                )}
              />
            </button>
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => setSelectedNodeId(n.id)}
            >
              <div className="flex items-center gap-2">
                <Layers
                  className={cn(
                    'h-4 w-4 shrink-0',
                    active
                      ? 'text-cyan-600 dark:text-cyan-300'
                      : 'text-muted-foreground'
                  )}
                />
                <div
                  className={cn(
                    'text-sm font-medium truncate',
                    active
                      ? 'text-cyan-900 dark:text-cyan-100'
                      : 'text-foreground'
                  )}
                >
                  {n.title}
                </div>
              </div>
              <div
                className={cn(
                  'mt-1 text-xs leading-relaxed',
                  active
                    ? 'text-cyan-700 dark:text-cyan-200/70'
                    : 'text-muted-foreground'
                )}
              >
                {n.summary}
              </div>
            </button>
          </div>

          {hasChildren && open && (
            <div className="mt-2 space-y-2">
              {renderTree(n.children!, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <div className="flex-none px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
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
                  placeholder="未命名的脚本项目"
                  className="bg-transparent border-none text-lg font-semibold text-foreground placeholder:text-muted-foreground outline-none focus:ring-0 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setShowSidePanels(!showSidePanels)}
              disabled={normandyData.outlineItems.length === 0}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors',
                showSidePanels
                  ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/15'
                  : 'border-border bg-background text-foreground hover:bg-accent',
                normandyData.outlineItems.length === 0 &&
                  'opacity-50 cursor-not-allowed'
              )}
            >
              <PanelRight className="h-3.5 w-3.5" />
              {showSidePanels ? '收起面板' : '展开面板'}
            </button>
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
                message.info('转换为场景功能待接入具体接口');
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-700 dark:text-cyan-200 transition-colors hover:bg-cyan-500/15"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              转换为场景
            </button>
          </div>
        </div>
      </div>

      <div
        className={cn(
          'flex-1 min-h-0 flex gap-4 px-4 py-4',
          !showSidePanels && 'justify-center'
        )}
      >
        {/* 左侧对话 */}
        <div
          className={cn(
            'flex-1 min-w-0 flex flex-col rounded-2xl border border-border bg-card overflow-hidden transition-all duration-500',
            !showSidePanels && 'max-w-2xl flex-none w-full shadow-2xl'
          )}
        >
          <div className="flex-none px-4 py-3 border-b border-border flex items-center justify-between bg-card">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Bot className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
              智能问答
            </div>
            {showSidePanels && (
              <button
                onClick={() => setShowSidePanels(false)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                收起侧边栏
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent relative">
            {sending && (
              <div className="absolute inset-0 z-50 bg-background/20 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
                <div className="bg-card/80 border border-border px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-in fade-in zoom-in-95 duration-300">
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />
                  <span className="text-xs font-bold text-cyan-700 dark:text-cyan-300">
                    正在执行解析流...
                  </span>
                </div>
              </div>
            )}
            {messages.map((m) => (
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
                  {m.thinking && (
                    <ThinkingProcess
                      content={m.thinking}
                      stages={m.stages}
                      onCancel={cancelAnalysis}
                    />
                  )}
                  {m.role === 'assistant' && !m.content && !m.thinking ? (
                    <div className="flex items-center gap-1.5 h-6 px-1">
                      <div className="w-1.5 h-1.5 bg-cyan-500/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <div className="w-1.5 h-1.5 bg-cyan-500/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <div className="w-1.5 h-1.5 bg-cyan-500/60 rounded-full animate-bounce" />
                    </div>
                  ) : (
                    <ChatContent
                      content={m.content}
                      onParse={() => {
                        setNormandyData(transformChiBiToInternal(chiBiWar));
                        setShowSidePanels(true);
                        message.success('解析成功');
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
                    {m.role === 'assistant' &&
                      m.content.trim().startsWith('{') &&
                      /* Parse button handled inside ChatContent now */
                      null}
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

          <div className="flex-none border-t border-border p-3 bg-card">
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
            <div className="mt-4 grid grid-cols-2 gap-2">
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
                },
                {
                  icon: Users,
                  label: '分析人物',
                  color: 'text-emerald-500 bg-emerald-500/10'
                },
                {
                  icon: Tags,
                  label: '提取实体',
                  color: 'text-orange-500 bg-orange-500/10'
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

        {/* 中间剧本逻辑 */}
        {showSidePanels && (
          <>
            <div className="flex-1 min-w-0 flex flex-col rounded-2xl border border-border bg-card overflow-hidden relative">
              <div className="flex-none px-4 py-3 border-b border-border flex items-center justify-between bg-card">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <PanelRight className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                  剧本逻辑
                </div>
                <div className="relative w-32">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    placeholder="查找..."
                    className="w-full rounded-lg border border-border bg-muted/50 pl-8 pr-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-cyan-500/40"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                {renderTree(nodes)}
              </div>

              <div className="flex-none border-t border-border p-4 bg-card">
                <div className="text-sm font-semibold text-foreground truncate">
                  {selectedNode.title}
                </div>
                <div className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-3">
                  {selectedNode.summary}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copySelectedSummary}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    <Copy className="h-3 w-3" />
                    复制
                  </button>
                  <button
                    type="button"
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    <Plus className="h-3 w-3" />
                    添加
                  </button>
                </div>
              </div>
            </div>

            {/* 右侧节点详情 */}
            <div className="flex-1 min-w-0 flex flex-col rounded-2xl border border-border bg-card overflow-hidden">
              <div className="flex-none px-4 py-3 border-b border-border flex items-center justify-between bg-card">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Info className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                  节点详情
                </div>
                <button
                  onClick={() => setShowSidePanels(false)}
                  className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                {selectedNode.type === 'subtitle' &&
                selectedNode.originalData ? (
                  <div className="space-y-6">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2">
                        片段标题
                      </div>
                      <div className="text-lg font-semibold text-foreground">
                        {selectedNode.originalData.title}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2">
                        字幕内容
                      </div>
                      <textarea
                        className="w-full min-h-[100px] rounded-xl border border-border bg-muted/50 p-4 text-sm leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                        value={selectedNode.originalData.subtitle}
                        onChange={(e) => {
                          const idx = parseInt(
                            selectedNode.id.split('-').pop() || '0',
                            10
                          );
                          updateSubtitleContent(idx, e.target.value);
                        }}
                      />
                    </div>

                    {selectedNode.originalData.core_content && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          剧情详情
                        </div>
                        <div className="rounded-xl border border-border bg-muted/50 p-4 text-sm leading-relaxed text-foreground">
                          <EntityHighlighter
                            text={selectedNode.originalData.core_content}
                            entities={selectedNode.originalData.entities}
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2">
                        时间范围
                      </div>
                      <div className="inline-flex items-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-600 dark:text-cyan-300">
                        {formatTimeRange(selectedNode.originalData.time_range)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-3">
                        图例说明
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(ENTITY_STYLES).map(([type, style]) => (
                          <div
                            key={type}
                            className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1"
                          >
                            <div
                              className={cn(
                                'h-2 w-2 rounded-full',
                                style.split(' ')[0].replace('text-', 'bg-')
                              )}
                            />
                            <span className={cn('text-xs capitalize', style)}>
                              {type}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Preview Modal */}
                    <Dialog
                      open={!!previewResource}
                      onOpenChange={(o) => !o && setPreviewResource(null)}
                    >
                      <DialogContent className="max-w-[1200px] w-[90vw] h-[80vh] p-0 overflow-hidden bg-background">
                        <div className="flex flex-col h-full">
                          <div className="flex-none px-6 py-4 border-b border-border flex items-center justify-between">
                            <div className="text-lg font-semibold">
                              {previewResource?.name}
                            </div>
                          </div>
                          <div className="flex-1 overflow-auto bg-muted/20 p-6 flex items-center justify-center">
                            {previewResource?.type === 'image' && (
                              <PreImage url={previewResource.url || ''} />
                            )}
                            {previewResource?.type === 'video' && (
                              <PreVideo url={previewResource.url || ''} />
                            )}
                            {previewResource?.type === 'audio' && (
                              <PreAudio url={previewResource.url || ''} />
                            )}
                            {previewResource?.type === 'geojson' && (
                              <PreMap geojsonUrl={previewResource.url || ''} />
                            )}
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {/* Add Resource Modal */}
                    <Dialog
                      open={isAddResourceOpen}
                      onOpenChange={setIsAddResourceOpen}
                    >
                      <DialogContent className="sm:max-w-[425px]">
                        <div className="grid gap-4 py-4">
                          <div className="grid grid-cols-4 items-center gap-4">
                            <label className="text-right text-sm">名称</label>
                            <input
                              value={newResource.name}
                              onChange={(e) =>
                                setNewResource({
                                  ...newResource,
                                  name: e.target.value
                                })
                              }
                              className="col-span-3 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                          </div>
                          <div className="grid grid-cols-4 items-center gap-4">
                            <label className="text-right text-sm">类型</label>
                            <select
                              value={newResource.type}
                              onChange={(e) =>
                                setNewResource({
                                  ...newResource,
                                  type: e.target.value as ResourceType
                                })
                              }
                              className="col-span-3 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              <option value="image">图片</option>
                              <option value="video">视频</option>
                              <option value="audio">音频</option>
                              <option value="geojson">GeoJSON</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-4 items-center gap-4">
                            <label className="text-right text-sm">URL</label>
                            <input
                              value={newResource.url}
                              onChange={(e) =>
                                setNewResource({
                                  ...newResource,
                                  url: e.target.value
                                })
                              }
                              className="col-span-3 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-3">
                          <button
                            onClick={() => setIsAddResourceOpen(false)}
                            className="h-9 px-4 py-2 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm font-medium transition-colors"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleAddResource}
                            className="h-9 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors"
                          >
                            确定
                          </button>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {selectedNode.originalData.resources &&
                      selectedNode.originalData.resources.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-3 flex items-center justify-between">
                            <span>关联资源</span>
                            <button
                              onClick={() => setIsAddResourceOpen(true)}
                              className="text-cyan-600 hover:text-cyan-500 text-[10px] flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              新建资源
                            </button>
                          </div>
                          <div className="space-y-2">
                            {selectedNode.originalData.resources.map(
                              (r: Resource) => (
                                <div
                                  key={r.id}
                                  className="rounded-xl border border-border bg-muted/50 transition-colors hover:bg-accent/50 group"
                                >
                                  <div className="flex items-center gap-3 p-3">
                                    <div
                                      className={cn(
                                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors',
                                        r.type === 'image'
                                          ? 'bg-blue-500/10 border-blue-500/20 text-blue-500'
                                          : r.type === 'video'
                                            ? 'bg-purple-500/10 border-purple-500/20 text-purple-500'
                                            : r.type === 'audio'
                                              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                                              : r.type === 'geojson'
                                                ? 'bg-fuchsia-500/10 border-fuchsia-500/20 text-fuchsia-500'
                                                : 'bg-muted border-border text-muted-foreground'
                                      )}
                                    >
                                      {r.type === 'image' && (
                                        <ImageIcon className="h-5 w-5" />
                                      )}
                                      {r.type === 'video' && (
                                        <Video className="h-5 w-5" />
                                      )}
                                      {r.type === 'audio' && (
                                        <Volume2 className="h-5 w-5" />
                                      )}
                                      {r.type === 'geojson' && (
                                        <MapPin className="h-5 w-5" />
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1 select-none">
                                      <div className="truncate text-sm font-medium text-foreground">
                                        {r.name}
                                      </div>
                                      {r.relatedEntity && (
                                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                          <div
                                            className={cn(
                                              'h-1.5 w-1.5 rounded-full',
                                              deriveEntityBg(
                                                selectedNode.originalData
                                                  .entities,
                                                r.relatedEntity
                                              )
                                            )}
                                          />
                                          关联实体：{r.relatedEntity}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      {r.url && (
                                        <button
                                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setPreviewResource(r);
                                          }}
                                          title="预览资源"
                                        >
                                          <Eye className="h-4 w-4" />
                                        </button>
                                      )}

                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <button
                                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                            onClick={(e) => e.stopPropagation()}
                                            title="修改资源属性"
                                          >
                                            <Pencil className="h-4 w-4" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                          className="w-[800px] max-h-[600px] overflow-y-auto"
                                          align="end"
                                        >
                                          <DropdownMenuLabel>
                                            修改资源属性
                                          </DropdownMenuLabel>
                                          <DropdownMenuSeparator />
                                          <div className="p-4">
                                            <ResourceEditorAdapter
                                              resource={r}
                                              onUpdate={updateResourceProperty}
                                            />
                                          </div>
                                        </DropdownMenuContent>
                                      </DropdownMenu>

                                      <button
                                        className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-500/10"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeResource(r.id);
                                        }}
                                        title="删除资源"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}

                  </div>
                ) : (
                  <>
                    {selectedNode.id === 'n-root' ? (
                      <div className="space-y-6">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            剧本主题
                          </div>
                          <div className="text-lg font-semibold text-foreground">
                            {normandyData.query ||
                              selectedNode.title ||
                              '未命名主题'}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            整体简介
                          </div>
                          <div className="rounded-xl border border-border bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground">
                            {normandyData.introduction || '暂无简介'}
                          </div>
                        </div>
                        {normandyData.spatio_temporal_context && (
                          <div>
                            <div className="text-xs font-medium text-muted-foreground mb-2">
                              时空概览
                            </div>
                            <div className="rounded-xl border border-border bg-muted/50 overflow-hidden h-64">
                              <MapMini
                                markers={
                                  normandyData.spatio_temporal_context.spatial_flow?.map(
                                    (f) => ({
                                      name: f.to,
                                      lat: f.lat,
                                      lng: f.lon
                                    })
                                  ) || []
                                }
                              />
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl border border-border bg-muted/50 px-3 py-2.5">
                            <div className="text-[11px] text-muted-foreground mb-1.5">
                              提要段落
                            </div>
                            <div className="text-xl font-semibold text-cyan-600 dark:text-cyan-300">
                              {normandyData.outlineItems?.length ?? 0}
                            </div>
                          </div>
                          <div className="rounded-xl border border-border bg-muted/50 px-3 py-2.5">
                            <div className="text-[11px] text-muted-foreground mb-1.5">
                              片段数量
                            </div>
                            <div className="text-xl font-semibold text-cyan-600 dark:text-cyan-300">
                              {normandyData.subtitles?.length ?? 0}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-3">
                          <div className="rounded-xl border border-border bg-muted/50 px-3 py-2.5">
                            <div className="text-[11px] text-muted-foreground mb-1.5">
                              其他要素
                            </div>
                            <div className="space-y-1 text-[11px] text-muted-foreground">
                              <div className="flex items-center justify-between">
                                <span>关键地点</span>
                                <span className="text-cyan-600 dark:text-cyan-300">
                                  {Array.from(
                                    new Set(
                                      (normandyData.subtitles || [])
                                        .flatMap(
                                          (s) => s.entities?.location || []
                                        )
                                        .filter(Boolean)
                                    )
                                  ).length || 0}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>关键角色</span>
                                <span className="text-cyan-600 dark:text-cyan-300">
                                  {Array.from(
                                    new Set(
                                      (normandyData.subtitles || [])
                                        .flatMap(
                                          (s) => s.entities?.person || []
                                        )
                                        .filter(Boolean)
                                    )
                                  ).length || 0}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>总时长片段</span>
                                <span className="text-cyan-600 dark:text-cyan-300">
                                  {normandyData.subtitles?.length ?? 0}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="rounded-xl border border-border bg-muted/50 px-3 py-2.5 col-span-2">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="text-[11px] text-muted-foreground">
                                关联文件夹
                              </div>
                              <button
                                type="button"
                                className="h-7 rounded border border-cyan-500/60 px-3 text-[11px] text-cyan-600 dark:text-cyan-300 hover:bg-cyan-500/10"
                              >
                                + 添加关联
                              </button>
                            </div>
                            <div className="space-y-2">
                              <div className="group flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/50 hover:border-cyan-500/30 cursor-pointer">
                                <Folder className="h-4 w-4 text-blue-500 fill-blue-500/20" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-foreground truncate">
                                    赤壁之战
                                  </div>
                                  <div className="text-[10px] text-muted-foreground truncate">
                                    包含 12 个资源 · 3 个子文件夹
                                  </div>
                                </div>
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                              <div className="text-[10px] text-muted-foreground text-center pt-1 opacity-60">
                                暂无关联文件夹，可在此预留展示我的空间 /
                                资源结构
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : selectedNode.id === 'n-outline' ? (
                      <div className="space-y-6">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            模块
                          </div>
                          <div className="text-lg font-semibold text-foreground">
                            提要与结构
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-3">
                            结构概览
                          </div>
                          <div className="space-y-3">
                            {(normandyData.outlineItems || []).map((o, i) => (
                              <div
                                key={i}
                                className="relative pl-4 border-l-2 border-border/50 last:border-l-0 pb-1"
                              >
                                <div className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border border-border bg-background ring-2 ring-background" />
                                <div className="rounded-xl border border-border bg-muted/30 p-3 hover:bg-muted/50 transition-colors">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="text-sm font-medium text-foreground">
                                      {i + 1}. {o.title}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                      {o.descriptions.length} 个子场景
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    {o.descriptions.slice(0, 3).map((d, di) => (
                                      <div
                                        key={di}
                                        className="flex items-start gap-2 text-xs text-muted-foreground"
                                      >
                                        <span className="shrink-0 opacity-50">
                                          -
                                        </span>
                                        <span className="line-clamp-1">
                                          {d.title}
                                          {d.summary ? (
                                            <span className="opacity-60 ml-1">
                                              - {d.summary}
                                            </span>
                                          ) : null}
                                        </span>
                                      </div>
                                    ))}
                                    {o.descriptions.length > 3 && (
                                      <div className="text-[10px] text-muted-foreground pl-3 opacity-60">
                                        ... 还有 {o.descriptions.length - 3} 个
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                            {(!normandyData.outlineItems ||
                              normandyData.outlineItems.length === 0) && (
                              <div className="text-xs text-muted-foreground text-center py-8">
                                暂无提要结构
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : /^n-outline-\d+$/.test(selectedNode.id) ? (
                      <div className="space-y-6">
                        {(() => {
                          const match =
                            selectedNode.id.match(/^n-outline-(\d+)$/);
                          const idx = match ? Number(match[1]) : -1;
                          const item =
                            idx >= 0 && idx < normandyData.outlineItems.length
                              ? normandyData.outlineItems[idx]
                              : undefined;
                          if (!item) {
                            return (
                              <div className="text-xs text-muted-foreground">
                                找不到对应的提要数据
                              </div>
                            );
                          }
                          const related = (normandyData.subtitles || []).filter(
                            (s) =>
                              typeof s.title === 'string' &&
                              s.title.includes(item.title)
                          );
                          const markers: MapMarker[] = related.flatMap(
                            (s: any, relatedIndex: number) => {
                              const locs: string[] =
                                (s.entities?.location as string[]) || [];
                              return createMarkersFromNames(
                                locs,
                                idx * 10 + relatedIndex
                              );
                            }
                          );
                          return (
                            <>
                              <div>
                                <div className="text-xs font-medium text-muted-foreground mb-2">
                                  标题
                                </div>
                                <div className="text-lg font-semibold text-foreground">
                                  {item.title}
                                </div>
                              </div>
                              <div>
                                <div className="flex items-center justify-between mb-3">
                                  <div className="text-xs font-medium text-muted-foreground">
                                    子提要列表
                                  </div>
                                  <div className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                    共 {item.descriptions.length} 个
                                  </div>
                                </div>
                                <div className="space-y-3">
                                  {item.descriptions.length > 0 ? (
                                    item.descriptions.map((d, i2) => (
                                      <div
                                        key={i2}
                                        className="group rounded-xl border border-border bg-muted/30 p-3 hover:bg-muted/50 hover:border-cyan-500/20 transition-all"
                                      >
                                        <div className="flex items-start gap-3">
                                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-500/10 text-[10px] font-medium text-cyan-600 dark:text-cyan-300 group-hover:bg-cyan-500/20">
                                            {i2 + 1}
                                          </div>
                                          <div className="min-w-0 flex-1 space-y-1">
                                            <div className="text-sm font-medium text-foreground">
                                              {d.title}
                                            </div>
                                            {d.summary && (
                                              <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                                                {d.summary}
                                              </div>
                                            )}
                                            <div className="flex items-center gap-2 pt-1">
                                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                                <Layers className="h-3 w-3" />
                                                {d.mini_scene.length} 个微场景
                                              </div>
                                              {d.mini_scene.length > 0 && (
                                                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                                  <div className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                                                  {formatTimeRange(
                                                    getMiniSceneTimeRange(
                                                      d.mini_scene
                                                    ) || [0, 0]
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-center py-6 text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                                      暂无子提要内容
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs font-medium text-muted-foreground mb-2">
                                  地理空间
                                </div>
                                <MapMini markers={markers} />
                              </div>
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-xs font-medium text-muted-foreground">
                                    描述流转 (Timeline)
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    为相邻节点配置 mapEase
                                  </div>
                                </div>
                                <TimelineTransition
                                  items={
                                    selectedNode.children?.map(
                                      (c, childIndex) => {
                                        const miniScenes =
                                          c.originalData?.mini_scene || [];
                                        const timeRange =
                                          getMiniSceneTimeRange(miniScenes);
                                        return {
                                          id: c.id,
                                          title: c.title,
                                          description: miniScenes.length
                                            ? `包含 ${miniScenes.length} 个微场景`
                                            : '暂无微场景',
                                          timeRange,
                                          order: childIndex + 1
                                        };
                                      }
                                    ) || []
                                  }
                                  mapEaseConfig={mapEaseConfig}
                                  onMapEaseChange={(fromId, toId, value) => {
                                    const key = `${fromId}__${toId}`;
                                    setMapEaseConfig((prev) => ({
                                      ...prev,
                                      [key]: value
                                    }));
                                  }}
                                />
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ) : /^n-outline-\d+-\d+$/.test(selectedNode.id) ? (
                      <div className="space-y-6">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            标题
                          </div>
                          <div className="text-lg font-semibold text-foreground">
                            {selectedNode.title}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            概要
                          </div>
                          <div className="text-xs text-muted-foreground leading-relaxed">
                            {selectedNode.summary || '无摘要'}
                          </div>
                        </div>
                        {Array.isArray(selectedNode.originalData?.mini_scene) &&
                          selectedNode.originalData.mini_scene.length > 0 && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-medium text-muted-foreground">
                                  片段时间轴
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  共{' '}
                                  {selectedNode.originalData.mini_scene.length}{' '}
                                  个片段
                                </div>
                              </div>
                              <div className="rounded-xl border border-border bg-muted/50 p-3">
                                <div className="flex flex-col gap-3">
                                  {selectedNode.originalData.mini_scene.map(
                                    (m: any, idx: number) => {
                                      const range = m.time_range;
                                      let start: number | undefined;
                                      let end: number | undefined;
                                      if (
                                        Array.isArray(range) &&
                                        range.length >= 2
                                      ) {
                                        if (typeof range[0] === 'number')
                                          start = range[0];
                                        if (typeof range[1] === 'number')
                                          end = range[1];
                                      } else if (typeof range === 'number') {
                                        start = range;
                                      }
                                      const timeLabel =
                                        start != null && end != null
                                          ? `${start.toFixed(1)}s - ${end.toFixed(
                                              1
                                            )}s`
                                          : start != null
                                            ? `${start.toFixed(1)}s`
                                            : '未知时间';

                                      const entities = m.entities || {};
                                      const toArray = (val: any) =>
                                        !val
                                          ? []
                                          : Array.isArray(val)
                                            ? val
                                            : [val];
                                      const locations = toArray(
                                        entities.space || entities.location
                                      );
                                      const persons = toArray(entities.person);
                                      const events = toArray(entities.event);

                                      return (
                                        <div key={idx} className="flex gap-3">
                                          <div className="flex flex-col items-center pt-1">
                                            {idx > 0 && (
                                              <div className="h-4 w-px bg-border" />
                                            )}
                                            <div className="h-2.5 w-2.5 rounded-full bg-cyan-400/80" />
                                            {idx <
                                              selectedNode.originalData
                                                .mini_scene.length -
                                                1 && (
                                              <div className="flex-1 w-px bg-border" />
                                            )}
                                          </div>
                                          <div className="flex-1">
                                            <div className="rounded-lg border border-border bg-muted/60 p-3">
                                              <div className="flex items-center justify-between gap-2">
                                                <div className="text-xs font-medium text-muted-foreground">
                                                  片段 {idx + 1} ·{' '}
                                                  {(typeof m.subtitle ===
                                                  'string'
                                                    ? m.subtitle
                                                    : m.subtitle?.content) ||
                                                    '未命名字幕'}
                                                </div>
                                                <div className="text-[11px] text-cyan-950 dark:text-cyan-500 dark:text-cyan-400">
                                                  {timeLabel}
                                                </div>
                                              </div>
                                              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                                                <div className="space-y-0.5">
                                                  <div className="text-muted-foreground">
                                                    地点
                                                  </div>
                                                  <div className="line-clamp-2">
                                                    {locations.length > 0
                                                      ? locations.join('、')
                                                      : '暂无'}
                                                  </div>
                                                </div>
                                                <div className="space-y-0.5">
                                                  <div className="text-muted-foreground">
                                                    角色
                                                  </div>
                                                  <div className="line-clamp-2">
                                                    {persons.length > 0
                                                      ? persons.join('、')
                                                      : '暂无'}
                                                  </div>
                                                </div>
                                                <div className="space-y-0.5">
                                                  <div className="text-muted-foreground">
                                                    事件
                                                  </div>
                                                  <div className="line-clamp-2">
                                                    {events.length > 0
                                                      ? events.join('、')
                                                      : '暂无'}
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    }
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                      </div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                        <Info className="mb-2 h-8 w-8 opacity-20" />
                        <p className="text-sm">请选择一个节点查看详情</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
