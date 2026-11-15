import { useT } from '@/i18n';
import { cn } from '@/ui/design';
import { useScoreChange } from './scoreChange';
import './strings';

/** One line: the score before the grower's last entry and after it. */
export function ScoreChangeLine({ className }: { className?: string }) {
  const t = useT();
  const change = useScoreChange((s) => s.change);
  if (!change) return null;
  const d = change.after - change.before;
  return (
    <p role="status" className={cn('flex flex-wrap items-baseline gap-x-1.5 text-sm text-ink-2', className)}>
      {d === 0 ? (
        t('gt.changeNone', { v: change.after })
      ) : (
        <>
          {t('gt.change')}
          <span className="t-value text-ink-3">{change.before}</span>
          <span aria-hidden>→</span>
          <span className="t-value text-ink-1">{change.after}</span>
          <span className={cn('t-value', d > 0 ? 'text-signal-strong' : 'text-alert')}>
            ({d > 0 ? '+' : '−'}
            {Math.abs(d)})
          </span>
        </>
      )}
    </p>
  );
}
