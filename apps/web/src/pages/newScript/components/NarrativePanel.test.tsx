import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NarrativePanel } from './NarrativePanel';

vi.mock('@/stores/warDataStore', () => ({
  useWarDataStore: () => ({
    currentData: {
      war_name: 'Test War',
      target_duration: 1000,
      outline: [
        {
          id: 'o1',
          title: 'Opening stage',
          time: { start: 0, finish: 1000 },
          descriptions: []
        }
      ]
    }
  })
}));

vi.mock('./DataImportButton', () => ({
  DataImportButton: () => null
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    Grid: () => <span data-testid="grid-layout-icon" />
  };
});

describe('NarrativePanel', () => {
  it('does not add an inline cyan theme color to the initial grid layout', () => {
    const { container } = render(
      <NarrativePanel
        selectedNode={{ id: 'n-root', title: 'Narrative', summary: '' }}
        nowText={() => ''}
        onCopy={vi.fn()}
      />
    );

    const gridButton = container
      .querySelector('[data-testid="grid-layout-icon"]')
      ?.closest('button');
    expect(gridButton).not.toBeNull();
    fireEvent.click(gridButton!);

    const hasInlineCyan = Array.from(container.querySelectorAll('[style]')).some(
      (element) => {
        const style = element.getAttribute('style') ?? '';
        return style.includes('#06b6d4') || style.includes('rgb(6, 182, 212)');
      }
    );

    expect(hasInlineCyan).toBe(false);
  });
});
