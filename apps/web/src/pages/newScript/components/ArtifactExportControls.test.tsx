import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from '@/components/ui/message';
import type { ArtifactExports } from '../artifactExports';
import { ArtifactExportControls } from './ArtifactExportControls';

vi.mock('@/components/ui/message', () => ({
  message: {
    error: vi.fn()
  }
}));

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
  beforeEach(() => {
    vi.mocked(message.error).mockClear();
  });

  it('renders wide commands and the compact export menu at the lg breakpoint', () => {
    render(
      <ArtifactExportControls
        exports={completedExports}
        download={vi.fn()}
      />
    );

    const wideCommands = screen.getByTestId('artifact-export-wide');
    expect(wideCommands).toHaveClass('hidden', 'lg:flex');
    expect(
      within(wideCommands).getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['EventPlan', 'RuntimePlan', 'SceneProject']);

    const compactCommands = screen.getByTestId('artifact-export-compact');
    expect(compactCommands).toHaveClass('lg:hidden');
    const trigger = within(compactCommands).getByRole('button', {
      name: 'Export artifacts'
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual(['EventPlan', 'RuntimePlan', 'SceneProject']);
  });

  it('disables every wide and compact export whose exact payload is unavailable', () => {
    render(<ArtifactExportControls exports={{}} download={vi.fn()} />);

    const wideCommands = screen.getByTestId('artifact-export-wide');
    expect(within(wideCommands).getByRole('button', { name: 'EventPlan' })).toBeDisabled();
    expect(within(wideCommands).getByRole('button', { name: 'RuntimePlan' })).toBeDisabled();
    expect(within(wideCommands).getByRole('button', { name: 'SceneProject' })).toBeDisabled();

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Export artifacts' }),
      { button: 0, ctrlKey: false }
    );
    for (const command of screen.getAllByRole('menuitem')) {
      expect(command).toHaveAttribute('data-disabled');
    }
  });

  it('downloads each wide command with its exact filename', () => {
    const download = vi.fn();
    render(
      <ArtifactExportControls
        exports={completedExports}
        download={download}
      />
    );

    const wideCommands = screen.getByTestId('artifact-export-wide');
    fireEvent.click(within(wideCommands).getByRole('button', { name: 'EventPlan' }));
    fireEvent.click(within(wideCommands).getByRole('button', { name: 'RuntimePlan' }));
    fireEvent.click(within(wideCommands).getByRole('button', { name: 'SceneProject' }));

    expect(download.mock.calls).toEqual([
      ['event-plan.json', completedExports.eventPlan],
      ['canonical-runtime-plan.json', completedExports.runtimePlan],
      ['scene-project.json', completedExports.sceneProject]
    ]);
  });

  it('downloads each compact menu command with its exact filename', () => {
    const download = vi.fn();
    render(
      <ArtifactExportControls
        exports={completedExports}
        download={download}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Export artifacts' });
    for (const name of ['EventPlan', 'RuntimePlan', 'SceneProject']) {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(screen.getByRole('menuitem', { name }));
    }

    expect(download.mock.calls).toEqual([
      ['event-plan.json', completedExports.eventPlan],
      ['canonical-runtime-plan.json', completedExports.runtimePlan],
      ['scene-project.json', completedExports.sceneProject]
    ]);
  });

  it('reports a generic message when wide or compact downloads fail', () => {
    const download = vi.fn(() => {
      throw new Error('internal artifact storage path');
    });
    render(
      <ArtifactExportControls
        exports={completedExports}
        download={download}
      />
    );
    const preventUnhandledError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', preventUnhandledError);

    try {
      fireEvent.click(
        within(screen.getByTestId('artifact-export-wide')).getByRole('button', {
          name: 'EventPlan'
        })
      );
      const trigger = screen.getByRole('button', { name: 'Export artifacts' });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(screen.getByRole('menuitem', { name: 'RuntimePlan' }));
    } finally {
      window.removeEventListener('error', preventUnhandledError);
    }

    expect(message.error).toHaveBeenCalledTimes(2);
    expect(vi.mocked(message.error).mock.calls).toEqual([
      ['下载失败，请稍后重试'],
      ['下载失败，请稍后重试']
    ]);
  });
});
