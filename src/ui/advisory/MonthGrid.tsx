/**
 * The month axis shared by the season calendar, the climate strip under it and the cash-flow chart
 * of the year plan: a label gutter and twelve equal columns, so January sits over January all the
 * way down the page. On a narrow screen the gutter folds away and the label sits over its track.
 */
import type { ReactNode } from 'react';
import { useLang } from '@/i18n';
import { useNarrow } from '@/ui/chrome/uiState';
import { cn } from '@/ui/design';
import { monthLong, monthShort } from './format';

/** Twelve equal columns with the hairline gap every month-aligned row uses. */
export const MONTH_COLS = 'grid grid-cols-12 gap-x-0.5';

export function MonthRow({ label, sub, children, align = 'center', className }: { label?: ReactNode; sub?: ReactNode; children: ReactNode; align?: 'center' | 'start' | 'end'; className?: string }) {
  const bare = label == null && sub == null;
  return (
    <div className={cn('grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 narrow:grid-cols-1 narrow:gap-y-0.5', align === 'center' ? 'items-center' : align === 'end' ? 'items-end' : 'items-start', className)}>
      <div className={cn('flex min-w-0 flex-col narrow:flex-row narrow:items-baseline narrow:gap-2', bare && 'narrow:hidden')}>
        {label != null && <span className="truncate text-xs font-medium text-ink-1">{label}</span>}
        {sub != null && <span className="t-caption truncate">{sub}</span>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Month names over the columns: three letters when there is room, the initial on a narrow screen. */
export function MonthHeader({ className }: { className?: string }) {
  const lang = useLang();
  const narrow = useNarrow();
  return (
    <MonthRow className={className}>
      <div className={MONTH_COLS} aria-hidden>
        {Array.from({ length: 12 }, (_, i) => {
          const short = monthShort(i + 1, lang);
          return (
            <span key={i} title={monthLong(i + 1, lang)} className="t-meta text-center">
              {narrow && lang === 'en' ? short[0] : short}
            </span>
          );
        })}
      </div>
    </MonthRow>
  );
}
