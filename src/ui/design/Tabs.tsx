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
 * marked by an ink rule under its label and medium weight; arrow keys move, Home and End jump.
 */
export function Tabs<V extends string = string>({ tabs, value, onValueChange, ariaLabel, size = 'md', block, children, className }: TabsProps<V>) {
  return (
    <RTabs.Root value={value} onValueChange={(v) => onValueChange(v as V)} className={cn('flex min-w-0 flex-col', className)}>
      <RTabs.List aria-label={ariaLabel} className="flex min-w-0 shrink-0 gap-7 overflow-x-auto border-b border-line-1 [scrollbar-width:none]">
        {tabs.map((tab) => (
          <RTabs.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className={cn(
              'relative -mb-px inline-flex shrink-0 items-center justify-center gap-1.5 border-b-2 border-transparent px-0 pt-[3px] whitespace-nowrap text-ink-1 [&_svg]:size-4',
              'transition-colors duration-(--dur-instant) ease-out hover:border-line-2 disabled:opacity-45',
              'data-[state=active]:border-ink-1 data-[state=active]:font-medium data-[state=active]:text-ink-1',
              // The label has no padding, so a ring would sit on the text: focus shows as a tint and the rule instead.
              'rounded-t-xs outline-none focus-visible:border-signal focus-visible:bg-surface-2 focus-visible:text-ink-1',
              size === 'lg' ? 'h-11 text-md' : 'h-9 text-md leading-[22px]',
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
