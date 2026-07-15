import React, { createContext, useContext } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface EditorPanelProps {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  headerContent?: React.ReactNode;
}

const EditorContext = createContext<{ embedded?: boolean }>({});
export const EditorProvider = EditorContext.Provider;

export function EditorPanel({
  title,
  onClose,
  children,
  className,
  headerContent
}: EditorPanelProps) {
  const { embedded } = useContext(EditorContext);

  if (embedded) {
    return (
      <div className={cn("flex flex-col", className)}>
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border/50">
          <div className="font-medium text-sm text-foreground">{title}</div>
          <div className="flex items-center gap-2">
            {headerContent}
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-6">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full bg-card border-l border-border", className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="font-medium text-sm">{title}</div>
        <div className="flex items-center gap-2">
          {headerContent}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {children}
        </div>
      </ScrollArea>
    </div>
  );
}

export const SectionTitle = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider", className)}>
    {children}
  </div>
);

export const FormItem = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
  <div className={cn("space-y-2", className)}>
    <label className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
      {label}
    </label>
    {children}
  </div>
);

export const FormRow = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("grid grid-cols-12 gap-2 items-center", className)}>
    {children}
  </div>
);
