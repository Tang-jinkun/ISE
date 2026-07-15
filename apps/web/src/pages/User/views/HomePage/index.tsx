import {
  createBlankScene,
  deleteScene,
  listScenes,
  type SceneItem
} from '@/api/scene';
import {
  createScript,
  deleteScript,
  listScripts,
  type ScriptItem
} from '@/api/script';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { message } from '@/components/ui/message';
import { FileText, Folder, Globe, Trash2, Video } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type ProjectType = 'scene' | 'script';

type RecentProject = {
  id: string;
  type: ProjectType;
  title: string;
  image?: string;
  updatedAt?: string;
};

export default function HomePage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(false);

  // Creation Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<ProjectType>('scene');
  const [createTitle, setCreateTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmNewScript, setConfirmNewScript] =
    useState<RecentProject | null>(null);

  const buildProjectTitle = (
    item: { title?: string; name?: string },
    fallback: string
  ) =>
    item.title && item.title.trim().length > 0
      ? item.title
      : item.name && item.name.trim().length > 0
        ? item.name
        : fallback;

  const loadProjects = async () => {
    try {
      setLoading(true);
      const [scriptRes, sceneRes] = await Promise.all([
        listScripts(),
        listScenes()
      ]);

      const scripts: RecentProject[] = (scriptRes.data ?? []).map(
        (s: ScriptItem) => ({
          id: String(s.id),
          type: 'script',
          title: buildProjectTitle(s, '未命名脚本'),
          updatedAt: s.updatedAt
        })
      );

      const scenes: RecentProject[] = (sceneRes.data ?? []).map(
        (s: SceneItem) => ({
          id: String(s.id),
          type: 'scene',
          title: buildProjectTitle(s, '未命名场景'),
          image: s.image ?? s.coverUrl,
          updatedAt: s.updatedAt
        })
      );

      const merged = [...scripts, ...scenes].sort((a, b) => {
        if (!a.updatedAt && !b.updatedAt) return 0;
        if (!a.updatedAt) return 1;
        if (!b.updatedAt) return -1;
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });

      setProjects(merged);
    } catch (error) {
      console.error(error);
      message.error('加载项目列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleOpenCreate = (type: ProjectType) => {
    setCreateType(type);
    setCreateTitle('');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!createTitle.trim()) {
      message.info('请输入项目名称');
      return;
    }
    try {
      setCreating(true);
      let newId: string;
      if (createType === 'script') {
        const res = await createScript({ title: createTitle });
        newId = String(res.data.id);
        navigate(`/script?projectId=${newId}`);
      } else {
        const res = await createBlankScene({ title: createTitle });
        newId = String(res.data.id);
        navigate(`/scene?projectId=${newId}`);
      }
      message.success('创建成功');
      setCreateOpen(false);
    } catch (error) {
      console.error(error);
      message.error('创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProject = async (project: RecentProject) => {
    try {
      if (project.type === 'script') {
        await deleteScript(project.id);
      } else if (project.type === 'scene') {
        await deleteScene(project.id);
      }
      message.success('删除成功');
      await loadProjects();
    } catch (error) {
      console.error(error);
      message.error('删除失败');
    }
  };

  const hasProjects = useMemo(() => projects.length > 0, [projects]);

  return (
    <div className="min-h-full py-6 animate-in fade-in duration-500 bg-background text-foreground">
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {createType === 'scene' ? '新建场景项目' : '新建脚本项目'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              输入名称后即可进入创作工作台
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">项目名称</Label>
              <Input
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder={
                  createType === 'scene' ? '未命名场景项目' : '未命名脚本项目'
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                className="bg-background border-border text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => setCreateOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground hover:bg-card/60"
              >
                取消
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating}
                className="bg-cyan-600 hover:bg-cyan-700 text-xs text-foreground px-4"
              >
                {creating ? '创建中...' : '确定创建'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmNewScript}
        onOpenChange={(open) => !open && setConfirmNewScript(null)}
      >
        <DialogContent className="bg-card border border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              进入脚本工作台
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              我们推出了新版脚本工作台，是否立即体验？
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={() => {
                if (confirmNewScript) {
                  navigate(`/script?projectId=${confirmNewScript.id}`);
                }
                setConfirmNewScript(null);
              }}
              className="text-xs text-muted-foreground hover:text-foreground hover:bg-card/60"
            >
              进入旧版
            </Button>
            <Button
              onClick={() => {
                if (confirmNewScript) {
                  navigate(`/new-script?projectId=${confirmNewScript.id}`);
                }
                setConfirmNewScript(null);
              }}
              className="bg-cyan-600 hover:bg-cyan-700 text-xs text-foreground px-4"
            >
              体验新版
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2.8fr)_minmax(0,3.2fr)]">
        <section className="space-y-6">
          <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card px-6 py-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-cyan-600 dark:text-cyan-300 mb-1.5">
                  工作台 · 概览
                </div>
                <div className="text-xl font-semibold text-foreground">
                  让我们创作一些新的地理场景吧
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  从脚本或场景开始，逐步搭建你的战例与故事线。
                </div>
              </div>
              <div className="hidden sm:flex items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10 p-3">
                <Globe className="w-8 h-8 text-cyan-600 dark:text-cyan-300" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="text-[11px] text-muted-foreground">总项目</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {projects.length}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                包含脚本与场景
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="text-[11px] text-muted-foreground">脚本项目</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-300">
                {projects.filter((p) => p.type === 'script').length}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                适合编排故事与提要
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="text-[11px] text-muted-foreground">场景项目</div>
              <div className="mt-1 text-2xl font-semibold text-cyan-600 dark:text-cyan-300">
                {projects.filter((p) => p.type === 'scene').length}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                适合搭建地理空间演示
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold text-muted-foreground">
              快速创建
            </div>
            <div className="grid grid-cols-1 gap-3">
              <ActionButton
                icon={Globe}
                label="新建场景项目"
                subLabel="构建三维地理场景与态势"
                variant="cyan"
                onClick={() => handleOpenCreate('scene')}
              />
              <ActionButton
                icon={FileText}
                label="新建脚本项目"
                subLabel="编排故事线与分镜脚本"
                variant="emerald"
                onClick={() => handleOpenCreate('script')}
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">
                最近动态
              </div>
              <div className="text-base font-semibold text-foreground">
                项目时间线
              </div>
            </div>
            {loading && (
              <div className="text-[11px] text-muted-foreground">
                正在加载项目…
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            {!loading && !hasProjects && (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                暂无项目，可在左侧通过「新建场景项目」或「新建脚本项目」快速开始。
              </div>
            )}

            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  if (project.type === 'script') {
                    setConfirmNewScript(project);
                  } else {
                    navigate(`/scene?projectId=${project.id}`);
                  }
                }}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/80 transition-colors text-left"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted/80">
                  {project.type === 'scene' ? (
                    <Globe className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
                  ) : (
                    <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium text-foreground">
                      {project.title}
                    </div>
                    <span className="inline-flex items-center rounded-full bg-muted/80 px-2 py-0.5 text-[11px] text-foreground border border-border">
                      {project.type === 'scene' ? '场景' : '脚本'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {project.updatedAt
                        ? project.updatedAt.slice(0, 16).replace('T', ' ')
                        : '刚刚创建'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(project);
                    }}
                    className="inline-flex items-center justify-center rounded-md border border-red-500/40 px-2 py-1 text-[11px] text-destructive hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    删除
                  </button>
                </div>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-muted-foreground">
                公共项目空间
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                后续可在此挂载团队共享项目夹或模板库。
              </div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-yellow-400/40 bg-yellow-500/10">
              <Folder className="w-4 h-4 text-yellow-400" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  subLabel,
  onClick,
  variant = 'cyan'
}: {
  icon: any;
  label: string;
  subLabel?: string;
  onClick?: () => void;
  variant?: 'cyan' | 'emerald';
}) {
  const colorStyles =
    variant === 'cyan'
      ? {
          iconBg: 'bg-cyan-500/10 group-hover:bg-cyan-500/20',
          iconColor: 'text-cyan-400',
          borderHover: 'hover:border-cyan-500/30',
          bgHover: 'hover:bg-cyan-950/30'
        }
      : {
          iconBg: 'bg-emerald-500/10 group-hover:bg-emerald-500/20',
          iconColor: 'text-emerald-400',
          borderHover: 'hover:border-emerald-500/30',
          bgHover: 'hover:bg-emerald-950/30'
        };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full flex items-center gap-4 px-4 py-4 bg-muted border border-border/50 rounded-xl transition-all duration-300 ${colorStyles.borderHover} ${colorStyles.bgHover}`}
    >
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border/50 transition-colors duration-300 ${colorStyles.iconBg}`}
      >
        <Icon className={`w-6 h-6 ${colorStyles.iconColor}`} />
      </div>
      <div className="flex flex-col items-start text-left">
        <span className="text-sm font-bold text-foreground group-hover:text-foreground transition-colors">
          {label}
        </span>
        {subLabel && (
          <span className="text-xs text-muted-foreground group-hover:text-muted-foreground transition-colors">
            {subLabel}
          </span>
        )}
      </div>
    </button>
  );
}

function ProjectCard({
  project,
  onOpenScript,
  onOpenScene,
  onDelete
}: {
  project: RecentProject;
  onOpenScript: (id: string) => void;
  onOpenScene: (id: string) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="group cursor-pointer relative"
      onClick={() => {
        if (project.type === 'script') onOpenScript(project.id);
        if (project.type === 'scene') onOpenScene(project.id);
      }}
    >
      {/* Card Body */}
      <div className="aspect-square bg-card rounded-xl border border-border/50 relative overflow-hidden group-hover:border-cyan-500/50 transition-all duration-300">
        {/* Delete Button (Top Right) */}
        <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 bg-red-500/80 hover:bg-red-500 text-foreground rounded-md backdrop-blur-sm"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="w-full h-full flex items-center justify-center p-4">
          {project.type === 'scene' ? (
            <div className="relative w-full h-full">
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10" />
              {project.image ? (
                <img
                  src={project.image}
                  alt={project.title}
                  className="w-full h-full object-cover rounded-lg transform group-hover:scale-110 transition-transform duration-500"
                />
              ) : null}
              <div className="absolute inset-0 flex items-center justify-center z-0 opacity-20">
                <Globe className="w-20 h-20 text-blue-400 animate-pulse" />
              </div>
            </div>
          ) : project.type === 'script' ? (
            <FileText className="w-20 h-20 text-blue-500 stroke-[1.5] group-hover:scale-110 transition-transform duration-300" />
          ) : (
            <Video className="w-20 h-20 text-purple-500 stroke-[1.5] group-hover:scale-110 transition-transform duration-300" />
          )}
        </div>
      </div>

      {/* Title */}
      <div className="mt-2 text-sm font-bold text-foreground truncate group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors px-1">
        {project.title}
      </div>
    </div>
  );
}
