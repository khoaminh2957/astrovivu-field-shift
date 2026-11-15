/**
 * Season planner: the farmer enters the year as seasons (Đông Xuân, Hè Thu, ...), each with one or
 * more crops and, if known, the sowing date. Writes `GroundTruth.currentRotation`; the first crop of
 * the season running now becomes the field's crop and its sowing date anchors the growth stages.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import type { ISODate } from '@/contracts';
import { getCrop, searchCrops } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { todayISO } from '@/lib/time';
import { useMission } from '@/state/mission';
import { IconButton, Input, Select, cn } from '@/ui/design';
import { cropName } from '@/ui/hud/format';
import { activeRow, monthsOf, presets, rotationFromRows, rowYears, rowsFromRotation, seasonName, type SeasonRow } from './seasons';
import './strings';

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortMonth = (m: number, lang: string) => (lang === 'vi' ? `T${m}` : EN_MONTHS[m - 1]);

/** Seasons as stored, the month today and whether the field is in the tropics. Shared with the top cards. */
export function useSeasonRows() {
  const rot = useMission((s) => s.groundTruth.currentRotation);
  const sowingDate = useMission((s) => s.groundTruth.sowingDate);
  const cropId = useMission((s) => s.cropId);
  const today = useMission((s) => s.telemetry?.window.today) ?? todayISO();
  const lat = useMission((s) => s.parcel?.centroid[1] ?? 0);
  const month = Number(today.slice(5, 7));
  const rows = useMemo(() => rowsFromRotation(rot, { crop: getCrop(cropId), sowingDate, month }), [rot, cropId, sowingDate, month]);
  return { rows, month, tropical: Math.abs(lat) < 23.5 };
}

/** 12 ticks, the season's months filled. */
function MonthStrip({ row, lang }: { row: SeasonRow; lang: string }) {
  const on = monthsOf(row.start, row.end);
  return (
    <span className="flex gap-0.5" aria-hidden>
      {Array.from({ length: 12 }, (_, k) => (
        <span key={k} title={shortMonth(k + 1, lang)} className={cn('h-1.5 w-2.5 rounded-[1px]', on.includes(k + 1) ? 'bg-signal' : 'bg-line-1')} />
      ))}
    </span>
  );
}

function CropAdder({ exclude, onAdd, autoOpen }: { exclude: string[]; onAdd: (id: string) => void; autoOpen?: boolean }) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(!!autoOpen);
  const [q, setQ] = useState('');
  const hits = useMemo(() => (open ? searchCrops(q, lang, 8).filter((c) => !exclude.includes(c.id) && getCrop(c.id)).slice(0, 6) : []), [open, q, lang, exclude]);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line-2 px-2.5 text-xs text-ink-2 hover:border-signal hover:text-signal-strong">
        <Plus size={12} aria-hidden />
        {t('season.addCrop')}
      </button>
    );
  }
  const close = () => (setOpen(false), setQ(''));
  return (
    <div className="flex w-full flex-col gap-1.5">
      <Input
        autoFocus
        aria-label={t('season.search')}
        placeholder={t('season.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && hits[0]) (onAdd(hits[0].id), close());
        }}
        onBlur={() => window.setTimeout(close, 150)}
      />
      {hits.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {hits.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (onAdd(c.id), close())}
              className="h-7 rounded-full border border-line-2 px-2.5 text-xs text-ink-1 hover:border-signal hover:bg-signal/10"
            >
              {cropName(c.names, lang)}
            </button>
          ))}
        </div>
      ) : (
        <p className="t-caption">{t('season.noMatch', { q })}</p>
      )}
    </div>
  );
}

