import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWarDataStore } from '@/stores/warDataStore';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Columns,
  Copy,
  Flag,
  Globe,
  Grid,
  History as HistoryIcon,
  Layers,
  MapPin,
  Palette,
  Settings2,
  Swords,
  Tags,
  Type,
  Users,
  Zap
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { DataImportButton } from './DataImportButton';

type NarrativePanelProps = {
  selectedNode: { id: string; title: string; summary: string };
  nowText: () => string;
  onCopy: () => void;
};

type LayoutType = 'grid' | 'waterfall' | 'carousel' | 'timeline';

type LayoutConfig = {
  fontSize: number;
  fontFamily: string;
  animationDuration: number;
  themeColor?: string;
};

export const NarrativePanel: React.FC<NarrativePanelProps> = ({
  selectedNode,
  nowText,
  onCopy
}) => {
  const [layout, setLayout] = useState<LayoutType>('timeline');
  const [config, setConfig] = useState<LayoutConfig>({
    fontSize: 14,
    fontFamily: 'sans-serif',
    animationDuration: 0.5
  });
  const [showConfig, setShowConfig] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(['o1'])
  );
  const [isLoading, setIsLoading] = useState(false);

  const toggleNode = (id: string) => {
    // Simulate loading for better UX as requested
    if (!expandedNodes.has(id)) {
      setIsLoading(true);
      setTimeout(() => setIsLoading(false), 300);
    }
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const { currentData } = useWarDataStore();

  const timelineData = useMemo(() => {
    if (!currentData) return [];
    return (currentData.outline || []).map((o: any) => ({
      ...o,
      stage: o.title,
      start_time: o.time?.start?.toString(),
      end_time: o.time?.finish?.toString()
    }));
  }, [currentData]);

  const renderTimeline = () => {
    return (
      <div className="relative space-y-8 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
        {isLoading && (
          <div className="absolute inset-0 bg-background/50 backdrop-blur-[1px] z-50 flex items-start justify-center pt-20">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-background border shadow-lg animate-in fade-in zoom-in duration-200">
              <Zap className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-xs font-medium">加载中...</span>
            </div>
          </div>
        )}
        {timelineData.map((item, i) => {
          const isExpanded = expandedNodes.has(item.id);
          return (
            <div key={item.id} className="relative flex items-start group">
              {/* Timeline Indicator */}
              <div
                className={cn(
                  'absolute left-0 w-10 h-10 flex items-center justify-center rounded-full border bg-background transition-all duration-300 z-10',
                  isExpanded
                    ? 'ring-4 ring-primary/10 border-primary'
                    : 'group-hover:scale-110'
                )}
              >
                <div
                  className={cn(
                    'w-3 h-3 rounded-full',
                    isExpanded ? 'bg-primary' : 'bg-border'
                  )}
                />
              </div>

              {/* Content */}
              <div className="ml-14 flex-1">
                <div
                  onClick={() => toggleNode(item.id)}
                  className="cursor-pointer flex items-center justify-between p-4 rounded-xl border border-border bg-card/50 hover:bg-muted/30 transition-all"
                >
                  <div className="flex flex-col">
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1 text-primary">
                      Stage {i + 1}
                    </div>
                    <div className="font-semibold text-lg">{item.title}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                      <Clock className="h-3 w-3" />
                      {item.start_time} - {item.end_time}
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>

                {/* Level 2: Descriptions */}
                {isExpanded && item.descriptions && (
                  <div className="mt-4 ml-4 space-y-4 animate-in slide-in-from-top-2 duration-300">
                    {item.descriptions.map((desc: any) => {
                      const isDescExpanded = expandedNodes.has(desc.id);
                      return (
                        <div
                          key={desc.id}
                          className="relative pl-6 before:absolute before:left-0 before:top-4 before:w-4 before:h-0.5 before:bg-border"
                        >
                          <div
                            onClick={() => toggleNode(desc.id)}
                            className="cursor-pointer group flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-background/50 hover:border-primary/30 transition-all"
                          >
                            <div className="mt-1">
                              {isDescExpanded ? (
                                <ChevronDown className="h-4 w-4 text-primary" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                              )}
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium">
                                {desc.title}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                                {desc.summary}
                              </div>
                            </div>
                          </div>

                          {/* Level 3: Units */}
                          {isDescExpanded && desc.units && (
                            <div className="mt-2 ml-8 space-y-2 animate-in slide-in-from-top-1 duration-200">
                              {desc.units.map((unit: any) => (
                                <div
                                  key={unit.id}
                                  className="p-3 rounded-lg border border-dashed border-border/50 bg-muted/20 text-xs leading-relaxed group hover:border-primary/20 transition-all"
                                >
                                  <div className="flex items-center gap-2 mb-1 text-primary font-medium">
                                    <Zap className="h-3 w-3" />
                                    单元细节
                                  </div>
                                  <div className="text-muted-foreground group-hover:text-foreground transition-colors">
                                    {unit.core_content}
                                  </div>
                                  {unit.entities && (
                                    <div className="mt-2 flex flex-wrap gap-1 opacity-70">
                                      {unit.entities.persons?.map(
                                        (p: string) => (
                                          <span
                                            key={p}
                                            className="px-1.5 py-0.5 bg-primary/5 text-primary rounded text-[10px]"
                                          >
                                            @{p}
                                          </span>
                                        )
                                      )}
                                      {unit.entities.spaces?.map(
                                        (s: string) => (
                                          <span
                                            key={s}
                                            className="px-1.5 py-0.5 bg-primary/5 text-primary rounded text-[10px]"
                                          >
                                            #{s}
                                          </span>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderLayout = () => {
    if (timelineData.length === 0)
      return (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-2xl">
          暂无时空上下文数据
        </div>
      );

    switch (layout) {
      case 'timeline':
        return renderTimeline();
      case 'grid':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {timelineData.map((item, i) => (
              <div
                key={i}
                className="p-4 rounded-xl border border-border bg-card/50 hover:border-cyan-500/30 transition-all hover:shadow-lg group"
                style={{
                  borderColor: i === 0 ? config.themeColor : undefined,
                  transitionDuration: `${config.animationDuration}s`
                }}
              >
                <div
                  className="text-[10px] font-bold uppercase tracking-wider mb-1"
                  style={{ color: config.themeColor }}
                >
                  Stage {i + 1}
                </div>
                <div
                  className="font-semibold mb-2"
                  style={{
                    fontSize: config.fontSize,
                    fontFamily: config.fontFamily
                  }}
                >
                  {item.stage}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>{item.start_time}</span>
                  <div className="h-px flex-1 bg-border" />
                  <span>{item.end_time}</span>
                </div>
              </div>
            ))}
          </div>
        );
      case 'waterfall':
        return (
          <div className="columns-1 sm:columns-2 gap-4 space-y-4">
            {timelineData.map((item, i) => (
              <div
                key={i}
                className="break-inside-avoid p-4 rounded-xl border border-border bg-card/50 hover:border-cyan-500/30 transition-all"
                style={{
                  minHeight: `${100 + (i % 3) * 40}px`,
                  transitionDuration: `${config.animationDuration}s`
                }}
              >
                <div
                  className="font-semibold mb-2"
                  style={{ fontSize: config.fontSize + 2 }}
                >
                  {item.stage}
                </div>
                <div className="text-xs text-muted-foreground">
                  {item.start_time} - {item.end_time}
                </div>
                <div className="mt-4 h-1 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full"
                    style={{
                      backgroundColor: config.themeColor,
                      width: `${(i + 1) * 20}%`
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        );
      case 'carousel':
        return (
          <div className="relative h-[300px] flex items-center justify-center overflow-hidden perspective-1000">
            {timelineData.map((item, i) => {
              const offset = i - Math.floor(timelineData.length / 2);
              return (
                <div
                  key={i}
                  className="absolute w-64 p-6 rounded-2xl border border-border bg-card shadow-xl transition-all duration-500 ease-out"
                  style={{
                    transform: `translateX(${offset * 120}px) translateZ(${Math.abs(offset) * -100}px) rotateY(${offset * -15}deg)`,
                    opacity: 1 - Math.abs(offset) * 0.3,
                    zIndex: 10 - Math.abs(offset),
                    borderColor: offset === 0 ? config.themeColor : undefined,
                    transitionDuration: `${config.animationDuration}s`
                  }}
                >
                  <div className="text-center">
                    <div
                      className="text-2xl font-bold mb-4"
                      style={{ color: config.themeColor }}
                    >
                      {item.stage}
                    </div>
                    <div className="text-sm font-medium mb-1">
                      {item.start_time}
                    </div>
                    <div className="text-xs text-muted-foreground">至</div>
                    <div className="text-sm font-medium mt-1">
                      {item.end_time}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onCopy}
            title="复制节点信息"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <div className="h-4 w-px bg-border" />
          <span className="text-sm font-medium">
            {selectedNode.title || '未命名节点'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex bg-muted p-1 rounded-lg">
            <button
              onClick={() => setLayout('timeline')}
              className={cn(
                'p-1.5 rounded-md transition-all',
                layout === 'timeline'
                  ? 'bg-background shadow-sm text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <HistoryIcon className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setLayout('grid')}
              className={cn(
                'p-1.5 rounded-md transition-all',
                layout === 'grid'
                  ? 'bg-background shadow-sm text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Grid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setLayout('waterfall')}
              className={cn(
                'p-1.5 rounded-md transition-all',
                layout === 'waterfall'
                  ? 'bg-background shadow-sm text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Columns className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setLayout('carousel')}
              className={cn(
                'p-1.5 rounded-md transition-all',
                layout === 'carousel'
                  ? 'bg-background shadow-sm text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Layers className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="h-4 w-px bg-border mx-1" />
          <DataImportButton />
          <div className="h-4 w-px bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-8 w-8', showConfig && 'bg-accent')}
            onClick={() => setShowConfig(!showConfig)}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {showConfig && (
          <div className="p-4 border-b bg-muted/20 grid grid-cols-2 sm:grid-cols-4 gap-4 animate-in slide-in-from-top duration-200">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                <Palette className="h-3 w-3" /> 主题颜色
              </label>
              <div className="flex gap-2">
                {[...Array(4)].map((_, i) => (
                  <button
                    key={i}
                    onClick={() => {}}
                    className={cn(
                      'w-5 h-5 rounded-full border-2 border-transparent transition-all bg-primary/20',
                      i === 0 && 'border-white ring-2 ring-primary/50 scale-110'
                    )}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="font-size-range"
                className="text-[10px] font-medium text-muted-foreground flex items-center gap-1"
              >
                <Type className="h-3 w-3" /> 字体大小
              </label>
              <input
                id="font-size-range"
                type="range"
                min="12"
                max="24"
                step="1"
                value={config.fontSize}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    fontSize: parseInt(e.target.value, 10)
                  }))
                }
                className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="animation-duration-range"
                className="text-[10px] font-medium text-muted-foreground flex items-center gap-1"
              >
                <Zap className="h-3 w-3" /> 动画时长
              </label>
              <input
                id="animation-duration-range"
                type="range"
                min="0.1"
                max="2"
                step="0.1"
                value={config.animationDuration}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    animationDuration: parseFloat(e.target.value)
                  }))
                }
                className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="font-family-select"
                className="text-[10px] font-medium text-muted-foreground flex items-center gap-1"
              >
                <Type className="h-3 w-3" /> 字体族
              </label>
              <select
                id="font-family-select"
                value={config.fontFamily}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, fontFamily: e.target.value }))
                }
                className="w-full text-[10px] bg-background border border-border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="sans-serif">无衬线</option>
                <option value="serif">衬线</option>
                <option value="monospace">等宽</option>
              </select>
            </div>
          </div>
        )}

        <div className="p-6">
          <div className="mx-auto max-w-4xl space-y-8">
            {selectedNode.id === 'n-root' ? (
              <div className="space-y-8">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      战例概览
                    </div>
                    <div className="text-3xl font-bold tracking-tight text-primary">
                      {selectedNode.title || '未命名的脚本项目'}
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-center px-4 py-2 rounded-xl bg-muted/30 border border-border">
                      <div className="text-[10px] text-muted-foreground uppercase font-bold">
                        Nodes
                      </div>
                      <div className="text-xl font-bold">
                        {currentData.outline.length}
                      </div>
                    </div>
                    <div className="text-center px-4 py-2 rounded-xl bg-muted/30 border border-border">
                      <div className="text-[10px] text-muted-foreground uppercase font-bold">
                        Duration
                      </div>
                      <div className="text-xl font-bold">
                        {currentData.target_duration / 1000}s
                      </div>
                    </div>
                  </div>
                </div>

                {/* NEW: War Meta Information */}
                {currentData.war_meta && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-3 rounded-xl bg-muted/20 border border-border flex items-center gap-3">
                      <Clock className="h-4 w-4 text-primary" />
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase font-bold leading-none mb-1">
                          时间跨度
                        </div>
                        <div className="text-xs font-medium">
                          {currentData.war_meta.time_range}
                        </div>
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/20 border border-border flex items-center gap-3">
                      <Globe className="h-4 w-4 text-primary" />
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase font-bold leading-none mb-1">
                          主要区域
                        </div>
                        <div className="text-xs font-medium">
                          {currentData.war_meta.main_region}
                        </div>
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/20 border border-border flex items-center gap-3">
                      <Flag className="h-4 w-4 text-primary" />
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase font-bold leading-none mb-1">
                          战役类型
                        </div>
                        <div className="text-xs font-medium">
                          {currentData.war_meta.type}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <div className="w-1 h-4 rounded-full bg-primary" />
                      战例大纲
                    </div>
                  </div>
                  {renderLayout()}
                </div>

                {/* NEW: War Info & Intro */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-lg font-bold text-foreground">
                    <Flag className="h-5 w-5 text-primary" />
                    {currentData.war_name}
                  </div>
                  <div className="p-4 rounded-xl bg-muted/30 border border-border text-sm leading-relaxed text-muted-foreground">
                    {currentData.intro?.content}
                    {currentData.intro?.source_cite && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {currentData.intro.source_cite.map(
                          (cite: string, idx: number) => (
                            <span
                              key={idx}
                              className="text-[10px] px-2 py-0.5 bg-background border rounded-full text-muted-foreground"
                            >
                              {cite}
                            </span>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* NEW: Tags & Significance */}
                {currentData.tags && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {currentData.tags.battle_style
                        .split('|')
                        .map((tag: string, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium"
                          >
                            <Tags className="h-3 w-3" />
                            {tag}
                          </div>
                        ))}
                    </div>
                    <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3">
                      <Zap className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <div className="text-[10px] text-primary uppercase font-bold mb-1">
                          战略意义
                        </div>
                        <div className="text-sm text-muted-foreground italic leading-relaxed">
                          "{currentData.tags.strategic_significance}"
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* NEW: 红蓝势力划分 (OOB) */}
                {currentData.OOB && (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Swords className="h-4 w-4 text-primary" />
                      红蓝势力划分
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Blue Force */}
                      <div className="p-4 rounded-xl border border-blue-side bg-blue-side/10 space-y-2 transition-all hover:bg-blue-side/15">
                        <div className="flex justify-between items-center">
                          <div className="font-bold text-blue-side">
                            {currentData.OOB.blue_force.name}
                          </div>
                          <div className="text-xs px-2 py-0.5 bg-blue-side text-blue-side-foreground rounded-full font-bold">
                            {currentData.OOB.blue_force.troop_strength}人
                          </div>
                        </div>
                        <div className="text-xs text-blue-side/80">
                          <span className="font-bold">指挥官:</span>{' '}
                          {currentData.OOB.blue_force.commander}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(currentData.OOB.blue_force.main_units ?? []).map(
                            (u: string, i: number) => (
                              <span
                                key={i}
                                className="text-[10px] px-1.5 py-0.5 bg-blue-side/20 border border-blue-side/30 rounded text-blue-side font-medium"
                              >
                                {u}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                      {/* Red Force */}
                      <div className="p-4 rounded-xl border border-red-side bg-red-side/10 space-y-2 transition-all hover:bg-red-side/15">
                        <div className="flex justify-between items-center">
                          <div className="font-bold text-red-side">
                            {currentData.OOB.red_force.name}
                          </div>
                          <div className="text-xs px-2 py-0.5 bg-red-side text-red-side-foreground rounded-full font-bold">
                            {currentData.OOB.red_force.troop_strength}人
                          </div>
                        </div>
                        <div className="text-xs text-red-side/80">
                          <span className="font-bold">指挥官:</span>{' '}
                          {currentData.OOB.red_force.commander}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(currentData.OOB.red_force.main_units ?? []).map(
                            (u: string, i: number) => (
                              <span
                                key={i}
                                className="text-[10px] px-1.5 py-0.5 bg-red-side/20 border border-red-side/30 rounded text-red-side font-medium"
                              >
                                {u}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* NEW: Entity Registry */}
                {currentData.entity_registry && (
                  <div className="space-y-4">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-primary" />
                      关键实体注册表
                    </div>

                    <div className="space-y-4">
                      {/* Persons - Three Column Layout */}
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <Users className="h-3 w-3" /> 人物阵营划分
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Red Column */}
                          <div
                            className="flex flex-col gap-2 p-3 rounded-xl border border-red-side/30 bg-red-side/5 min-h-[120px] transition-all"
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.currentTarget.classList.add(
                                'bg-red-side/10',
                                'border-red-side/50'
                              );
                            }}
                            onDragLeave={(e) => {
                              e.currentTarget.classList.remove(
                                'bg-red-side/10',
                                'border-red-side/50'
                              );
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.currentTarget.classList.remove(
                                'bg-red-side/10',
                                'border-red-side/50'
                              );
                              const personId =
                                e.dataTransfer.getData('personId');
                              const fromCamp =
                                e.dataTransfer.getData('fromCamp');
                              if (fromCamp !== 'red') {
                                // Trigger camp switching logic here if state management is available
                                console.log(`Switching ${personId} to red`);
                              }
                            }}
                          >
                            <div className="text-[10px] font-black text-red-side uppercase tracking-widest mb-1 flex items-center justify-between border-b border-red-side/20 pb-1">
                              <span>红方势力</span>
                              <span className="opacity-50 font-bold">
                                RED FORCE
                              </span>
                            </div>
                            <div className="flex flex-col gap-2">
                              {currentData.entity_registry.persons
                                .filter((p: any) => p.camp === 'red')
                                .map((p: any) => (
                                  <div
                                    key={p.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData('personId', p.id);
                                      e.dataTransfer.setData('fromCamp', 'red');
                                      e.currentTarget.classList.add(
                                        'opacity-50'
                                      );
                                    }}
                                    onDragEnd={(e) => {
                                      e.currentTarget.classList.remove(
                                        'opacity-50'
                                      );
                                    }}
                                    className="flex items-center justify-between px-3 py-2 rounded-lg border border-red-side/20 bg-card hover:border-red-side/40 transition-all cursor-grab active:cursor-grabbing shadow-sm"
                                  >
                                    <span className="text-xs font-bold text-red-side">
                                      {p.name}
                                    </span>
                                    <span className="text-[9px] font-black text-red-side/70 bg-red-side/10 px-1.5 py-0.5 rounded-full border border-red-side/20">
                                      {p.role}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>

                          {/* Blue Column */}
                          <div
                            className="flex flex-col gap-2 p-3 rounded-xl border border-blue-side/30 bg-blue-side/5 min-h-[120px] transition-all"
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.currentTarget.classList.add(
                                'bg-blue-side/10',
                                'border-blue-side/50'
                              );
                            }}
                            onDragLeave={(e) => {
                              e.currentTarget.classList.remove(
                                'bg-blue-side/10',
                                'border-blue-side/50'
                              );
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.currentTarget.classList.remove(
                                'bg-blue-side/10',
                                'border-blue-side/50'
                              );
                              const personId =
                                e.dataTransfer.getData('personId');
                              const fromCamp =
                                e.dataTransfer.getData('fromCamp');
                              if (fromCamp !== 'blue') {
                                console.log(`Switching ${personId} to blue`);
                              }
                            }}
                          >
                            <div className="text-[10px] font-black text-blue-side uppercase tracking-widest mb-1 flex items-center justify-between border-b border-blue-side/20 pb-1">
                              <span>蓝方势力</span>
                              <span className="opacity-50 font-bold">
                                BLUE FORCE
                              </span>
                            </div>
                            <div className="flex flex-col gap-2">
                              {currentData.entity_registry.persons
                                .filter((p: any) => p.camp === 'blue')
                                .map((p: any) => (
                                  <div
                                    key={p.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData('personId', p.id);
                                      e.dataTransfer.setData(
                                        'fromCamp',
                                        'blue'
                                      );
                                      e.currentTarget.classList.add(
                                        'opacity-50'
                                      );
                                    }}
                                    onDragEnd={(e) => {
                                      e.currentTarget.classList.remove(
                                        'opacity-50'
                                      );
                                    }}
                                    className="flex items-center justify-between px-3 py-2 rounded-lg border border-blue-side/20 bg-card hover:border-blue-side/40 transition-all cursor-grab active:cursor-grabbing shadow-sm"
                                  >
                                    <span className="text-xs font-bold text-blue-side">
                                      {p.name}
                                    </span>
                                    <span className="text-[9px] font-black text-blue-side/70 bg-blue-side/10 px-1.5 py-0.5 rounded-full border border-blue-side/20">
                                      {p.role}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>

                          {/* Neutral Column */}
                          {currentData.entity_registry.persons.filter(
                            (p: any) => p.camp !== 'red' && p.camp !== 'blue'
                          ).length > 0 && (
                            <div
                              className="flex flex-col gap-2 p-3 rounded-xl border border-border bg-muted/20 min-h-[120px] transition-all"
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.add(
                                  'bg-muted/40',
                                  'border-muted-foreground/40'
                                );
                              }}
                              onDragLeave={(e) => {
                                e.currentTarget.classList.remove(
                                  'bg-muted/40',
                                  'border-muted-foreground/40'
                                );
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.remove(
                                  'bg-muted/40',
                                  'border-muted-foreground/40'
                                );
                                const personId =
                                  e.dataTransfer.getData('personId');
                                const fromCamp =
                                  e.dataTransfer.getData('fromCamp');
                                if (fromCamp !== 'neutral') {
                                  console.log(
                                    `Switching ${personId} to neutral`
                                  );
                                }
                              }}
                            >
                              <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1 flex items-center justify-between border-b border-border/50 pb-1">
                                <span>中立力量</span>
                                <span className="opacity-50 font-bold">
                                  NEUTRAL FORCE
                                </span>
                              </div>
                              <div className="flex flex-col gap-2">
                                {currentData.entity_registry.persons
                                  .filter(
                                    (p: any) =>
                                      p.camp !== 'red' && p.camp !== 'blue'
                                  )
                                  .map((p: any) => (
                                    <div
                                      key={p.id}
                                      draggable
                                      onDragStart={(e) => {
                                        e.dataTransfer.setData(
                                          'personId',
                                          p.id
                                        );
                                        e.dataTransfer.setData(
                                          'fromCamp',
                                          'neutral'
                                        );
                                        e.currentTarget.classList.add(
                                          'opacity-50'
                                        );
                                      }}
                                      onDragEnd={(e) => {
                                        e.currentTarget.classList.remove(
                                          'opacity-50'
                                        );
                                      }}
                                      className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-card hover:border-muted-foreground/20 transition-all cursor-grab active:cursor-grabbing shadow-sm"
                                    >
                                      <span className="text-xs font-bold text-foreground">
                                        {p.name}
                                      </span>
                                      <span className="text-[9px] font-black text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded-full border border-border/50">
                                        {p.role}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Spaces - Visual Labels */}
                      <div className="p-4 rounded-xl border border-primary/20 bg-space-side/10 shadow-sm transition-all hover:bg-space-side/15">
                        <div className="text-xs font-black text-space-side-foreground mb-4 flex items-center gap-2 uppercase tracking-widest border-b border-space-side/20 pb-2">
                          <MapPin className="h-3.5 w-3.5" /> 地点与地理坐标
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {currentData.entity_registry.spaces.map((s: any) => (
                            <div
                              key={s.id}
                              className="group relative flex flex-col gap-1 p-2.5 rounded-lg border border-space-side/20 bg-card hover:bg-space-side/5 hover:border-space-side/50 transition-all duration-300 shadow-sm"
                            >
                              <div className="flex items-center gap-2">
                                <div className="p-1.5 rounded-full bg-space-side/20 text-space-side-foreground shadow-inner">
                                  <MapPin className="h-2.5 w-2.5" />
                                </div>
                                <span className="text-xs font-black text-space-side-foreground truncate">
                                  {s.name}
                                </span>
                              </div>

                              {/* Hover Indicator */}
                              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="w-1.5 h-1.5 rounded-full bg-space-side animate-pulse" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              (() => {
                const outlineList = currentData.outline;

                const match = selectedNode.id.match(/^n-outline-(\d+)$/);
                const idx = match ? Number(match[match.length - 1]) : -1;
                const item =
                  idx >= 0 && idx < (outlineList || []).length
                    ? outlineList[idx]
                    : undefined;

                if (!item) {
                  return (
                    <div className="text-xs text-muted-foreground">
                      找不到对应的提要数据
                    </div>
                  );
                }

                return (
                  <>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2">
                        标题
                      </div>
                      <div className="text-lg font-semibold text-foreground flex items-center justify-between">
                        {item.title}
                        {item.time && (
                          <div className="flex items-center gap-1 text-xs font-normal text-muted-foreground bg-muted px-2 py-1 rounded-full">
                            <Clock className="h-3 w-3" />
                            {item.time.start} - {item.time.finish}
                          </div>
                        )}
                      </div>
                      {item.outline_meta && (
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <div className="p-2 rounded-lg bg-muted/30 border border-border">
                            <div className="text-[10px] text-muted-foreground mb-1">
                              阶段
                            </div>
                            <div className="text-xs font-medium">
                              {item.outline_meta.phase}
                            </div>
                          </div>
                          <div className="p-2 rounded-lg bg-muted/30 border border-border">
                            <div className="text-[10px] text-muted-foreground mb-1">
                              叙事作用
                            </div>
                            <div className="text-xs font-medium">
                              {item.outline_meta.narrative_role}
                            </div>
                          </div>
                          <div className="p-2 rounded-lg bg-muted/30 border border-border">
                            <div className="text-[10px] text-muted-foreground mb-1">
                              战略焦点
                            </div>
                            <div
                              className="text-xs font-medium line-clamp-1"
                              title={item.outline_meta.strategic_focus}
                            >
                              {item.outline_meta.strategic_focus}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-xs font-medium text-muted-foreground">
                          子提要列表
                        </div>
                        <div className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          共 {item.descriptions?.length || 0} 个
                        </div>
                      </div>
                      <div className="space-y-3">
                        {item.descriptions && item.descriptions.length > 0 ? (
                          item.descriptions.map((d: any, i2: number) => (
                            <div
                              key={i2}
                              className="group rounded-xl border border-border bg-muted/30 p-3 hover:bg-muted/50 hover:border-primary/20 transition-all"
                            >
                              <div className="flex items-start gap-3">
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary group-hover:bg-primary/20">
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
                                  {d.units && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {d.units.map((u: any, uIdx: number) => (
                                        <span
                                          key={uIdx}
                                          className="text-[10px] px-1.5 py-0.5 bg-background border rounded text-muted-foreground truncate max-w-[150px]"
                                        >
                                          {u.core_content}
                                        </span>
                                      ))}
                                    </div>
                                  )}
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
                  </>
                );
              })()
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
