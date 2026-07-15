import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface LoadingProps {
  className?: string;
  text?: string;
}

export function Loading({
  className,
  text = 'SYSTEM INITIALIZING...'
}: LoadingProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex h-screen w-full flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-md transition-all duration-300',
        className
      )}
    >
      <div className="relative flex h-32 w-32 items-center justify-center">
        {/* Outer rotating ring - Slow */}
        <div className="absolute inset-0 animate-[spin_3s_linear_infinite] rounded-full border-b-2 border-t-2 border-cyan-500/20" />

        {/* Middle rotating ring - Reverse */}
        <div className="absolute inset-4 animate-[spin_2s_linear_infinite_reverse] rounded-full border-l-2 border-r-2 border-cyan-500/40" />

        {/* Inner rotating ring - Fast */}
        <div className="absolute inset-8 animate-[spin_1s_linear_infinite] rounded-full border-b-2 border-cyan-500/60" />

        {/* Center pulsing core */}
        <div className="absolute inset-[38px] animate-pulse rounded-full bg-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.6)]" />

        {/* Center Icon */}
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
      </div>

      <div className="flex flex-col items-center gap-2 mt-4">
        <h2 className="text-xl font-bold tracking-[0.2em] text-cyan-500 animate-pulse">
          INTELLIGENT SCENEDITOR
        </h2>
        <div className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-cyan-500/50 animate-bounce [animation-delay:-0.3s]" />
          <span className="h-1 w-1 rounded-full bg-cyan-500/50 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-1 w-1 rounded-full bg-cyan-500/50 animate-bounce" />
          <span className="text-xs font-mono text-muted-foreground/80 tracking-widest uppercase ml-2">
            {text}
          </span>
        </div>
      </div>

      {/* Decorative background elements */}
      <div className="absolute bottom-0 left-0 h-32 w-32 bg-cyan-500/5 blur-[100px]" />
      <div className="absolute top-0 right-0 h-32 w-32 bg-purple-500/5 blur-[100px]" />
    </div>
  );
}
