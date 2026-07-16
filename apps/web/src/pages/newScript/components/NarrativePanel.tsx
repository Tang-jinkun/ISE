import type { AgentArtifactView, AgentEventUnit } from '@/api/agent';
import { Copy } from 'lucide-react';

type NarrativePanelProps = {
  selectedNode: { id: string; title: string; summary: string };
  nowText: () => string;
  onCopy: () => void;
  eventPlan?: AgentArtifactView;
  narrativePlan?: AgentArtifactView;
};

type SubtitleView = {
  subtitleId: string;
  eventUnitId: string;
  text: string;
  importance: 'high' | 'medium' | 'low';
  evidenceRefs: string[];
};

const importanceLabel = {
  high: '高重要度',
  medium: '中重要度',
  low: '低重要度'
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function eventUnits(artifact?: AgentArtifactView): AgentEventUnit[] {
  if (!isRecord(artifact?.data) || !Array.isArray(artifact.data.eventUnits)) {
    return [];
  }
  return artifact.data.eventUnits as AgentEventUnit[];
}

function subtitles(artifact?: AgentArtifactView): SubtitleView[] {
  if (!isRecord(artifact?.data) || !Array.isArray(artifact.data.subtitles)) {
    return [];
  }
  return artifact.data.subtitles.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.subtitleId !== 'string' ||
      typeof value.eventUnitId !== 'string' ||
      typeof value.text !== 'string' ||
      !['high', 'medium', 'low'].includes(String(value.importance)) ||
      !Array.isArray(value.evidenceRefs)
    ) {
      return [];
    }
    return [
      {
        subtitleId: value.subtitleId,
        eventUnitId: value.eventUnitId,
        text: value.text,
        importance: value.importance as SubtitleView['importance'],
        evidenceRefs: value.evidenceRefs.filter(
          (reference): reference is string => typeof reference === 'string'
        )
      }
    ];
  });
}

function targetDuration(artifact?: AgentArtifactView): number | null {
  if (
    !isRecord(artifact?.data) ||
    typeof artifact.data.targetDurationMs !== 'number'
  ) {
    return null;
  }
  return Math.round(artifact.data.targetDurationMs / 1000);
}

export function NarrativePanel({
  selectedNode,
  onCopy,
  eventPlan,
  narrativePlan
}: NarrativePanelProps) {
  const units = eventUnits(eventPlan);
  const script = subtitles(narrativePlan);
  const durationSeconds = targetDuration(narrativePlan);
  const showingNarration = Boolean(narrativePlan);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={showingNarration ? '字幕脚本' : '事件计划'}>
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {showingNarration ? '字幕脚本' : '事件计划'}
          </h2>
          {selectedNode.title && (
            <p className="truncate text-[10px] text-muted-foreground">
              {selectedNode.title}
            </p>
          )}
        </div>
        {durationSeconds !== null && (
          <span className="shrink-0 text-xs text-muted-foreground">
            目标时长 {durationSeconds} 秒
          </span>
        )}
        <button
          type="button"
          aria-label="复制产物摘要"
          title="复制产物摘要"
          onClick={onCopy}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Copy className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 thin-scrollbar">
        {showingNarration ? (
          script.length > 0 ? (
            <ol className="divide-y divide-border">
              {script.map((subtitle, index) => (
                <li key={subtitle.subtitleId} className="py-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{String(index + 1).padStart(2, '0')}</span>
                    <span>{subtitle.eventUnitId}</span>
                    <span className="ml-auto">{importanceLabel[subtitle.importance]}</span>
                  </div>
                  <p className="text-sm leading-6 text-foreground">{subtitle.text}</p>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {subtitle.evidenceRefs.length} 条证据
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无字幕</p>
          )
        ) : units.length > 0 ? (
          <ol className="divide-y divide-border">
            {units.map((unit, index) => (
              <li key={unit.eventUnitId} className="py-4">
                <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="font-mono">{String(index + 1).padStart(2, '0')}</span>
                  <span>{importanceLabel[unit.importance]}</span>
                  <span className="ml-auto">{unit.evidenceRefs.length} 条证据</span>
                </div>
                <h3 className="text-sm font-semibold text-foreground">{unit.title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {unit.narrativePurpose}
                </p>
                {unit.participants.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-foreground/75">
                    {unit.participants.map((participant) => (
                      <span key={participant}>{participant}</span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">暂无事件计划</p>
        )}
      </div>
    </section>
  );
}
