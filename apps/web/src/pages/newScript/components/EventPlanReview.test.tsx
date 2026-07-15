import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentArtifactView, AgentEventUnit, ReviewTuple } from '@/api/agent';
import { EventPlanReview } from './EventPlanReview';

const review: ReviewTuple = {
  reviewId: 'review-1',
  artifactId: 'draft-1',
  version: 1,
  fingerprint: `sha256:${'a'.repeat(64)}`,
};

const eventUnits: AgentEventUnit[] = [
  {
    eventUnitId: 'eu-1',
    title: '建立攻击链',
    worldStateChange: '编队发现目标并建立跟踪',
    participants: ['aircraft-1'],
    locationRefs: ['location-1'],
    realWorldTime: '2026-07-15T08:00:00+08:00',
    evidenceRefs: ['evidence-1'],
    inferenceRefs: [],
    uncertainties: [],
    narrativePurpose: '交代交战起点',
    importance: 'high',
  },
  {
    eventUnitId: 'eu-2',
    title: '目标机动',
    worldStateChange: '目标改变航向',
    participants: ['aircraft-2'],
    locationRefs: ['location-2'],
    evidenceRefs: [],
    inferenceRefs: ['inference-1'],
    uncertainties: ['原始材料未说明机动原因'],
    narrativePurpose: '推动冲突升级',
    importance: 'medium',
  },
];

const artifact: AgentArtifactView = {
  artifactId: 'draft-1',
  type: 'ise.event-plan-draft/v1',
  version: 1,
  createdAt: '2026-07-15T00:00:00.000Z',
  createdBy: 'agent',
  superseded: false,
  data: {
    schemaVersion: 'event-plan/v1',
    planId: 'plan-1',
    documentId: 'document-1',
    version: 1,
    eventUnits,
    omittedEvidence: [],
    warnings: [],
  },
};

describe('EventPlanReview', () => {
  const onApprove = vi.fn();
  const onRevise = vi.fn();
  const onReject = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderReview() {
    return render(
      <EventPlanReview
        artifact={artifact}
        review={review}
        onApprove={onApprove}
        onRevise={onRevise}
        onReject={onReject}
      />,
    );
  }

  it('renders event state, importance, evidence, and inference warnings', () => {
    renderReview();

    expect(screen.getByDisplayValue('建立攻击链')).toBeInTheDocument();
    expect(screen.getByDisplayValue('编队发现目标并建立跟踪')).toBeInTheDocument();
    expect(screen.getByLabelText('重要程度 建立攻击链')).toHaveValue('high');
    expect(screen.getByRole('link', { name: 'evidence-1' })).toHaveAttribute(
      'href',
      '#evidence-evidence-1',
    );
    expect(screen.getByText('推断依据：inference-1')).toBeInTheDocument();
    expect(screen.getByText('原始材料未说明机动原因')).toBeInTheDocument();
  });

  it('submits a new revision after reordering events', () => {
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: '下移 建立攻击链' }));
    fireEvent.click(screen.getByRole('button', { name: '提交修改' }));

    expect(onRevise).toHaveBeenCalledWith({
      baseArtifactId: 'draft-1',
      eventUnits: [
        expect.objectContaining({ eventUnitId: 'eu-2' }),
        expect.objectContaining({ eventUnitId: 'eu-1' }),
      ],
    });
  });

  it('edits title, state change, and importance in the submitted local copy', () => {
    renderReview();
    const firstEvent = screen.getByRole('group', { name: '事件 建立攻击链' });

    fireEvent.change(within(firstEvent).getByLabelText('事件标题'), {
      target: { value: '进入拦截航线' },
    });
    fireEvent.change(within(firstEvent).getByLabelText('状态变化'), {
      target: { value: '编队完成目标识别' },
    });
    fireEvent.change(within(firstEvent).getByLabelText('重要程度 进入拦截航线'), {
      target: { value: 'low' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交修改' }));

    expect(onRevise).toHaveBeenCalledWith(
      expect.objectContaining({
        baseArtifactId: 'draft-1',
        eventUnits: [
          expect.objectContaining({
            eventUnitId: 'eu-1',
            title: '进入拦截航线',
            worldStateChange: '编队完成目标识别',
            importance: 'low',
          }),
          expect.objectContaining({ eventUnitId: 'eu-2' }),
        ],
      }),
    );
  });

  it('deletes an event from the submitted revision', () => {
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: '删除 目标机动' }));
    fireEvent.click(screen.getByRole('button', { name: '提交修改' }));

    expect(onRevise).toHaveBeenCalledWith({
      baseArtifactId: 'draft-1',
      eventUnits: [expect.objectContaining({ eventUnitId: 'eu-1' })],
    });
  });

  it('approves and rejects the exact active review tuple', () => {
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: '批准事件计划' }));
    fireEvent.click(screen.getByRole('button', { name: '拒绝事件计划' }));

    expect(onApprove).toHaveBeenCalledWith(review);
    expect(onReject).toHaveBeenCalledWith(review);
  });

  it('never mutates the hydrated artifact while editing', () => {
    const original = structuredClone(artifact);
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: '下移 建立攻击链' }));
    const movedEvent = screen.getByRole('group', { name: '事件 建立攻击链' });
    fireEvent.change(within(movedEvent).getByLabelText('事件标题'), {
      target: { value: '本地修改' },
    });
    fireEvent.click(screen.getByRole('button', { name: '删除 目标机动' }));

    expect(artifact).toEqual(original);
  });

  it('keeps local edits when the same artifact version is hydrated again', () => {
    const view = renderReview();
    const firstEvent = screen.getByRole('group', { name: '事件 建立攻击链' });
    fireEvent.change(within(firstEvent).getByLabelText('事件标题'), {
      target: { value: '尚未提交的本地修改' },
    });

    view.rerender(
      <EventPlanReview
        artifact={{ ...artifact, data: structuredClone(artifact.data) }}
        review={review}
        onApprove={onApprove}
        onRevise={onRevise}
        onReject={onReject}
      />,
    );

    expect(screen.getByDisplayValue('尚未提交的本地修改')).toBeInTheDocument();
  });

  it('does not allow deleting the last remaining event', () => {
    renderReview();
    fireEvent.click(screen.getByRole('button', { name: '删除 目标机动' }));

    expect(screen.getByRole('button', { name: '删除 建立攻击链' })).toBeDisabled();
  });
});
