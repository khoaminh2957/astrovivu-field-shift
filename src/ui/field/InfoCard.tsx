import type { ReactNode } from 'react';
import { SquarePen } from 'lucide-react';
import { cn } from '@/ui/design';

/**
 * A small bordered card: a grey label over one medium-weight value. The Status tab opens with a
 * row of them (crop, planting date, weather) and the Field report with the score in the same form.
 * With `onClick` the whole card is a button and carries an edit mark in its corner.
 */
export function InfoCard({ label, children, onClick, action, className }: { label?: string; children: ReactNode; onClick?: () => void; action?: string; className?: string }) {
  const body = (
    <>
      {label != null && (
        <span className="flex items-center justify-between gap-2 text-xs text-ink-3">
          <span className="truncate">{label}</span>
          {onClick && <SquarePen size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-4" />}
        </span>
      )}
      <span className="min-w-0 truncate text-xs leading-4 font-medium text-ink-1 narrow:text-base">{children}</span>
    </>
  );
  const cls = cn('flex min-h-[62px] min-w-0 flex-col justify-center gap-[5px] rounded-sm border border-line-1 bg-surface-0 px-4 py-3 text-left compact:px-3', className);
  return onClick ? (
    <button type="button" aria-label={action} onClick={onClick} className={cn(cls, 'transition-colors duration-(--dur-base) hover:bg-surface-2')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
