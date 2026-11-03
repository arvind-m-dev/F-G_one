'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  side,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** "right" renders a slide-over drawer instead of a centred modal */
  side?: 'right';
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-[#0b0d11]/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                className={cn(
                  'fixed z-50 flex flex-col border bg-elevated shadow-lg focus:outline-none',
                  side === 'right'
                    ? 'inset-y-2 right-2 w-[calc(100%-1rem)] max-w-lg rounded-2xl'
                    : 'top-1/2 left-1/2 max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg rounded-2xl',
                  className,
                )}
                initial={side === 'right' ? { x: 40, opacity: 0 } : { opacity: 0, scale: 0.96, y: '-48%', x: '-50%' }}
                animate={side === 'right' ? { x: 0, opacity: 1 } : { opacity: 1, scale: 1, y: '-50%', x: '-50%' }}
                exit={side === 'right' ? { x: 40, opacity: 0 } : { opacity: 0, scale: 0.96, y: '-48%', x: '-50%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              >
                <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
                  <div>
                    <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description className="mt-0.5 text-sm text-muted">{description}</DialogPrimitive.Description>
                    ) : (
                      <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogPrimitive.Description>
                    )}
                  </div>
                  <DialogPrimitive.Close className="rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-foreground" aria-label="Close">
                    <X className="size-4" />
                  </DialogPrimitive.Close>
                </div>
                <div className="scrollbar-thin flex-1 overflow-y-auto px-6 pt-2 pb-6">{children}</div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  danger,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} className="max-w-md">
      <p className="text-sm text-muted">{description}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button className="h-9 rounded-lg px-4 text-sm font-medium hover:bg-surface-2" onClick={() => onOpenChange(false)}>
          Cancel
        </button>
        <button
          className={cn('inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-white disabled:opacity-60', danger ? 'bg-danger' : 'bg-primary')}
          disabled={loading}
          onClick={onConfirm}
        >
          {loading ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
