/**
 * Top bar: brand, the locked field and how to change it, the mission views, the Urban Grower
 * Companion, ground truth and the language. Height `--topbar-h`; every other region starts under it.
 */
import { ArrowLeft, ClipboardPen, Sprout } from 'lucide-react';
import type { Lang } from '@/contracts';
import { useT } from '@/i18n';
import { type Phase, useMission } from '@/state/mission';
import { Button, Segmented, Tabs, Tag, Wordmark, cn, useHudDensity } from '@/ui/design';
import { countOverrides } from '@/ui/override';
import { fmtNum } from '@/ui/hud/format';
import { useMissionUi } from './uiState';
import './strings';

type View = 'locked' | 'advisory' | 'tracking';
const VIEWS: View[] = ['locked', 'advisory', 'tracking'];
const VIEW_KEY: Record<View, string> = { locked: 'nav.field', advisory: 'nav.advisory', tracking: 'nav.tracking' };

export function TopBar() {
  const t = useT();
  const density = useHudDensity();
  const phase = useMission((s) => s.phase);
  const parcel = useMission((s) => s.parcel);
  const lang = useMission((s) => s.lang);
  const gtCount = useMission((s) => countOverrides(s.groundTruth));
  const setPhase = useMission((s) => s.setPhase);
  const setLang = useMission((s) => s.setLang);
  const unlockParcel = useMission((s) => s.unlockParcel);
  const overrideOpen = useMissionUi((s) => s.overrideOpen);
  const setOverrideOpen = useMissionUi((s) => s.setOverrideOpen);
  if (phase === 'hero') return null;

  const inView = (VIEWS as Phase[]).includes(phase);
  const compactBar = density !== 'regular';

  const toUrban = () => {
    setOverrideOpen(false);
    setPhase(phase === 'urban' ? (parcel ? 'locked' : 'explore') : 'urban');
  };

  return (
    <header className="absolute inset-x-0 top-0 z-(--z-chrome) flex h-(--topbar-h) items-center gap-3 border-b border-line-1 bg-surface-0/94 px-(--panel-pad) shadow-md">
      <button
        type="button"
        aria-label={t('chrome.home')}
        onClick={() => {
          setOverrideOpen(false);
          if (parcel) unlockParcel();
          else setPhase('explore');
        }}
        className="flex shrink-0 items-center rounded-xs py-1"
      >
        <Wordmark size="sm" />
      </button>

      {parcel && phase !== 'urban' && (
        <div className="flex min-w-0 items-center gap-2 border-l border-line-1 pl-3">
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium text-ink-1 [font-stretch:var(--stretch-semi)]" title={parcel.name}>
              {parcel.name}
            </span>
            <span className="t-meta truncate">
              {[parcel.place?.label, t('chrome.area', { a: fmtNum(parcel.areaHa, parcel.areaHa < 10 ? 1 : 0) })].filter(Boolean).join(' · ')}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => (setOverrideOpen(false), unlockParcel())}>
            {t('chrome.change')}
          </Button>
        </div>
      )}

      {parcel && inView && (
        <Tabs<View>
          ariaLabel={t('chrome.nav.label')}
          className={cn('-mb-px self-end', compactBar ? 'ml-1' : 'ml-4')}
          value={phase as View}
          onValueChange={(v) => {
            if (v !== 'locked') setOverrideOpen(false);
            setPhase(v);
          }}
          tabs={VIEWS.map((v) => ({ value: v, label: t(`chrome.${VIEW_KEY[v]}`) }))}
        />
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {phase === 'locked' && (
          <Button size="sm" variant={overrideOpen ? 'primary' : 'secondary'} icon={<ClipboardPen />} aria-pressed={overrideOpen} onClick={() => setOverrideOpen(!overrideOpen)}>
            {t('chrome.groundTruth')}
            {gtCount > 0 && (
              <Tag size="sm" tone="ground-truth" variant={overrideOpen ? 'outline' : 'solid'} aria-label={t('chrome.groundTruthCount', { n: gtCount })} className="ml-1">
                {gtCount}
              </Tag>
            )}
          </Button>
        )}
        <Button size="sm" variant={phase === 'urban' ? 'secondary' : 'ghost'} icon={phase === 'urban' ? <ArrowLeft /> : <Sprout />} onClick={toUrban}>
          {phase === 'urban' ? (parcel ? t('chrome.urbanBack') : t('chrome.urbanBackExplore')) : t('chrome.urban')}
        </Button>
        <Segmented<Lang>
          ariaLabel={t('chrome.lang')}
          size="sm"
          value={lang}
          onValueChange={setLang}
          options={[
            { value: 'en', label: 'EN', ariaLabel: 'English' },
            { value: 'vi', label: 'VI', ariaLabel: 'Tiếng Việt' },
          ]}
        />
      </div>
    </header>
  );
}
