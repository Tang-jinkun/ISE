import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

export type TimelineItem = {
  id: string;
  title: string;
  description?: string;
  timeRange?: [number, number];
  order?: number;
};

type TimelineTransitionProps = {
  items: TimelineItem[];
  mapEaseConfig?: Record<string, string>;
  onMapEaseChange?: (fromId: string, toId: string, value: string) => void;
};

const MAP_EASE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeInOut', label: 'Ease In Out' },
  { value: 'fly', label: 'Fly To' },
  { value: 'orbit', label: 'Orbit' }
];

export function TimelineTransition({
  items,
  mapEaseConfig,
  onMapEaseChange
}: TimelineTransitionProps) {
  if (!items.length) return null;

  const edges = useMemo(
    () =>
      items.length < 2
        ? []
        : items.slice(0, -1).map((from, index) => {
            const to = items[index + 1];
            const key = `${from.id}__${to.id}`;
            return { key, from, to, index };
          }),
    [items]
  );

  const [activeEdgeKey, setActiveEdgeKey] = useState<string | undefined>(
    () => (edges[0]?.key as string | undefined) || undefined
  );

  const [modalEdgeKey, setModalEdgeKey] = useState<string | undefined>();

  const activeEdge =
    edges.find((e) => e.key === activeEdgeKey) || edges[0] || undefined;

  return (
    <div className="w-full p-4 border-b border-border bg-muted/20">
      <div className="flex gap-4">
        <div className="flex-1 flex flex-col gap-3">
          {items.map((item, index) => (
            <div key={item.id} className="flex gap-3">
              <div className="flex flex-col items-center pt-1">
                {index > 0 && <div className="h-4 w-px bg-border" />}
                <div className="h-2.5 w-2.5 rounded-full bg-cyan-400/80" />
                {index < items.length - 1 && (
                  <div className="flex-1 w-px bg-border" />
                )}
              </div>
              <div className="flex-1">
                <div className="relative group rounded-xl border border-border bg-card p-3 hover:bg-accent hover:border-cyan-500/30 transition-all cursor-pointer">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-medium text-cyan-300">
                      节点 {index + 1}
                    </div>
                    <div className="h-1.5 w-1.5 rounded-full bg-cyan-500/50" />
                  </div>
                  <div
                    className="text-sm text-foreground font-medium truncate"
                    title={item.title}
                  >
                    {item.title}
                  </div>
                  {item.description && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {item.description}
                    </div>
                  )}
                  {item.timeRange && (
                    <div className="text-[11px] text-cyan-400 mt-1">
                      {item.timeRange[0]} - {item.timeRange[1]}s
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>视角转换</span>
                    {typeof item.order === 'number' && (
                      <span>#{item.order}</span>
                    )}
                  </div>
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-500/0 via-cyan-500/5 to-cyan-500/0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {edges.length > 0 && activeEdge && (
          <div className="w-64 rounded-xl border border-border bg-popover/80 p-3">
            <div className="text-xs font-medium text-foreground mb-1">
              mapEase 树
            </div>
            <div className="text-[10px] text-muted-foreground mb-2">
              右侧列表项对应左侧时间轴相邻节点之间的转换逻辑
            </div>
            <div className="space-y-1 max-h-40 overflow-auto pr-1">
              {edges.map((edge) => {
                const key = edge.key;
                const active = key === activeEdge.key;
                const value = mapEaseConfig?.[key] || 'linear';
                return (
                  <div
                    key={key}
                    onClick={() => setActiveEdgeKey(key)}
                    className={`w-full rounded border px-2 py-1 text-left text-[11px] transition-colors ${
                      active
                        ? 'border-cyan-500/60 bg-cyan-500/10 text-foreground'
                        : 'border-border bg-muted/70 text-foreground hover:border-cyan-500/40 hover:bg-input'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1">
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        <span className="truncate max-w-[120px]">
                          from 节点{edge.index + 1} to 节点{edge.index + 2}
                        </span>
                      </div>
                      <span className="text-[10px] text-cyan-400">{value}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveEdgeKey(key);
                          setModalEdgeKey(key);
                        }}
                        className="ml-1 rounded border border-cyan-500/50 px-2 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/10"
                      >
                        配置
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {modalEdgeKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-[420px] rounded-xl border border-border bg-popover p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-foreground">
                from 节点
                {(
                  (edges.find((e) => e.key === modalEdgeKey)?.index ?? 0) + 1
                ).toString()}{' '}
                to 节点
                {(
                  (edges.find((e) => e.key === modalEdgeKey)?.index ?? 0) + 2
                ).toString()}
              </div>
              <button
                type="button"
                onClick={() => setModalEdgeKey(undefined)}
                className="h-6 w-6 flex items-center justify-center rounded-full border border-border text-xs text-foreground hover:bg-accent"
              >
                ×
              </button>
            </div>
            {(() => {
              const edge = edges.find((e) => e.key === modalEdgeKey);
              if (!edge) return null;
              const currentValue = mapEaseConfig?.[edge.key] || 'linear';
              return (
                <>
                  <div className="text-xs text-muted-foreground mb-3">
                    {edge.from.title} → {edge.to.title}
                  </div>
                  <div>
                    <div className="text-[11px] text-foreground mb-1">
                      mapEase 过渡方式
                    </div>
                    <select
                      value={currentValue}
                      onChange={(e) => {
                        onMapEaseChange?.(
                          edge.from.id,
                          edge.to.id,
                          e.target.value
                        );
                      }}
                      className="h-9 w-full rounded border border-border bg-input text-xs text-foreground px-2 focus:outline-none focus:border-cyan-500/70"
                    >
                      {MAP_EASE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
