import {
  DEFAULT_TRANSITION_DATA,
  TransitionDetail
} from '@/components/resource-editors/MapEaseDetail';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { message } from '@/components/ui/message';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useParamsStore } from '@/stores/paramsStore';
import {
  Activity,
  ArrowRight,
  Box,
  ChevronRight,
  FileJson,
  Layers,
  Map as MapIcon,
  MapPin,
  Music,
  Play,
  Search,
  Settings2,
  Sparkles,
  Type
} from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataImportButton } from './DataImportButton';

/**
 * 轨道配置元数据接口
 */
interface TrackConfig {
  label: string;
  icon: React.ReactNode;
  color: string;
  controlledFields: string[];
}

/**
 * 属性中英文映射表
 */
const ATTR_MAP: Record<string, string> = {
  id: '唯一标识',
  core_content: '核心内容',
  time: '时间设置',
  start: '开始时间 (ms)',
  finish: '结束时间 (ms)',
  role: '角色身份',
  paths: '轨道素材',
  audio: '音频轨',
  text: '字幕轨',
  geojson: '地理轨',
  picture: '图片轨',
  marker: '标注轨',
  video: '视频轨',
  volume: '音量音效',
  fadeInTime: '淡入时长',
  fadeOutTime: '淡出时长',
  currentTime: '当前播放时间',
  muted: '静音状态',
  loop: '循环播放',
  speed: '播放倍速',
  content: '内容详情',
  purpose: '素材用途',
  animation: '动画特效',
  font_style: '字体样式',
  fontFamily: '字体族',
  fontSize: '字号大小',
  fontColor: '字体颜色',
  fontOpacity: '字体透明度',
  bold: '加粗文本',
  italic: '斜体文本',
  letterSpacing: '字间距',
  lineSpacing: '行间距',
  textalign: '文本对齐方式',
  wrap_style: '容器样式',
  left: '水平坐标 (X)',
  top: '垂直坐标 (Y)',
  width: '元素宽度',
  height: '元素高度',
  rotate: '旋转角度',
  borderColor: '边框颜色',
  borderWidth: '边框粗细',
  bgOpacity: '背景透明度',
  bgColor: '背景颜色',
  zIndex: '堆叠层级',
  paint: '样式绘制',
  layout: '布局配置',
  filter: '数据过滤',
  line_width: '线条宽度',
  line_blur: '线条模糊度',
  line_color: '线条颜色',
  line_type: '线条类型',
  line_opacity: '线条不透明度',
  circle_opacity: '圆点不透明度',
  circle_radius: '圆点半径',
  circle_color: '圆点颜色',
  circle_blur: '圆点模糊度',
  fill_opacity: '填充不透明度',
  fill_antialias: '抗锯齿渲染',
  fill_color: '填充颜色',
  fill_outline_color: '轮廓颜色',
  text_field: '关联文本字段',
  text_font: '文本字体集',
  text_size: '文本字号',
  text_color: '文本颜色',
  text_model: '渲染模型',
  text_opacity: '文本透明度',
  text_anchor: '对齐锚点',
  text_justify: '两端对齐',
  text_offset: '文本偏移量',
  text_rotate: '文本旋转角度',
  filter_operator: '过滤操作符',
  filter_key: '过滤主键',
  filter_value: '过滤阈值'
};

/**
 * 完整的轨道属性映射表
 * 包含英文 key 到中文名称、轨道类型图标、默认颜色、受控字段列表等元数据
 * 新增轨道类型时只需在此扩展即可自动生效
 */
