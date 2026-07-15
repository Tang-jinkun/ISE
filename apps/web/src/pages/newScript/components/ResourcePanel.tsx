import type { Diagnostic, SceneProjectConfig } from '@ise/runtime-contracts';
import { cn } from '@/lib/utils';
import {
  Activity,
  Box,
  Camera,
  Clock,
  Info,
  Layers,
  Link,
  Map as MapIcon,
  MapPin,
  Type,
  Users
} from 'lucide-react';
import { useMemo } from 'react';
import { DataImportButton } from './DataImportButton';
import { isSceneTrackType } from './sceneTrackMetadata';

/**
 * 叙事单元接口定义 (扩展 WarUnit 以包含业务分类)
 */
interface NarrativeUnit {
  id: string;
  core_content: string;
  time: { start: number; finish: number };
  paths: Record<string, unknown[]>;
  category: string;
  logic_causal?: { role?: string };
  entities?: {
    persons?: string[];
    spaces?: string[];
    objects?: string[];
    events?: string[];
  };
  relation?: unknown[];
  view_bbox?: [[number, number], [number, number]];
}

/**
 * ResourcePanel 组件
 * 可视化展示叙事单元数据为竖型时间线
 */
export const ResourcePanel = ({
  sceneConfig,
  diagnostics
}: {
  sceneConfig: SceneProjectConfig | null;
  diagnostics: Diagnostic[];
}) => {

  // 解析并处理数据：将所有 units 提取出来，并标记其所属分类
  const timelineUnits = useMemo(() => {
    if (!sceneConfig) return [];
    const units = new globalThis.Map<string, NarrativeUnit>();
    for (const track of sceneConfig.tracks) {
      if (!isSceneTrackType(track.type)) continue;
      for (const item of track.items) {
        const current = units.get(item.eventUnitId) ?? {
          id: item.eventUnitId,
          core_content: item.eventUnitId,
          time: { start: item.startMs, finish: item.startMs + item.durationMs },
          paths: {},
          category: '场景事件'
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

    // 按时间顺序排列
    return Array.from(units.values()).sort(
      (a, b) => a.time.start - b.time.start
    );
  }, [sceneConfig]);

  /**
   * 统计路径类型的数量
   */
  const getPathCounts = (paths: NarrativeUnit['paths']) => {
    if (!paths) return [];
    const counts = [
      {
        key: 'subtitle',
        label: '字幕',
        icon: <Type className="w-3 h-3" />,
        count: paths.subtitle?.length || 0
      },
      {
        key: 'geojson',
        label: '地理',
        icon: <MapIcon className="w-3 h-3" />,
        count: paths.geojson?.length || 0
      },
      {
        key: 'video',
        label: '视频',
        icon: <Camera className="w-3 h-3" />,
        count: paths.video?.length || 0
      },
      {
        key: 'image',
        label: '图片',
        icon: <Layers className="w-3 h-3" />,
        count: paths.image?.length || 0
      },
      {
        key: 'marker',
        label: '标注',
        icon: <MapPin className="w-3 h-3" />,
        count: paths.marker?.length || 0
      },
      {
        key: 'camera',
        label: '镜头',
        icon: <Camera className="w-3 h-3" />,
        count: paths.camera?.length || 0
      },
      {
        key: 'model',
        label: '模型',
        icon: <Box className="w-3 h-3" />,
        count: paths.model?.length || 0
      }
    ];
    return counts.filter((c) => c.count > 0);
  };

  /**
   * 逻辑角色标签样式
   */
  const getRoleStyle = (role: string) => {
    switch (role) {
      case 'cause':
        return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      case 'decision':
        return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20';
      case 'action':
        return 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20';
      case 'result':
        return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* 头部信息 */}
      <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary mb-1">
            <Info className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider">
              叙事单元时间线
            </span>
          </div>
          <h2 className="text-lg font-bold">
            {sceneConfig?.sourceDocumentId || '未加载数据'}
          </h2>
        </div>
        <DataImportButton />
      </div>

      {diagnostics.length > 0 && (
        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {diagnostics.map((diagnostic) => (
            <p key={`${diagnostic.code}:${diagnostic.message}`}>
              {diagnostic.message}
            </p>
          ))}
        </div>
      )}

      {/* 时间线滚动区域 */}
      <div className="flex-1 overflow-y-auto p-6 thin-scrollbar">
        <div className="relative max-w-3xl mx-auto">
          {/* 竖向轴线 */}
          <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/50 via-border to-transparent -translate-x-1/2 hidden md:block" />
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border md:hidden" />

          <div className="space-y-12">
            {timelineUnits.map((unit, index) => (
              <div
                key={unit.id}
                className={cn(
                  'relative flex flex-col md:flex-row items-start md:items-center gap-8 group',
                  index % 2 === 0 ? 'md:flex-row-reverse' : ''
                )}
              >
                {/* 时间点指示器 */}
                <div className="absolute left-4 md:left-1/2 top-0 w-8 h-8 rounded-full border-4 border-background bg-primary shadow-lg shadow-primary/20 -translate-x-1/2 z-10 transition-transform group-hover:scale-125" />

                {/* 内容卡片 */}
                <div
                  className={cn(
                    'flex-1 w-full md:w-[45%] ml-10 md:ml-0',
                    index % 2 === 0 ? 'md:text-right' : 'md:text-left'
                  )}
                >
                  <div className="p-5 rounded-2xl border border-border bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all duration-300">
                    {/* 分类标签与逻辑角色 */}
                    <div
                      className={cn(
                        'flex flex-wrap items-center gap-2 mb-3',
                        index % 2 === 0 ? 'md:justify-end' : 'md:justify-start'
                      )}
                    >
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-tight border border-primary/20">
                        {unit.category}
                      </span>
                      {unit.logic_causal?.role && (
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight border',
                            'bg-primary/10 text-primary border-primary/20'
                          )}
                        >
                          {unit.logic_causal.role}
                        </span>
                      )}
                    </div>

                    {/* 核心内容 */}
                    <p className="text-sm font-medium text-foreground leading-relaxed mb-4">
                      {unit.core_content}
                    </p>

                    {/* 实体标签组 */}
                    <div
                      className={cn(
                        'flex flex-wrap gap-2 mb-4',
                        index % 2 === 0 ? 'md:justify-end' : 'md:justify-start'
                      )}
                    >
                      {unit.entities?.persons?.map((p) => (
                        <span
                          key={p}
                          className="flex items-center gap-1 text-[10px] bg-primary/5 text-primary px-1.5 py-0.5 rounded border border-primary/10"
                        >
                          <Users className="w-2.5 h-2.5" /> {p}
                        </span>
                      ))}
                      {unit.entities?.spaces?.map((s) => (
                        <span
                          key={s}
                          className="flex items-center gap-1 text-[10px] bg-primary/5 text-primary px-1.5 py-0.5 rounded border border-primary/10"
                        >
                          <MapPin className="w-2.5 h-2.5" /> {s}
                        </span>
                      ))}
                      {unit.entities?.objects?.map((o) => (
                        <span
                          key={o}
                          className="flex items-center gap-1 text-[10px] bg-primary/5 text-primary px-1.5 py-0.5 rounded border border-primary/10"
                        >
                          <Box className="w-2.5 h-2.5" /> {o}
                        </span>
                      ))}
                      {unit.entities?.events?.map((e) => (
                        <span
                          key={e}
                          className="flex items-center gap-1 text-[10px] bg-primary/5 text-primary px-1.5 py-0.5 rounded border border-primary/10"
                        >
                          <Activity className="w-2.5 h-2.5" /> {e}
                        </span>
                      ))}
                    </div>

                    {/* 素材统计 & 关联信息 */}
                    <div
                      className={cn(
                        'flex flex-wrap gap-x-4 gap-y-2 py-3 border-y border-border/50 mb-3',
                        index % 2 === 0
                          ? 'md:justify-end text-right'
                          : 'md:justify-start text-left'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {getPathCounts(unit.paths).map((count) => (
                          <div
                            key={count.key}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground"
                            title={count.label}
                          >
                            <span className="text-primary">{count.icon}</span>
                            <span className="font-mono">{count.count}</span>
                          </div>
                        ))}
                      </div>
                      {unit.relation && unit.relation.length > 0 && (
                        <div className="flex items-center gap-1 text-[10px] text-cyan-600 font-bold">
                          <Link className="w-3 h-3" />
                          <span>{unit.relation.length} RELATIONS</span>
                        </div>
                      )}
                    </div>

                    {/* 底部时间信息 */}
                    <div
                      className={cn(
                        'flex items-center gap-3 text-[10px] text-muted-foreground/60',
                        index % 2 === 0 ? 'md:justify-end' : 'md:justify-start'
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span className="font-mono">
                          {unit.time.start}ms - {unit.time.finish}ms
                        </span>
                      </div>

                      {unit.view_bbox && (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 opacity-50" />
                          <span className="font-mono">
                            {unit.view_bbox[0][0]}, {unit.view_bbox[0][1]}...
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 另一侧的时间标注 (仅桌面端显示) */}
                <div
                  className={cn(
                    'hidden md:block flex-1 text-xs font-bold text-primary opacity-50 group-hover:opacity-100 uppercase tracking-widest',
                    index % 2 === 0 ? 'text-left' : 'text-right'
                  )}
                >
                  UNIT {index + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
