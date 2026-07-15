import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalPortal = DialogPrimitive.Portal;
export const ModalClose = DialogPrimitive.Close;

export function ModalOverlay(
  props: React.ComponentProps<typeof DialogPrimitive.Overlay>
) {
  return (
    <DialogPrimitive.Overlay
      {...props}
      className={cn(
        'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out',
        props.className
      )}
    />
  );
}

export function ModalContent(
  props: React.ComponentProps<typeof DialogPrimitive.Content> & {
    showClose?: boolean;
  }
) {
  const { className, children, showClose = true, ...rest } = props;
  return (
    <ModalPortal>
      <ModalOverlay />
      <DialogPrimitive.Content
        {...rest}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background text-foreground shadow-2xl backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          className
        )}
      >
        {showClose && (
          <ModalClose asChild>
            <button
              type="button"
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              <X className="h-4 w-4" />
            </button>
          </ModalClose>
        )}
        {children}
      </DialogPrimitive.Content>
    </ModalPortal>
  );
}

export function ModalHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        'flex flex-col gap-1.5 border-b border-border px-6 py-5',
        props.className
      )}
    />
  );
}

export function ModalTitle(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      {...props}
      className={cn('text-lg font-semibold tracking-tight', props.className)}
    />
  );
}

export function ModalDescription(
  props: React.HTMLAttributes<HTMLParagraphElement>
) {
  return (
    <p
      {...props}
      className={cn('text-sm text-muted-foreground', props.className)}
    />
  );
}

export function ModalBody(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn('px-6 py-5', props.className)} />
  );
}

export function ModalFooter(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        'flex items-center justify-end gap-3 border-t border-border px-6 py-4',
        props.className
      )}
    />
  );
}
