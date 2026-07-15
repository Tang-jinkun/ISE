import { useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  CheckCircle2,
  Info,
  TriangleAlert,
  X,
  XCircle
} from 'lucide-react';
import { cn } from '../../lib/utils';

type NotificationType = 'info' | 'success' | 'warning' | 'error';

type NotificationItem = {
  id: string;
  type: NotificationType;
  title: React.ReactNode;
  description?: React.ReactNode;
  duration: number;
};

const store = {
  items: [] as NotificationItem[],
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
  getSnapshot() {
    return store.items;
  },
  emit() {
    for (const listener of store.listeners) listener();
  }
};

const timers = new Map<string, number>();

function uid(prefix = 'ntf') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function remove(id: string) {
  const t = timers.get(id);
  if (t) window.clearTimeout(t);
  timers.delete(id);
  store.items = store.items.filter((n) => n.id !== id);
  store.emit();
}

function add(item: Omit<NotificationItem, 'id'>) {
  if (typeof document === 'undefined') return () => {};
  ensureMounted();

  const id = uid();
  store.items = [{ ...item, id }, ...store.items].slice(0, 6);
  store.emit();

  if (item.duration > 0) {
    const t = window.setTimeout(() => remove(id), item.duration);
    timers.set(id, t);
  }

  return () => remove(id);
}

function iconFor(type: NotificationType) {
  if (type === 'success') return <CheckCircle2 className="w-5 h-5 text-green-300" />;
  if (type === 'warning') return <TriangleAlert className="w-5 h-5 text-yellow-300" />;
  if (type === 'error') return <XCircle className="w-5 h-5 text-red-300" />;
  return <Info className="w-5 h-5 text-cyan-300" />;
}

function ringFor(type: NotificationType) {
  if (type === 'success') return 'ring-green-500/15';
  if (type === 'warning') return 'ring-yellow-500/15';
  if (type === 'error') return 'ring-red-500/15';
  return 'ring-cyan-500/15';
}

function NotificationHost() {
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (items.length === 0) return null;

  return (
    <div className="fixed top-5 right-5 z-[9999] pointer-events-none">
      <div className="flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col gap-3">
        {items.map((n) => (
          <div
            key={n.id}
            className={cn(
              'pointer-events-auto rounded-2xl border border-border bg-popover/90 p-4 shadow-2xl backdrop-blur-md ring-1',
              ringFor(n.type),
              'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-right-2'
            )}
            data-state="open"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">{iconFor(n.type)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground leading-snug">
                    {n.title}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {n.description && (
                  <div className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    {n.description}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

let root: Root | null = null;

function ensureMounted() {
  if (root) return;
  const id = 'ui-notification-root';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  root = createRoot(el);
  root.render(<NotificationHost />);
}

type NotificationOptions = {
  duration?: number;
};

export const notification = {
  open(
    payload: {
      type?: NotificationType;
      title: React.ReactNode;
      description?: React.ReactNode;
    } & NotificationOptions
  ) {
    return add({
      type: payload.type ?? 'info',
      title: payload.title,
      description: payload.description,
      duration: payload.duration ?? 4500
    });
  },
  success(
    payload: { title: React.ReactNode; description?: React.ReactNode } & NotificationOptions
  ) {
    return add({
      type: 'success',
      title: payload.title,
      description: payload.description,
      duration: payload.duration ?? 4500
    });
  },
  info(payload: { title: React.ReactNode; description?: React.ReactNode } & NotificationOptions) {
    return add({
      type: 'info',
      title: payload.title,
      description: payload.description,
      duration: payload.duration ?? 4500
    });
  },
  warning(
    payload: { title: React.ReactNode; description?: React.ReactNode } & NotificationOptions
  ) {
    return add({
      type: 'warning',
      title: payload.title,
      description: payload.description,
      duration: payload.duration ?? 4500
    });
  },
  error(payload: { title: React.ReactNode; description?: React.ReactNode } & NotificationOptions) {
    return add({
      type: 'error',
      title: payload.title,
      description: payload.description,
      duration: payload.duration ?? 6000
    });
  },
  destroy() {
    for (const id of timers.keys()) remove(id);
    store.items = [];
    store.emit();
  }
};
