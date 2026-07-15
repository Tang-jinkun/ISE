import { GuideLine, Rect } from './types';

export const getSnapLines = (
  rect: Rect,
  targets: Rect[],
  threshold: number = 5
): { x: number | null; y: number | null; guides: GuideLine[] } => {
  let snapX: number | null = null;
  let snapY: number | null = null;
  const guides: GuideLine[] = [];

  let minDistX = threshold + 1;
  let minDistY = threshold + 1;

  const { x, y, width: w, height: h } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const right = x + w;
  const bottom = y + h;

  targets.forEach((target) => {
    const tx = target.x;
    const ty = target.y;
    const tw = target.width;
    const th = target.height;
    const tcx = tx + tw / 2;
    const tcy = ty + th / 2;
    const tright = tx + tw;
    const tbottom = ty + th;

    // X-Axis Snapping (Vertical Lines)
    const xChecks = [
      { val: x, tVal: tx, type: 'start-start' },
      { val: x, tVal: tcx, type: 'start-center' },
      { val: x, tVal: tright, type: 'start-end' },
      { val: cx, tVal: tx, type: 'center-start' },
      { val: cx, tVal: tcx, type: 'center-center' },
      { val: cx, tVal: tright, type: 'center-end' },
      { val: right, tVal: tx, type: 'end-start' },
      { val: right, tVal: tcx, type: 'end-center' },
      { val: right, tVal: tright, type: 'end-end' }
    ];

    xChecks.forEach((check) => {
      const dist = Math.abs(check.val - check.tVal);
      if (dist < minDistX) {
        minDistX = dist;
        if (check.type.startsWith('start')) snapX = check.tVal;
        else if (check.type.startsWith('center')) snapX = check.tVal - w / 2;
        else if (check.type.startsWith('end')) snapX = check.tVal - w;

        guides.push({
          type: 'vertical',
          position: check.tVal,
          start: Math.min(y, ty),
          end: Math.max(bottom, tbottom)
        });
      } else if (dist === minDistX && dist <= threshold) {
        guides.push({
          type: 'vertical',
          position: check.tVal,
          start: Math.min(y, ty),
          end: Math.max(bottom, tbottom)
        });
      }
    });

    // Y-Axis Snapping (Horizontal Lines)
    const yChecks = [
      { val: y, tVal: ty, type: 'start-start' },
      { val: y, tVal: tcy, type: 'start-center' },
      { val: y, tVal: tbottom, type: 'start-end' },
      { val: cy, tVal: ty, type: 'center-start' },
      { val: cy, tVal: tcy, type: 'center-center' },
      { val: cy, tVal: tbottom, type: 'center-end' },
      { val: bottom, tVal: ty, type: 'end-start' },
      { val: bottom, tVal: tcy, type: 'end-center' },
      { val: bottom, tVal: tbottom, type: 'end-end' }
    ];

    yChecks.forEach((check) => {
      const dist = Math.abs(check.val - check.tVal);
      if (dist < minDistY) {
        minDistY = dist;
        if (check.type.startsWith('start')) snapY = check.tVal;
        else if (check.type.startsWith('center')) snapY = check.tVal - h / 2;
        else if (check.type.startsWith('end')) snapY = check.tVal - h;

        guides.push({
          type: 'horizontal',
          position: check.tVal,
          start: Math.min(x, tx),
          end: Math.max(right, tright)
        });
      } else if (dist === minDistY && dist <= threshold) {
        guides.push({
          type: 'horizontal',
          position: check.tVal,
          start: Math.min(x, tx),
          end: Math.max(right, tright)
        });
      }
    });
  });

  // Filter guides for best match
  const bestGuides = guides.filter((g) => {
    if (g.type === 'vertical') {
      if (snapX === null) return false;
      const newL = snapX;
      const newC = snapX + w / 2;
      const newR = snapX + w;
      return (
        Math.abs(g.position - newL) < 1 ||
        Math.abs(g.position - newC) < 1 ||
        Math.abs(g.position - newR) < 1
      );
    } else {
      if (snapY === null) return false;
      const newT = snapY;
      const newM = snapY + h / 2;
      const newB = snapY + h;
      return (
        Math.abs(g.position - newT) < 1 ||
        Math.abs(g.position - newM) < 1 ||
        Math.abs(g.position - newB) < 1
      );
    }
  });

  return { x: snapX, y: snapY, guides: bestGuides };
};

export const checkCollision = (rect: Rect, targets: Rect[]): Rect[] => {
  return targets.filter((target) => {
    if (rect.id && target.id === rect.id) return false;
    return (
      rect.x < target.x + target.width &&
      rect.x + rect.width > target.x &&
      rect.y < target.y + target.height &&
      rect.y + rect.height > target.y
    );
  });
};