function SeasonCard({ row, index, year, active, tropical, fresh, onChange, onRemove }: { row: SeasonRow; index: number; year: number; active: boolean; tropical: boolean; fresh: boolean; onChange: (r: SeasonRow) => void; onRemove: () => void }) {
  const t = useT();
  const lang = useLang();
  const months = useMemo(() => Array.from({ length: 12 }, (_, k) => ({ value: String(k + 1), label: t('season.month', { m: k + 1 }) })), [t]);
  const name = seasonName(row, tropical);
  const title = t(`season.name.${name}`, { n: index + 1 });
  const sowLabel = `${title} · ${t('season.sowing')}`;
  // The season running now, a new one and one without a crop are open; the others are one line until asked for.
  const [open, setOpen] = useState(active || fresh || row.crops.length === 0);
  const bodyId = useId();
  const crops = row.crops.map((id) => getCrop(id)).map((c, i) => (c ? cropName(c.names, lang) : row.crops[i]));
  return (
    <li className={cn('flex flex-col gap-2.5 rounded-sm border px-3 py-2.5', active ? 'border-signal/60' : 'border-line-1')}>
      <div className="flex items-center gap-2">
        <button type="button" aria-expanded={open} aria-controls={bodyId} aria-label={t(open ? 'season.fold' : 'season.unfold', { s: title })} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 rounded-xs text-left">
          <span className="shrink-0 text-sm font-medium text-ink-1">{title}</span>
          {active && <span className="shrink-0 rounded-full bg-signal/15 px-2 text-[11px] leading-5 text-signal-strong">{t('season.now')}</span>}
          {year > 0 && <span className="shrink-0 rounded-full bg-surface-2 px-2 text-[11px] leading-5 text-ink-2">{t('season.nextYear', { n: year + 1 })}</span>}
          {!open && (
            <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
              {shortMonth(row.start, lang)}-{shortMonth(row.end, lang)} · {crops.join(' + ')}
            </span>
          )}
          <span className="flex-1" />
          <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-ink-3 transition-transform duration-(--dur-fast)', open && 'rotate-180')} />
        </button>
        <IconButton label={t('season.remove')} icon={<X />} size="sm" onClick={onRemove} />
      </div>
      {open && <SeasonBody id={bodyId} row={row} months={months} sowLabel={sowLabel} fresh={fresh} onChange={onChange} />}
    </li>
  );
}

function SeasonBody({ id, row, months, sowLabel, fresh, onChange }: { id: string; row: SeasonRow; months: { value: string; label: string }[]; sowLabel: string; fresh: boolean; onChange: (r: SeasonRow) => void }) {
  const t = useT();
  const lang = useLang();
  return (
    <div id={id} className="flex flex-col gap-2.5">

      <div className="flex flex-wrap items-center gap-2">
        <Select ariaLabel={t('season.from')} options={months} value={String(row.start)} onValueChange={(v) => onChange({ ...row, start: Number(v) })} className="w-[7.5rem]" />
        <span className="text-ink-3" aria-hidden>
          →
        </span>
        <Select ariaLabel={t('season.to')} options={months} value={String(row.end)} onValueChange={(v) => onChange({ ...row, end: Number(v) })} className="w-[7.5rem]" />
        <MonthStrip row={row} lang={lang} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {row.crops.map((id) => {
          const c = getCrop(id);
          return (
            <span key={id} className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-2 pr-1 pl-2.5 text-xs text-ink-1">
              {c ? cropName(c.names, lang) : id}
              <button type="button" aria-label={t('season.removeCrop', { c: c ? cropName(c.names, lang) : id })} onClick={() => onChange({ ...row, crops: row.crops.filter((x) => x !== id) })} className="flex size-5 items-center justify-center rounded-full text-ink-3 hover:bg-surface-3 hover:text-ink-1">
                <X size={12} aria-hidden />
              </button>
            </span>
          );
        })}
        <CropAdder exclude={row.crops} autoOpen={fresh && row.crops.length === 0} onAdd={(id) => onChange({ ...row, crops: [...row.crops, id] })} />
      </div>
      {row.crops.length > 1 && <p className="t-caption -mt-1">{t('season.intercrop', { n: row.crops.length })}</p>}

      <label className="flex items-center gap-2 text-xs text-ink-2">
        <span className="shrink-0">{t('season.sowing')}</span>
        <Input
          type="date"
          aria-label={sowLabel}
          value={row.sowingDate ?? ''}
          onChange={(e) => {
            const v = (e.target.value || undefined) as ISODate | undefined;
            // A sowing date outside the season moves the season to start in that month.
            const m = v ? Number(v.slice(5, 7)) : NaN;
            const len = monthsOf(row.start, row.end).length;
            const shift = v && !monthsOf(row.start, row.end).includes(m) && len < 12;
            onChange({ ...row, sowingDate: v, ...(shift ? { start: m, end: ((m + len - 2) % 12) + 1 } : {}) });
          }}
          className="w-[10.5rem]"
        />
        {!row.sowingDate && <span className="t-caption">{t('season.sowingHint')}</span>}
      </label>
    </div>
  );
}