const TRACK_CONFIG: Record<string, TrackConfig> = {
  video: {
    label: '视频轨',
    icon: <Activity className="w-3.5 h-3.5" />,
    color: '#3b82f6',
    controlledFields: ['start', 'finish', 'volume', 'currentTime']
  },
  audio: {
    label: '音频轨',
    icon: <Music className="w-3.5 h-3.5" />,
    color: '#10b981',
    controlledFields: ['start', 'finish', 'volume', 'fadeInTime', 'fadeOutTime']
  },
  text: {
    label: '字幕轨',
    icon: <Type className="w-3.5 h-3.5" />,
    color: '#f59e0b',
    controlledFields: ['start', 'finish', 'content', 'font_style']
  },
  geojson: {
    label: '地理轨',
    icon: <MapIcon className="w-3.5 h-3.5" />,
    color: '#8b5cf6',
    controlledFields: ['start', 'finish', 'paint', 'layout']
  },
  picture: {
    label: '图片轨',
    icon: <Layers className="w-3.5 h-3.5" />,
    color: '#ec4899',
    controlledFields: ['start', 'finish', 'width', 'height']
  },
  marker: {
    label: '标注轨',
    icon: <MapPin className="w-3.5 h-3.5" />,
    color: '#f43f5e',
    controlledFields: ['start', 'finish', 'content']
  },
  // 兼容性映射
  videoTrack: {
    label: '视频轨',
    icon: <Activity className="w-3.5 h-3.5" />,
    color: '#3b82f6',
    controlledFields: ['start', 'finish', 'volume', 'currentTime']
  },
  audioTrack: {
    label: '音频轨',
    icon: <Music className="w-3.5 h-3.5" />,
    color: '#10b981',
    controlledFields: ['start', 'finish', 'volume', 'fadeInTime', 'fadeOutTime']
  },
  subtitleTrack: {
    label: '字幕轨',
    icon: <Type className="w-3.5 h-3.5" />,
    color: '#f59e0b',
    controlledFields: ['start', 'finish', 'content', 'font_style']
  }
};

/**
 * ParamsPanel 组件
 * 初始加载即渲染 chibi_battle.mock.ts 中全部 unit 的 path 配置数据
 */
