import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Film,
  Layers,
  MapPin,
  MessageSquare
} from 'lucide-react';

// Define types locally if not available via import to ensure self-containment
// or import them if they are exported. Assuming they are available in types.ts or similar
// For now, I'll use 'any' for complex nested types to avoid import issues,
// but in a real scenario I'd import strictly.
// Based on previous reads, NormandyData is defined in index.tsx but not exported?
// I should probably define the interface here to be safe.

interface NormandyData {
  query: string;
  introduction: string;
  spatio_temporal_context?: {
    location: string;
    time: string;
  };
  outlineItems: {
    title: string;
    descriptions: {
      title: string;
      mini_scene: {
        core_content: string;
      }[];
    }[];
  }[];
  subtitles: {
    title: string;
    subtitle: string;
    core_content?: string;
    time_range: number | [number, number];
  }[];
}

interface ScriptDataDisplayProps {
  data: NormandyData;
}

export const ScriptDataDisplay: React.FC<ScriptDataDisplayProps> = ({ data }) => {
  const [activeTab, setActiveTab] = useState<'outline' | 'timeline'>('outline');
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  if (!data) return null;

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const formatTime = (tr: number | [number, number]) => {
    if (Array.isArray(tr)) {
      return `${tr[0]}s - ${tr[1]}s`;
    }
    return `${tr}s`;
  };

  return (
    <Card className="w-full max-w-2xl bg-card/50 backdrop-blur border-primary/20 shadow-lg overflow-hidden">
      <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-primary uppercase tracking-wider">剧本概览</span>
        </div>
        <CardTitle className="text-lg font-bold text-foreground">
          {data.query || '未命名剧本'}
        </CardTitle>
        {data.introduction && (
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {data.introduction}
          </p>
        )}

        {data.spatio_temporal_context && (
          <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md border border-border/50">
              <Clock className="w-3 h-3" />
              <span>{data.spatio_temporal_context.time}</span>
            </div>
            <div className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md border border-border/50">
              <MapPin className="w-3 h-3" />
              <span>{data.spatio_temporal_context.location}</span>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <div className="flex border-b border-border/50">
          <button
            onClick={() => setActiveTab('outline')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2
              ${activeTab === 'outline'
                ? 'bg-primary/10 text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
              }`}
          >
            <Layers className="w-4 h-4" />
            大纲结构
          </button>
          <button
            onClick={() => setActiveTab('timeline')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2
              ${activeTab === 'timeline'
                ? 'bg-primary/10 text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
              }`}
          >
            <Film className="w-4 h-4" />
            时间轴 ({data.subtitles?.length || 0})
          </button>
        </div>

        <ScrollArea className="h-[400px] w-full bg-background/30">
          <div className="p-4 space-y-3">
            {activeTab === 'outline' && (
              <div className="space-y-3">
                {data.outlineItems?.map((item, i) => (
                  <div key={i} className="rounded-lg border border-border/60 overflow-hidden bg-card/40">
                    <div
                      className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => toggleExpand(`outline-${i}`)}
                    >
                      {expandedItems[`outline-${i}`] ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="font-medium text-sm text-foreground">{item.title}</span>
                      <span className="ml-auto text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                        {item.descriptions?.length || 0} 幕
                      </span>
                    </div>

                    {expandedItems[`outline-${i}`] && (
                      <div className="border-t border-border/50 bg-background/50 p-2 space-y-2">
                        {item.descriptions?.map((desc, j) => (
                          <div key={j} className="ml-2 pl-3 border-l-2 border-primary/20 py-1">
                            <div className="text-sm font-medium text-foreground/90">{desc.title}</div>
                            <div className="mt-1 space-y-1">
                              {desc.mini_scene?.map((scene, k) => (
                                <div key={k} className="text-xs text-muted-foreground bg-muted/20 p-2 rounded hover:bg-muted/30 transition-colors">
                                  {scene.core_content}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {(!data.outlineItems || data.outlineItems.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    暂无大纲数据
                  </div>
                )}
              </div>
            )}

            {activeTab === 'timeline' && (
              <div className="space-y-2">
                {data.subtitles?.map((sub, i) => (
                  <div key={i} className="flex gap-3 group">
                    <div className="flex flex-col items-center pt-1">
                      <div className="w-2 h-2 rounded-full bg-primary/40 group-hover:bg-primary transition-colors ring-2 ring-background" />
                      <div className="w-px h-full bg-border/50 -mb-2 mt-1" />
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="bg-card/40 border border-border/50 rounded-lg p-3 hover:border-primary/30 transition-colors">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="text-sm font-medium text-foreground">
                            {sub.title || sub.core_content || '未命名片段'}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                            {formatTime(sub.time_range)}
                          </span>
                        </div>
                        {sub.subtitle && (
                          <div className="flex items-start gap-2 mt-2 bg-primary/5 p-2 rounded text-xs text-primary/80">
                            <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>{sub.subtitle}</span>
                          </div>
                        )}
                        {sub.core_content && sub.core_content !== sub.title && (
                          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                            {sub.core_content}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {(!data.subtitles || data.subtitles.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    暂无时间轴数据
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
