import { useMemo, useState } from 'react';
import {
  Box,
  CloudUpload,
  FileText,
  Filter,
  Folder,
  MoreVertical,
  Search,
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

type AssetItem = {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'model' | 'other';
  size: string;
  updatedAt: string;
  status: 'published' | 'draft';
};

type PublicProjectItem = {
  id: string;
  name: string;
  kind: 'editor' | 'script';
  updatedAt: string;
  status: 'published' | 'draft';
};

export default function ManagePage() {
  const [tab, setTab] = useState<'assets' | 'projects'>('assets');
  const [query, setQuery] = useState('');

  const assets = useMemo<AssetItem[]>(
    () => [
      {
        id: 'a-1',
        name: '城市街区纹理包',
        kind: 'image',
        size: '128 MB',
        updatedAt: '2023-10-26 11:42',
        status: 'published'
      },
      {
        id: 'a-2',
        name: '无人机巡航素材',
        kind: 'video',
        size: '420 MB',
        updatedAt: '2023-10-25 20:10',
        status: 'published'
      },
      {
        id: 'a-3',
        name: '地形模型集合（试用）',
        kind: 'model',
        size: '2.1 GB',
        updatedAt: '2023-10-23 09:30',
        status: 'draft'
      }
    ],
    []
  );

  const projects = useMemo<PublicProjectItem[]>(
    () => [
      {
        id: 'p-1',
        name: '公共项目：海岛防御（编辑）',
        kind: 'editor',
        updatedAt: '2023-10-26 16:05',
        status: 'published'
      },
      {
        id: 'p-2',
        name: '公共项目：红蓝对抗（脚本）',
        kind: 'script',
        updatedAt: '2023-10-24 13:18',
        status: 'draft'
      }
    ],
    []
  );

  const filteredAssets = useMemo(() => {
    if (!query.trim()) return assets;
    const q = query.trim().toLowerCase();
    return assets.filter((a) => a.name.toLowerCase().includes(q));
  }, [assets, query]);

  const filteredProjects = useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.trim().toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  const kindIcon = (kind: AssetItem['kind']) => {
    if (kind === 'image') return <Box className="w-4 h-4 text-purple-600 dark:text-purple-300" />;
    if (kind === 'video') return <Video className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />;
    if (kind === 'model') return <Folder className="w-4 h-4 text-yellow-600 dark:text-yellow-300" />;
    return <Box className="w-4 h-4 text-muted-foreground" />;
  };

  const kindLabel = (kind: AssetItem['kind']) => {
    if (kind === 'image') return '图片素材';
    if (kind === 'video') return '视频素材';
    if (kind === 'model') return '模型素材';
    return '其他';
  };

  const projectKindLabel = (kind: PublicProjectItem['kind']) => {
    if (kind === 'editor') return '编辑项目';
    return '脚本项目';
  };

  const statusPill = (status: 'published' | 'draft') => (
    <span
      className={cn(
        'text-xs px-2 py-0.5 rounded-full border',
        status === 'published'
          ? 'text-green-600 dark:text-green-300 border-green-500/25 bg-green-500/10'
          : 'text-muted-foreground border-border bg-muted'
      )}
    >
      {status === 'published' ? '已发布' : '草稿'}
    </span>
  );

  return (
    <div className="h-full flex flex-col space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">管理页面</h1>
        <p className="text-muted-foreground">
          管理公共素材与公共项目（编辑/脚本）。
        </p>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="bg-card p-1 rounded-lg inline-flex border border-border">
          <button
            type="button"
            onClick={() => setTab('assets')}
            className={cn(
              'px-6 py-2 rounded-md text-sm font-medium transition-all duration-200',
              tab === 'assets'
                ? 'bg-primary text-primary-foreground shadow-lg'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            管理公共素材
          </button>
          <button
            type="button"
            onClick={() => setTab('projects')}
            className={cn(
              'px-6 py-2 rounded-md text-sm font-medium transition-all duration-200',
              tab === 'projects'
                ? 'bg-primary text-primary-foreground shadow-lg'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            管理公共项目
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'assets' ? '搜索素材...' : '搜索项目...'}
              className="w-full bg-background border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
            />
          </div>
          <button
            type="button"
            className="p-2.5 rounded-xl bg-background border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Filter className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-700 dark:text-cyan-600 dark:text-cyan-300 hover:bg-cyan-500/15 transition-colors"
          >
            <CloudUpload className="w-4 h-4" />
            {tab === 'assets' ? '上传素材' : '创建项目'}
          </button>
        </div>
      </div>

      <div className="flex-1 rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="text-sm text-foreground">
            {tab === 'assets' ? '公共素材列表' : '公共项目列表'}
          </div>
          <div className="text-xs text-muted-foreground">
            {tab === 'assets'
              ? `${filteredAssets.length} 个素材`
              : `${filteredProjects.length} 个项目`}
          </div>
        </div>

        {tab === 'assets' ? (
          <div className="overflow-y-auto flex-1">
            <div className="grid grid-cols-12 gap-4 p-4 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <div className="col-span-6 pl-2">素材</div>
              <div className="col-span-2">类型</div>
              <div className="col-span-2">大小</div>
              <div className="col-span-1">状态</div>
              <div className="col-span-1 text-right pr-2">操作</div>
            </div>

            {filteredAssets.map((item) => (
              <div
                key={item.id}
                className="group grid grid-cols-12 gap-4 p-4 items-center border-b border-border hover:bg-accent transition-colors"
              >
                <div className="col-span-6 flex items-center gap-4 pl-2 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                    {kindIcon(item.kind)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate group-hover:text-cyan-500 transition-colors">
                      {item.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {item.updatedAt}
                    </div>
                  </div>
                </div>

                <div className="col-span-2">
                  <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-background text-muted-foreground">
                    {kindLabel(item.kind)}
                  </span>
                </div>

                <div className="col-span-2 text-sm text-muted-foreground">
                  {item.size}
                </div>
                <div className="col-span-1">{statusPill(item.status)}</div>

                <div className="col-span-1 flex justify-end pr-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent outline-none transition-colors">
                      <MoreVertical className="w-4 h-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem>
                        <FileText className="w-4 h-4 mr-2" />
                        查看详情
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-400 focus:text-red-400 focus:bg-red-500/10">
                        <Trash2 className="w-4 h-4 mr-2" />
                        删除素材
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}

            {filteredAssets.length === 0 && (
              <div className="p-10">
                <div className="h-56 rounded-xl border border-dashed border-border bg-background flex items-center justify-center text-muted-foreground">
                  暂无公共素材
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-y-auto flex-1">
            <div className="grid grid-cols-12 gap-4 p-4 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <div className="col-span-7 pl-2">项目</div>
              <div className="col-span-2">类型</div>
              <div className="col-span-2">状态</div>
              <div className="col-span-1 text-right pr-2">操作</div>
            </div>

            {filteredProjects.map((item) => (
              <div
                key={item.id}
                className="group grid grid-cols-12 gap-4 p-4 items-center border-b border-border hover:bg-accent transition-colors"
              >
                <div className="col-span-7 flex items-center gap-4 pl-2 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                    {item.kind === 'editor' ? (
                      <Box className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
                    ) : (
                      <FileText className="w-4 h-4 text-green-200" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate group-hover:text-cyan-500 transition-colors">
                      {item.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {item.updatedAt}
                    </div>
                  </div>
                </div>

                <div className="col-span-2">
                  <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-background text-muted-foreground">
                    {projectKindLabel(item.kind)}
                  </span>
                </div>

                <div className="col-span-2">{statusPill(item.status)}</div>

                <div className="col-span-1 flex justify-end pr-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent outline-none transition-colors">
                      <MoreVertical className="w-4 h-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem>
                        <FileText className="w-4 h-4 mr-2" />
                        查看详情
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Box className="w-4 h-4 mr-2" />
                        编辑配置
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-400 focus:text-red-400 focus:bg-red-500/10">
                        <Trash2 className="w-4 h-4 mr-2" />
                        删除项目
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}

            {filteredProjects.length === 0 && (
              <div className="p-10">
                <div className="h-56 rounded-xl border border-dashed border-border bg-background flex items-center justify-center text-muted-foreground">
                  暂无公共项目
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
