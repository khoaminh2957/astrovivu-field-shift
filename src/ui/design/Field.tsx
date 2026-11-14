import { type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes, useId } from 'react';
import * as RSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from './cn';
import './strings';

export type ControlSize = 'md' | 'lg';

/** Shared look of every text-like control: white, a hairline boundary, signal on focus, alert on error. */
const well =
  'w-full min-w-0 rounded-sm border border-line-2 bg-surface-0 text-ink-1 transition-colors duration-(--dur-instant) ease-out ' +
  'hover:border-[#b9b9bd] focus-within:border-signal focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-signal/25 ' +
  'has-[:disabled]:opacity-45 has-[:disabled]:hover:border-line-2 data-[invalid=true]:border-alert';

const heights: Record<ControlSize, string> = { md: 'h-8 text-xs', lg: 'h-10 text-base narrow:h-11' };

export interface FieldProps {
  /** Visible label. Always present: placeholders are not labels. */
  label: ReactNode;
  /** Id of the control this field labels. Use the same id on the Input, Textarea or Select. */
  htmlFor: string;
  /** Help under the control: what to enter, in which unit, where to find it. */
  hint?: ReactNode;
  /** Says what is wrong and how to fix it. Replaces the hint and is announced. */
  error?: ReactNode;
  required?: boolean;
  /** Content at the right of the label row (a provenance tag, a "reset" button). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Label + control + hint or error. The control inside gets `aria-describedby="<htmlFor>-help"`. */
export function Field({ label, htmlFor, hint, error, required, aside, children, className }: FieldProps) {
  const t = useT();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="t-label text-ink-1">
          {label}
          {required && <span className="ml-1 text-ink-3">({t('design.common.required')})</span>}
        </label>
        {aside}
      </div>
      {children}
      {(error != null || hint != null) && (
        <p id={`${htmlFor}-help`} role={error != null ? 'alert' : undefined} className={cn('t-caption', error != null && 'text-alert')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: ControlSize;
  /** Leading adornment: an icon or a symbol. */
  prefix?: ReactNode;
  /** Trailing unit, set in the measurement face: `pH`, `mm`, `t/ha`. */
  unit?: ReactNode;
  invalid?: boolean;
  /** Right-align and use tabular numerals (measurements). */
  numeric?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ size = 'md', prefix, unit, invalid, numeric, className, id, ref, ...rest }: InputProps) {
  return (
    <div data-invalid={invalid || undefined} className={cn(well, heights[size], 'flex items-center gap-2 px-3', className)}>
      {prefix != null && <span className="shrink-0 text-ink-3 [&_svg]:size-4">{prefix}</span>}
      <input
        ref={ref}
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={id ? `${id}-help` : undefined}
        className={cn('h-full min-w-0 flex-1 bg-transparent outline-none disabled:cursor-not-allowed', numeric && 't-value text-right')}
        {...rest}
      />
      {unit != null && <span className="t-unit shrink-0">{unit}</span>}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ invalid, className, id, rows = 3, ref, ...rest }: TextareaProps) {
  return (
    <div data-invalid={invalid || undefined} className={cn(well, 'flex px-2.5 py-1.5 text-sm', className)}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={invalid || undefined}
        aria-describedby={id ? `${id}-help` : undefined}
        className="min-h-12 w-full resize-y bg-transparent leading-5 outline-none disabled:cursor-not-allowed"
        {...rest}
      />
    </div>
  );
}

export interface SelectOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Second line in the list (not shown in the closed control). */
  hint?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  options: SelectOption<V>[];
  value: V | undefined;
  onValueChange: (value: V) => void;
  /** Same id as the `Field` around it. */
  id?: string;
  placeholder?: ReactNode;
  /** Needed only when there is no visible `Field` label. */
  ariaLabel?: string;
  size?: ControlSize;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Choice among more options than a Segmented control can show (crops, textures, drainage classes). */
export function Select<V extends string = string>({ options, value, onValueChange, id, placeholder, ariaLabel, size = 'md', invalid, disabled, className }: SelectProps<V>) {
  const t = useT();
  const fallbackId = useId();
  const cid = id ?? fallbackId;
  return (
    <RSelect.Root value={value} onValueChange={(v) => onValueChange(v as V)} disabled={disabled}>
      <RSelect.Trigger
        id={cid}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={id ? `${id}-help` : undefined}
        data-invalid={invalid || undefined}
        className={cn(
          well,
          heights[size],
          'flex items-center justify-between gap-2 px-3 text-left outline-offset-0 focus-visible:border-signal disabled:opacity-45 data-[placeholder]:text-ink-3',
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <RSelect.Value placeholder={placeholder ?? t('design.common.select')} />
        </span>
        <RSelect.Icon className="shrink-0 text-ink-3">
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content position="popper" sideOffset={4} collisionPadding={8} className="z-(--z-popover) max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-sm border border-line-1 bg-surface-0 shadow-lg">
          <RSelect.Viewport className="p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className={cn(
                  'relative flex cursor-pointer items-start gap-2 rounded-xs py-1.5 pr-2 pl-7 text-ink-1 outline-none select-none',
                  size === 'lg' ? 'min-h-11 text-base' : 'text-sm',
                  'data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45',
                )}
              >
                <RSelect.ItemIndicator className="absolute top-2 left-2">
                  <Check size={14} strokeWidth={2} aria-hidden className="text-signal-strong" />
                </RSelect.ItemIndicator>
                <span className="min-w-0">
                  <RSelect.ItemText>{o.label}</RSelect.ItemText>
                  {o.hint != null && <span className="block text-xs opacity-70">{o.hint}</span>}
                </span>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
