import { Dragger } from '@/components/common/Dragger';
import type { Rect } from '@/components/common/Dragger/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import pearlHarborData from '@/mock/OLD/偷袭珍珠港.json';
import hainanData from '@/mock/OLD/海南岛战例-完成版更正错误版.json';
import chibiData from '@/mock/OLD/火烧赤壁.json';
import nuomanData from '@/mock/OLD/诺曼底登陆-完成版.json';
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  FileText,
  GripHorizontal,
  Image as ImageIcon,
  Map,
  Minus,
  Music,
  Play,
  Plus,
  Settings,
  Square,
  Trash2,
  Video
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AddTrackModal } from './AddTrackModal';
import { SceneConfigModal } from './SceneConfigModal';

export type TrackClip = {
  id: string;
  label: string;
  color: string;
  start: number;
  width: number;
  content?: string;
};

export interface Track {
  id: string;
  label: string;
  icon?: React.ReactNode;
  visible?: boolean;
  clips: TrackClip[];
  type?: string;
}

interface TimelineProps {
  tracks: Track[];
  selectedClipId?: string;
  currentTime?: number;
  onTimeChange?: (time: number) => void;
  onDeleteTrack?: (id: string) => void;
  onToggleVisibility?: (id: string) => void;
  onClipSelect?: (clip: TrackClip, trackId: string, trackType: string) => void;
  onClipChange?: (
    trackId: string,
    clipId: string,
    newStart: number,
    newDuration: number,
    newTrackId?: string
  ) => void;
  onDrop?: (trackId: string, startTime: number, item: any) => void;
  onAddTrack?: (type: string) => void;
  onDeleteClip?: (trackId: string, clipId: string) => void;
  onAddAsset?: (
    trackId: string,
    startTime: number,
    duration: number,
    asset: any
  ) => void;
}

const getTypeIcon = (type?: string) => {
  const t = type?.toLowerCase();
  if (t === 'picture') return <ImageIcon className="w-3.5 h-3.5" />;
  if (t === 'subtitles' || t === 'subtitle')
    return <FileText className="w-3.5 h-3.5" />;
  if (t === 'audio' || t === 'music') return <Music className="w-3.5 h-3.5" />;
  if (t === 'geojson' || t === 'map') return <Map className="w-3.5 h-3.5" />;
  if (t === 'viewchange' || t === 'camera')
    return <ArrowUpRight className="w-3.5 h-3.5" />;
  if (t === 'video' || t === 'videovision')
    return <Video className="w-3.5 h-3.5" />;
  return <Square className="w-3.5 h-3.5" />;
};

const mapCompletedDataToTracks = (data: any): Track[] => {
  if (!data || !data.paths) return [];

  return data.paths
    .map((path: any) => {
      const type = path.type?.toLowerCase();
      let color = 'bg-blue-500'; // default

      if (type === 'viewchange') color = 'bg-blue-600/80 border-blue-400';
      else if (type === 'subtitles') color = 'bg-green-600/80 border-green-400';
      else if (type === 'picture') color = 'bg-red-600/80 border-red-400';
      else if (type === 'video' || type === 'videovision') {
        // Check if it's actually audio
        const firstClip = path.timing?.[0];
        if (firstClip?.src?.endsWith('.mp3')) {
          color = 'bg-green-600/80 border-green-400';
          path.type = 'audio';
        } else {
          color = 'bg-purple-600/80 border-purple-400';
          path.type = 'video';
        }
      } else if (type === 'geojson')
        color = 'bg-orange-600/80 border-orange-400';

      return {
        id: String(path.id),
        label: path.type,
        visible: true,
        icon: getTypeIcon(path.type),
        clips: (path.timing || []).map((el: any) => {
          let label = '';
          const pType = path.type?.toLowerCase();
          if (pType === 'subtitles') {
            label = el.content || '';
          } else if (pType === 'audio') {
            label = el.src?.split('/').pop()?.replace('.mp3', '') || '';
          } else if (pType === 'picture') {
            label = el.id || '';
          } else if (pType === 'video') {
            label = el.id || '';
          } else if (pType === 'viewchange') {
            label = ''; // Just the icon
          }

          return {
            id: String(el.id),
            label,
            color,
            start: (el.start || 0) / 1000,
            width: ((el.finish || 0) - (el.start || 0)) / 1000,
            content: el.content
          };
        }),
        type: path.type
      };
    })
    .sort((a: any, b: any) => {
      // Sort to match image order: ViewChange, Subtitles, Picture, Audio, Video
      const order = [
        'viewchange',
        'subtitles',
        'picture',
        'audio',
        'video',
        'geojson'
      ];
      return (
        order.indexOf(a.type.toLowerCase()) -
        order.indexOf(b.type.toLowerCase())
      );
    });
};

