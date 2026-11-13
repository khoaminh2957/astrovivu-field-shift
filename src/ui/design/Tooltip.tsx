import type { ReactElement, ReactNode } from 'react';
import * as RTooltip from '@radix-ui/react-tooltip';
import * as RPopover from '@radix-ui/react-popover';
import { cn } from './cn';

const floating = 'z-(--z-popover) rounded-sm border border-line-2 bg-surface-3 text-ink-1 shadow-lg';

export interface TooltipProps {
  /** One short line. Anything the user must be able to read on touch belongs in a Popover instead. */
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Milliseconds before it opens on hover. */
  delay?: number;
  /** Render the child without a tooltip (keeps call sites unconditional). */
  disabled?: boolean;
}

/** Hover and focus hint. Self-contained: no provider needed at the app root. */
export function Tooltip({ content, children, side = 'top', align = 'center', delay = 350, disabled }: TooltipProps) {
  if (disabled || content == null || content === '') return children;
  return (
    <RTooltip.Provider delayDuration={delay} skipDelayDuration={200}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content side={side} align={align} sideOffset={6} collisionPadding={8} className={cn(floating, 'max-w-64 px-2 py-1 text-xs')}>
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

export interface PopoverProps {
  /** The element that opens the popover; must accept a ref and click handlers (a button). */
  trigger: ReactElement;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accessible name of the floating panel. */
  label?: string;
  className?: string;
}

/** Click, tap or Enter opens it; works on touch, unlike a tooltip. Used for reasons and details. */
export function Popover({ trigger, children, side = 'bottom', align = 'start', open, onOpenChange, label, className }: PopoverProps) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content side={side} align={align} sideOffset={6} collisionPadding={8} aria-label={label} className={cn(floating, 'w-72 max-w-[calc(100vw-16px)] p-3 text-sm', className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
