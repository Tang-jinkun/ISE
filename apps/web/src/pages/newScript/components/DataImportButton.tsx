import React from 'react';
import { Database, Loader2 } from 'lucide-react';
import { useWarDataStore, type DatasetKey } from '@/stores/warDataStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';

export const DataImportButton: React.FC<{ className?: string }> = ({ className }) => {
  const { switchMockDataset, isLoading, currentKey } = useWarDataStore();

  const datasets: { key: DatasetKey; label: string }[] = [
    { key: 'chibi', label: '赤壁之战' },
    { key: 'hainan', label: '海南岛战役' },
    { key: 'nuoman', label: '诺曼底登陆' },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={isLoading}
          title="导入数据"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card/50 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:opacity-50",
            className
          )}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Database className="h-3.5 w-3.5" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">
          数据源导入
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {datasets.map((ds) => (
          <DropdownMenuItem
            key={ds.key}
            onClick={() => switchMockDataset(ds.key)}
            className={cn(
              "flex items-center justify-between text-xs font-bold transition-colors",
              currentKey === ds.key ? "text-primary bg-primary/5" : "text-foreground hover:text-primary"
            )}
          >
            {ds.label}
            {currentKey === ds.key && (
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
