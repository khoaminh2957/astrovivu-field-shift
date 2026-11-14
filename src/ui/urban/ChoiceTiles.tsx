/** Illustrated choices: a radio group drawn as tiles, and multi-select chips. */
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/ui/design';

export interface TileOption<V extends string> {
  value: V;
  label: string;
  hint?: string;
  icon: ReactNode;
}

/**
 * Native radios under the tiles, so arrow keys, Tab and screen readers behave as for any radio
 * group. The chosen tile has a green rim, a tint and a check mark (the mark is the non-colour cue).
 */
export function ChoiceTiles<V extends string>({ legend, name, value, onChange, options, className }: { legend: string; name: string; value: V; onChange: (v: V) => void; options: TileOption<V>[]; className?: string }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="t-label mb-1.5 p-0">{legend}</legend>
      <div className={cn('grid gap-2', className)}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label
              key={o.value}
              className={cn(
                'relative flex min-h-[84px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-sm border px-1 py-2 text-center transition-colors duration-(--dur-instant)',
                'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-signal',
                on ? 'border-signal bg-signal/12 text-signal-strong' : 'border-line-2 bg-surface-0 text-ink-2 hover:bg-surface-2 hover:text-ink-1',
              )}
            >
              <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
              {on && <Check aria-hidden size={14} strokeWidth={2} className="absolute top-1.5 right-1.5" />}
              <span aria-hidden className="mb-0.5 [&_svg]:size-6 [&_svg]:stroke-[1.5]">
                {o.icon}
              </span>
              <span className="text-sm leading-tight font-medium">{o.label}</span>
              {o.hint && <span className={cn('text-xs leading-tight', on ? 'text-signal-strong' : 'text-ink-3')}>{o.hint}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface ChipOption<V extends string> {
  value: V;
  label: string;
  icon?: ReactNode;
}

/** Any number of choices. Each chip is a toggle button; a chosen chip also carries a check mark. */
export function ChoiceChips<V extends string>({ legend, hint, values, onToggle, options }: { legend: string; hint?: string; values: V[]; onToggle: (v: V) => void; options: ChipOption<V>[] }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="t-label mb-1.5 p-0">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o.value)}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-2.5 text-sm leading-tight font-medium transition-colors duration-(--dur-instant) narrow:min-h-11',
                on ? 'border-signal bg-signal/12 text-signal-strong' : 'border-line-2 bg-surface-0 text-ink-2 hover:bg-surface-2 hover:text-ink-1',
              )}
            >
              <span aria-hidden className="[&_svg]:size-4 [&_svg]:stroke-[1.5]">
                {on ? <Check /> : o.icon}
              </span>
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && <p className="t-caption mt-1.5">{hint}</p>}
    </fieldset>
  );
}
