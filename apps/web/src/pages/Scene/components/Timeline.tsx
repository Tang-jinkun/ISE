import { Dragger } from '@/components/common/Dragger';
import type { Rect } from '@/components/common/Dragger/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SceneTrack, SceneTrackItem } from '@ise/runtime-contracts';
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  FileText,
  GripHorizontal,
  Image as ImageIcon,
  Map,
  Minus,
  Play,
  Plus,
  Square,
  Trash2,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type TimelineClip = {
  id: string;
  label: string;
  color: string;
  startSeconds: number;
  durationSeconds: number;
  item: SceneTrackItem;
};

type TimelineTrack = {
  id: string;
  label: string;
  visible: boolean;
  clips: TimelineClip[];
  type: SceneTrack['type'];
  source: SceneTrack;
};

function modelTrackOwnerId(track: Extract<SceneTrack, { type: 'model' }>): string | undefined {
  const generatedTrackPrefix = 'track:model:';
  if (track.trackId.startsWith(generatedTrackPrefix)) {
    const entityId = track.trackId.slice(generatedTrackPrefix.length);
    if (entityId) return entityId;
  }

  const entityIds = new Set(track.items.map((item) => item.params.entityId));
  return entityIds.size === 1 ? entityIds.values().next().value : undefined;
}

function isCompatibleClipTarget(
  sourceTrack: SceneTrack,
  sourceItem: SceneTrackItem,
  targetTrack: SceneTrack,
): boolean {
  if (sourceTrack.type !== targetTrack.type) return false;
  if (sourceTrack.trackId === targetTrack.trackId || sourceTrack.type !== 'model') return true;
  if (targetTrack.type !== 'model' || !('entityId' in sourceItem.params)) return false;

  return modelTrackOwnerId(targetTrack) === sourceItem.params.entityId;
}

export function resolveClipDragChange(
  sourceTrack: SceneTrack,
  sourceItem: SceneTrackItem,
  collidedTrack: SceneTrack | undefined,
  startMs: number,
  durationMs: number,
) {
  return {
    startMs,
    durationMs,
    targetTrackId: collidedTrack && isCompatibleClipTarget(sourceTrack, sourceItem, collidedTrack)
      ? collidedTrack.trackId
      : sourceTrack.trackId,
  };
}

export interface TimelineProps {
  tracks: SceneTrack[];
  selectedClipId?: string;
  currentTimeMs?: number;
  totalDurationMs?: number;
  onTimeChange?: (timeMs: number) => void;
  onDeleteTrack?: (trackId: string) => void;
  onToggleVisibility?: (trackId: string) => void;
  onClipSelect?: (
    item: SceneTrackItem,
    trackId: string,
    trackType: SceneTrack['type'],
  ) => void;
  onClipChange?: (
    trackId: string,
    itemId: string,
    startMs: number,
    durationMs: number,
    targetTrackId?: string,
  ) => void;
  onDeleteClip?: (trackId: string, itemId: string) => void;
}

const trackColors: Record<SceneTrack['type'], string> = {
  subtitle: 'bg-green-600/80 border-green-400',
  image: 'bg-blue-600/80 border-blue-400',
  video: 'bg-purple-600/80 border-purple-400',
  marker: 'bg-red-600/80 border-red-400',
  geojson: 'bg-fuchsia-600/80 border-fuchsia-400',
  camera: 'bg-cyan-600/80 border-cyan-400',
  model: 'bg-orange-600/80 border-orange-400',
  data_link: 'bg-sky-600/80 border-sky-400',
};

function typeIcon(type: SceneTrack['type']) {
  if (type === 'subtitle') return <FileText className="h-3.5 w-3.5" />;
  if (type === 'image') return <ImageIcon className="h-3.5 w-3.5" />;
  if (type === 'video') return <Video className="h-3.5 w-3.5" />;
  if (type === 'marker' || type === 'geojson') return <Map className="h-3.5 w-3.5" />;
  if (type === 'camera' || type === 'model') return <ArrowUpRight className="h-3.5 w-3.5" />;
  return <Square className="h-3.5 w-3.5" />;
}

function displayTracks(tracks: SceneTrack[]): TimelineTrack[] {
  return tracks.map((track) => ({
    id: track.trackId,
    label: track.label,
    visible: track.visible,
    type: track.type,
    source: track,
    clips: track.items.map((item) => ({
      id: item.id,
      label: item.id,
      color: trackColors[track.type],
      startSeconds: item.startMs / 1000,
      durationSeconds: item.durationMs / 1000,
      item,
    })),
  }));
}

