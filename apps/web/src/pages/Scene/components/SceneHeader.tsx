import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Clock,
  Loader2,
  Map as MapIcon,
  Pause,
  Play,
  RotateCcw,
  Save,
  Settings
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface SceneHeaderProps {
  projectTitle: string;
  totalDuration?: number;
  currentTime?: number;
  onTitleChange?: (title: string) => void;
  onSave?: () => Promise<void>;
  onPlay?: () => void;
  onPause?: () => void;
  onReplay?: () => void;
  onSeek?: (timeSeconds: number) => void;
  runtimeReady?: boolean;
  projectId?: string | null;
  mode?: 'edit' | 'preview';
}

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export function SceneHeader({
  projectTitle,
  totalDuration = 0,
  currentTime = 0,
  onTitleChange,
  onSave,
  onPlay,
  onPause,
  onReplay,
  onSeek,
  runtimeReady = false,
  projectId,
  mode = 'edit'
}: SceneHeaderProps) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!onSave) return;
    try {
      setSaving(true);
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-xl"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-cyan-400" />
            <Input
              value={projectTitle}
              onChange={(e) => onTitleChange?.(e.target.value)}
              readOnly={mode === 'preview'}
              className={cn(
                'h-7 w-[260px] text-sm font-semibold border-transparent bg-transparent px-2',
                mode === 'edit' && 'hover:border-border focus:border-cyan-500'
              )}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 px-2">
            <span>场景编辑器</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl"
            aria-label="播放"
            onClick={onPlay}
            data-testid="scene-runtime-play"
            disabled={!runtimeReady}
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl"
            aria-label="暂停"
            onClick={onPause}
            data-testid="scene-runtime-pause"
            disabled={!runtimeReady}
          >
            <Pause className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl"
            aria-label="重播"
            onClick={onReplay}
            data-testid="scene-runtime-replay"
            disabled={!runtimeReady}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <div className="hidden items-center gap-1 rounded-xl border border-border bg-card px-2 py-1 text-xs text-muted-foreground md:flex">
            <Clock className="h-3 w-3" />
            <span>
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
          </div>
          {mode === 'preview' && (
            <input
              type="range"
              min={0}
              max={totalDuration}
              step={0.001}
              value={Math.min(totalDuration, Math.max(0, currentTime))}
              aria-label="场景时间线"
              data-testid="scene-runtime-seek"
              className="ml-2 h-1 w-36 cursor-pointer accent-cyan-500"
              disabled={!runtimeReady}
              onChange={(event) => onSeek?.(Number(event.target.value))}
            />
          )}
        </div>
        <ThemeToggle />
        {mode === 'edit' && (
          <>
            <Button
              variant="ghost"
              className="hidden md:inline-flex gap-2 text-xs"
            >
              <Settings className="w-3.5 h-3.5" />
              场景设置
            </Button>
            <Button
              variant="ghost"
              className="gap-2 rounded-xl text-xs"
              onClick={() =>
                navigate(
                  projectId
                    ? `/preview?projectId=${encodeURIComponent(projectId)}`
                    : '/preview',
                )
              }
            >
              <Play className="w-3.5 h-3.5" />
              预览
            </Button>
            <Button
              className="gap-2 rounded-xl text-xs px-4"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              保存
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
