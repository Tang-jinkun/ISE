import type { ReactNode } from 'react';
import {
  AlertTriangle,
  PanelRightClose,
  PanelRightOpen,
  Workflow
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceState, WorkspaceTab } from '../workspaceStage';

const TAB_LABELS: Record<WorkspaceTab, string> = {
  'event-plan': '事件计划',
  narration: '字幕脚本',
  blueprint: '场景蓝图',
  assets: '资源',
  params: '参数',
  preview: '预览'
};

export type SceneWorkspaceProps = {
  state: WorkspaceState;
  activeTab: WorkspaceTab | null;
  onTabChange(tab: WorkspaceTab): void;
  widthPct: number;
  collapsed: boolean;
  onCollapsedChange(value: boolean): void;
  panels: Partial<Record<WorkspaceTab, ReactNode>>;
};

export function SceneWorkspace({
  state,
  activeTab,
  onTabChange,
  widthPct,
  collapsed,
  onCollapsedChange,
  panels
}: SceneWorkspaceProps) {
  if (!state.visible) return null;

  const renderedTabs = state.availableTabs.filter(
    (tab) => panels[tab] !== undefined
  );
  const selectedTab =
    activeTab && renderedTabs.includes(activeTab)
      ? activeTab
      : renderedTabs[0] ?? null;

  if (collapsed) {
    return (
      <aside
        role="complementary"
        aria-label="场景工作台"
        style={{ width: '44px' }}
        className="hidden h-full shrink-0 border-l border-border bg-card md:flex md:flex-col md:items-center md:py-2"
      >
        <button
          type="button"
          aria-label="展开场景工作台"
          title="展开场景工作台"
          onClick={() => onCollapsedChange(false)}
          className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      role="complementary"
      aria-label="场景工作台"
      style={{ width: `${widthPct}%` }}
      className="hidden h-full min-w-0 shrink-0 overflow-hidden rounded-md border border-border bg-card md:flex md:flex-col"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Workflow className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        <h2 className="text-sm font-semibold text-foreground">场景工作台</h2>
        {state.failed && (
          <span className="ml-1 inline-flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            生成受阻
          </span>
        )}
        <button
          type="button"
          aria-label="收起场景工作台"
          title="收起场景工作台"
          onClick={() => onCollapsedChange(true)}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>

      {renderedTabs.length > 0 && (
        <div
          role="tablist"
          aria-label="场景工作台视图"
          className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-border px-2"
        >
          {renderedTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selectedTab === tab}
              onClick={() => onTabChange(tab)}
              className={cn(
                'h-9 shrink-0 border-b-2 px-3 text-xs font-medium transition-colors',
                selectedTab === tab
                  ? 'border-cyan-500 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        {selectedTab ? panels[selectedTab] : null}
      </div>
    </aside>
  );
}
