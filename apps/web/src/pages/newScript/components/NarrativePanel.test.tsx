import type { AgentArtifactView } from '@/api/agent';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NarrativePanel } from './NarrativePanel';

const eventPlan: AgentArtifactView = {
  artifactId: 'event-plan-1',
  type: 'ise.event-plan-draft/v1',
  version: 1,
  createdAt: '2026-07-15T00:00:00.000Z',
  createdBy: 'agent',
  superseded: false,
  data: {
    eventUnits: [
      {
        eventUnitId: 'event-1',
        title: '兵力展开',
        worldStateChange: '常态警戒转为空中兵力展开',
        participants: ['苏-30MKI', 'JF-17'],
        locationRefs: ['阿达姆普尔', '米纳斯'],
        evidenceRefs: ['evidence-1', 'evidence-2'],
        inferenceRefs: [],
        uncertainties: [],
        narrativePurpose: '建立双方初始态势',
        importance: 'high'
      },
      {
        eventUnitId: 'event-2',
        title: '空中对峙',
        worldStateChange: '双方编队接近',
        participants: ['苏-30MKI', 'JF-17'],
        locationRefs: ['边境空域'],
        evidenceRefs: ['evidence-3'],
        inferenceRefs: [],
        uncertainties: [],
        narrativePurpose: '建立交战压力',
        importance: 'medium'
      }
    ]
  }
};

const narration: AgentArtifactView = {
  artifactId: 'narration-1',
  type: 'ise.narrative-plan/v1',
  version: 1,
  createdAt: '2026-07-15T00:00:01.000Z',
  createdBy: 'agent',
  superseded: false,
  data: {
    targetDurationMs: 180_000,
    subtitles: [
      {
        subtitleId: 'subtitle-1',
        eventUnitId: 'event-1',
        text: '双方空中兵力从各自基地出动展开',
        importance: 'high',
        evidenceRefs: ['evidence-1']
      }
    ]
  }
};

describe('NarrativePanel', () => {
  it('shows real EventPlan units in source order without decorative layouts', () => {
    render(
      <NarrativePanel
        selectedNode={{ id: 'n-root', title: '印巴空中对抗', summary: '' }}
        nowText={() => ''}
        onCopy={vi.fn()}
        eventPlan={eventPlan}
      />
    );

    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      '兵力展开',
      '空中对峙'
    ]);
    expect(screen.getByText('建立双方初始态势')).toBeInTheDocument();
    expect(screen.getByText('2 条证据')).toBeInTheDocument();
    expect(screen.queryByText('Stage 1')).not.toBeInTheDocument();
  });

  it('shows the authoritative subtitle script when narration exists', () => {
    render(
      <NarrativePanel
        selectedNode={{ id: 'n-root', title: '印巴空中对抗', summary: '' }}
        nowText={() => ''}
        onCopy={vi.fn()}
        eventPlan={eventPlan}
        narrativePlan={narration}
      />
    );

    expect(
      screen.getByText('双方空中兵力从各自基地出动展开')
    ).toBeInTheDocument();
    expect(screen.getByText('高重要度')).toBeInTheDocument();
    expect(screen.getByText('目标时长 180 秒')).toBeInTheDocument();
  });

  it('renders NarrationPlan beats instead of requiring legacy subtitles', () => {
    const narrationPlan: AgentArtifactView = {
      ...narration,
      type: 'ise.narration-plan/v1',
      data: {
        targetDurationMs: 45_000,
        beats: [
          {
            subtitleId: 'subtitle-2',
            eventUnitId: 'event-2',
            text: '编队进入对峙空域并建立态势感知',
            evidenceRefs: ['evidence-3'],
            beatRole: 'action',
            attentionTarget: 'JF-17 编队',
            importance: 'medium',
            estimatedDurationMs: 6_000
          }
        ]
      }
    };

    render(
      <NarrativePanel
        selectedNode={{ id: 'n-root', title: '印巴空中对抗', summary: '' }}
        nowText={() => ''}
        onCopy={vi.fn()}
        eventPlan={eventPlan}
        narrativePlan={narrationPlan}
      />
    );

    expect(
      screen.getByText('编队进入对峙空域并建立态势感知')
    ).toBeInTheDocument();
    expect(screen.getByText('JF-17 编队')).toBeInTheDocument();
    expect(screen.getByText('动作')).toBeInTheDocument();
  });

  it('keeps copy as a compact command', () => {
    const onCopy = vi.fn();
    render(
      <NarrativePanel
        selectedNode={{ id: 'n-root', title: '印巴空中对抗', summary: '' }}
        nowText={() => ''}
        onCopy={onCopy}
        eventPlan={eventPlan}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '复制产物摘要' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
