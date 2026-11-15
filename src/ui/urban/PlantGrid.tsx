/** The recommendations as picture cards: the top three first and stronger, then the rest, then the photo credit. */
import type { UrbanRecommendation } from '@/contracts';
import { ECOCROP_TERMS_URL } from '@/core/urban';
import { useT } from '@/i18n';
import { hasEcoCropPhoto, useCropImages } from './CropPhoto';
import { PlantCard } from './PlantCard';
import './strings';

/** Columns follow the width of the list itself, not the window: the list is narrow beside the side column. */
const GRID = 'grid gap-3 @[520px]:grid-cols-2 @[720px]:grid-cols-3';

export function PlantGrid({ recs, month, onOpen }: { recs: UrbanRecommendation[]; month: number; onOpen: (cropId: string) => void }) {
  const t = useT();
  const images = useCropImages();
  const top = recs.slice(0, 3);
  const rest = recs.slice(3);
  const anyEcoCropPhoto = recs.some((r) => hasEcoCropPhoto(images, r.cropId));
  return (
    <div className="@container flex flex-col gap-4">
      <ul className={`m-0 list-none p-0 ${GRID}`}>
        {top.map((r, i) => (
          <li key={r.cropId} className="flex min-w-0">
            <PlantCard rec={r} month={month} rank={i + 1} onOpen={() => onOpen(r.cropId)} />
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <>
          <h3 className="t-heading text-ink-2">{t('urban.more')}</h3>
          <ul className={`m-0 list-none p-0 ${GRID}`}>
            {rest.map((r) => (
              <li key={r.cropId} className="flex min-w-0">
                <PlantCard rec={r} month={month} onOpen={() => onOpen(r.cropId)} />
              </li>
            ))}
          </ul>
        </>
      )}
      {anyEcoCropPhoto && (
        <p className="t-caption">
          {t('urban.photosCredit')}{' '}
          <a href={ECOCROP_TERMS_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-ink-2 underline">
            {t('urban.photosTerms')}
            <span className="sr-only"> ({t('urban.newTab')})</span>
          </a>
        </p>
      )}
    </div>
  );
}
