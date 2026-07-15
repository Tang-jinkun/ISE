import { Brain, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useState } from 'react';

export const ThinkingProcess = ({ content }: { content: string }) => {
  const [expanded, setExpanded] = useState(true);
  const steps = content.split('\n').filter(Boolean);
  const isFinished = steps.length > 0 && !content.endsWith('...'); // Simple heuristic

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5 dark:text-primary dark:hover:bg-primary/20 transition-colors"
      >
        <div className="flex items-center gap-1.5 flex-1">
          {isFinished ? (
            <Sparkles className="h-3.5 w-3.5" />
          ) : (
            <Brain className="h-3.5 w-3.5 animate-pulse" />
          )}
          <span>思考过程</span>
          {!isFinished && (
            <span className="flex gap-0.5">
              <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1 w-1 rounded-full bg-primary animate-bounce" />
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 opacity-50" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1">
          <div className="space-y-2 border-l-2 border-primary/20 pl-3">
            {steps.map((step, i) => (
              <div key={i} className="relative">
                <div
                  className={`text-[10px] leading-relaxed ${
                    i === steps.length - 1 && !isFinished
                      ? 'text-primary dark:text-primary font-medium animate-pulse'
                      : 'text-muted-foreground'
                  }`}
                >
                  {step}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
