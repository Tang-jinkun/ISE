import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Loader2,
  Map as MapIcon,
  Play,
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
        <ThemeToggle />
        {/* <div className="hidden md:flex items-center gap-1 rounded-xl border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>
            {formatTime(currentTime)} / {formatTime(totalDuration)}
          </span>
        </div> */}
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
              onClick={() => navigate('/preview')}
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
