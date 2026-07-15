import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactExports } from '../artifactExports';
import { ArtifactExportControls } from './ArtifactExportControls';

const completedExports: Required<ArtifactExports> = {
  eventPlan: {
    schemaVersion: 'event-plan/v1',
    planId: 'plan-1'
  },
  runtimePlan: {
    schemaVersion: 'canonical-runtime-plan/v1',
    eventPlanArtifactId: 'accepted-1'
  },
  sceneProject: {
    schemaVersion: 'ise-scene/v1',
    sourceDocumentId: 'document-1',
    eventPlanArtifactId: 'accepted-1',
    runtimePlanArtifactId: 'compiled-1',
    totalDurationMs: 10_000,
    entities: [],
    tracks: [],
    diagnostics: []
  }
};

describe('ArtifactExportControls', () => {
  it('disables every export whose exact payload is unavailable', () => {
    render(<ArtifactExportControls exports={{}} download={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'EventPlan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'RuntimePlan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'SceneProject' })).toBeDisabled();
  });

  it('downloads each completed payload with its exact filename', () => {
    const download = vi.fn();
    render(
      <ArtifactExportControls
        exports={completedExports}
        download={download}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'EventPlan' }));
    fireEvent.click(screen.getByRole('button', { name: 'RuntimePlan' }));
    fireEvent.click(screen.getByRole('button', { name: 'SceneProject' }));

    expect(download.mock.calls).toEqual([
      ['event-plan.json', completedExports.eventPlan],
      ['canonical-runtime-plan.json', completedExports.runtimePlan],
      ['scene-project.json', completedExports.sceneProject]
    ]);
  });
});
