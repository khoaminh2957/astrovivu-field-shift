import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** `lg` is the 44 px touch size: use it for anything a thumb presses (dock, phone screens). */
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-full border font-medium whitespace-nowrap ' +
  'transition-colors duration-(--dur-instant) ease-out disabled:opacity-45 aria-disabled:opacity-45';

const variants: Record<ButtonVariant, string> = {
  // Inverse video: the brightest solid on screen is the thing the operator is about to do.
  primary: 'border-signal bg-signal text-on-signal shadow-md hover:brightness-110 active:brightness-95',
  secondary: 'border-line-2 bg-surface-0 text-ink-1 shadow-sm hover:bg-surface-2 active:bg-surface-3',
  ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink-1 active:bg-surface-3',
  danger: 'border-alert/60 bg-transparent text-alert hover:bg-alert/12 active:bg-alert/20',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-sm',
  lg: 'h-11 px-4 text-base',
};

const iconSizes: Record<ButtonSize, string> = { sm: 'size-7', md: 'size-8', lg: 'size-11' };
const glyph: Record<ButtonSize, string> = { sm: '[&_svg]:size-3.5', md: '[&_svg]:size-4', lg: '[&_svg]:size-5' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon before the label (a lucide icon element). */
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Shows a spinner in place of the leading icon and blocks presses; the label stays readable. */
  loading?: boolean;
  /** Stretch to the width of the container. */
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, loading, block, className, children, disabled, type = 'button', ref, ...rest }: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], glyph[size], block && 'w-full', className)}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name, also shown as the tooltip. Required: an icon alone is not a label. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Pressed state for toggling icon buttons (play/pause, layer on/off). */
  pressed?: boolean;
  loading?: boolean;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ label, icon, variant = 'ghost', size = 'md', pressed, loading, tooltipSide = 'top', className, disabled, type = 'button', ref, ...rest }: IconButtonProps) {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={cn(
          base,
          variants[variant],
          iconSizes[size],
          glyph[size],
          'px-0',
          pressed && variant !== 'primary' && 'border-signal bg-signal text-on-signal hover:bg-ink-1 hover:text-on-signal',
          className,
        )}
        {...rest}
      >
        {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      </button>
    </Tooltip>
  );
}
