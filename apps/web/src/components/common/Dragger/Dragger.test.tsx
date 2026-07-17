import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dragger, type DragResult, type Rect, type ResizeResult } from '.';

describe('Dragger completion callbacks', () => {
  it('ends a drag with the latest moved geometry, collisions, and guides', () => {
    const collisionTarget: Rect = {
      id: 'target-lane',
      x: 35,
      y: 55,
      width: 100,
      height: 100
    };
    const snapTarget: Rect = {
      id: 'snap-target',
      x: 40,
      y: 60,
      width: 30,
      height: 20
    };
    const onDrag = vi.fn<(result: DragResult) => void>();
    const onDragEnd = vi.fn<(result: DragResult) => void>();

    render(
      <Dragger
        x={10}
        y={20}
        w={30}
        h={20}
        collisionDetection
        collisionTargets={[collisionTarget]}
        snapToObjects
        snapTargets={[snapTarget]}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
      >
        <div key="dragged-item" data-testid="dragged-item" />
      </Dragger>
    );

    fireEvent.mouseDown(screen.getByTestId('dragged-item'), {
      button: 0,
      clientX: 100,
      clientY: 200
    });
    fireEvent.mouseMove(document, { clientX: 129, clientY: 239 });

    expect(onDrag).toHaveBeenCalledOnce();
    const latestDrag = onDrag.mock.lastCall?.[0];
    expect(latestDrag).toEqual(
      expect.objectContaining({
        x: 40,
        y: 60,
        isColliding: true,
        collisions: [collisionTarget]
      })
    );
    expect(latestDrag?.activeGuides.length).toBeGreaterThan(0);

    fireEvent.mouseUp(document);

    expect(onDragEnd).toHaveBeenCalledWith(latestDrag);
    expect(onDragEnd.mock.lastCall?.[0].collisions.map(({ id }) => id)).toEqual([
      'target-lane'
    ]);
  });

  it('ends an east resize with the latest moved geometry', () => {
    const onResize = vi.fn<(result: ResizeResult) => void>();
    const onResizeEnd = vi.fn<(result: ResizeResult) => void>();
    const { container } = render(
      <Dragger
        x={10}
        y={20}
        w={30}
        h={20}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />
    );
    const eastHandle = container.querySelector('.cursor-e-resize');
    expect(eastHandle).not.toBeNull();

    fireEvent.mouseDown(eastHandle!, {
      button: 0,
      clientX: 100,
      clientY: 200
    });
    fireEvent.mouseMove(document, { clientX: 125, clientY: 200 });

    expect(onResize).toHaveBeenCalledOnce();
    const latestResize = onResize.mock.lastCall?.[0];
    expect(latestResize).toEqual(
      expect.objectContaining({ x: 10, y: 20, width: 55, height: 20 })
    );

    fireEvent.mouseUp(document);

    expect(onResizeEnd).toHaveBeenCalledWith(latestResize);
  });
});
