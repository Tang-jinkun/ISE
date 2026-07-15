import { Database, Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

type DataImportButtonProps = {
  className?: string;
  isLoading?: boolean;
  onImport?: (file: File) => void | Promise<void>;
};

export const DataImportButton = ({
  className,
  isLoading = false,
  onImport
}: DataImportButtonProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label="导入 DOCX 报告"
        className="sr-only"
        disabled={isLoading || !onImport}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file && onImport) void onImport(file);
        }}
      />
      <button
        type="button"
        disabled={isLoading || !onImport}
        title="导入数据"
        aria-label="导入数据"
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card/50 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:opacity-50',
          className
        )}
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Database className="h-3.5 w-3.5" />
        )}
      </button>
    </>
  );
};
