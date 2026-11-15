/**
 * The way on from step ①: one button at the foot of the field panel to step ②, with the strategy
 * that fits the field best named beside it. It replaces the old Rotation tab, which on a wide
 * screen behaved as a link and on a phone as a tab.
 */
import { ArrowRight } from 'lucide-react';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { bestStrategyId } from '@/ui/advisory/metrics';
import { useMissionUi } from '@/ui/chrome/uiState';
import { cn } from '@/ui/design';

export function NextStep({ className }: { className?: string }) {
  const t = useT();
  const lang = useLang();
  const report = useMission((s) => s.advisory);
  const setPhase = useMission((s) => s.setPhase);
  const setView = useMissionUi((s) => s.setAdvisoryView);
  const rotations = report?.rotations ?? [];
  const best = rotations.find((r) => r.id === bestStrategyId(rotations));
  const current = rotations.find((r) => r.kind === 'current');
  const gain = best && current && best.id !== current.id ? Math.round(best.score) - Math.round(current.score) : null;
  return (
    <div className={cn('workspace-next-step', className)} data-next-step>
      <div className="min-w-0 flex-1">
        <span className="block text-xs text-ink-3">{t('field.next.kicker')}</span>
        <span className="block truncate text-sm font-semibold text-ink-1">
          {best ? t('field.next.best', { name: pick(best.name, lang) }) : report ? t('field.next.none') : t('field.next.loading')}
        </span>
        {gain != null && gain > 0 && <span className="block text-xs text-signal-strong">{t('field.next.gain', { n: gain })}</span>}
      </div>
      <button
        type="button"
        onClick={() => {
          setView('farm');
          setPhase('advisory');
        }}
        className="workspace-next-button"
      >
        <span aria-hidden className="workspace-next-num">
          2
        </span>
        {t('field.next.go')}
        <ArrowRight size={17} aria-hidden />
      </button>
    </div>
  );
}
