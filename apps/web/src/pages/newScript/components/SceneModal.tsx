import type { SceneProjectConfig } from '@ise/runtime-contracts';
import { createScene } from '@/api/scene';
import { Dragger } from '@/components/common/Dragger';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  Activity,
  ArrowRight,
  Camera,
  Image as ImageIcon,
  Map as MapIcon,
  Minus,
  Music,
  Play,
  Plus,
  Type,
  Video,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataImportButton } from './DataImportButton';

const getTypeIcon = (type: string) => {
  switch (type.toLowerCase()) {
    case 'viewchange':
    case 'mapease':
    case 'camera':
      return <ArrowRight className="w-3.5 h-3.5" />;
    case 'camera_rotate':
    case 'camerarotate':
      return <Camera className="w-3.5 h-3.5" />;
    case 'camera_along':
    case 'cameraalong':
      return <Activity className="w-3.5 h-3.5" />;
    case 'video':
    case 'videovision':
      return <Video className="w-3.5 h-3.5" />;
    case 'picture':
      return <ImageIcon className="w-3.5 h-3.5" />;
    case 'audio':
    case 'music':
      return <Music className="w-3.5 h-3.5" />;
    case 'text':
    case 'subtitles':
    case 'subtitle':
      return <Type className="w-3.5 h-3.5" />;
    case 'geojson':
    case 'map':
      return <MapIcon className="w-3.5 h-3.5" />;
    default:
      return <Play className="w-3.5 h-3.5" />;
  }
};

const getClipStyle = (type?: string) => {
  const t = type?.toLowerCase();
  if (t === 'viewchange' || t === 'mapease' || t === 'camera')
    return 'bg-blue-600/80 border-blue-400';
  if (t === 'subtitles' || t === 'subtitle' || t === 'text')
    return 'bg-green-600/80 border-green-400';
  if (t === 'picture') return 'bg-red-600/80 border-red-400';
  if (t === 'audio' || t === 'music') return 'bg-green-600/80 border-green-400';
  if (t === 'video' || t === 'videovision')
    return 'bg-purple-600/80 border-purple-400';
  if (t === 'geojson' || t === 'map')
    return 'bg-orange-600/80 border-orange-400';
  return 'bg-blue-500';
};

interface SceneModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  config: SceneProjectConfig | null;
}

export interface TimelineItem {
  title: string;
  start: number;
  finish: number;
  name?: string;
  itemType?: string;
}

export interface PathTrack {
  id: string;
  type: string;
  name: string;
  sceneItems: TimelineItem[];
}

const TYPE_LABELS: Record<string, string> = {
  viewchange: '视角转移',
  camera_rotate: '视角旋转',
  camera_along: '视角跟随',
  video: '视频轨道',
  picture: '图片轨道',
  audio: '音频轨道',
  text: '文本轨道',
  geojson: '地图矢量',
  image_raster: '地图影像',
  marker: '地图图标',
  dynamic_line: '动态绘线',
  plot_symbol: '军事标绘'
};

const TYPE_COLORS: Record<string, string> = {
  Picture: 'var(--brand-color)',
  Video: 'var(--brand-color)',
  Audio: 'var(--brand-color)',
  Text: 'var(--brand-color)',
  CameraRotate: 'var(--brand-color)',
  CameraAlong: 'var(--brand-color)',
  Dynamiclayer: 'var(--brand-color)',
  GeoJson: 'var(--brand-color)',
  ImageRaster: 'var(--brand-color)',
  MapEase: 'var(--brand-color)',
  Marker: 'var(--brand-color)'
};

const TYPE_MAP: Record<string, string> = {
  viewchange: 'MapEase',
  camera_rotate: 'CameraRotate',
  camera_along: 'CameraAlong',
  video: 'Video',
  picture: 'Picture',
  audio: 'Audio',
  text: 'Text',
  geojson: 'GeoJson',
  image_raster: 'ImageRaster',
  marker: 'Marker',
  dynamic_line: 'Dynamiclayer'
};

