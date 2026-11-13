import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from './cn';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Heading row. Omit for a bare plate. */
  title?: ReactNode;
  /** Small line beside the title: a count, a date, a source. */
  meta?: ReactNode;
  /** Controls at the right of the heading row. */
  actions?: ReactNode;
  footer?: ReactNode;
  /**
   * `plate` floats on imagery (default); `raised` sits one level above another plate (popovers,
   * the assistant); `flat` is a section inside a plate: no shadow, no fill.
   */
  tone?: 'plate' | 'raised' | 'flat';
  /** Inner padding. `none` when the content is a list or a chart that should reach the edges. */
  pad?: 'none' | 'sm' | 'md';
  /** Element to render: use `aside`, `section` or `nav` so landmarks are meaningful. */
  as?: 'section' | 'aside' | 'div' | 'nav' | 'article';
  ref?: Ref<HTMLElement>;
}

const tones = { plate: 'plate', raised: 'plate-raised', flat: 'border border-line-1 rounded-sm' } as const;
const pads = { none: '', sm: 'p-3', md: 'p-(--panel-pad)' } as const;

/** The one container of the system. Panels never nest inside panels; use `tone="flat"` for groups. */
export function Panel({ title, meta, actions, footer, tone = 'plate', pad = 'md', as: Tag = 'section', className, children, ref, ...rest }: PanelProps) {
  const hasHead = title != null || actions != null;
  return (
    <Tag ref={ref as Ref<HTMLDivElement>} className={cn('flex min-w-0 flex-col text-ink-1', tones[tone], className)} {...rest}>
      {hasHead && (
        <header className="flex min-h-10 shrink-0 items-center gap-3 border-b border-line-1 px-(--panel-pad) py-1.5">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {title != null && <h2 className="t-heading truncate">{title}</h2>}
            {meta != null && <span className="t-meta shrink-0">{meta}</span>}
          </div>
          {actions != null && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 min-w-0 flex-1', pads[pad])}>{children}</div>
      {footer != null && <footer className="shrink-0 border-t border-line-1 px-(--panel-pad) py-2">{footer}</footer>}
    </Tag>
  );
}
