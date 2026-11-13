import type { ReactElement, ReactNode } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from './cn';
import './strings';

interface ShellProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens it (a Button). Optional when `open` is controlled. */
  trigger?: ReactElement;
  /** Required: names the dialog for screen readers and heads it visually. */
  title: ReactNode;
  /** One or two sentences under the title. */
  description?: ReactNode;
  /** Buttons row. Primary action last (right-most). */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

function Header({ title, description }: Pick<ShellProps, 'title' | 'description'>) {
  const t = useT();
  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-line-1 px-(--panel-pad) py-3">
      <div className="min-w-0 flex-1">
        <RDialog.Title className="t-title">{title}</RDialog.Title>
        {description != null && <RDialog.Description className="t-caption mt-1 text-ink-2">{description}</RDialog.Description>}
      </div>
      <RDialog.Close aria-label={t('design.common.close')} className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-2 hover:bg-surface-3 hover:text-ink-1">
        <X size={16} strokeWidth={1.5} aria-hidden />
      </RDialog.Close>
    </header>
  );
}

const overlay = 'fixed inset-0 z-(--z-overlay) bg-scrim data-[state=open]:animate-fade-in';

export interface DialogProps extends ShellProps {
  size?: 'sm' | 'md' | 'lg';
}

const dialogMax = { sm: '24rem', md: '32rem', lg: '48rem' } as const;

/**
 * Modal dialog for a decision that must interrupt: confirm discarding a drawn field, resetting
 * Ground-Truth Overrides. For side content that can stay open while the map is used, use `Sheet`.
 */
export function Dialog({ open, onOpenChange, trigger, title, description, footer, size = 'md', children, className }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className={overlay} />
        <RDialog.Content
          {...(description == null ? { 'aria-describedby': undefined } : {})}
          style={{ maxWidth: dialogMax[size] }}
          className={cn(
            'plate-raised fixed top-1/2 left-1/2 z-(--z-overlay) flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-1/2 flex-col data-[state=open]:animate-fade-in',
            className,
          )}
        >
          <Header title={title} description={description} />
          {children != null && <div className="min-h-0 flex-1 overflow-y-auto p-(--panel-pad)">{children}</div>}
          {footer != null && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line-1 px-(--panel-pad) py-3">{footer}</footer>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export interface SheetProps extends ShellProps {
  /** Edge it is attached to. `bottom` is the phone pattern. */
  side?: 'right' | 'left' | 'bottom';
  /**
   * Modal sheets dim the screen and trap focus. Non-modal sheets (default) leave the globe and the
   * timeline usable: right for the Ground-Truth Override panel and the assistant.
   */
  modal?: boolean;
  /** Width for left/right sheets, CSS length. */
  width?: string;
}

const sheetSide = {
  right: 'top-(--topbar-h) right-0 bottom-0 border-y-0 border-r-0 rounded-none',
  left: 'top-(--topbar-h) left-0 bottom-0 border-y-0 border-l-0 rounded-none',
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] border-x-0 border-b-0 rounded-none safe-bottom',
} as const;

/** Panel attached to an edge. Escape closes it; focus returns to the trigger. */
export function Sheet({ open, onOpenChange, trigger, title, description, footer, side = 'right', modal = false, width = '360px', children, className }: SheetProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        {modal && <RDialog.Overlay className={overlay} />}
        <RDialog.Content
          {...(description == null ? { 'aria-describedby': undefined } : {})}
          // A non-modal sheet must not close when the user works the map behind it.
          onInteractOutside={modal ? undefined : (e) => e.preventDefault()}
          style={side === 'bottom' ? undefined : { width, maxWidth: '100vw' }}
          className={cn('plate-raised fixed z-(--z-overlay) flex flex-col', sheetSide[side], !modal && 'z-(--z-panel)', className)}
        >
          <Header title={title} description={description} />
          {children != null && <div className="min-h-0 flex-1 overflow-y-auto p-(--panel-pad)">{children}</div>}
          {footer != null && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line-1 px-(--panel-pad) py-3">{footer}</footer>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