export function Timeline({
  selectedClipId,
  currentTime = 0,
  onTimeChange,
  onDeleteTrack,
  onToggleVisibility,
  onClipSelect,
  onClipChange,
  onDrop,
  onAddTrack,
  onDeleteClip
}: TimelineProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [currentConfigId, setCurrentConfigId] = useState('nuoman');

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    clipId: string;
    trackId: string;
  } | null>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(320);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('contextmenu', handleClickOutside);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('contextmenu', handleClickOutside);
    };
  }, []);

  const currentData = useMemo(() => {
    switch (currentConfigId) {
      case 'hainan':
        return hainanData;
      case 'chibi':
        return chibiData;
      case 'nuoman':
        return nuomanData;
      case 'pearl_harbor':
        return pearlHarborData;
      default:
        return nuomanData;
    }
  }, [currentConfigId]);

  const mappedTracks = useMemo(
    () => mapCompletedDataToTracks(currentData),
    [currentData]
  );

  const BASE_PIXELS_PER_SECOND = 10;
  const pixelsPerSecond = BASE_PIXELS_PER_SECOND * scale;

  const smartTickInterval = useMemo(() => {
    const minTickWidth = 60;
    const targetInterval = minTickWidth / pixelsPerSecond;
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return steps.find((s) => s >= targetInterval) || steps[steps.length - 1];
  }, [pixelsPerSecond]);

  const totalDuration = useMemo(() => {
    let maxTime = 2000;
    mappedTracks.forEach((track) => {
      if (track.visible === false) return;
      track.clips.forEach((clip) => {
        const end = clip.start + clip.width;
        if (end > maxTime) maxTime = end;
      });
    });
    // Add a moderate buffer (500ms) to the total duration
    return (maxTime || 2000) + 500;
  }, [mappedTracks]);

  const tickCount = Math.ceil(totalDuration / smartTickInterval);

  // Virtualization for Ticks: Only render visible ticks
  // We need to know scrollLeft and clientWidth of the scroll container
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1000);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Sync header scroll
      if (headerRef.current) {
        headerRef.current.scrollLeft = container.scrollLeft;
      }

      // Use requestAnimationFrame to throttle scroll updates
      requestAnimationFrame(() => {
        setScrollLeft(container.scrollLeft);
      });
    };

    const handleResize = () => {
      requestAnimationFrame(() => {
        setViewportWidth(container.clientWidth);
      });
    };

    // Initial values
    setScrollLeft(container.scrollLeft);
    setViewportWidth(container.clientWidth);

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Calculate visible tick range with buffer
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

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startY.current - e.clientY;
      setHeight(Math.max(200, Math.min(800, startHeight.current + delta)));
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = 'default';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const isDraggingPlayhead = useRef(false);
  const startX = useRef(0);
  const dragStartTime = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingPlayhead.current && onTimeChange) {
        e.preventDefault();
        const deltaX = e.clientX - startX.current;
        const deltaTime = deltaX / pixelsPerSecond;
        onTimeChange(Math.max(0, dragStartTime.current + deltaTime));
      }
    };

    const handleMouseUp = () => {
      if (isDraggingPlayhead.current) {
        isDraggingPlayhead.current = false;
        document.body.style.cursor = 'default';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [pixelsPerSecond, onTimeChange]);

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    isDraggingPlayhead.current = true;
    startX.current = e.clientX;
    dragStartTime.current = currentTime;
    document.body.style.cursor = 'ew-resize';
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isResizing.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    document.body.style.cursor = 'row-resize';
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      // Native vertical scrolling handles vertical movement automatically
      // We only handle Zoom (Ctrl) and Horizontal Scroll (Shift)

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        const factor = 0.1;
        const newScale = Math.max(
          0.05,
          Math.min(20, scale + Math.sign(delta) * factor * scale)
        );
        setScale(newScale);
      } else if (e.shiftKey) {
        // Allow native horizontal scroll or enforce it
        // Usually Shift+Wheel is handled by browser as horizontal scroll
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [scale]);

  return (
    <section
      className="border-t border-border bg-card/95 flex flex-col relative"
      style={{ height }}
    >
      {/* Resize Handle */}
      <div
        className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize z-50 hover:bg-primary/50 transition-colors flex items-center justify-center group"
        onMouseDown={handleMouseDown}
      >
        <GripHorizontal className="w-8 h-4 text-muted-foreground/20 group-hover:text-muted-foreground/80 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <AddTrackModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSelect={(type) => {
          onAddTrack?.(type);
          setModalOpen(false);
        }}
      />

      {/* Toolbar */}
      <div className="relative flex-none flex items-center justify-between px-4 py-2 border-b border-border text-[11px] text-muted-foreground bg-card">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-foreground hover:text-primary hover:bg-accent"
            onClick={() => setModalOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加轨道</span>
          </Button>
        </div>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1">
          <button className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-accent/50 text-foreground hover:bg-accent transition-colors">
            <Play className="w-3.5 h-3.5 fill-current" />
          </button>
          <button className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-accent/50 text-foreground hover:bg-accent transition-colors">
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
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
        className="flex-none overflow-hidden relative z-40 bg-background border-b border-border shadow-sm"
      >
        <div className="min-w-max flex h-8">
          {/* Top-Left Intersection (Sticky Left) */}
          <div className="sticky left-0 z-50 w-64 bg-background border-r border-border flex items-center justify-between px-4 font-medium text-xs text-muted-foreground">
            <span>轨道列表</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded-md hover:bg-accent text-[#00bcd4]"
              title="切换配置"
              onClick={() => setConfigModalOpen(true)}
            >
              <Settings className="w-3.5 h-3.5" />
            </Button>
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
                className="absolute bottom-0 h-4 border-l border-border/50 pl-1 text-[10px] text-muted-foreground select-none flex items-end pb-1"
                style={{
                  left: `${i * smartTickInterval * pixelsPerSecond}px`,
                  width: `${smartTickInterval * pixelsPerSecond}px`
                }}
              >
                {i * smartTickInterval}s
              </div>
            ))}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 z-50 group"
              style={{
                left: `${currentTime * pixelsPerSecond}px`
              }}
            >
              {/* Handle */}
              <div
                className="absolute -top-1 -translate-x-1/2 w-4 h-4 cursor-ew-resize z-50 flex items-center justify-center group-hover:scale-110 transition-transform"
                onMouseDown={handlePlayheadMouseDown}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="text-cyan-500 drop-shadow-md filter"
                >
                  <path d="M0 0H12V6L6 12L0 6V0Z" fill="currentColor" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto relative timeline-scrollbar"
      >
        <div className="min-w-max min-h-full relative flex flex-col">
          {/* Grid Lines */}
          <div className="absolute top-0 bottom-0 right-0 left-64 pointer-events-none z-0">
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

          {/* Playhead Line Overlay */}
          <div className="absolute top-0 bottom-0 right-0 left-64 pointer-events-none z-40">
            <div
              className="absolute top-0 bottom-0 w-px bg-cyan-500 shadow-[0_0_4px_rgba(6,182,212,0.5)]"
              style={{
                left: `${currentTime * pixelsPerSecond}px`
              }}
            />
          </div>

          {/* Track Rows */}
          <div className="flex flex-col">
            {mappedTracks.map((track, index) => (
              <div
                key={track.id}
                className="flex h-9 border-b border-border/20 bg-muted/30"
              >
                {/* Track Header (Sticky Left) */}
                <div className="sticky left-0 z-30 w-64 bg-background/95 border-r border-border flex items-center px-2 gap-2 group">
                  <div className="w-6 text-center text-[10px] text-muted-foreground font-mono">
                    {index + 1}
                  </div>

                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {track.icon}
                    <span
                      className="truncate text-xs text-muted-foreground"
                      title={track.label}
                    >
                      {track.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onToggleVisibility?.(track.id)}
                      className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
                      title={track.visible !== false ? '隐藏' : '显示'}
                    >
                      {track.visible !== false ? (
                        <Eye className="w-3.5 h-3.5" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => onDeleteTrack?.(track.id)}
                      className="p-1 hover:bg-red-500/20 rounded text-muted-foreground hover:text-red-400"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Track Content */}
                <div
                  className="flex-1 relative"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const json = e.dataTransfer.getData('application/json');
                    if (!json) return;
                    try {
                      const item = JSON.parse(json);
                      const rect = e.currentTarget.getBoundingClientRect();
                      const offsetX = e.clientX - rect.left;
                      const startTime = Math.max(0, offsetX / pixelsPerSecond);
                      onDrop?.(track.id, startTime, item);
                    } catch (err) {
                      console.error('Failed to parse dropped item', err);
                    }
                  }}
                >
                  {track.visible !== false &&
                    track.clips.map((clip) => {
                      // Prepare targets relative to this track
                      const trackTargets: Rect[] = mappedTracks.map((t, i) => ({
                        id: t.id,
                        x: 0,
                        y: (i - index) * 36, // Relative Y position
                        width: 100000, // Large width to cover timeline
                        height: 36,
                        // @ts-ignore - attaching extra data for logic
                        type: t.type
                      }));

                      const snapTargets: Rect[] = mappedTracks.flatMap(
                        (t, tIdx) =>
                          t.clips
                            .filter((c) => c.id !== clip.id)
                            .map((c) => ({
                              id: c.id,
                              x: c.start * pixelsPerSecond,
                              y: (tIdx - index) * 36 + 6,
                              width: c.width * pixelsPerSecond,
                              height: 24
                            }))
                      );

                      return (
                        <Dragger
                          key={clip.id}
                          x={clip.start * pixelsPerSecond}
                          y={6}
                          w={clip.width * pixelsPerSecond}
                          h={24}
                          minH={24}
                          maxH={24}
                          axis="both"
                          parentBounds={false}
                          selected={selectedClipId === clip.id}
                          draggable={true}
                          resizable={true}
                          snapToGrid={true}
                          gridSize={pixelsPerSecond / 10} // Snap to 0.1s
                          snapToObjects={true}
                          snapTargets={snapTargets}
                          collisionDetection={true}
                          collisionTargets={trackTargets}
                          className={cn(
                            'rounded text-[10px] flex items-center px-2 text-primary-foreground truncate cursor-pointer transition-all z-10',
                            clip.color,
                            selectedClipId === clip.id
                              ? 'brightness-110 z-20'
                              : 'hover:brightness-110 shadow-sm border border-border'
                          )}
                          onClick={() => {
                            // e.stopPropagation();
                            onClipSelect?.(
                              clip,
                              track.id,
                              track.type || 'unknown'
                            );
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu({
                              visible: true,
                              x: e.clientX,
                              y: e.clientY,
                              clipId: clip.id,
                              trackId: track.id
                            });
                          }}
                          onDragEnd={(res) => {
                            const newStart = Math.max(
                              0,
                              res.x / pixelsPerSecond
                            );
                            let targetTrackId = track.id;

                            // Find valid track target
                            const collidedTrack = res.collisions[0];
                            if (collidedTrack) {
                              const targetType = (collidedTrack as any).type;
                              if (
                                targetType === track.type ||
                                track.type === 'unknown'
                              ) {
                                targetTrackId = collidedTrack.id!;
                              }
                            }

                            onClipChange?.(
                              track.id,
                              clip.id,
                              newStart,
                              clip.width,
                              targetTrackId
                            );
                          }}
                          onResizeEnd={(res) => {
                            const newStart = Math.max(
                              0,
                              res.x / pixelsPerSecond
                            );
                            const newWidth = Math.max(
                              0.1,
                              res.width / pixelsPerSecond
                            );
                            onClipChange?.(
                              track.id,
                              clip.id,
                              newStart,
                              newWidth,
                              track.id
                            );
                          }}
                        >
                          <span className="truncate flex items-center gap-1">
                            {getTypeIcon(track.type)}
                            {clip.label}
                          </span>
                        </Dragger>
                      );
                    })}

                  {/* Grid Lines */}
                  {visibleTicks.map((i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-l border-border/20 pointer-events-none"
                      style={{
                        left: `${i * smartTickInterval * pixelsPerSecond}px`
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Context Menu */}
      {contextMenu && contextMenu.visible && (
        <div
          className="fixed z-[100] bg-popover text-popover-foreground border border-border rounded-md shadow-md p-1 min-w-[120px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground rounded-sm flex items-center gap-2"
            onClick={() => {
              onDeleteClip?.(contextMenu.trackId, contextMenu.clipId);
              setContextMenu(null);
            }}
          >
            <Trash2 className="w-4 h-4" />
            <span>删除</span>
          </button>
        </div>
      )}
      <SceneConfigModal
        open={configModalOpen}
        onOpenChange={setConfigModalOpen}
        currentConfigId={currentConfigId}
        onSelect={setCurrentConfigId}
      />
    </section>
  );
}
