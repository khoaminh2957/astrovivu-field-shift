/** Small building blocks shared by the advisory, tracking and urban screens. */
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import type { BranchId, EvidenceItem, I18nText } from '@/contracts';
import { pick } from '@/contracts';
import { SOURCES } from '@/data';
import { useLang, useT } from '@/i18n';
import { BranchIcon, Segmented, StatusGlyph, StatusTag, Tag, cn } from '@/ui/design';
import type { CurrencyCode } from './format';
import './strings';

const SOURCE_BY_ID = new Map(Object.values(SOURCES).map((s) => [s.id, s]));

/** Short dataset name for a source id; unknown ids are shown as they are, never hidden. */
export function sourceName(id: string | undefined): string | null {
  if (!id) return null;
  const s = SOURCE_BY_ID.get(id);
  return s ? (s.resourceName ?? s.name) : id;
}

export function BranchName({ branch }: { branch: BranchId }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 text-ink-3">
      <BranchIcon branch={branch} size={13} />
      <span className="text-2xs [font-stretch:var(--stretch-semi)]">{t(`advisory.branch.${branch}`)}</span>
    </span>
  );
}

/** Evidence rows: what was measured, its value, and the dataset and telemetry branch it came from. */
export function EvidenceList({ items, className }: { items: EvidenceItem[]; className?: string }) {
  const lang = useLang();
  const t = useT();
  if (!items.length) return <p className={cn('t-caption', className)}>{t('advisory.noEvidence')}</p>;
  return (
    <ul className={cn('flex list-none flex-col gap-1.5 p-0', className)}>
      {items.map((e, i) => (
        <li key={i} className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="min-w-0 text-sm text-ink-2">{pick(e.label, lang)}</span>
            <span className="t-value shrink-0 text-right text-xs text-ink-1">{pick(e.value, lang)}</span>
          </div>
          {(e.sourceId || e.branch) && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              {e.sourceId && <span className="t-meta truncate">{sourceName(e.sourceId)}</span>}
              {e.branch && <BranchName branch={e.branch} />}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Bulleted I18nText list with a state glyph per line (the glyph carries the meaning, not colour). */
export function TextList({ items, glyph, empty, className }: { items: I18nText[]; glyph?: 'watch' | 'info' | 'dash'; empty?: ReactNode; className?: string }) {
  const lang = useLang();
  if (!items.length) return empty ? <p className="t-caption">{empty}</p> : null;
  return (
    <ul className={cn('flex list-none flex-col gap-1.5 p-0 text-sm text-ink-2', className)}>
      {items.map((x, i) => (
        <li key={i} className="flex min-w-0 gap-2">
          {glyph === 'watch' || glyph === 'info' ? (
            <StatusGlyph status={glyph} size={10} className="mt-[5px]" />
          ) : (
            <span aria-hidden className="mt-[9px] h-px w-2 shrink-0 bg-line-3" />
          )}
          <span className="min-w-0">{pick(x, lang)}</span>
        </li>
      ))}
    </ul>
  );
}

export function LocalReviewTag({ className }: { className?: string }) {
  const t = useT();
  return <StatusTag status="watch" label={t('advisory.localReview')} className={className} />;
}

/** Standing reminder that this is decision support, shown on every advisory screen. */
export function SupportLine({ className }: { className?: string }) {
  const t = useT();
  return (
    <p className={cn('flex max-w-[96ch] items-start gap-2 text-sm text-ink-2', className)}>
      <Info size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
      <span>{t('advisory.support')}</span>
    </p>
  );
}

export function CurrencySwitch({ value, onChange }: { value: CurrencyCode; onChange: (c: CurrencyCode) => void }) {
  const t = useT();
  return (
    <Segmented
      size="sm"
      ariaLabel={t('advisory.currency')}
      value={value}
      onValueChange={onChange}
      options={[
        { value: 'USD', label: 'USD' },
        { value: 'VND', label: 'VND' },
      ]}
    />
  );
}

/** Visible marker on any screen that is rendering a development fixture instead of engine output. */
export function FixtureTag() {
  const t = useT();
  return (
    <Tag tone="simulated" variant="soft" title={t('advisory.fixtureHint')}>
      {t('advisory.fixture')}
    </Tag>
  );
}

/** Section heading inside a page region (not a panel): title, a one-line explainer, controls. */
export function SectionHead({ title, sub, actions, id }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="t-title">
          {title}
        </h2>
        {sub != null && <p className="t-caption mt-0.5 max-w-[88ch]">{sub}</p>}
      </div>
      {actions != null && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Label of a scoring factor key (`water`, `ph`, ...); unknown keys are shown as they are. */
export function factorName(t: (k: string) => string, key: string): string {
  const k = `advisory.factor.${key}`;
  const s = t(k);
  return s === k ? key : s;
}
