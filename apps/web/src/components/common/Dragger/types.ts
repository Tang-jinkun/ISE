export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Position, Size {
  id?: string;
  type?: string; // For track type checking
}

export interface GuideLine {
  type: 'horizontal' | 'vertical';
  position: number; // x or y value
  start: number;
  end: number; // length of the line to draw
}

export interface DragResult {
  x: number;
  y: number;
  isColliding: boolean;
  collisions: Rect[]; // Objects we are colliding with
  activeGuides: GuideLine[];
}

export interface ResizeResult extends DragResult {
  width: number;
  height: number;
}

export type ResizeHandleType =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';

export interface DraggerProps {
  // Controlled state
  x: number;
  y: number;
  w: number;
  h: number;

  // Constraints
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  parentBounds?: boolean; // Restrict to parent container
  axis?: 'x' | 'y' | 'both';

  // Functionality toggles
  draggable?: boolean;
  resizable?: boolean;
  rotatable?: boolean; // Reserved

  // Snapping & Guides
  snapToGrid?: boolean;
  gridSize?: number; // default 10
  snapToObjects?: boolean;
  snapThreshold?: number; // default 5
  snapTargets?: Rect[]; // Other objects to snap to

  // Collision
  collisionDetection?: boolean;
  collisionTargets?: Rect[]; // Objects to check collision against

  // Track/Zone logic (Optional custom validation)
  // Can be used for "same type track" logic
  isValidMove?: (x: number, y: number) => boolean;

  // Events
  onDragStart?: () => void;
  onDrag?: (result: DragResult) => void;
  onDragEnd?: (result: DragResult) => void;

  onResizeStart?: () => void;
  onResize?: (result: ResizeResult) => void;
  onResizeEnd?: (result: ResizeResult) => void;

  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;

  // UI
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;

  // Render props or custom components
  handleComponent?: React.ReactNode; // Custom resize handle

  // Selected state (for showing handles/border)
  selected?: boolean;
}