export function Timeline({
  tracks,
  selectedClipId,
  currentTimeMs = 0,
  totalDurationMs = 0,
  onTimeChange,
  onDeleteTrack,
  onToggleVisibility,
  onClipSelect,
  onClipChange,
  onDeleteClip,
}: TimelineProps) {
  const timelineTracks = useMemo(() => displayTracks(tracks), [tracks]);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(320);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    itemId: string;
    trackId: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);
  const draggingPlayhead = useRef(false);
  const playheadStartX = useRef(0);
  const playheadStartMs = useRef(0);

  const pixelsPerSecond = 10 * scale;
  const totalSeconds = Math.max(
    totalDurationMs / 1000,
    ...timelineTracks.flatMap((track) =>
      track.clips.map((clip) => clip.startSeconds + clip.durationSeconds),
    ),
    1,
  );
  const rulerSeconds = Math.ceil(totalSeconds + 5);
  const tickInterval = [1, 2, 5, 10, 15, 30, 60, 120].find(
    (value) => value * pixelsPerSecond >= 60,
  ) ?? 120;
  const ticks = useMemo(
    () => Array.from({ length: Math.ceil(rulerSeconds / tickInterval) + 1 }, (_, index) => index),
    [rulerSeconds, tickInterval],
  );

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (resizing.current) {
        const delta = resizeStartY.current - event.clientY;
        setHeight(Math.max(200, Math.min(800, resizeStartHeight.current + delta)));
      }
      if (draggingPlayhead.current && onTimeChange) {
        const deltaMs = ((event.clientX - playheadStartX.current) / pixelsPerSecond) * 1000;
        onTimeChange(Math.max(0, Math.round(playheadStartMs.current + deltaMs)));
      }
    };
    const up = () => {
      resizing.current = false;
      draggingPlayhead.current = false;
      document.body.style.cursor = 'default';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [onTimeChange, pixelsPerSecond]);

  return (
    <section className="relative flex flex-col border-t border-border bg-card/95" style={{ height }}>
      <div
        className="absolute -top-1 left-0 right-0 z-50 flex h-2 cursor-row-resize items-center justify-center transition-colors hover:bg-primary/50"
        onMouseDown={(event) => {
          resizing.current = true;
          resizeStartY.current = event.clientY;
          resizeStartHeight.current = height;
          document.body.style.cursor = 'row-resize';
        }}
      >
        <GripHorizontal className="h-4 w-8 text-muted-foreground/20" />
      </div>

      <div className="relative flex flex-none items-center justify-between border-b border-border bg-card px-4 py-2 text-[11px] text-muted-foreground">
        <span className="font-medium">轨道时间轴</span>
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1">
          <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-accent/50 text-foreground">
            <Play className="h-3.5 w-3.5 fill-current" />
          </button>
          <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-accent/50 text-foreground">
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => setScale(Math.max(0.1, scale - 0.1))}>
            <Minus className="h-3 w-3" />
          </Button>
          <input
            aria-label="Timeline zoom"
            type="range"
            min="10"
            max="500"
            step="10"
            value={scale * 100}
            onChange={(event) => setScale(Number(event.target.value) / 100)}
            className="h-1.5 w-24 cursor-pointer appearance-none rounded-lg bg-accent"
          />
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => setScale(Math.min(5, scale + 0.1))}>
            <Plus className="h-3 w-3" />
          </Button>
          <span className="w-10 text-right">{(scale * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div ref={headerRef} className="relative z-40 flex-none overflow-hidden border-b border-border bg-background shadow-sm">
        <div className="flex h-8 min-w-max">
          <div className="sticky left-0 z-50 flex w-64 items-center border-r border-border bg-background px-4 text-xs font-medium text-muted-foreground">
            轨道列表
          </div>
          <div className="relative flex-1" style={{ width: rulerSeconds * pixelsPerSecond }}>
            {ticks.map((tick) => (
              <div
                key={tick}
                className="absolute bottom-0 h-4 border-l border-border/50 pl-1 text-[10px] text-muted-foreground"
                style={{ left: tick * tickInterval * pixelsPerSecond }}
              >
                {tick * tickInterval}s
              </div>
            ))}
            <div
              className="absolute top-0 z-50 h-4 w-4 -translate-x-1/2 cursor-ew-resize text-cyan-500"
              style={{ left: (currentTimeMs / 1000) * pixelsPerSecond }}
              onMouseDown={(event) => {
                draggingPlayhead.current = true;
                playheadStartX.current = event.clientX;
                playheadStartMs.current = currentTimeMs;
                document.body.style.cursor = 'ew-resize';
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M0 0H12V6L6 12L0 6V0Z" fill="currentColor" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto timeline-scrollbar"
        onScroll={(event) => {
          if (headerRef.current) headerRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        <div className="relative flex min-h-full min-w-max flex-col">
          <div className="pointer-events-none absolute bottom-0 left-64 right-0 top-0 z-40">
            <div
              className="absolute bottom-0 top-0 w-px bg-cyan-500 shadow-[0_0_4px_rgba(6,182,212,0.5)]"
              style={{ left: (currentTimeMs / 1000) * pixelsPerSecond }}
            />
          </div>
          {timelineTracks.map((track, trackIndex) => (
            <div key={track.id} className="flex h-9 border-b border-border/20 bg-muted/30">
              <div className="group sticky left-0 z-30 flex w-64 items-center gap-2 border-r border-border bg-background/95 px-2">
                <div className="w-6 text-center font-mono text-[10px] text-muted-foreground">{trackIndex + 1}</div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {typeIcon(track.type)}
                  <span className="truncate text-xs text-muted-foreground" title={track.label}>{track.label}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={() => onToggleVisibility?.(track.id)}>
                    {track.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-red-500/20 hover:text-red-400" onClick={() => onDeleteTrack?.(track.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="relative flex-1" style={{ width: rulerSeconds * pixelsPerSecond }}>
                {track.visible && track.clips.map((clip) => {
                  const trackTargets: Rect[] = timelineTracks.flatMap((candidate, index) =>
                    isCompatibleClipTarget(track.source, clip.item, candidate.source) ? [{
                      id: candidate.id,
                      x: 0,
                      y: (index - trackIndex) * 36,
                      width: rulerSeconds * pixelsPerSecond,
                      height: 36,
                    }] : [],
                  );
                  const snapTargets: Rect[] = timelineTracks.flatMap((candidate, index) =>
                    candidate.clips
                      .filter((candidateClip) => candidateClip.id !== clip.id)
                      .map((candidateClip) => ({
                        id: candidateClip.id,
                        x: candidateClip.startSeconds * pixelsPerSecond,
                        y: (index - trackIndex) * 36 + 6,
                        width: candidateClip.durationSeconds * pixelsPerSecond,
                        height: 24,
                      })),
                  );
                  return (
                    <Dragger
                      key={clip.id}
                      x={clip.startSeconds * pixelsPerSecond}
                      y={6}
                      w={clip.durationSeconds * pixelsPerSecond}
                      h={24}
                      minH={24}
                      maxH={24}
                      axis="both"
                      parentBounds={false}
                      selected={selectedClipId === clip.id}
                      draggable
                      resizable
                      snapToGrid
                      gridSize={pixelsPerSecond / 10}
                      snapToObjects
                      snapTargets={snapTargets}
                      collisionDetection
                      collisionTargets={trackTargets}
                      className={cn(
                        'z-10 flex cursor-pointer items-center truncate rounded border px-2 text-[10px] text-primary-foreground transition-all',
                        clip.color,
                        selectedClipId === clip.id ? 'z-20 brightness-110' : 'border-border shadow-sm hover:brightness-110',
                      )}
                      onClick={() => onClipSelect?.(clip.item, track.id, track.type)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setContextMenu({ x: event.clientX, y: event.clientY, itemId: clip.id, trackId: track.id });
                      }}
                      onDragEnd={(result) => {
                        const collided = result.collisions[0];
                        const collidedTrack = collided
                          ? timelineTracks.find(candidate => candidate.id === collided.id)?.source
                          : undefined;
                        const change = resolveClipDragChange(
                          track.source,
                          clip.item,
                          collidedTrack,
                          Math.max(0, Math.round((result.x / pixelsPerSecond) * 1000)),
                          clip.item.durationMs,
                        );
                        onClipChange?.(
                          track.id,
                          clip.id,
                          change.startMs,
                          change.durationMs,
                          change.targetTrackId,
                        );
                      }}
                      onResizeEnd={(result) => {
                        onClipChange?.(
                          track.id,
                          clip.id,
                          Math.max(0, Math.round((result.x / pixelsPerSecond) * 1000)),
                          Math.max(1, Math.round((result.width / pixelsPerSecond) * 1000)),
                          track.id,
                        );
                      }}
                    >
                      <span className="flex items-center gap-1 truncate">{typeIcon(track.type)}{clip.label}</span>
                    </Dragger>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-[100] min-w-[120px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              onDeleteClip?.(contextMenu.trackId, contextMenu.itemId);
              setContextMenu(null);
            }}
          >
            <Trash2 className="h-4 w-4" />
            <span>删除</span>
          </button>
        </div>
      )}
    </section>
  );
}
