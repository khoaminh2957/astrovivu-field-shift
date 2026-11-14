/**
 * The five lists the challenge asks of every strategy, for the selected one only: why it is
 * suggested, the evidence, the benefits, and (flagged for local review) the information gaps and
 * the risks. Evidence that comes from a telemetry branch opens that branch on the field.
 */
import type { ReactNode } from 'react';
import { ArrowUpRight, CircleHelp, Database, Lightbulb, Sprout, TriangleAlert } from 'lucide-react';
import type { BranchId, EvidenceItem, RotationStrategy } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { useMissionUi } from '@/ui/chrome/uiState';
import { BranchIcon, cn } from '@/ui/design';
import { useSelectBranch } from '@/ui/field/MetricCards';
import { LocalReviewTag, TextList, sourceName } from './shared';

export function StrategyStory({ strategy }: { strategy: RotationStrategy }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
        <Block icon={<Lightbulb />} title={t('advisory.list.why')}>
          <TextList items={strategy.why} empty={t('advisory.story.none')} />
        </Block>
        <Block icon={<Sprout />} title={t('advisory.list.benefits')}>
          <TextList items={strategy.benefits} empty={t('advisory.story.none')} />
        </Block>
      </div>

      <Block icon={<Database />} title={t('advisory.list.evidence')} sub={t('advisory.story.evidenceHint')}>
        <Evidence items={strategy.evidence} />
      </Block>

      {/* What the data cannot settle: the part an extension officer or agronomist has to check. */}
      <div className="flex flex-col gap-3 rounded-sm border border-watch/45 bg-watch/[0.05] p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <LocalReviewTag />
          <span className="text-sm text-ink-2">{t('advisory.localReviewHint')}</span>
        </div>
        <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
          <Block icon={<CircleHelp />} title={t('advisory.list.gaps')} flagged>
            <TextList items={strategy.gaps} glyph="info" empty={t('advisory.noGaps')} />
          </Block>
          <Block icon={<TriangleAlert />} title={t('advisory.list.risks')} flagged>
            <TextList items={strategy.risks} glyph="watch" empty={t('advisory.noRisks')} />
          </Block>
        </div>
      </div>
    </div>
  );
}

function Block({ icon, title, sub, flagged, children }: { icon: ReactNode; title: string; sub?: string; flagged?: boolean; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-medium text-ink-1">
        <span aria-hidden className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-xs [&>svg]:size-3.5 [&>svg]:stroke-[1.75]', flagged ? 'bg-watch/14 text-watch' : 'bg-surface-2 text-ink-2')}>
          {icon}
        </span>
        {title}
      </h3>
      {sub && <p className="t-caption -mt-1">{sub}</p>}
      {children}
    </section>
  );
}

/** Evidence as chips: what was measured, the value, the dataset. A chip with a branch is a button. */
function Evidence({ items }: { items: EvidenceItem[] }) {
  const t = useT();
  const lang = useLang();
  const select = useSelectBranch();
  const setPhase = useMission((s) => s.setPhase);
  if (!items.length) return <p className="t-caption">{t('advisory.noEvidence')}</p>;

  const open = (branch: BranchId) => {
    select(branch);
    useMissionUi.getState().setFieldTab('data');
    setPhase('locked');
  };
  const chip = 'flex min-w-0 flex-col gap-0.5 rounded-sm border border-line-1 bg-surface-0 px-2.5 py-2 text-left';

  return (
    <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
      {items.map((e, i) => {
        const body = (
          <>
            <span className="flex min-w-0 items-start gap-1.5">
              {e.branch && <BranchIcon branch={e.branch} size={14} className="mt-0.5 shrink-0 text-ink-3" />}
              <span className="min-w-0 flex-1 text-xs text-ink-2">{pick(e.label, lang)}</span>
              {e.branch && <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink-3" />}
            </span>
            <span className="t-value text-sm text-ink-1">{pick(e.value, lang)}</span>
            {e.sourceId && <span className="t-meta truncate">{sourceName(e.sourceId)}</span>}
          </>
        );
        return (
          <li key={i} className="flex min-w-0">
            {e.branch ? (
              <button type="button" onClick={() => open(e.branch!)} title={t('advisory.story.openBranch', { branch: t(`advisory.branch.${e.branch}`) })} className={cn(chip, 'w-full hover:bg-surface-2')}>
                {body}
                <span className="sr-only">{t('advisory.story.openBranch', { branch: t(`advisory.branch.${e.branch}`) })}</span>
              </button>
            ) : (
              <div className={cn(chip, 'w-full')}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
