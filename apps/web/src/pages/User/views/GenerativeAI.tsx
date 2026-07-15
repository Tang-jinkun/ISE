import { useMemo, useState } from 'react';
import {
  Download,
  Image as ImageIcon,
  MoreVertical,
  Play,
  Search,
  Sparkles,
  Trash2,
  Video
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown';

type GeneratedItem = {
  id: string;
  kind: 'image' | 'video';
  title: string;
  prompt: string;
  createdAt: string;
  height: number;
  status: 'done' | 'running' | 'failed';
};

export default function GenerativeAI() {
  const [mode, setMode] = useState<'video' | 'image'>('video');
  const [query, setQuery] = useState('');

  const items = useMemo<GeneratedItem[]>(
    () => [
      {
        id: 'g-1',
        kind: 'video',
        title: '海岛防御推演镜头 A',
        prompt: '夜间海岛防御部署，低空无人机巡航，冷色调',
        createdAt: '2023-10-26 19:20',
        height: 220,
        status: 'done'
      },
      {
        id: 'g-2',
        kind: 'image',
        title: '城市巷战分镜 03',
        prompt: '城市街区巷战，烟雾与光束穿透，粒子感',
        createdAt: '2023-10-26 18:55',
        height: 320,
        status: 'done'
      },
      {
        id: 'g-3',
        kind: 'image',
        title: '战术地图纹理',
        prompt: '战术地图纹理，网格线，荧光标注，暗黑 UI 风格',
        createdAt: '2023-10-26 17:40',
        height: 260,
        status: 'running'
      },
      {
        id: 'g-4',
        kind: 'video',
        title: '无人机编队演示',
        prompt: '无人机编队掠过山谷，逆光，镜头抖动轻微',
        createdAt: '2023-10-25 22:12',
        height: 280,
        status: 'done'
      },
      {
        id: 'g-5',
        kind: 'image',
        title: '指挥舱 UI 面板',
        prompt: '指挥舱 UI 面板，霓虹线条，信息密度高，赛博',
        createdAt: '2023-10-25 21:05',
        height: 360,
        status: 'failed'
      }
    ],
    []
  );

  const filtered = useMemo(() => {
    const base = items.filter((i) =>
      mode === 'video' ? i.kind === 'video' : i.kind === 'image'
    );
    if (!query.trim()) return base;
    const q = query.trim().toLowerCase();
    return base.filter(
      (i) =>
        i.title.toLowerCase().includes(q) || i.prompt.toLowerCase().includes(q)
    );
  }, [items, mode, query]);

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">AI生成</h1>
          <p className="text-muted-foreground">
            一键生成视频或图片，集中管理你的生成结果。
          </p>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMode('video')}
              className={cn(
                'group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all',
                mode === 'video'
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-600 dark:text-cyan-300 shadow-[0_0_30px_-10px_rgba(34,211,238,0.35)]'
                  : 'bg-card border-border text-muted-foreground hover:bg-muted hover:border-border/80'
              )}
            >
              <Video
                className={cn(
                  'w-4 h-4',
                  mode === 'video'
                    ? 'text-cyan-600 dark:text-cyan-300'
                    : 'text-muted-foreground group-hover:text-foreground'
                )}
              />
              生成视频
            </button>
            <button
              type="button"
              onClick={() => setMode('image')}
              className={cn(
                'group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all',
                mode === 'image'
                  ? 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-300 shadow-[0_0_30px_-10px_rgba(168,85,247,0.35)]'
                  : 'bg-card border-border text-muted-foreground hover:bg-muted hover:border-border/80'
              )}
            >
              <ImageIcon
                className={cn(
                  'w-4 h-4',
                  mode === 'image'
                    ? 'text-purple-600 dark:text-purple-300'
                    : 'text-muted-foreground group-hover:text-foreground'
                )}
              />
              生成图片
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative w-full lg:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索生成结果..."
                className="w-full bg-card border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500/40"
              />
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="w-4 h-4 text-cyan-400/80" />
              <span>{mode === 'video' ? '视频生成' : '图片生成'}</span>
              <span>•</span>
              <span>{filtered.length} 项</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 rounded-2xl border border-border/50 bg-muted/30 overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {mode === 'video' ? '生成视频结果' : '生成图片结果'}
          </div>
          <div className="text-xs text-muted-foreground">瀑布流展示</div>
        </div>

        <div className="p-5">
          {filtered.length === 0 ? (
            <div className="h-64 rounded-xl border border-dashed border-border bg-muted flex items-center justify-center text-muted-foreground">
              暂无生成内容
            </div>
          ) : (
            <div className="columns-1 sm:columns-2 lg:columns-3 2xl:columns-4 gap-6">
              {filtered.map((item) => (
                <div key={item.id} className="mb-6 break-inside-avoid">
                  <div className="group rounded-2xl border border-border bg-card overflow-hidden hover:border-cyan-500/30 transition-colors">
                    <div
                      className={cn(
                        'relative w-full overflow-hidden',
                        item.kind === 'video'
                          ? 'bg-gradient-to-br from-cyan-500/15 via-card to-background dark:via-zinc-900 dark:to-zinc-950'
                          : 'bg-gradient-to-br from-purple-500/15 via-card to-background dark:via-zinc-900 dark:to-zinc-950'
                      )}
                      style={{ height: item.height }}
                    >
                      <div className="absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(34,211,238,0.12),transparent_55%),radial-gradient(circle_at_50%_80%,rgba(168,85,247,0.10),transparent_55%)]" />

                      {item.kind === 'video' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-12 h-12 rounded-full bg-black/50 border border-border flex items-center justify-center backdrop-blur-sm group-hover:scale-110 transition-transform">
                            <Play className="w-5 h-5 text-foreground" />
                          </div>
                        </div>
                      )}

                      <div className="absolute left-3 top-3 flex items-center gap-2">
                        <span
                          className={cn(
                            'text-[11px] px-2 py-0.5 rounded-full border backdrop-blur-sm',
                            item.status === 'done' &&
                              'border-green-500/25 bg-green-500/10 text-green-300',
                            item.status === 'running' &&
                              'border-cyan-500/25 bg-cyan-500/10 text-cyan-200',
                            item.status === 'failed' &&
                              'border-red-500/25 bg-red-500/10 text-red-300'
                          )}
                        >
                          {item.status === 'done'
                            ? '已完成'
                            : item.status === 'running'
                            ? '生成中'
                            : '失败'}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-border bg-secondary/80 text-muted-foreground backdrop-blur-sm">
                          {item.kind === 'video' ? '视频' : '图片'}
                        </span>
                      </div>

                      <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <DropdownMenu>
                          <DropdownMenuTrigger className="p-2 rounded-lg text-foreground hover:bg-accent outline-none transition-colors">
                            <MoreVertical className="w-4 h-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem>
                              <Download className="w-4 h-4 mr-2" />
                              下载
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-400 focus:text-red-400 focus:bg-red-500/10">
                              <Trash2 className="w-4 h-4 mr-2" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <div className="p-4 space-y-2">
                      <div className="text-sm font-medium text-foreground group-hover:text-cyan-600 dark:text-cyan-300 transition-colors truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-muted-foreground overflow-hidden text-ellipsis leading-relaxed max-h-10">
                        {item.prompt}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.createdAt}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
