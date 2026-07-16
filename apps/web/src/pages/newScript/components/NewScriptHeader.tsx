import {
  ArrowLeft,
  Eye,
  FileText,
  History,
  Save,
  Settings2,
  TriangleAlert
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import type { ArtifactExports } from '../artifactExports';
import { ArtifactExportControls } from './ArtifactExportControls';

export type NewScriptHeaderProps = {
  title: string;
  onTitleChange(value: string): void;
  onBack(): void;
  onOpenLegacy(): void;
  onConfigureModel(): void;
  modelLabel: string;
  modelConfigError: boolean;
  exports: ArtifactExports;
  saving: boolean;
  onSave(): void;
  previewEnabled: boolean;
  onPreview(): void;
};

export function NewScriptHeader({
  title,
  onTitleChange,
  onBack,
  onOpenLegacy,
  onConfigureModel,
  modelLabel,
  modelConfigError,
  exports,
  saving,
  onSave,
  previewEnabled,
  onPreview
}: NewScriptHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <button
        type="button"
        aria-label="返回"
        title="返回"
        onClick={onBack}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-accent"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      <FileText className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-300" />
      <input
        type="text"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="未命名脚本项目"
        className="min-w-0 max-w-md flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground"
      />

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label={modelConfigError ? '模型状态异常' : undefined}
          onClick={onConfigureModel}
          className={modelConfigError
            ? 'inline-flex h-8 min-w-0 max-w-56 items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 text-xs text-destructive transition-colors hover:bg-destructive/10'
            : 'inline-flex h-8 min-w-0 max-w-56 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'}
        >
          {modelConfigError ? (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Settings2 className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{modelLabel}</span>
        </button>
        {modelConfigError && (
          <span role="alert" className="sr-only">
            模型配置状态加载失败
          </span>
        )}

        <button
          type="button"
          onClick={onOpenLegacy}
          className="hidden h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex"
        >
          <History className="h-3.5 w-3.5" />
          返回旧版
        </button>

        <ThemeToggle />
        <ArtifactExportControls exports={exports} />

        <button
          type="button"
          aria-label={saving ? '保存中' : '保存'}
          disabled={saving}
          onClick={onSave}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{saving ? '保存中' : '保存'}</span>
        </button>

        <button
          type="button"
          aria-label="预览"
          disabled={!previewEnabled}
          onClick={onPreview}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2.5 text-xs text-cyan-700 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-cyan-200"
        >
          <Eye className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">预览</span>
        </button>
      </div>
    </header>
  );
}
