import { AlertTriangle, ArrowDown, ArrowUp, Link2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { AgentArtifactView, AgentEventUnit, ReviewTuple, RevisionRequest } from '@/api/agent';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type EventPlanReviewProps = {
  artifact: AgentArtifactView;
  review: ReviewTuple;
  onApprove: (review: ReviewTuple) => void;
  onRevise: (revision: RevisionRequest) => void;
  onReject: (review: ReviewTuple) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEventUnit(value: unknown): value is AgentEventUnit {
  if (!isRecord(value)) return false;
  return (
    typeof value.eventUnitId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.worldStateChange === 'string' &&
    Array.isArray(value.participants) &&
    Array.isArray(value.locationRefs) &&
    Array.isArray(value.evidenceRefs) &&
    Array.isArray(value.inferenceRefs) &&
    Array.isArray(value.uncertainties) &&
    typeof value.narrativePurpose === 'string' &&
    ['high', 'medium', 'low'].includes(String(value.importance))
  );
}

function artifactEventUnits(artifact: AgentArtifactView): AgentEventUnit[] {
  if (!isRecord(artifact.data) || !Array.isArray(artifact.data.eventUnits)) {
    return [];
  }
  return artifact.data.eventUnits.filter(isEventUnit);
}

function cloneEventUnits(units: AgentEventUnit[]): AgentEventUnit[] {
  return units.map((unit) => ({
    ...unit,
    participants: [...unit.participants],
    locationRefs: [...unit.locationRefs],
    evidenceRefs: [...unit.evidenceRefs],
    inferenceRefs: [...unit.inferenceRefs],
    uncertainties: [...unit.uncertainties],
  }));
}

function exactReviewTuple(review: ReviewTuple): ReviewTuple {
  return {
    reviewId: review.reviewId,
    artifactId: review.artifactId,
    version: review.version,
    fingerprint: review.fingerprint,
  };
}

export function EventPlanReview({ artifact, ...props }: EventPlanReviewProps) {
  return (
    <EventPlanReviewEditor
      key={`${artifact.artifactId}:${artifact.version}`}
      artifact={artifact}
      {...props}
    />
  );
}

function EventPlanReviewEditor({
  artifact,
  review,
  onApprove,
  onRevise,
  onReject,
}: EventPlanReviewProps) {
  const [draftUnits, setDraftUnits] = useState<AgentEventUnit[]>(() =>
    cloneEventUnits(artifactEventUnits(artifact)),
  );

  const replaceUnit = (index: number, next: AgentEventUnit) => {
    setDraftUnits((current) =>
      current.map((unit, unitIndex) => (unitIndex === index ? next : unit)),
    );
  };

  const move = (from: number, to: number) => {
    setDraftUnits((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (!moved) return current;
      next.splice(to, 0, moved);
      return next;
    });
  };

  const remove = (index: number) => {
    setDraftUnits((current) =>
      current.length === 1 ? current : current.filter((_, unitIndex) => unitIndex !== index),
    );
  };

  if (draftUnits.length === 0) {
    return (
      <p role="alert" className="text-sm text-destructive">
        事件计划内容不可用
      </p>
    );
  }

  return (
    <section aria-labelledby="event-plan-review-title" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="event-plan-review-title" className="text-base font-semibold text-foreground">
            事件计划审核
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            版本 {review.version} · {draftUnits.length} 个事件
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {draftUnits.map((unit, index) => (
          <fieldset
            key={unit.eventUnitId}
            aria-label={`事件 ${unit.title}`}
            className="space-y-3 rounded-md border border-border bg-background p-3"
          >
            <legend className="sr-only">事件 {unit.title}</legend>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`event-title-${unit.eventUnitId}`}
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  事件标题
                </label>
                <Input
                  id={`event-title-${unit.eventUnitId}`}
                  value={unit.title}
                  onChange={(changeEvent) =>
                    replaceUnit(index, {
                      ...unit,
                      title: changeEvent.target.value,
                    })
                  }
                />
              </div>

              <div className="flex shrink-0 items-center gap-1 pt-5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`上移 ${unit.title}`}
                  title={`上移 ${unit.title}`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`下移 ${unit.title}`}
                  title={`下移 ${unit.title}`}
                  disabled={index === draftUnits.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  aria-label={`删除 ${unit.title}`}
                  title={`删除 ${unit.title}`}
                  disabled={draftUnits.length === 1}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem]">
              <div>
                <label
                  htmlFor={`event-state-${unit.eventUnitId}`}
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  状态变化
                </label>
                <Textarea
                  id={`event-state-${unit.eventUnitId}`}
                  className="min-h-20 resize-y"
                  value={unit.worldStateChange}
                  onChange={(changeEvent) =>
                    replaceUnit(index, {
                      ...unit,
                      worldStateChange: changeEvent.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label
                  htmlFor={`event-importance-${unit.eventUnitId}`}
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  重要程度
                </label>
                <select
                  id={`event-importance-${unit.eventUnitId}`}
                  aria-label={`重要程度 ${unit.title}`}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={unit.importance}
                  onChange={(changeEvent) =>
                    replaceUnit(index, {
                      ...unit,
                      importance: changeEvent.target.value as AgentEventUnit['importance'],
                    })
                  }
                >
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </div>
            </div>

            <div className="grid gap-3 border-t border-border pt-3 md:grid-cols-2">
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Link2 className="size-3.5" aria-hidden="true" />
                  证据来源
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {unit.evidenceRefs.length > 0 ? (
                    unit.evidenceRefs.map((evidenceRef) => (
                      <a
                        key={evidenceRef}
                        href={`#evidence-${encodeURIComponent(evidenceRef)}`}
                        className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-accent"
                      >
                        {evidenceRef}
                      </a>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">无直接证据</span>
                  )}
                </div>
              </div>

              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  推断与不确定性
                </p>
                {unit.inferenceRefs.length > 0 || unit.uncertainties.length > 0 ? (
                  <div className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
                    {unit.inferenceRefs.map((inferenceRef) => (
                      <p key={inferenceRef}>推断依据：{inferenceRef}</p>
                    ))}
                    {unit.uncertainties.map((uncertainty) => (
                      <p key={uncertainty}>{uncertainty}</p>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">无推断项</span>
                )}
              </div>
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="destructive"
          onClick={() => onReject(exactReviewTuple(review))}
        >
          拒绝事件计划
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onRevise({
              baseArtifactId: artifact.artifactId,
              eventUnits: cloneEventUnits(draftUnits),
            })
          }
        >
          提交修改
        </Button>
        <Button type="button" onClick={() => onApprove(exactReviewTuple(review))}>
          批准事件计划
        </Button>
      </div>
    </section>
  );
}
