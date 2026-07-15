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
    Columns: () => <span data-testid="waterfall-layout-icon" />,
    Grid: () => <span data-testid="grid-layout-icon" />,
    Layers: () => <span data-testid="carousel-layout-icon" />
  };
});

describe('NarrativePanel', () => {
  const renderPanel = () =>
    render(
      <NarrativePanel
        selectedNode={{ id: 'n-root', title: 'Narrative', summary: '' }}
        nowText={() => ''}
        onCopy={vi.fn()}
      />
    );

  const switchLayout = (container: HTMLElement, testId: string) => {
    const button = container
      .querySelector(`[data-testid="${testId}"]`)
      ?.closest('button');
    expect(button).not.toBeNull();
    fireEvent.click(button!);
  };

  const expectNoCyanAccent = (container: HTMLElement) => {
    expect(container.innerHTML).not.toContain('cyan');

    const hasInlineCyan = Array.from(container.querySelectorAll('[style]')).some(
      (element) => {
        const style = element.getAttribute('style') ?? '';
        return style.includes('#06b6d4') || style.includes('rgb(6, 182, 212)');
      }
    );

    expect(hasInlineCyan).toBe(false);
  };

  it('uses semantic primary accents in the grid layout', () => {
    const { container } = renderPanel();
    switchLayout(container, 'grid-layout-icon');

    const stageLabel = Array.from(container.querySelectorAll('div')).find(
      (element) => element.textContent === 'Stage 1'
    );
    const card = stageLabel?.closest('.group');

    expect(stageLabel).toHaveClass('text-primary');
    expect(card).toHaveClass('border-primary', 'hover:border-primary/30');
    expectNoCyanAccent(container);
  });

  it('keeps waterfall progress visible with a semantic primary accent', () => {
    const { container } = renderPanel();
    switchLayout(container, 'waterfall-layout-icon');

    const progress = Array.from(container.querySelectorAll('[style]')).find(
      (element) => element.getAttribute('style')?.includes('width: 20%')
    );
    const card = progress?.closest('.break-inside-avoid');

    expect(progress).toHaveClass('bg-primary');
    expect(card).toHaveClass('hover:border-primary/30');
    expectNoCyanAccent(container);
  });

  it('uses semantic primary accents in the carousel layout', () => {
    const { container } = renderPanel();
    switchLayout(container, 'carousel-layout-icon');

    const title = Array.from(container.querySelectorAll('.text-2xl')).find(
      (element) => element.textContent === 'Opening stage'
    );
    const card = title?.closest('.absolute');

    expect(title).toHaveClass('text-primary');
    expect(card).toHaveClass('border-primary');
    expectNoCyanAccent(container);
  });
});