export function SeasonPlanner() {
  const t = useT();
  const parcelId = useMission((s) => s.parcel?.id);
  const setCropPlan = useMission((s) => s.setCropPlan);
  const { rows: stored, month, tropical } = useSeasonRows();
  const [rows, setRows] = useState<SeasonRow[]>(stored);
  const [fresh, setFresh] = useState<number | null>(null);
  const storedKey = `${parcelId}|${JSON.stringify(stored)}`;
  const lastKey = useRef(storedKey);

  // A different field, a reset or the advisory changing the rotation replaces what is shown.
  useEffect(() => {
    if (storedKey !== lastKey.current) {
      lastKey.current = storedKey;
      setRows(stored);
    }
  }, [storedKey, stored]);

  const commit = (next: SeasonRow[]) => {
    setRows(next);
    const rot = rotationFromRows(next);
    const ai = activeRow(next, month);
    const main = ai >= 0 ? next[ai].crops[0] : (rot[0]?.cropId ?? null);
    const sowingDate = ai >= 0 ? next[ai].sowingDate : undefined;
    const keptRows = next.filter((r) => r.crops.length > 0);
    lastKey.current = `${parcelId}|${JSON.stringify(keptRows.length ? rowsFromRotation(rot, { month }) : [])}`;
    setCropPlan(main, { currentRotation: rot.length ? rot : undefined, sowingDate });
  };

  const years = rowYears(rows);
  const active = activeRow(rows, month);
  const add = (start: number, end: number) => {
    setFresh(rows.length);
    setRows([...rows, { start, end, crops: [] }]);
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="season-title">
      <div>
        <h3 id="season-title" className="t-heading">
          {t('season.title')}
        </h3>
        <p className="t-caption">{t('season.lede')}</p>
      </div>

      {rows.length === 0 && <p className="t-caption text-ink-2">{t('season.empty')}</p>}
      {rows.length > 0 && (
        <ol className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <SeasonCard
              key={i}
              row={r}
              index={i}
              year={years[i]}
              active={i === active}
              tropical={tropical}
              fresh={fresh === i}
              onChange={(nr) => commit(rows.map((x, j) => (j === i ? nr : x)))}
              onRemove={() => commit(rows.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="t-label mr-1">{t('season.add')}</span>
        {presets(tropical).map((p) => (
          <button key={p.name} type="button" onClick={() => add(p.start, p.end)} className="inline-flex h-7 items-center gap-1 rounded-full border border-line-2 px-2.5 text-xs text-ink-1 hover:border-signal hover:text-signal-strong">
            <Plus size={12} aria-hidden />
            {t(`season.name.${p.name}`, { n: rows.length + 1 })}
          </button>
        ))}
        <button type="button" onClick={() => add(month, ((month + 2) % 12) + 1)} className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line-2 px-2.5 text-xs text-ink-2 hover:border-signal hover:text-signal-strong">
          <Plus size={12} aria-hidden />
          {t('season.custom')}
        </button>
      </div>
    </section>
  );
}