export const ParamsPanel = ({
  sceneConfig,
  onUpdate
}: {
  sceneConfig: SceneProjectConfig | null;
  onUpdate?: (config: SceneProjectConfig) => void;
}) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');

  /**
   * 获取轨道配置，包含翻译和降级逻辑
   */
  const getTrackConfigWithTranslation = (type: string): TrackConfig => {
    const config = TRACK_CONFIG[type] || TRACK_CONFIG[type.toLowerCase()];
    if (config) {
      return {
        ...config,
        label: t(`tracks.${type.toLowerCase()}`, config.label)
      };
    }

    // 降级提示逻辑：如果映射表中缺失字段，返回默认配置并提供降级名称
    return {
      label: ATTR_MAP[type.toLowerCase()] || type,
      icon: <Box className="w-3.5 h-3.5" />,
      color: '#94a3b8',
      controlledFields: []
    };
  };

  const [transitionData, setTransitionData] = useState<Record<string, any>>({});
  const [expandedTransitions, setExpandedTransitions] = useState<
    Record<string, boolean>
  >({});
  const [useAnimations, setUseAnimations] = useState(true);
  const { showTransitions, setShowTransitions } = useParamsStore();

  // 1. 预处理数据
  const allUnitsData = useMemo(() => {
    if (!sceneConfig) return [];
    const units = new globalThis.Map<
      string,
      {
        id: string;
        core_content: string;
        paths: Record<string, unknown[]>;
        time: { start: number; finish: number };
      }
    >();
    for (const track of sceneConfig.tracks) {
      for (const item of track.items) {
        const current = units.get(item.eventUnitId) ?? {
          id: item.eventUnitId,
          core_content: item.eventUnitId,
          paths: {},
          time: { start: item.startMs, finish: item.startMs + item.durationMs }
        };
        current.time.start = Math.min(current.time.start, item.startMs);
        current.time.finish = Math.max(
          current.time.finish,
          item.startMs + item.durationMs
        );
        current.paths[track.type] = [
          ...(current.paths[track.type] ?? []),
          item
        ];
        units.set(item.eventUnitId, current);
      }
    }
    return Array.from(units.values());
  }, [sceneConfig]);

  const [expandedUnits, setExpandedUnits] = useState<Record<string, boolean>>(
    () => {
      const initial: Record<string, boolean> = {};
      allUnitsData.slice(0, 2).forEach((u) => (initial[u.id] = true));
      return initial;
    }
  );

  const [expandedPaths, setExpandedPaths] = useState<
    Record<string, string | null>
  >({});

  const toggleUnit = (unitId: string) => {
    setExpandedUnits((prev) => ({
      ...prev,
      [unitId]: !prev[unitId]
    }));
  };

  const togglePathType = (unitId: string, type: string) => {
    const key = `${unitId}-${type}`;
    setExpandedPaths((prev) => ({
      ...prev,
      [key]: prev[key] === type ? null : type
    }));
  };

  /**
   * 自动保存处理
   */
  const handleSave = useCallback(
    async (itemId: string, fieldPath: string, value: any) => {
      try {
        if (onUpdate && sceneConfig) {
          const path = fieldPath.split('.');
          const replaceField = (
            source: Record<string, unknown>,
            [field, ...remaining]: string[]
          ): Record<string, unknown> => {
            if (!field) return source;
            if (remaining.length === 0) return { ...source, [field]: value };
            const nested = source[field];
            return {
              ...source,
              [field]: replaceField(
                typeof nested === 'object' && nested !== null
                  ? (nested as Record<string, unknown>)
                  : {},
                remaining
              )
            };
          };
          const next = {
            ...sceneConfig,
            tracks: sceneConfig.tracks.map((track) => ({
              ...track,
              items: track.items.map((item) =>
                item.id === itemId
                  ? (replaceField(
                      item as unknown as Record<string, unknown>,
                      path
                    ) as typeof item)
                  : item
              )
            }))
          } as SceneProjectConfig;
          onUpdate(next);
        }
        message.success(
          `已保存 ${ATTR_MAP[fieldPath.split('.').pop() || ''] || fieldPath}`
        );
      } catch (err) {
        message.error('保存失败，请检查网络连接');
      }
    },
    [onUpdate, sceneConfig]
  );

  /**
   * 保存转场数据
   */
  const handleTransitionSave = (unitId: string) => {
    const data = transitionData[unitId];
    console.log(`Saving Transition for ${unitId}:`, data);
    message.success('转场设置已保存');
    setExpandedTransitions((prev) => ({ ...prev, [unitId]: false }));
  };

  /**
   * 动态表单组件渲染 (图2参考色板适配)
   * 前景色与背景色满足 WCAG 2.1 对比度 (≥4.5:1)
   */
  const renderInput = (
    unitId: string,
    fieldPath: string,
    value: any,
    label: string,
    disabled = false,
    error = false
  ) => {
    const type = typeof value;
    const commonProps = {
      disabled,
      className: cn(
        'h-8 text-[11px] bg-background border-border/60 text-foreground transition-all duration-200',
        'focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary',
        'placeholder:text-muted-foreground/70',
        disabled && 'opacity-50 cursor-not-allowed bg-muted/30 grayscale',
        error &&
          'border-destructive focus-visible:ring-destructive/50 focus-visible:border-destructive'
      ),
      onBlur: (e: any) => handleSave(unitId, fieldPath, e.target.value)
    };

    const isRequired = ['id', 'core_content', 'start', 'finish'].includes(
      fieldPath.split('.').pop() || ''
    );

    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <Label
            className={cn(
              'text-[10px] font-bold uppercase tracking-tight',
              error
                ? 'text-destructive'
                : 'text-muted-foreground/90 dark:text-muted-foreground'
            )}
          >
            {label}
            {isRequired && <span className="text-destructive ml-0.5">*</span>}
          </Label>
        </div>

        {type === 'boolean' ? (
          <div className="flex items-center gap-3 py-1">
            <Switch
              disabled={disabled}
              checked={!!value}
              onCheckedChange={(checked: boolean) =>
                handleSave(unitId, fieldPath, checked)
              }
              className="data-[state=checked]:bg-primary"
            />
            <span
              className={cn(
                'text-[10px] font-medium',
                disabled ? 'text-muted-foreground/50' : 'text-foreground/90'
              )}
            >
              {value ? '开启' : '关闭'}
            </span>
          </div>
        ) : type === 'number' ? (
          <Input
            type="number"
            defaultValue={value}
            {...commonProps}
            onChange={(e: any) => {
              const val = parseFloat(e.target.value);
              if (fieldPath.includes('volume') && (val < 0 || val > 1)) {
                message.error('音量范围需在 0-1 之间');
              }
            }}
          />
        ) : Array.isArray(value) ? (
          <div className="text-[9px] p-2 bg-muted/40 rounded border border-border/40 font-mono leading-tight text-muted-foreground/90">
            <pre className="whitespace-pre-wrap break-all">
              {JSON.stringify(value, null, 2)}
            </pre>
          </div>
        ) : (
          <Input defaultValue={value} {...commonProps} />
        )}
        {error && (
          <p className="text-[9px] font-bold text-destructive mt-0.5">
            此项为必填或格式错误
          </p>
        )}
      </div>
    );
  };

  const renderPathItems = (unitId: string, type: string, items: any[]) => {
    if (!items || items.length === 0) return null;
    const key = `${unitId}-${type}`;
    const isExpanded = expandedPaths[key] === type;
    const config = getTrackConfigWithTranslation(type);

    return (
      <div className="space-y-2">
        <button
          onClick={() => togglePathType(unitId, type)}
          className={cn(
            'w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-300 border',
            isExpanded
              ? 'bg-white/10 text-foreground border-white/20 shadow-sm'
              : 'bg-transparent text-muted-foreground border-transparent hover:bg-white/5'
          )}
          style={isExpanded ? { borderColor: `${config.color}40` } : {}}
        >
          <div className="flex items-center gap-3 text-xs font-bold tracking-tight">
            <div
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                isExpanded ? 'text-white' : 'bg-muted/50 text-muted-foreground'
              )}
              style={isExpanded ? { backgroundColor: config.color } : {}}
            >
              {config.icon}
            </div>
            {config.label}{' '}
            <span className="opacity-40 font-mono text-[10px] ml-1">
              ({items.length})
            </span>
          </div>
          <ChevronRight
            className={cn(
              'w-4 h-4 transition-transform duration-300',
              isExpanded ? 'rotate-90' : 'opacity-30'
            )}
            style={isExpanded ? { color: config.color } : {}}
          />
        </button>

        {isExpanded && (
          <div
            className="space-y-4 pl-4 border-l animate-in slide-in-from-top-2 duration-300"
            style={{ borderLeftColor: `${config.color}60` }}
          >
            {items.map((item: any, idx: number) => (
              <div
                key={idx}
                className="p-4 rounded-2xl border border-border/40 bg-muted/20 space-y-4 shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-border/20 pb-2.5">
                  <div className="text-[10px] font-black text-primary/80 flex items-center gap-2 tracking-widest uppercase">
                    <Play className="w-2.5 h-2.5 fill-current" /> 条目 #
                    {idx + 1}
                  </div>
                  {item.uuid && (
                    <span className="text-[9px] font-mono bg-muted/80 px-2 py-0.5 rounded-full text-muted-foreground border border-border/30">
                      ID: {item.uuid}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-5">
                  {Object.entries(item).map(([k, v]: [string, any]) => {
                    if (k === 'uuid') return null;

                    // 如果定义了受控字段且当前字段不在其中，则跳过渲染
                    if (
                      config.controlledFields.length > 0 &&
                      !config.controlledFields.includes(k)
                    ) {
                      return null;
                    }

                    const label = ATTR_MAP[k] || k;

                    if (
                      typeof v === 'object' &&
                      v !== null &&
                      !Array.isArray(v)
                    ) {
                      return (
                        <div
                          key={k}
                          className="space-y-3 p-3 bg-muted/30 rounded-xl border border-border/20"
                        >
                          <Label className="text-[10px] font-black text-primary uppercase flex items-center gap-2 tracking-wider">
                            <Box className="w-3.5 h-3.5" /> {label}
                          </Label>
                          <div className="grid grid-cols-1 gap-4 pl-1">
                            {Object.entries(v).map(
                              ([subK, subV]: [string, any]) => (
                                <div key={subK}>
                                  {renderInput(
                                    item.id,
                                    `${k}.${subK}`,
                                    subV,
                                    ATTR_MAP[subK] || subK
                                  )}
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={k}>{renderInput(item.id, k, v, label)}</div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 搜索过滤
  const filteredUnits = allUnitsData.filter(
    (u: any) =>
      u.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.core_content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-[#f9f9f9] dark:bg-[#1a1a1a] border-l border-border/50 shadow-2xl">
      {/* Global Header */}
      <div className="p-5 border-b border-border/30 bg-white/50 dark:bg-black/20 backdrop-blur-md">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-primary">
            <Settings2 className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">
              Global Inspector
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold text-muted-foreground uppercase">
                显示转场
              </span>
              <Switch
                checked={showTransitions}
                onCheckedChange={setShowTransitions}
                className="scale-75 data-[state=checked]:bg-primary"
              />
            </div>
            <div className="h-4 w-px bg-border/30 mx-1" />
            <DataImportButton />
          </div>
        </div>
        <h2 className="text-sm font-black text-foreground tracking-tight flex items-center gap-2">
          {sceneConfig?.sourceDocumentId || '未加载'}{' '}
          <span className="text-[10px] font-mono font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {allUnitsData.length} UNITS
          </span>
        </h2>

        {allUnitsData.length > 15 && (
          <div className="mt-4 relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <Input
              placeholder="搜索单元 ID 或内容..."
              value={searchTerm}
              onChange={(e: any) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-[11px] bg-muted/30 border-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </div>
        )}
      </div>

      {/* Split Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Main List Area (Left 60% or 100%) */}
        <div
          className={cn(
            'h-full overflow-y-auto p-5 space-y-6 thin-scrollbar transition-all duration-300 ease-in-out',
            showTransitions ? 'w-[60%]' : 'w-full'
          )}
        >
          {filteredUnits.map((unit: any, index: number) => {
            return (
              <React.Fragment key={unit.id}>
                {/* Unit Card (图2样式重构) */}
                <Card
                  className={cn(
                    'border-none overflow-hidden transition-all duration-500 relative bg-card shadow-sm',
                    expandedUnits[unit.id]
                      ? 'shadow-md ring-1 ring-black/5 dark:ring-white/5 scale-[1.02]'
                      : 'opacity-90 hover:opacity-100 hover:scale-[1.01]'
                  )}
                >
                  {/* Accent Line (左侧 4px 竖条) */}
                  <div className="absolute left-0 top-0 bottom-0 w-1 transition-colors duration-300 bg-primary" />

                  {/* Unit Header */}
                  <div
                    onClick={() => toggleUnit(unit.id)}
                    className={cn(
                      'px-5 py-4 flex items-center justify-between cursor-pointer transition-colors',
                      expandedUnits[unit.id]
                        ? 'bg-muted/10'
                        : 'hover:bg-muted/20'
                    )}
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-black font-mono uppercase tracking-[0.15em] text-foreground/40">
                        {unit.id}
                      </span>
                      <span className="text-[10px] font-bold text-foreground/80 leading-relaxed truncate max-w-[240px]">
                        {unit.core_content}
                      </span>
                    </div>
                    <ChevronRight
                      className={cn(
                        'w-4 h-4 transition-all duration-500',
                        expandedUnits[unit.id]
                          ? 'rotate-90 text-primary'
                          : 'text-muted-foreground/30'
                      )}
                    />
                  </div>

                  {/* Path Form Content */}
                  {expandedUnits[unit.id] && (
                    <CardContent className="px-5 pb-5 pt-2 border-t border-border/10 space-y-5 animate-in fade-in zoom-in-95 duration-500">
                      <div className="flex items-center justify-between pb-3 border-b border-border/20">
                        <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                          <FileJson className="w-3.5 h-3.5 opacity-50" />{' '}
                          {ATTR_MAP.paths}
                        </span>
                        <div className="flex gap-1.5">
                          {Object.entries(unit.paths || {})
                            .filter(
                              ([_, items]) =>
                                Array.isArray(items) && items.length > 0
                            )
                            .map(([type]) => {
                              const config =
                                getTrackConfigWithTranslation(type);
                              return (
                                <span
                                  key={type}
                                  className="text-[8px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter"
                                  style={{
                                    backgroundColor: `${config.color}15`,
                                    color: config.color
                                  }}
                                >
                                  {config.label}
                                </span>
                              );
                            })}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {Object.keys(TRACK_CONFIG).map((type) => {
                          const items = unit.paths?.[type];
                          if (!items || items.length === 0) return null;
                          return (
                            <React.Fragment key={type}>
                              {renderPathItems(unit.id, type, items)}
                            </React.Fragment>
                          );
                        })}
                        {/* 处理不在 TRACK_CONFIG 中的其他可能轨道 */}
                        {Object.keys(unit.paths || {}).map((type) => {
                          if (
                            TRACK_CONFIG[type] ||
                            (unit.paths?.[type]?.length ?? 0) === 0
                          )
                            return null;
                          return (
                            <React.Fragment key={type}>
                              {renderPathItems(unit.id, type, unit.paths[type])}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Transition Form (Removed, now in right panel) */}
                {/* {index < filteredUnits.length - 1 && (...)} */}
              </React.Fragment>
            );
          })}
        </div>

        {/* Transition Visualization (Right 40%) */}
        <div
          className={cn(
            'h-full border-l border-border/50 bg-card overflow-y-auto p-8 space-y-8 transition-all duration-300 ease-in-out thin-scrollbar',
            showTransitions
              ? 'w-[40%] opacity-100'
              : 'w-0 opacity-0 pointer-events-none'
          )}
        >
          <div className="flex items-center gap-3 text-primary mb-10">
            <Sparkles className="w-5 h-5 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-[0.3em]">
              过渡转场
            </span>
          </div>

          <div className="space-y-12">
            {filteredUnits.map((unit, idx) => {
              if (idx === filteredUnits.length - 1) return null;
              const nextUnit = filteredUnits[idx + 1];

              return (
                <div
                  key={`viz-${unit.id}`}
                  className="flex flex-col items-center gap-6 animate-in fade-in slide-in-from-right-10 duration-500"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  {/* Source Unit */}
                  <div className="w-full px-4 py-3 bg-muted/20 border border-border/50 rounded-xl text-center">
                    <span className="text-[10px] font-black font-mono text-foreground/40 block mb-1">
                      {unit.id}
                    </span>
                    <span className="text-[11px] font-bold text-foreground truncate block">
                      {unit.core_content}
                    </span>
                  </div>

                  {/* Transition Arrow & Form */}
                  <div className="flex flex-col items-center gap-3 w-full">
                    <div
                      className="flex flex-col items-center gap-1 group cursor-pointer"
                      onClick={() =>
                        setExpandedTransitions((prev) => ({
                          ...prev,
                          [unit.id]: !prev[unit.id]
                        }))
                      }
                    >
                      <div className="h-8 w-px bg-gradient-to-b from-primary to-transparent" />
                      <div
                        className={cn(
                          'p-1.5 rounded-full border transition-all duration-300',
                          expandedTransitions[unit.id]
                            ? 'bg-primary text-primary-foreground border-primary shadow-lg scale-110'
                            : 'bg-card text-primary border-primary/20 group-hover:border-primary'
                        )}
                      >
                        <ArrowRight
                          className={cn(
                            'w-3.5 h-3.5 transition-transform duration-500',
                            expandedTransitions[unit.id]
                              ? 'rotate-[-90deg]'
                              : 'rotate-90'
                          )}
                        />
                      </div>
                      <div className="h-8 w-px bg-gradient-to-t from-primary to-transparent" />
                    </div>

                    {/* Injected Transition Form (Inline now to avoid overlap) */}
                    {expandedTransitions[unit.id] && (
                      <div className="w-full max-w-[320px] animate-in fade-in slide-in-from-top-4 duration-500">
                        <TransitionDetail
                          data={
                            transitionData[unit.id] || DEFAULT_TRANSITION_DATA
                          }
                          onUpdate={(data) =>
                            setTransitionData((prev) => ({
                              ...prev,
                              [unit.id]: {
                                ...(prev[unit.id] || DEFAULT_TRANSITION_DATA),
                                ...data
                              }
                            }))
                          }
                          onSave={() => handleTransitionSave(unit.id)}
                        />
                      </div>
                    )}
                  </div>

                  {/* Target Unit */}
                  <div className="w-full px-4 py-3 bg-muted/20 border border-border/50 rounded-xl text-center">
                    <span className="text-[10px] font-black font-mono text-foreground/40 block mb-1">
                      {nextUnit.id}
                    </span>
                    <span className="text-[11px] font-bold text-foreground truncate block">
                      {nextUnit.core_content}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
import type { SceneProjectConfig } from '@ise/runtime-contracts';