export const SceneModal: React.FC<SceneModalProps> = ({
  isOpen,
  onClose,
  title,
  config
}) => {
  const navigate = useNavigate();
  const sumtime = config?.totalDurationMs ?? 0;

  // Timeline-like state
  const [scale, setScale] = useState(1);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1000);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const BASE_PIXELS_PER_SECOND = 10;
  const pixelsPerSecond = BASE_PIXELS_PER_SECOND * scale;

  const smartTickInterval = useMemo(() => {
    const minTickWidth = 60;
    const targetInterval = minTickWidth / pixelsPerSecond;
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return steps.find((s) => s >= targetInterval) || steps[steps.length - 1];
  }, [pixelsPerSecond]);

  const totalDuration = sumtime / 1000 + 0.5; // buffer
  const tickCount = Math.ceil(totalDuration / smartTickInterval);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (headerRef.current) {
        headerRef.current.scrollLeft = container.scrollLeft;
      }
      requestAnimationFrame(() => {
        setScrollLeft(container.scrollLeft);
      });
    };

    const handleResize = () => {
      requestAnimationFrame(() => {
        setViewportWidth(container.clientWidth);
      });
    };

    setScrollLeft(container.scrollLeft);
    setViewportWidth(container.clientWidth);

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen]); // Re-init when modal opens

  const tickWidth = smartTickInterval * pixelsPerSecond;
  const startTickIndex = Math.max(
    0,
    Math.floor((scrollLeft - 200) / tickWidth)
  );
  const endTickIndex = Math.min(
    tickCount,
    Math.ceil((scrollLeft + viewportWidth + 200) / tickWidth)
  );

  const visibleTicks = useMemo(() => {
    const ticks = [];
    for (let i = startTickIndex; i < endTickIndex; i++) {
      ticks.push(i);
    }
    return ticks;
  }, [startTickIndex, endTickIndex]);

  const outlineArray = useMemo(() => {
    if (!config) return [];
    const eventUnits = new globalThis.Map<string, TimelineItem>();
    for (const track of config.tracks) {
      for (const item of track.items) {
        const existing = eventUnits.get(item.eventUnitId);
        const finish = item.startMs + item.durationMs;
        eventUnits.set(item.eventUnitId, {
          title: item.eventUnitId,
          start: Math.min(existing?.start ?? item.startMs, item.startMs),
          finish: Math.max(existing?.finish ?? finish, finish)
        });
      }
    }
    return [
      {
        id: 'outline',
        title: '阶段层',
        content: Array.from(eventUnits.values()).sort(
          (left, right) => left.start - right.start
        )
      }
    ];
  }, [config]);

  const pathArray = useMemo(() => {
    if (!config) return [];
    return config.tracks.map<PathTrack>((track) => ({
      id: track.trackId,
      type: track.type,
      name: track.label,
      sceneItems: track.items.map((item) => {
        const params = item.params as Record<string, unknown>;
        const itemTitle =
          (typeof params.text === 'string' && params.text) ||
          (typeof params.label === 'string' && params.label) ||
          ('assetId' in item && item.assetId) ||
          item.id;
        return {
          title: itemTitle,
          name: itemTitle,
          start: item.startMs,
          finish: item.startMs + item.durationMs,
          itemType: TYPE_MAP[track.type] ?? track.type
        };
      })
    }));
  }, [config]);

  const [visibleItemCount, setVisibleItemCount] = useState(0);
  const [isConfirming, setIsConfirming] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const totalItems = useMemo(() => {
    let count = 0;
    outlineArray.forEach((o) => {
      count += 1; // track header
      count += o.content.length; // track items
    });
    pathArray.forEach((p) => {
      count += 1; // track header
      count += p.sceneItems.length; // track items
    });
    return count;
  }, [outlineArray, pathArray]);

  // Helper to get reveal index for an item
  const getRevealIndex = (
    trackIndex: number,
    itemIndex: number = -1,
    isPath: boolean = false
  ) => {
    let count = 0;
    const array = isPath ? pathArray : outlineArray;
    const previousArray = isPath ? outlineArray : [];

    // Count previous array items
    previousArray.forEach((o) => {
      count += 1 + o.content.length;
    });

    // Count items in current array up to trackIndex
    for (let i = 0; i < trackIndex; i++) {
      count +=
        1 +
        (isPath
          ? pathArray[i].sceneItems.length
          : outlineArray[i].content.length);
    }

    if (itemIndex === -1) return count; // return header index
    return count + 1 + itemIndex; // return specific item index
  };

  useEffect(() => {
    if (isOpen) {
      setVisibleItemCount(0);
      const timer = setInterval(() => {
        setVisibleItemCount((prev) => {
          if (prev >= totalItems) {
            clearInterval(timer);
            return prev;
          }
          return prev + 1;
        });
      }, 50); // Faster reveal for individual items
      return () => clearInterval(timer);
    } else {
      setVisibleItemCount(0);
    }
  }, [isOpen, totalItems]);

  const handleConfirm = async () => {
    if (!config || isConfirming) return;
    setIsConfirming(true);
    setCreateError(null);
    try {
      const response = await createScene({ title, config });
      onClose();
      navigate(`/scene?projectId=${encodeURIComponent(response.data.id)}`);
    } catch (error) {
      setCreateError(
        error instanceof Error && error.message
          ? error.message
          : '场景创建失败，请稍后重试'
      );
    } finally {
      setIsConfirming(false);
    }
  };

  const getDraggerWidth = (start: number, finish: number) => {
    return ((finish - start) / 1000) * pixelsPerSecond;
  };

  const getDraggerOffLeft = (start: number) => {
    return (start / 1000) * pixelsPerSecond;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[98vw] md:max-w-[95vw] w-full md:w-[1400px] h-[90vh] md:h-[80vh] p-0 bg-background border border-border overflow-hidden text-foreground flex flex-col rounded-2xl shadow-2xl">
        <DialogHeader className="p-4 border-b border-border flex flex-row items-center justify-between shrink-0 bg-card/50">
          <DialogTitle className="text-primary text-sm font-black uppercase tracking-widest flex items-center gap-2">
            <Play className="w-4 h-4" />
            动态聚合
          </DialogTitle>
          <div className="flex items-center gap-3">
            <DataImportButton />
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-primary transition-colors p-1 rounded-lg hover:bg-primary/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto custom-scrollbar p-6 bg-background">
          <div className="min-w-max">
            {/* Toolbar Area (Zoom/Playhead Controls) */}
            <div className="relative flex-none flex items-center justify-between px-4 py-2 border border-border rounded-t-xl text-[11px] text-muted-foreground bg-card">
              <div className="flex items-center gap-3">
                <Badge
                  variant="secondary"
                  className="bg-primary/10 text-primary border-primary/20"
                >
                  <Activity className="w-3 h-3 mr-1" />
                  轨道展示
                </Badge>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-full hover:bg-accent"
                  onClick={() => setScale(Math.max(0.1, scale - 0.1))}
                >
                  <Minus className="w-3 h-3 text-muted-foreground" />
                </Button>

                <div className="flex items-center gap-2 min-w-[100px]">
                  <input
                    type="range"
                    min="10"
                    max="500"
                    step="10"
                    value={scale * 100}
                    onChange={(e) => setScale(Number(e.target.value) / 100)}
                    className="w-24 h-1.5 bg-accent rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-muted-foreground [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:bg-primary transition-all"
                  />
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-full hover:bg-accent"
                  onClick={() => setScale(Math.min(5, scale + 0.1))}
                >
                  <Plus className="w-3 h-3 text-muted-foreground" />
                </Button>

                <span className="text-muted-foreground w-10 text-right">
                  {(scale * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Header Area (Synced Scroll) */}
            <div
              ref={headerRef}
              className="flex-none overflow-hidden relative z-40 bg-background border-x border-b border-border shadow-sm"
            >
              <div className="min-w-max flex h-8">
                <div className="sticky left-0 z-50 w-[180px] bg-background border-r border-border flex items-center justify-center font-black text-[10px] uppercase tracking-wider text-muted-foreground">
                  轨道类型
                </div>

                {/* Time Ruler */}
                <div
                  className="flex-1 relative flex items-end pb-1"
                  style={{
                    width: `${tickCount * smartTickInterval * pixelsPerSecond}px`
                  }}
                >
                  {visibleTicks.map((i) => (
                    <div
                      key={i}
                      className="absolute bottom-0 h-4 border-l border-border/50 pl-1 text-[9px] text-muted-foreground select-none flex items-end pb-1 font-mono"
                      style={{
                        left: `${i * smartTickInterval * pixelsPerSecond}px`,
                        width: `${smartTickInterval * pixelsPerSecond}px`
                      }}
                    >
                      {i * smartTickInterval}s
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Scrollable Tracks Area */}
            <div
              ref={scrollContainerRef}
              className="border-x border-b border-border rounded-b-xl overflow-auto relative timeline-scrollbar max-h-[400px]"
            >
              <div
                className="min-w-max relative flex flex-col bg-background"
                style={{
                  width: `${tickCount * smartTickInterval * pixelsPerSecond + 180}px`
                }}
              >
                {/* Grid Lines Overlay */}
                <div className="absolute top-0 bottom-0 right-0 left-[180px] pointer-events-none z-0">
                  {visibleTicks.map((i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-l border-border/10"
                      style={{
                        left: `${i * smartTickInterval * pixelsPerSecond}px`
                      }}
                    />
                  ))}
                </div>

                {/* Path Tracks */}
                <div className="flex flex-col">
                  {/* Header Section: Outlines and Descriptions (Migrated to Top for Priority) */}
                  {outlineArray.map((section, i) => (
                    <div
                      key={section.id}
                      className={cn(
                        'flex h-[40px] border-b border-border last:border-b-0 group hover:bg-primary/[0.02] transition-colors duration-500',
                        visibleItemCount > getRevealIndex(i)
                          ? 'animate-in slide-in-from-left-4 fade-in'
                          : 'opacity-0'
                      )}
                    >
                      {/* Section Header (Sticky Left) */}
                      <div className="sticky left-0 z-30 w-[180px] bg-background border-r border-border flex items-center justify-center font-black text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/10">
                        {section.title}
                      </div>

                      {/* Section Content */}
                      <div className="flex-1 relative h-full">
                        {section.content.map((item, idx) => (
                          <div
                            key={idx}
                            className={cn(
                              'absolute h-[30px] top-[5px] flex items-center justify-center px-3 border border-amber-400/50 text-[9px] font-black truncate transition-all bg-amber-400/20 text-amber-700 rounded-sm shadow-sm pointer-events-none duration-500',
                              visibleItemCount > getRevealIndex(i, idx)
                                ? 'animate-in zoom-in-95 fade-in'
                                : 'opacity-0'
                            )}
                            style={{
                              left: `${getDraggerOffLeft(item.start)}px`,
                              width: `${getDraggerWidth(item.start, item.finish)}px`
                            }}
                            title={`${item.title} (${item.start}ms - ${item.finish}ms)`}
                          >
                            <div className="truncate">{item.title}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {pathArray.map((track, i) => (
                    <div
                      key={track.id}
                      className={cn(
                        'flex h-12 border-b border-border/20 bg-muted/5 last:border-b-0 group hover:bg-primary/[0.02] transition-colors duration-500',
                        visibleItemCount > getRevealIndex(i, -1, true)
                          ? 'animate-in slide-in-from-left-4 fade-in'
                          : 'opacity-0'
                      )}
                    >
                      {/* Track Header (Sticky Left) */}
                      <div className="sticky left-0 z-30 w-[180px] bg-background/95 border-r border-border flex items-center justify-center gap-2.5 px-4">
                        <div className="text-primary opacity-70 group-hover:opacity-100 transition-opacity">
                          {getTypeIcon(track.type)}
                        </div>
                        <Badge
                          variant="outline"
                          className="border-primary/20 text-primary bg-primary/5 text-[9px] font-black tracking-tighter"
                        >
                          {track.name}
                        </Badge>
                      </div>

                      {/* Track Content */}
                      <div className="flex-1 relative h-full">
                        {track.sceneItems.map((item, idx) => {
                          const clipId = `${track.id}-${idx}`;
                          return (
                            <Dragger
                              key={idx}
                              x={getDraggerOffLeft(item.start)}
                              y={10}
                              w={getDraggerWidth(item.start, item.finish)}
                              h={28}
                              minH={28}
                              maxH={28}
                              parentBounds={false}
                              draggable={false}
                              resizable={false}
                              className={cn(
                                'rounded text-[9px] flex items-center px-2 text-primary-foreground truncate transition-all z-10 pointer-events-none duration-500',
                                getClipStyle(track.type),
                                'shadow-sm border border-border',
                                visibleItemCount > getRevealIndex(i, idx, true)
                                  ? 'animate-in zoom-in-95 fade-in'
                                  : 'opacity-0'
                              )}
                            >
                              <span className="truncate flex items-center gap-1">
                                {getTypeIcon(track.type)}
                                {item.name}
                              </span>
                            </Dragger>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Area with Confirm Button */}
        <div className="flex-none p-4 border-t border-border bg-card/30 flex items-center justify-end gap-3">
          {createError && (
            <p role="alert" className="mr-auto text-xs text-destructive">
              {createError}
            </p>
          )}
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isConfirming}
            className="text-xs font-bold px-6"
          >
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isConfirming || !config}
            aria-label="确认创建场景"
            className="text-xs font-bold px-8 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 min-w-[100px]"
          >
            {isConfirming ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
                正在新建场景...
              </>
            ) : (
              '确定'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
