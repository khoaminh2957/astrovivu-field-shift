/** One recommended plant as a card that opens its care guide. The top three are drawn stronger. */
import { Droplets, Sun, Timer } from 'lucide-react';
import type { UrbanRecommendation } from '@/contracts';
import { pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { cn } from '@/ui/design';
import { fmtNum } from '@/ui/advisory/format';
import { CropPhoto } from './CropPhoto';
import { Difficulty, IconLine, MonthDots, ScoreRing, SowStatus } from './parts';
import './strings';

export function PlantCard({ rec, month, rank, onOpen }: { rec: UrbanRecommendation; month: number; /** 1-3 for the top picks. */ rank?: number; onOpen: () => void }) {
  const t = useT();
  const lang = useLang();
  const name = pick(rec.name, lang);
  const sci = getCrop(rec.cropId)?.scientificName;
  const top = rank != null;
  // Spans only: the whole card is one button, and a button may hold phrasing content only.
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn(
        'workspace-urban-card flex w-full min-w-0 flex-col gap-3 rounded-sm border bg-surface-0 p-3 text-left transition-colors duration-(--dur-instant) hover:bg-surface-2',
        top ? 'border-line-3 shadow-md' : 'border-line-2',
      )}
    >
      <span className="flex min-w-0 gap-3">
        <CropPhoto cropId={rec.cropId} name={name} size={top ? 'md' : 'sm'} />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          {top && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-signal-strong">
              <span className="t-value inline-flex size-4.5 items-center justify-center rounded-full bg-signal text-2xs leading-none font-semibold text-on-signal">{rank}</span>
              {t('urban.topPick')}
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="workspace-card-title">{name}</span>
            {sci && <span className="workspace-caption truncate italic">{sci}</span>}
          </span>
          <span className="flex items-center gap-2">
            <ScoreRing score={rec.score} size={top ? 40 : 36} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="t-label">{t('urban.match')}</span>
              <Difficulty level={rec.difficulty} />
            </span>
          </span>
          <span className="flex min-h-5 items-center">
            <SowStatus rec={rec} month={month} />
          </span>
        </span>
      </span>
      {top && rec.why[0] && <span className="workspace-copy line-clamp-2">{pick(rec.why[0], lang)}</span>}
      <span className="flex flex-col gap-1.5">
        <IconLine icon={<Droplets />} label={t('urban.care.water')} clamp>
          {pick(rec.care.water, lang)}
        </IconLine>
        <IconLine icon={<Sun />} label={t('urban.care.light')} clamp>
          {pick(rec.care.light, lang)}
        </IconLine>
      </span>
      <MonthDots rec={rec} month={month} />
      <span className="flex items-center gap-2 text-sm text-ink-2">
        <Timer aria-hidden size={16} strokeWidth={1.5} className="shrink-0 text-ink-3" />
        <span>
          {t('urban.care.harvest')}{' '}
          <span className="t-value text-ink-1">
            {fmtNum(rec.care.harvestDays[0], lang)} – {fmtNum(rec.care.harvestDays[1], lang)}
          </span>{' '}
          <span className="t-unit">{t('urban.days')}</span>
        </span>
      </span>
    </button>
  );
}
