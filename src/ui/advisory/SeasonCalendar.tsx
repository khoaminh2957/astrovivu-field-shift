/**
 * The season calendar: what stands on the field in each month, for the current practice and for
 * the selected strategy, one row of twelve months per rotation year. The climate strip under it
 * shares the same columns, so a season can be read straight against the rain and the temperature
 * of its months.
 */
import { useState } from 'react';
import type { RotationStrategy } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { cn } from '@/ui/design';
import { ClimateStrip, type ClimateStripProps } from './ClimateStrip';
import { type CropGroup, FALLOW_HATCH, GROUP_FILL, GROUP_ORDER, cropGroup } from './cropGroups';
import type { CurrencyCode } from './format';
import { MONTH_COLS, MonthHeader, MonthRow } from './MonthGrid';
import { type OpenBlock, SeasonBlock } from './SeasonBlock';
import { type YearRow, emptyMonths, layoutRotation } from './seasonLayout';

const LANE_PX = 30;

interface Props {
  /** The baseline; null when the engine returned none, or when it is the selection itself. */
  current: RotationStrategy | null;
  selected: RotationStrategy;
  climate: ClimateStripProps | null;
  currency: CurrencyCode;
}

const usesReference = (r: RotationStrategy) => r.economics?.seasons?.some((s) => s.usesReferenceValues) ?? false;

export function SeasonCalendar({ current, selected, climate, currency }: Props) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState<OpenBlock | null>(null);
  const groups = [
    ...(current && current.id !== selected.id ? [{ strategy: current, title: t('advisory.current') }] : []),
    { strategy: selected, title: selected.kind === 'current' ? t('advisory.current') : t('advisory.cal.selected') },
  ].map((g) => ({ ...g, rows: layoutRotation(g.strategy.seasons, g.strategy.years) }));
  const used = new Set<CropGroup>(groups.flatMap((g) => g.strategy.seasons.map((s) => cropGroup(s.cropId))));
  const anyEmpty = groups.some((g) => g.rows.some((r) => emptyMonths(r).length > 0));
  const anyWrap = groups.some((g) => g.rows.some((r) => r.lanes.some((l) => l.some((s) => s.openEnd))));

  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <MonthHeader />
        {groups.map((g, gi) => (
          <div key={g.strategy.id} role="group" aria-label={`${g.title}: ${pick(g.strategy.name, lang)}`} className={cn('flex flex-col gap-1', gi > 0 && 'mt-1.5')}>
            {g.rows.map((row) => (
              <MonthRow
                key={row.year}
                label={row.year === 0 ? g.title : undefined}
                sub={g.rows.length > 1 ? t('advisory.yearN', { n: row.year + 1 }) : t('advisory.cal.everyYear')}
              >
                <YearTrack row={row} rowKey={`${g.strategy.id}:${row.year}`} open={open} setOpen={setOpen} currency={currency} usesReference={usesReference(g.strategy)} />
              </MonthRow>
            ))}
          </div>
        ))}
      </div>

      {climate ? <ClimateStrip {...climate} /> : <p className="t-caption">{t('advisory.clim.missing')}</p>}

      <figcaption className="flex flex-col gap-1.5 border-t border-line-1 pt-2.5">
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0" aria-label={t('advisory.cal.legend')}>
          {GROUP_ORDER.filter((g) => used.has(g)).map((g) => (
            <li key={g} className="t-caption inline-flex items-center gap-1.5">
              <span aria-hidden className={cn('inline-block h-3 w-4 rounded-xs', GROUP_FILL[g])} style={g === 'fallow' ? { backgroundImage: FALLOW_HATCH } : undefined} />
              {t(`advisory.group.${g}`)}
            </li>
          ))}
          {anyEmpty && (
            <li className="t-caption inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-3 w-4 rounded-xs border border-dashed border-line-3" />
              {t('advisory.cal.empty')}
            </li>
          )}
        </ul>
        <p className="t-caption">
          {t('advisory.cal.hint')}
          {anyWrap && ` ${t('advisory.cal.wrap')}`}
        </p>
      </figcaption>
    </figure>
  );
}

/** One rotation year: twelve month cells with the season blocks laid over them in lanes. */
function YearTrack({ row, rowKey, open, setOpen, currency, usesReference }: { row: YearRow; rowKey: string; open: OpenBlock | null; setOpen: (o: OpenBlock | null) => void; currency: CurrencyCode; usesReference: boolean }) {
  const lanes = Math.max(1, row.lanes.length);
  return (
    <div className={cn(MONTH_COLS, 'gap-y-0.5')} style={{ gridTemplateRows: `repeat(${lanes}, ${LANE_PX}px)` }}>
      {Array.from({ length: 12 }, (_, c) => (
        <span key={c} aria-hidden className="rounded-xs bg-surface-2" style={{ gridColumn: c + 1, gridRow: '1 / -1' }} />
      ))}
      {row.lanes.map((lane, li) =>
        lane.map((seg) => (
          <SeasonBlock
            key={`${seg.index}-${seg.col}`}
            segment={seg}
            blockKey={`${rowKey}:${seg.index}:${seg.col}`}
            open={open}
            setOpen={setOpen}
            currency={currency}
            usesReference={usesReference}
            style={{ gridColumn: `${seg.col + 1} / span ${seg.span}`, gridRow: li + 1 }}
          />
        )),
      )}
    </div>
  );
}
