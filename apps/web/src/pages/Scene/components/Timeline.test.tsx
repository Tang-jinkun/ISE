import type { SceneTrack } from '@ise/runtime-contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveClipDragChange, Timeline } from './Timeline';

const tracks: SceneTrack[] = [
  {
    trackId: 'track:model',
    type: 'model',
    label: 'Canonical model track',
    visible: true,
    items: [
      {
        id: 'model-jf17-flight',
        eventUnitId: 'event-1',
        startMs: 12_000,
        durationMs: 8_000,
        evidenceRefs: ['evidence:1'],
        params: { action: 'model.spawn', entityId: 'jf17' },
      },
    ],
  },
];

const entityTracks: SceneTrack[] = [
  {
    trackId: 'track:model:entity:jf17-1',
    type: 'model',
    label: 'JF-17 1',
    visible: true,
    items: [{
      id: 'model-jf17-flight', eventUnitId: 'event-1', startMs: 12_000, durationMs: 8_000,
      evidenceRefs: ['evidence:1'], params: { action: 'model.spawn', entityId: 'entity:jf17-1' },
    }],
  },
  {
    trackId: 'track:model:entity:f16-1',
    type: 'model',
    label: 'F-16 1',
    visible: true,
    items: [{
      id: 'model-f16-flight', eventUnitId: 'event-1', startMs: 12_000, durationMs: 8_000,
      evidenceRefs: ['evidence:1'], params: { action: 'model.spawn', entityId: 'entity:f16-1' },
    }],
  },
];

describe('Timeline', () => {
  it('renders a generic legacy model track', () => {
    render(<Timeline tracks={tracks} />);

    expect(screen.getByText('Canonical model track')).toBeVisible();
    expect(screen.getByText('model-jf17-flight')).toBeVisible();
  });

  it('renders simultaneous model entity tracks as distinct rows and clips', () => {
    render(<Timeline tracks={entityTracks} />);

    expect(screen.getByText('JF-17 1')).toBeVisible();
    expect(screen.getByText('F-16 1')).toBeVisible();
    expect(screen.getByText('model-jf17-flight')).toBeVisible();
    expect(screen.getByText('model-f16-flight')).toBeVisible();
  });

  it('keeps a model clip on its entity track after colliding with another entity track', () => {
    const sourceTrack = entityTracks[0]!;
    const sourceItem = sourceTrack.items[0]!;

    expect(resolveClipDragChange(sourceTrack, sourceItem, entityTracks[1], 17_500, 8_000)).toEqual({
      startMs: 17_500,
      durationMs: 8_000,
      targetTrackId: sourceTrack.trackId,
    });
    expect(resolveClipDragChange(sourceTrack, sourceItem, sourceTrack, 17_500, 8_000)).toEqual({
      startMs: 17_500,
      durationMs: 8_000,
      targetTrackId: sourceTrack.trackId,
    });
  });
});
