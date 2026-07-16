import { FileText, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DataImportButton } from './DataImportButton';

export type ChatComposerProps = {
  value: string;
  attachment: File | null;
  disabled: boolean;
  error?: string | null;
  onValueChange(value: string): void;
  onAttachmentChange(file: File | null): void;
  onSend(): void;
};

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatComposer({
  value,
  attachment,
  disabled,
  error,
  onValueChange,
  onAttachmentChange,
  onSend
}: ChatComposerProps) {
  const canSend = !disabled && Boolean(value.trim() || attachment);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border border-border bg-background shadow-sm focus-within:border-cyan-500/45">
        {attachment && (
          <div className="flex min-w-0 items-center gap-2 border-b border-border bg-muted/35 px-3 py-2">
            <FileText className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-300" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-foreground">
                {attachment.name}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {formatFileSize(attachment.size)}
              </div>
            </div>
            <button
              type="button"
              aria-label="移除附件"
              title="移除附件"
              disabled={disabled}
              onClick={() => onAttachmentChange(null)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <textarea
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !(event.nativeEvent as KeyboardEvent).isComposing
            ) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder="描述你想生成的场景..."
          className="block min-h-20 max-h-40 w-full resize-none bg-transparent px-3 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="flex h-10 items-center justify-between border-t border-border/70 px-2">
          <DataImportButton
            className="h-7 w-7 border-0 bg-transparent"
            isLoading={disabled}
            onImport={onAttachmentChange}
          />
          <button
            type="button"
            aria-label="发送消息"
            title="发送消息"
            disabled={!canSend}
            onClick={onSend}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
              canSend
                ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 dark:text-cyan-200'
                : 'border-border bg-muted text-muted-foreground'
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
