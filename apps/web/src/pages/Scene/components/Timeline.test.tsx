import type { SceneTrack } from '@ise/runtime-contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Timeline } from './Timeline';

const tracks: SceneTrack[] = [
  {
    trackId: 'track-model',
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

describe('Timeline', () => {
  it('renders the supplied canonical tracks', () => {
    render(<Timeline tracks={tracks} />);

    expect(screen.getByText('Canonical model track')).toBeVisible();
    expect(screen.getByText('model-jf17-flight')).toBeVisible();
  });
});
