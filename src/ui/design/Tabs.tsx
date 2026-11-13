import type { ReactNode } from 'react';
import * as RTabs from '@radix-ui/react-tabs';
import { cn } from './cn';

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  /** Small count or state after the label (a number of alerts, a `Tag`). */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<V extends string = string> {
  tabs: TabItem<V>[];
  value: V;
  onValueChange: (value: V) => void;
  /** Names the tab list: "Advisory sections". */
  ariaLabel: string;
  /** `lg` is 44 px tall for touch. */
  size?: 'md' | 'lg';
  /** Tabs share the full width equally (phone layouts). */
  block?: boolean;
  /** `TabPanel` elements. Omit to drive your own content from `value`. */
  children?: ReactNode;
  className?: string;
}

/**
 * Tabs switch between views of the same parcel (journal / seasons / finances). The active tab is
 * marked by a signal rule under it and full-strength ink; arrow keys move, Home and End jump.
 */
export function Tabs<V extends string = string>({ tabs, value, onValueChange, ariaLabel, size = 'md', block, children, className }: TabsProps<V>) {
  return (
    <RTabs.Root value={value} onValueChange={(v) => onValueChange(v as V)} className={cn('flex min-w-0 flex-col', className)}>
      <RTabs.List aria-label={ariaLabel} className="flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-line-1">
        {tabs.map((tab) => (
          <RTabs.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className={cn(
              'relative -mb-px inline-flex shrink-0 items-center justify-center gap-1.5 border-b-2 border-transparent px-3 font-medium whitespace-nowrap text-ink-3 [&_svg]:size-4',
              'transition-colors duration-(--dur-instant) ease-out hover:text-ink-1 disabled:opacity-45',
              'data-[state=active]:border-signal data-[state=active]:text-ink-1',
              '-outline-offset-2',
              size === 'lg' ? 'h-11 text-base' : 'h-9 text-sm',
              block && 'flex-1',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}

/** Content of one tab. Unmounted while inactive unless `keepMounted`. */
export function TabPanel({ value, keepMounted, className, children }: { value: string; keepMounted?: boolean; className?: string; children: ReactNode }) {
  return (
    <RTabs.Content value={value} forceMount={keepMounted || undefined} className={cn('min-h-0 min-w-0 flex-1 pt-3 outline-offset-0 data-[state=inactive]:hidden', className)}>
      {children}
    </RTabs.Content>
  );
}
