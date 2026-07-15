import { useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

type MessageType = 'success' | 'info' | 'error' | 'loading';

type MessageItem = {
  id: string;
  type: MessageType;
  content: React.ReactNode;
  duration: number;
};

const store = {
  items: [] as MessageItem[],
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

function uid(prefix = 'msg') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function remove(id: string) {
  const t = timers.get(id);
  if (t) window.clearTimeout(t);
  timers.delete(id);
  store.items = store.items.filter((m) => m.id !== id);
  store.emit();
}

function add(item: Omit<MessageItem, 'id'>) {
  if (typeof document === 'undefined') return () => {};
  ensureMounted();

  const id = uid();
  store.items = [...store.items, { ...item, id }];
  store.emit();

  if (item.duration > 0) {
    const t = window.setTimeout(() => remove(id), item.duration);
    timers.set(id, t);
  }

  return () => remove(id);
}

function iconFor(type: MessageType) {
  if (type === 'success') return <CheckCircle2 className="w-4 h-4 text-green-300" />;
  if (type === 'error') return <XCircle className="w-4 h-4 text-red-300" />;
  if (type === 'loading') return <Loader2 className="w-4 h-4 text-cyan-300 animate-spin" />;
  return <Info className="w-4 h-4 text-cyan-300" />;
}

function MessageHost() {
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  if (items.length === 0) return null;

  return (
    <div className="fixed top-5 inset-x-0 z-[9999] pointer-events-none">
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-2 px-4">
        {items.map((m) => (
          <div
            key={m.id}
            className={cn(
              'pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-popover/90 px-3 py-2 text-sm text-foreground shadow-2xl backdrop-blur-md',
              'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-top-2'
            )}
            data-state="open"
          >
            {iconFor(m.type)}
            <div className="max-w-[620px] truncate">{m.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

let root: Root | null = null;

function ensureMounted() {
  if (root) return;
  const id = 'ui-message-root';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  root = createRoot(el);
  root.render(<MessageHost />);
}

type MessageOptions = {
  duration?: number;
};

export const message = {
  open(payload: { type?: MessageType; content: React.ReactNode } & MessageOptions) {
    return add({
      type: payload.type ?? 'info',
      content: payload.content,
      duration: payload.duration ?? 2000
    });
  },
  success(content: React.ReactNode, options?: MessageOptions) {
    return add({ type: 'success', content, duration: options?.duration ?? 2000 });
  },
  info(content: React.ReactNode, options?: MessageOptions) {
    return add({ type: 'info', content, duration: options?.duration ?? 2000 });
  },
  error(content: React.ReactNode, options?: MessageOptions) {
    return add({ type: 'error', content, duration: options?.duration ?? 2500 });
  },
  loading(content: React.ReactNode, options?: MessageOptions) {
    return add({ type: 'loading', content, duration: options?.duration ?? 0 });
  },
  destroy() {
    for (const id of timers.keys()) remove(id);
    store.items = [];
    store.emit();
  }
};
