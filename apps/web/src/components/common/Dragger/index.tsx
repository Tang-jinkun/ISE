import { cn } from '@/lib/utils';
import React, { useEffect, useRef, useState } from 'react';
import {
  type DragResult,
  type DraggerProps,
  type GuideLine,
  type ResizeResult,
  type ResizeHandleType
} from './types';
import { checkCollision, getSnapLines } from './utils';

export * from './types';

export const Dragger: React.FC<DraggerProps> = ({
  x,
  y,
  w,
  h,
  minW = 10,
  maxW = Infinity,
  minH = 10,
  maxH = Infinity,
  parentBounds = false,
  axis = 'both',
  draggable = true,
  resizable = true,
  rotatable = false,
  snapToGrid = false,
  gridSize = 10,
  snapToObjects = false,
  snapThreshold = 5,
  snapTargets = [],
  collisionDetection = false,
  collisionTargets = [],
  isValidMove,
  onDragStart,
  onDrag,
  onDragEnd,
  onResizeStart,
  onResize,
  onResizeEnd,
  onClick,
  onContextMenu,
  className,
  style,
  children,
  handleComponent,
  selected = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [activeGuides, setActiveGuides] = useState<GuideLine[]>([]);
  const [isColliding, setIsColliding] = useState(false);

  // Internal state for drag/resize deltas
  const startPos = useRef({ x: 0, y: 0 });
  const startRect = useRef({ x, y, w, h });
  const latestDragResult = useRef<DragResult | null>(null);
  const latestResizeResult = useRef<ResizeResult | null>(null);
  const resizeHandle = useRef<ResizeHandleType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [currentRect, setCurrentRect] = useState({ x, y, w, h });

  // Sync props to internal state when not interacting
  useEffect(() => {
    if (!isDragging && !isResizing) {
      setCurrentRect({ x, y, w, h });
    }
  }, [x, y, w, h, isDragging, isResizing]);

  // Helper to get parent bounds
  const getBounds = () => {
    if (!parentBounds || !containerRef.current?.parentElement) return null;
    const parent = containerRef.current.parentElement;
    return {
      width: parent.clientWidth,
      height: parent.clientHeight
    };
  };

  // Drag Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!draggable || e.button !== 0) return;
    // If clicked on resize handle, ignore (handled by handle's onMouseDown)
    if ((e.target as HTMLElement).closest('.dragger-handle')) return;

    e.stopPropagation();
    e.preventDefault();

    startPos.current = { x: e.clientX, y: e.clientY };
    startRect.current = { x, y, w, h };
    latestDragResult.current = {
      x,
      y,
      isColliding: false,
      collisions: [],
      activeGuides: []
    };

    setIsDragging(true);
    onDragStart?.();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;

    const deltaX = e.clientX - startPos.current.x;
    const deltaY = e.clientY - startPos.current.y;

    let newX = startRect.current.x + (axis === 'y' ? 0 : deltaX);
    let newY = startRect.current.y + (axis === 'x' ? 0 : deltaY);

    // Apply Grid Snapping
    if (snapToGrid) {
      newX = Math.round(newX / gridSize) * gridSize;
      newY = Math.round(newY / gridSize) * gridSize;
    }

    let guides: GuideLine[] = [];

    // Apply Object Snapping
    if (snapToObjects && snapTargets.length > 0) {
      const snapResult = getSnapLines(
        { x: newX, y: newY, width: w, height: h },
        snapTargets,
        snapThreshold
      );

      if (snapResult.x !== null && axis !== 'y') newX = snapResult.x;
      if (snapResult.y !== null && axis !== 'x') newY = snapResult.y;
      guides = snapResult.guides;
    }

    // Apply Bounds
    if (parentBounds) {
      const bounds = getBounds();
      if (bounds) {
        newX = Math.max(0, Math.min(newX, bounds.width - w));
        newY = Math.max(0, Math.min(newY, bounds.height - h));
      }
    }

    // Collision Detection
    const collisions = collisionDetection
      ? checkCollision(
          { x: newX, y: newY, width: w, height: h, id: (children as any)?.key },
          collisionTargets
        )
      : [];

    const colliding = collisions.length > 0;
    setIsColliding(colliding);
    setActiveGuides(guides);

    // Update internal state for smooth rendering
    setCurrentRect((prev) => ({ ...prev, x: newX, y: newY }));

    // Custom Validation
    if (isValidMove && !isValidMove(newX, newY)) {
      return;
    }

    const result = {
      x: newX,
      y: newY,
      isColliding: colliding,
      collisions,
      activeGuides: guides
    };
    latestDragResult.current = result;
    onDrag?.(result);
  };

  const handleMouseUp = () => {
    if (!isDragging) return;

    setIsDragging(false);
    setActiveGuides([]);
    setIsColliding(false);

    onDragEnd?.(latestDragResult.current!);
    latestDragResult.current = null;
  };

  // Resize Handlers
  const handleResizeStart = (
    e: React.MouseEvent,
    direction: ResizeHandleType
  ) => {
    if (!resizable || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    startPos.current = { x: e.clientX, y: e.clientY };
    startRect.current = { x, y, w, h };
    latestResizeResult.current = {
      x,
      y,
      width: w,
      height: h,
      isColliding: false,
      collisions: [],
      activeGuides: []
    };
    resizeHandle.current = direction;

    setIsResizing(true);
    onResizeStart?.();
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!isResizing || !resizeHandle.current) return;

    const deltaX = e.clientX - startPos.current.x;
    const deltaY = e.clientY - startPos.current.y;
    const direction = resizeHandle.current;

    let newX = startRect.current.x;
    let newY = startRect.current.y;
    let newW = startRect.current.w;
    let newH = startRect.current.h;

    // Calculate new dimensions based on direction
    if (direction.includes('e')) newW = startRect.current.w + deltaX;
    if (direction.includes('w')) {
      newW = startRect.current.w - deltaX;
      newX = startRect.current.x + deltaX;
    }
    if (direction.includes('s')) newH = startRect.current.h + deltaY;
    if (direction.includes('n')) {
      newH = startRect.current.h - deltaY;
      newY = startRect.current.y + deltaY;
    }

    // Constraints
    if (newW < minW) {
      if (direction.includes('w')) newX -= minW - newW; // Adjust X if hitting min width from left
      newW = minW;
    }
    if (newW > maxW) newW = maxW;

    if (newH < minH) {
      if (direction.includes('n')) newY -= minH - newH;
      newH = minH;
    }
    if (newH > maxH) newH = maxH;

    // Grid Snapping (Simple version for resize)
    if (snapToGrid) {
      if (direction.includes('e') || direction.includes('w'))
        newW = Math.round(newW / gridSize) * gridSize;
      if (direction.includes('s') || direction.includes('n'))
        newH = Math.round(newH / gridSize) * gridSize;
    }

    // Object Snapping (Optional for resize - usually just edges)
    let guides: GuideLine[] = [];
    if (snapToObjects && snapTargets.length > 0) {
      // Implement complex resize snapping if needed. For now, skip to keep simple.
      // Or reuse getSnapLines but only for the moving edge?
    }

    // Update internal state
    setCurrentRect({ x: newX, y: newY, w: newW, h: newH });

    const result = {
      x: newX,
      y: newY,
      width: newW,
      height: newH,
      isColliding: false,
      collisions: [],
      activeGuides: guides
    };
    latestResizeResult.current = result;
    onResize?.(result);
  };

  const handleResizeUp = () => {
    setIsResizing(false);
    resizeHandle.current = null;
    onResizeEnd?.(latestResizeResult.current!);
    latestResizeResult.current = null;
  };

  const dragHandlers = useRef({
    move: handleMouseMove,
    up: handleMouseUp
  });
  dragHandlers.current = {
    move: handleMouseMove,
    up: handleMouseUp
  };

  const resizeHandlers = useRef({
    move: handleResizeMove,
    up: handleResizeUp
  });
  resizeHandlers.current = {
    move: handleResizeMove,
    up: handleResizeUp
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (event: MouseEvent) => dragHandlers.current.move(event);
    const handleUp = () => dragHandlers.current.up();
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (event: MouseEvent) => resizeHandlers.current.move(event);
    const handleUp = () => resizeHandlers.current.up();
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isResizing]);

  // Render Handles
  const renderHandle = (dir: ResizeHandleType) => (
    <div
      key={dir}
      className={cn(
        'dragger-handle absolute w-2 h-2 bg-background border border-cyan-500 z-20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity',
        // Position logic
        dir === 'n' &&
          'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-n-resize',
        dir === 's' &&
          'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-s-resize',
        dir === 'e' &&
          'right-0 top-1/2 -translate-y-1/2 translate-x-1/2 cursor-e-resize',
        dir === 'w' &&
          'left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-w-resize',
        dir === 'ne' &&
          'top-0 right-0 -translate-y-1/2 translate-x-1/2 cursor-ne-resize',
        dir === 'nw' &&
          'top-0 left-0 -translate-y-1/2 -translate-x-1/2 cursor-nw-resize',
        dir === 'se' &&
          'bottom-0 right-0 translate-y-1/2 translate-x-1/2 cursor-se-resize',
        dir === 'sw' &&
          'bottom-0 left-0 translate-y-1/2 -translate-x-1/2 cursor-sw-resize',
        selected && 'opacity-100'
      )}
      onMouseDown={(e) => handleResizeStart(e, dir)}
    />
  );

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          'absolute group touch-none select-none',
          draggable && 'cursor-move',
          isColliding && 'ring-2 ring-red-500 bg-red-500/10',
          isDragging ? 'z-[100]' : selected ? 'z-10' : '',
          className
        )}
        style={{
          transform: `translate(${currentRect.x}px, ${currentRect.y}px)`,
          width: currentRect.w,
          height: currentRect.h,
          ...style
        }}
        onMouseDown={handleMouseDown}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {children}

        {/* Selection/Hover Border */}
        {(selected || isResizing) && (
          <div className="absolute inset-0 border border-cyan-500 pointer-events-none" />
        )}

        {/* Resize Handles */}
        {resizable &&
          (selected || isResizing || !selected) && ( // Show on hover (group) or selected
            <>
              {/* Only standard 4 corners + 4 edges? */}
              {['n', 's', 'e', 'w'].map((dir) =>
                renderHandle(dir as ResizeHandleType)
              )}
              {/* Use standard cursor styles */}
            </>
          )}
      </div>

      {/* Guide Lines - Rendered as siblings in the same coordinate space (assuming parent is relative) */}
      {activeGuides.map((guide, i) => (
        <div
          key={i}
          className="absolute bg-cyan-500 z-50 pointer-events-none"
          style={{
            left: guide.type === 'vertical' ? guide.position : guide.start,
            top: guide.type === 'horizontal' ? guide.position : guide.start,
            width: guide.type === 'vertical' ? 1 : guide.end - guide.start,
            height: guide.type === 'horizontal' ? 1 : guide.end - guide.start
          }}
        />
      ))}
    </>
  );
};
