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

  it('uses rerendered drag behavior and callbacks throughout an active gesture', () => {
    const snapTarget: Rect = {
      id: 'latest-snap-target',
      x: 40,
      y: 20,
      width: 30,
      height: 20
    };
    const collisionTarget: Rect = {
      id: 'latest-collision-target',
      x: 35,
      y: 15,
      width: 100,
      height: 100
    };
    const initialValidation = vi.fn(() => true);
    const latestValidation = vi.fn(() => true);
    const initialOnDrag = vi.fn<(result: DragResult) => void>();
    const latestOnDrag = vi.fn<(result: DragResult) => void>();
    const initialOnDragEnd = vi.fn<(result: DragResult) => void>();
    const intermediateOnDragEnd = vi.fn<(result: DragResult) => void>();
    const latestOnDragEnd = vi.fn<(result: DragResult) => void>();
    const child = <div key="rerendered-drag" data-testid="rerendered-drag" />;
    const { rerender } = render(
      <Dragger
        x={10}
        y={20}
        w={30}
        h={20}
        isValidMove={initialValidation}
        onDrag={initialOnDrag}
        onDragEnd={initialOnDragEnd}
      >
        {child}
      </Dragger>
    );

    fireEvent.mouseDown(screen.getByTestId('rerendered-drag'), {
      button: 0,
      clientX: 100,
      clientY: 200
    });
    rerender(
      <Dragger
        x={10}
        y={20}
        w={30}
        h={20}
        axis="x"
        snapToObjects
        snapTargets={[snapTarget]}
        collisionDetection
        collisionTargets={[collisionTarget]}
        isValidMove={latestValidation}
        onDrag={latestOnDrag}
        onDragEnd={intermediateOnDragEnd}
      >
        {child}
      </Dragger>
    );

    fireEvent.mouseMove(document, { clientX: 129, clientY: 239 });

    expect(initialValidation).not.toHaveBeenCalled();
    expect(latestValidation).toHaveBeenCalledWith(40, 20);
    expect(initialOnDrag).not.toHaveBeenCalled();
    expect(latestOnDrag).toHaveBeenCalledOnce();
    const latestDrag = latestOnDrag.mock.lastCall?.[0];
    expect(latestDrag).toEqual(
      expect.objectContaining({
        x: 40,
        y: 20,
        isColliding: true,
        collisions: [collisionTarget]
      })
    );
    expect(latestDrag?.activeGuides.length).toBeGreaterThan(0);

    rerender(
      <Dragger
        x={10}
        y={20}
        w={30}
        h={20}
        axis="x"
        snapToObjects
        snapTargets={[snapTarget]}
        collisionDetection
        collisionTargets={[collisionTarget]}
        isValidMove={latestValidation}
        onDrag={latestOnDrag}
        onDragEnd={latestOnDragEnd}
      >
        {child}
      </Dragger>
    );
    fireEvent.mouseUp(document);

    expect(initialOnDragEnd).not.toHaveBeenCalled();
    expect(intermediateOnDragEnd).not.toHaveBeenCalled();
    expect(latestOnDragEnd).toHaveBeenCalledWith(latestDrag);
  });

  it('uses rerendered resize constraints and callbacks throughout an active gesture', () => {
    const initialOnResize = vi.fn<(result: ResizeResult) => void>();
    const latestOnResize = vi.fn<(result: ResizeResult) => void>();
    const initialOnResizeEnd = vi.fn<(result: ResizeResult) => void>();
    const intermediateOnResizeEnd = vi.fn<(result: ResizeResult) => void>();
    const latestOnResizeEnd = vi.fn<(result: ResizeResult) => void>();
    const { container, rerender } = render(
      <Dragger
        x={10}
        y={20}
        w={30}
        h={20}
        maxW={100}
        onResize={initialOnResize}
        onResizeEnd={initialOnResizeEnd}
      />
    );
    const eastHandle = container.querySelector('.cursor-e-resize');
    expect(eastHandle).not.toBeNull();

    fireEvent.mouseDown(eastHandle!, {
      button: 0,
      clientX: 100,
      clientY: 200
    });
    rerender(
      <Dragger
        x={10}
        y={20}
        w={30}
        h={20}
        maxW={40}
        onResize={latestOnResize}
        onResizeEnd={intermediateOnResizeEnd}
      />
    );
    fireEvent.mouseMove(document, { clientX: 125, clientY: 200 });

    expect(initialOnResize).not.toHaveBeenCalled();
    expect(latestOnResize).toHaveBeenCalledOnce();
    const latestResize = latestOnResize.mock.lastCall?.[0];
    expect(latestResize).toEqual(
      expect.objectContaining({ x: 10, y: 20, width: 40, height: 20 })
    );

    rerender(
      <Dragger
        x={10}
        y={20}
        w={30}
        h={20}
        maxW={40}
        onResize={latestOnResize}
        onResizeEnd={latestOnResizeEnd}
      />
    );
    fireEvent.mouseUp(document);

    expect(initialOnResizeEnd).not.toHaveBeenCalled();
    expect(intermediateOnResizeEnd).not.toHaveBeenCalled();
    expect(latestOnResizeEnd).toHaveBeenCalledWith(latestResize);
  });
});
