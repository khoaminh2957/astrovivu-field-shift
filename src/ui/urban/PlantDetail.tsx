/**
 * Care guide of one recommended plant, in a modal sheet (right edge, or bottom on narrow screens):
 * the photograph with its credit and the link to the species on FAO EcoCrop, why it fits, care,
 * and the year month by month starting now. Focus is trapped; Escape closes it.
 */
import type { ReactNode } from 'react';
import { Droplets, ExternalLink, MessageCircleQuestion, Sun, Timer } from 'lucide-react';
import type { UrbanRecommendation } from '@/contracts';
import { pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { cropImage, ecocropPageUrl, sowLevels, yearFrom } from '@/core/urban';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { useNarrow } from '@/ui/chrome/uiState';
import { Button, Sheet, Tag, cn } from '@/ui/design';
import { fmtNum, monthLong } from '@/ui/advisory/format';
import { TextList } from '@/ui/advisory/shared';
import { CropPhoto, useCropImages } from './CropPhoto';
import { Difficulty, IconLine, MonthDots, MonthKey, ScoreRing, SowMark, SowStatus } from './parts';
import './strings';

export function PlantDetail({ rec, month, onClose }: { rec: UrbanRecommendation | null; month: number; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const narrow = useNarrow();
  const images = useCropImages();
  const setAskOpen = useMission((s) => s.setAskOpen);
  if (!rec) return null;
  const name = pick(rec.name, lang);
  const crop = getCrop(rec.cropId);
  const hasPhoto = cropImage(images, crop?.ecocropId) != null;
  const levels = sowLevels(rec.care.sowMonths, rec.care.sowFit);
  const steps = yearFrom(rec.calendar, month);

  const askAssistant = () => {
    onClose();
    // After the sheet has handed focus back, so the assistant's input keeps it.
    window.setTimeout(() => setAskOpen(true), 0);
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      modal
      side={narrow ? 'bottom' : 'right'}
      width="460px"
      className={narrow ? undefined : 'top-0'}
      title={name}
      description={crop ? <span className="italic">{crop.scientificName}</span> : undefined}
      footer={
        <div className="flex w-full flex-col gap-1.5">
          <Button variant="secondary" size="lg" icon={<MessageCircleQuestion />} onClick={askAssistant} block>
            {t('urban.ask')}
          </Button>
          <p className="t-caption">{t('urban.askHint', { name })}</p>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex gap-4">
          <figure className="m-0 flex shrink-0 flex-col gap-1">
            <CropPhoto cropId={rec.cropId} name={name} size="lg" />
            {hasPhoto && <figcaption className="t-meta">{t('urban.photoCredit')}</figcaption>}
          </figure>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-3">
              <ScoreRing score={rec.score} size={52} />
              <div className="flex flex-col gap-0.5">
                <span className="t-label">{t('urban.match')}</span>
                <Difficulty level={rec.difficulty} />
              </div>
            </div>
            <div className="flex">
              <SowStatus rec={rec} month={month} />
            </div>
            <span className="flex items-start gap-2 text-sm text-ink-2">
              <Timer aria-hidden size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-3" />
              <span>
                {t('urban.care.harvest')}{' '}
                <span className="t-value text-ink-1">
                  {fmtNum(rec.care.harvestDays[0], lang)} – {fmtNum(rec.care.harvestDays[1], lang)}
                </span>{' '}
                <span className="t-unit">{t('urban.days')}</span>
              </span>
            </span>
            {crop?.ecocropId != null && (
              <a href={ecocropPageUrl(crop.ecocropId)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex items-start gap-1.5 text-sm text-signal-strong underline">
                <ExternalLink aria-hidden size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                <span>
                  {t('urban.ecocropLink')}
                  <span className="sr-only"> ({t('urban.newTab')})</span>
                </span>
              </a>
            )}
          </div>
        </div>

        <Block title={t('urban.why')}>
          <TextList items={rec.why} className="text-ink-1" />
        </Block>

        <Block title={t('urban.care')}>
          <div className="flex flex-col gap-2">
            <IconLine icon={<Droplets />} label={t('urban.care.water')}>
              {pick(rec.care.water, lang)}
            </IconLine>
            <IconLine icon={<Sun />} label={t('urban.care.light')}>
              {pick(rec.care.light, lang)}
            </IconLine>
          </div>
          {rec.care.tips.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              <h4 className="t-label">{t('urban.tips')}</h4>
              <TextList items={rec.care.tips} glyph="info" />
            </div>
          )}
        </Block>

        <Block title={t('urban.care.sow')}>
          <div className="flex flex-col gap-2">
            <MonthDots rec={rec} month={month} />
            <MonthKey showMarginal={levels.includes('marginal')} />
          </div>
        </Block>

        {steps.some((s) => s.tasks.length) && (
          <Block title={t('urban.calendar')} sub={t('urban.calendarSub')}>
            <ol className="m-0 flex list-none flex-col p-0">
              {steps.map((s, i) => {
                const busy = s.tasks.length > 0;
                return (
                  <li key={s.month} className="grid grid-cols-[1rem_7.75rem_minmax(0,1fr)] gap-x-2">
                    {/* The rail of the timeline: a mark per month joined by a hairline. */}
                    <span aria-hidden className="relative flex justify-center">
                      {i < steps.length - 1 && <span className="absolute top-3 bottom-[-0.5rem] w-px bg-line-2" />}
                      <span className="relative mt-1 flex size-3 items-center justify-center rounded-full bg-surface-0">
                        <SowMark level={levels[s.month - 1]} />
                      </span>
                    </span>
                    <span className={cn('pb-2.5 text-sm whitespace-nowrap', busy || s.month === month ? 'font-medium text-ink-1' : 'text-ink-3')}>
                      {monthLong(s.month, lang)}
                      {s.month === month && (
                        <Tag className="ml-1.5" size="sm">
                          {t('urban.now')}
                        </Tag>
                      )}
                    </span>
                    <span className={cn('pb-2.5 text-sm', busy ? 'text-ink-1' : 'text-ink-3')}>{busy ? s.tasks.map((x) => pick(x, lang)).join(' · ') : t('urban.task.none')}</span>
                  </li>
                );
              })}
            </ol>
          </Block>
        )}
      </div>
    </Sheet>
  );
}

function Block({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line-1 pt-4">
      <div>
        <h3 className="t-heading">{title}</h3>
        {sub && <p className="t-caption">{sub}</p>}
      </div>
      {children}
    </section>
  );
}
