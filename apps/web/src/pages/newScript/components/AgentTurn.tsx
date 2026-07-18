import type { AgentTurnActivity, AgentTurnView } from '@/api/agent';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  LoaderCircle,
  Route,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChatContent } from './ChatContent';

function activityLabel(activity: AgentTurnActivity): string {
  if (activity.type === 'thinking') return activity.text ?? '正在分析当前请求';
  if (activity.type === 'stage' || activity.type === 'artifact' || activity.type === 'review') {
    return activity.summary ?? '场景生成状态已更新';
  }
  if (activity.type === 'diagnostic') {
    if (activity.code === 'MODEL_NOT_CONFIGURED') {
      return '尚未配置模型，请先在顶部完成模型配置';
    }
    return activity.summary ?? '执行状态已更新';
  }
  return activity.summary ?? activity.name ?? '正在调用工具';
}

function ActivityIcon({ activity }: { activity: AgentTurnActivity }) {
  if (activity.status === 'failed') return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (activity.status === 'running') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-cyan-600 dark:text-cyan-300" />;
  if (activity.type === 'tool') return <Wrench className="h-3.5 w-3.5 text-muted-foreground" />;
  if (activity.type === 'stage') return <Route className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />;
  if (activity.type === 'artifact') return <FileCheck2 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />;
  if (activity.type === 'review') return <ShieldCheck className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />;
  return <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />;
}

function isActiveStatus(status: AgentTurnView['status']): boolean {
  return status === 'queued' || status === 'running';
}

function turnActivitySummary(turn: AgentTurnView): string {
  const stepCount = turn.activities.length;
  if (isActiveStatus(turn.status)) return `执行过程，正在执行 ${stepCount} 步`;
  if (turn.status === 'failed') return `执行过程，执行失败 ${stepCount} 步`;
  if (turn.status === 'cancelled') return `执行过程，已取消 ${stepCount} 步`;
  return `执行过程，已完成 ${stepCount} 步`;
}

function turnStatusLabel(turn: AgentTurnView): string {
  const stepCount = turn.activities.length;
  if (isActiveStatus(turn.status)) return `执行中 · ${stepCount} 步`;
  if (turn.status === 'failed') return `执行失败 · ${stepCount} 步`;
  if (turn.status === 'cancelled') return `已取消 · ${stepCount} 步`;
  return `已完成 ${stepCount} 步`;
}

export function AgentTurn({ turn, isLatest = false }: { turn: AgentTurnView; isLatest?: boolean }) {
  const isRunning = isActiveStatus(turn.status);
  const [expanded, setExpanded] = useState(isRunning || turn.status === 'failed' || isLatest);
  const stepCount = turn.activities.length;
  const activityName = turnActivitySummary(turn);
  const answer = turn.assistantMessage?.content ?? turn.outcome?.finalAnswer ?? '';

  useEffect(() => {
    if (isActiveStatus(turn.status) || turn.status === 'failed' || isLatest) setExpanded(true);
  }, [turn.status, isLatest]);

  return (
    <div className="flex gap-3" data-agent-turn={turn.id}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
        <Bot className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
      </div>
      <div className="min-w-0 max-w-[88%] flex-1 space-y-2">
        {stepCount > 0 && (
          <div className="overflow-hidden rounded-lg border border-border bg-muted/35">
            <button
              type="button"
              aria-label={activityName}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="font-medium text-foreground">执行过程</span>
              <span className={cn('ml-auto', turn.status === 'failed' && 'text-destructive')}>
                {turnStatusLabel(turn)}
              </span>
            </button>
            {expanded && (
              <div className="border-t border-border px-3 py-2.5">
                <div className="space-y-2 border-l border-border pl-3">
                  {turn.activities.map((activity) => (
                    <div key={activity.id} className="flex min-w-0 items-start gap-2 text-xs">
                      <span className="mt-0.5 shrink-0"><ActivityIcon activity={activity} /></span>
                      <div className="min-w-0 flex-1">
                        <div className={cn('leading-5', activity.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                          {activityLabel(activity)}
                        </div>
                        {activity.type === 'tool' && activity.name && (
                          <div className="mt-0.5 truncate font-mono text-[10px] text-cyan-700 dark:text-cyan-300">
                            {activity.name}
                          </div>
                        )}
                        {activity.type === 'stage' && activity.percentage !== undefined && (
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                            <div
                              aria-label={`${activity.percentage}%`}
                              className="h-1 flex-1 overflow-hidden rounded-sm bg-border"
                            >
                              <div
                                className="h-full bg-cyan-600 dark:bg-cyan-300"
                                style={{ width: `${Math.min(100, Math.max(0, activity.percentage))}%` }}
                              />
                            </div>
                            <span>{activity.percentage}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {stepCount === 0 && !isRunning && (
          <div
            role="status"
            className={cn(
              'flex items-center gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground',
              turn.status === 'failed' && 'text-destructive'
            )}
          >
            <span className="font-medium text-foreground">执行过程</span>
            <span className="ml-auto">{turnStatusLabel(turn)}</span>
          </div>
        )}
        {answer ? (
          <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-foreground shadow-sm">
            <ChatContent content={answer} />
          </div>
        ) : isRunning ? (
          <div aria-label="智能体正在处理" className="flex h-9 items-center gap-1.5 px-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500/60 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500/60 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500/60" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
