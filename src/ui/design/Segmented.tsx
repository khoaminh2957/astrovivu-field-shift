import type { ReactNode } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Switch from '@radix-ui/react-switch';
import { cn } from './cn';

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Accessible name when `label` is not text (icon-only segments). */
  ariaLabel?: string;
}

export interface SegmentedProps<V extends string = string> {
  options: SegmentedOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
  /** Names the group for screen readers: "Map overlay", "Language". */
  ariaLabel: string;
  /** `lg` is 44 px tall for touch. */
  size?: 'sm' | 'md' | 'lg';
  /** Segments share the full width equally. */
  block?: boolean;
  disabled?: boolean;
  className?: string;
}

const segSize = { sm: 'h-6 px-2 text-xs', md: 'h-7 px-2.5 text-xs', lg: 'h-9 px-3 text-base narrow:h-10' } as const;

/**
 * Segmented control: one choice out of two to five, all visible. The chosen segment is a white
 * tile lifted off a grey track. Arrow keys move between segments; a selected segment cannot be deselected.
 */
export function Segmented<V extends string = string>({ options, value, onValueChange, ariaLabel, size = 'md', block, disabled, className }: SegmentedProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as V)}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn('inline-flex items-center gap-0.5 rounded-sm bg-surface-3 p-0.5', block && 'flex w-full', disabled && 'opacity-45', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          aria-label={o.ariaLabel}
          className={cn(
            'inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[6px] font-medium whitespace-nowrap text-ink-3 [&_svg]:size-4',
            'transition-colors duration-(--dur-instant) ease-out hover:text-ink-1 disabled:opacity-45',
            'data-[state=on]:bg-surface-0 data-[state=on]:text-ink-1 data-[state=on]:shadow-sm',
            segSize[size],
            block && 'flex-1',
          )}
        >
          {o.icon}
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label. Without it, pass `ariaLabel`. */
  label?: ReactNode;
  /** Second line under the label. */
  hint?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  /** `lg` enlarges the hit area to 44 px for touch. */
  size?: 'md' | 'lg';
  /** Put the switch after the label and push it to the far edge (settings rows, layer lists). */
  trailing?: boolean;
  className?: string;
}

/** On/off switch for something that takes effect immediately (a map layer). Off is hollow, on is solid. */
export function Toggle({ checked, onCheckedChange, label, hint, ariaLabel, disabled, size = 'md', trailing, className }: ToggleProps) {
  const control = (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label == null ? ariaLabel : undefined}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-line-2',
        'transition-colors duration-(--dur-fast) ease-out data-[state=checked]:border-signal data-[state=checked]:bg-signal',
        'disabled:opacity-45',
      )}
    >
      <Switch.Thumb
        className={cn(
          'block size-4 translate-x-[1px] rounded-full bg-white shadow-sm',
          'transition-transform duration-(--dur-fast) ease-out data-[state=checked]:translate-x-[17px]',
        )}
      />
    </Switch.Root>
  );
  if (label == null) return <span className={cn('inline-flex', size === 'lg' && 'min-h-11 items-center', className)}>{control}</span>;
  return (
    <label className={cn('flex min-w-0 items-center gap-2.5', size === 'lg' && 'min-h-11', trailing && 'justify-between', disabled && 'cursor-not-allowed', !disabled && 'cursor-pointer', className)}>
      {!trailing && control}
      <span className="min-w-0">
        <span className={cn('block text-sm text-ink-1', disabled && 'text-ink-3')}>{label}</span>
        {hint != null && <span className="t-caption block">{hint}</span>}
      </span>
      {trailing && control}
    </label>
  );
}
