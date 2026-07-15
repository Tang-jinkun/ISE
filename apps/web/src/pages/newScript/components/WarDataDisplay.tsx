import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type WarData } from '@/mock/types';
import {
  Activity,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Map as MapIcon,
  Scan,
  Sparkles,
  Target
} from 'lucide-react';
import React, { useState } from 'react';

interface WarDataDisplayProps {
  data: WarData;
  onParse?: () => void;
}

export const WarDataDisplay: React.FC<WarDataDisplayProps> = ({
  data,
  onParse
}) => {
  const [expanded, setExpanded] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showOutline, setShowOutline] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>(
    {}
  );

  if (!data) return null;

  const toggleItemExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleParseClick = () => {
    if (parsing) return;

    // 如果已经解析并展示了右侧面板，点击此按钮仅重新触发面板展示逻辑
    if (expanded) {
      if (onParse) {
        onParse();
      }
      return;
    }

    setParsing(true);
    setProgress(0);

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setParsing(false);
            setExpanded(true);
            if (onParse) {
              onParse();
            }
          }, 200);
          return 100;
        }
        return prev + 5;
      });
    }, 50);
  };

  return (
    <Card className="w-full bg-gradient-to-br from-card/90 to-card/50 backdrop-blur-md border-primary/20 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md hover:border-primary/30">
      <CardHeader className="relative pb-2 border-b border-border/50 bg-muted/10 p-3">
        {/* Background decorative elements */}
        <div className="absolute top-0 right-0 p-2 opacity-10">
          <Activity className="w-16 h-16 text-primary" />
        </div>

        <div className="flex items-start justify-between relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/20 text-primary uppercase tracking-wider border border-primary/20">
                战役情报
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Globe className="w-3 h-3" />
                历史档案
              </span>
            </div>
            <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
              {data.war_name}
              <Sparkles className="w-3 h-3 text-primary animate-pulse" />
            </CardTitle>
          </div>
        </div>

        {data.intro && (
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-3">
            {data.intro}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="bg-card/40 p-2 rounded-lg border border-border/40 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              <Clock className="w-3 h-3 text-primary" />
              时间跨度
            </div>
            <div className="text-[10px] font-medium text-foreground/90 leading-tight">
              {data.spatio_temporal_context?.time || '未知时间'}
            </div>
          </div>
          <div className="bg-card/40 p-2 rounded-lg border border-border/40 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              <MapIcon className="w-3 h-3 text-primary" />
              核心区域
            </div>
            <div className="text-[10px] font-medium text-foreground/90 leading-tight">
              {data.spatio_temporal_context?.location || '未知地点'}
            </div>
          </div>
        </div>

        {/* 关键人物与战略目标 */}
        {/* <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="bg-card/40 p-2 rounded-lg border border-border/40 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              <Users className="w-3 h-3 text-primary" />
              关键人物
            </div>
            <div className="text-[10px] font-medium text-foreground/90 leading-tight line-clamp-2">
              曹操、孙权、刘备、周瑜、诸葛亮、黄盖
            </div>
          </div>
          <div className="bg-card/40 p-2 rounded-lg border border-border/40 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              <Target className="w-3 h-3 text-primary" />
              战略目标
            </div>
            <div className="text-[10px] font-medium text-foreground/90 leading-tight line-clamp-2">
              曹操意图统一全国，孙刘联盟保卫江东与荆州
            </div>
          </div>
        </div> */}

        {/* 伤亡情况 */}
        {/* <div className="mt-2 bg-card/40 p-2 rounded-lg border border-border/40 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
            <Activity className="w-3 h-3 text-primary" />
            伤亡情况
          </div>
          <div className="text-[10px] font-medium text-foreground/90 leading-tight">
            曹军死伤惨重（过半），联军损失较小
          </div>
        </div> */}

        {/* Outline Section Toggle */}
        {data.outline && data.outline.length > 0 && (
          <div className="mt-3 border-t border-border/50 pt-3">
            <button
              onClick={() => setShowOutline(!showOutline)}
              className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded-lg transition-colors group"
            >
              <div className="flex items-center gap-2">
                <div className="p-1 bg-primary/10 rounded-md group-hover:bg-primary/20 transition-colors">
                  <BookOpen className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="font-bold text-xs text-foreground/90">
                  战役大纲
                </span>
                <span className="px-1.5 py-0.5 rounded-full bg-muted text-[10px] text-muted-foreground font-medium">
                  {data.outline.length} 幕
                </span>
              </div>
              <ChevronDown
                className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-300 ${
                  showOutline ? 'rotate-180' : ''
                }`}
              />
            </button>

            <div
              className={`grid transition-[grid-template-rows] duration-500 ease-in-out ${
                showOutline
                  ? 'grid-rows-[1fr] opacity-100 mt-2'
                  : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                <div className="space-y-2 px-1">
                  {data.outline.map((item, idx) => {
                    const itemId = `outline-${idx}`;
                    const isItemExpanded = expandedItems[itemId];

                    return (
                      <div
                        key={idx}
                        className="border border-border/40 rounded-lg overflow-hidden bg-card/20"
                      >
                        <div
                          className="flex items-center justify-between p-3 cursor-pointer hover:bg-primary/5 transition-colors"
                          onClick={(e) => toggleItemExpand(itemId, e)}
                        >
                          <span className="font-medium text-sm text-foreground/90">
                            {item.title}
                          </span>
                          {isItemExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>

                        {isItemExpanded && item.descriptions && (
                          <div className="p-3 bg-background/40 border-t border-border/30 space-y-3 animate-in slide-in-from-top-1 duration-300">
                            {item.descriptions.map((desc, dIdx) => (
                              <div
                                key={dIdx}
                                className="pl-3 border-l-2 border-primary/20"
                              >
                                <div className="text-xs font-bold text-foreground/80 mb-1">
                                  {desc.title}
                                </div>
                                <div className="space-y-1">
                                  {desc.mini_scene?.map((scene, sIdx) => (
                                    <p
                                      key={sIdx}
                                      className="text-xs text-muted-foreground leading-relaxed"
                                    >
                                      • {scene.core_content}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          {data.spatio_temporal_context?.timeline && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20">
              <Activity className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-medium text-primary">
                {data.spatio_temporal_context.timeline.length} 个战役阶段
              </span>
            </div>
          )}
          {data.outline && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20">
              <Target className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-medium text-primary">
                {data.outline.length} 个核心情节
              </span>
            </div>
          )}
        </div>

        {/* Big "Parse" / Analysis Button - The main call to action */}
        <div className="mt-6 flex justify-center px-4 pb-2">
          <Button
            onClick={handleParseClick}
            disabled={parsing}
            className={`
              relative group overflow-hidden w-full max-w-sm h-12 rounded-xl shadow-lg
              transition-all duration-500 ease-out transform hover:-translate-y-0.5
              ${
                expanded
                  ? 'bg-secondary/80 text-secondary-foreground hover:bg-secondary'
                  : 'bg-primary text-primary-foreground hover:shadow-primary/25 hover:shadow-2xl'
              }
            `}
          >
            {/* Progress Bar Background */}
            {parsing && (
              <div
                className="absolute left-0 top-0 bottom-0 bg-primary/30 z-0 transition-all duration-100 ease-linear"
                style={{ width: `${progress}%` }}
              />
            )}

            {/* Shimmer effect */}
            {!expanded && !parsing && (
              <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            )}

            <div className="flex items-center gap-2.5 z-10 font-bold tracking-wider text-sm relative">
              {parsing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                  <span>正在解析战役数据 {progress}%...</span>
                </>
              ) : (
                <>
                  <Scan className="w-4 h-4 animate-pulse" />
                  <span>解析结果</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </div>
          </Button>
        </div>
      </CardHeader>

      {/* Expandable Content Area */}
      <div
        className={`
          transition-[max-height,opacity] duration-500 ease-in-out overflow-hidden
          ${expanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}
        `}
      >
        <CardContent className="p-0 bg-background/30">
          <ScrollArea className="h-[500px] w-full custom-scrollbar">
            <div className="p-4 space-y-6">
              {/* Spatio-Temporal Context */}
              {data.spatio_temporal_context && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-card/60 p-3 rounded-lg border border-border/50 flex items-start gap-3">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <Clock className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-0.5">
                        发生时间
                      </div>
                      <div className="text-sm font-semibold text-foreground/90">
                        {data.spatio_temporal_context.time}
                      </div>
                    </div>
                  </div>

                  <div className="bg-card/60 p-3 rounded-lg border border-border/50 flex items-start gap-3">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <MapIcon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-0.5">
                        地理位置
                      </div>
                      <div className="text-sm font-semibold text-foreground/90">
                        {data.spatio_temporal_context.location}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Timeline Preview */}
              {data.spatio_temporal_context?.timeline && (
                <div className="space-y-2">
                  <h4 className="text-sm font-bold flex items-center gap-2 text-foreground/80">
                    <Activity className="w-4 h-4 text-primary" />
                    战役阶段
                  </h4>
                  <div className="relative pl-2 ml-1 border-l-2 border-primary/20 space-y-3">
                    {data.spatio_temporal_context.timeline.map((stage, idx) => (
                      <div key={idx} className="relative pl-4 group">
                        <div className="absolute -left-[9px] top-1.5 w-3 h-3 rounded-full bg-background border-2 border-primary/40 group-hover:border-primary transition-colors" />
                        <div className="bg-card/40 p-2 rounded border border-primary/20 hover:border-primary/40 hover:bg-primary/10 transition-colors">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-medium text-foreground/90 group-hover:text-primary transition-colors">
                              {stage.stage}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {stage.start_time} - {stage.end_time}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Outline Data Removed from here as it's now in the main view */}
            </div>
          </ScrollArea>
        </CardContent>
      </div>
    </Card>
  );
};
