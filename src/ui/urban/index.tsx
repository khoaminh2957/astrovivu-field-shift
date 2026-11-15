/**
 * Urban Grower Companion (side mission). Three steps a person with a balcony can read at a glance:
 * your spot (place, light, space, wishes), your climate (twelve months), what grows here (picture
 * cards that open a care guide). Phone first.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Blinds, Building2, CalendarClock, Carrot, Cherry, Cloud, CloudSun, Fence, Flower2, Leaf, MapPin, Sprout, Sun, Trees, Umbrella } from 'lucide-react';
import type { UrbanClimate, UrbanPreference, UrbanRecommendation, UrbanSite } from '@/contracts';
import { recommendUrban, recommendUrbanAhead } from '@/core/urban';
import { loadUrbanClimate } from '@/data';
import { useLang, useT } from '@/i18n';
import { todayISO } from '@/lib/time';
import { useMission } from '@/state/mission';
import { Button, EmptyState, Panel, Skeleton } from '@/ui/design';
import { useFixture } from '@/ui/advisory/fixture';
import { monthLong } from '@/ui/advisory/format';
import { FixtureTag } from '@/ui/advisory/shared';
import { ChoiceChips, ChoiceTiles } from './ChoiceTiles';
import { ClimateStrip, climateSources, type ClimateState } from './ClimateStrip';
import { LocationPicker, type Loc } from './LocationPicker';
import { PlantDetail } from './PlantDetail';
import { PlantGrid } from './PlantGrid';
import './strings';

const LIGHTS = [
  { value: 'full', icon: <Sun /> },
  { value: 'partial', icon: <CloudSun /> },
  { value: 'shade', icon: <Cloud /> },
] as const;
const SPACES = [
  { value: 'windowsill', icon: <Blinds /> },
  { value: 'balcony', icon: <Fence /> },
  { value: 'rooftop', icon: <Building2 /> },
  { value: 'yard', icon: <Trees /> },
] as const;
const PREFS = [
  { value: 'vegetables', icon: <Carrot /> },
  { value: 'herbs', icon: <Leaf /> },
  { value: 'flowers', icon: <Flower2 /> },
  { value: 'shade-easy', icon: <Umbrella /> },
  { value: 'fruit', icon: <Cherry /> },
] as const satisfies readonly { value: UrbanPreference; icon: ReactNode }[];

export function UrbanCompanion({ active = true }: { active?: boolean }) {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const setPhase = useMission((s) => s.setPhase);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [climate, setClimate] = useState<UrbanClimate | null>(null);
  const [climateState, setClimateState] = useState<ClimateState>('idle');
  const [light, setLight] = useState<UrbanSite['light']>('partial');
  const [space, setSpace] = useState<UrbanSite['space']>('balcony');
  const [prefs, setPrefs] = useState<UrbanPreference[]>(['vegetables', 'herbs']);
  const [openId, setOpenId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const fixture = useFixture(import.meta.env.DEV ? () => import('./__fixtures__/urban').then((m) => m.URBAN_FIXTURE) : null);
  const month = Number(todayISO().slice(5, 7));

  useEffect(() => {
    if (!loc) return;
    let alive = true;
    setClimate(null);
    setClimateState('loading');
    loadUrbanClimate(loc.at).then(
      (c) => alive && (setClimate(c), setClimateState('idle')),
      () => alive && setClimateState('error'),
    );
    return () => {
      alive = false;
    };
  }, [loc]);

  // Picks for this month; when there are none (a temperate winter), the picks of the month sowing opens.
  const { recs, aheadMonth } = useMemo((): { recs: UrbanRecommendation[]; aheadMonth: number | null } => {
    if (fixture) return { recs: fixture, aheadMonth: null };
    if (!loc || !climate) return { recs: [], aheadMonth: null };
    const site: UrbanSite = { location: loc.at, light, space, place: { label: loc.label } };
    const now = recommendUrban(site, climate, prefs, month);
    if (now.length) return { recs: now, aheadMonth: null };
    const ahead = recommendUrbanAhead(site, climate, prefs, month);
    return ahead ? { recs: ahead.picks, aheadMonth: ahead.month } : { recs: [], aheadMonth: null };
  }, [fixture, loc, climate, light, space, prefs, month]);
  // Vietnamese month names are sentence-initial ("Tháng 3"); inside a sentence they are lower case.
  const monthName = (m: number) => (lang === 'vi' ? monthLong(m, lang).toLocaleLowerCase('vi') : monthLong(m, lang));
  const open = recs.find((r) => r.cropId === openId) ?? null;
  const fieldLocationSelected = parcel && loc && loc.at[0] === parcel.centroid[0] && loc.at[1] === parcel.centroid[1];

  const openGuide = (cropId: string) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpenId(cropId);
  };
  const closeGuide = () => {
    setOpenId(null);
    // The sheet has no trigger element of its own, so focus is handed back to the card by hand.
    const el = opener.current;
    window.setTimeout(() => el?.isConnected && el.focus(), 0);
  };

  return (
    <main aria-labelledby="urb-title" className="workspace-theme urban-workspace absolute inset-0 overflow-x-hidden overflow-y-auto">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 pt-4 pb-24 lg:px-6 lg:pt-5">
        <header className="flex flex-col gap-1">
          {parcel && <button type="button" className="rotation-back mb-2 self-start" onClick={() => setPhase('locked')}><ArrowLeft size={16} aria-hidden />{t('urban.backToField')}</button>}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 id="urb-title" className="workspace-page-title">
              {t('urban.title')}
            </h1>
            {fixture && <FixtureTag />}
          </div>
          <p className="workspace-copy max-w-[68ch]">{t('urban.lead')}</p>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Panel title={t('urban.spot')} className="workspace-urban-card">
              <div className="flex flex-col gap-5">
                <LocationPicker loc={loc} onPick={setLoc} />
                {parcel && !fieldLocationSelected && (
                  <Button icon={<MapPin />} variant="secondary" onClick={() => setLoc({ at: parcel.centroid, label: parcel.place?.label ?? parcel.name })}>
                    {t('urban.useFieldLocation')}
                  </Button>
                )}
                <ChoiceTiles
                  legend={t('urban.light')}
                  name="urb-light"
                  value={light}
                  onChange={setLight}
                  className="grid-cols-3"
                  options={LIGHTS.map((o) => ({ ...o, label: t(`urban.light.${o.value}`), hint: t(`urban.light.${o.value}.hint`) }))}
                />
                <ChoiceTiles
                  legend={t('urban.space')}
                  name="urb-space"
                  value={space}
                  onChange={setSpace}
                  className="grid-cols-2 min-[400px]:grid-cols-4"
                  options={SPACES.map((o) => ({ ...o, label: t(`urban.space.${o.value}`), hint: t(`urban.space.${o.value}.hint`) }))}
                />
                <ChoiceChips
                  legend={t('urban.prefs')}
                  hint={t('urban.prefsHint')}
                  values={prefs}
                  onToggle={(p) => setPrefs((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]))}
                  options={PREFS.map((o) => ({ ...o, label: t(`urban.pref.${o.value}`) }))}
                />
              </div>
            </Panel>
            <Panel title={t('urban.climate')} meta={climateSources(climate)} className="workspace-urban-card">
              {loc ? <ClimateStrip climate={climate} state={climateState} month={month} /> : <p className="workspace-copy">{t('urban.climateNeedsPlace')}</p>}
            </Panel>
          </div>

          <section aria-labelledby="urb-picks" className="flex min-w-0 flex-col gap-3">
            <h2 id="urb-picks" className="workspace-section-title flex flex-wrap items-baseline gap-x-2">
              {t('urban.picks')}
              {recs.length > 0 && <span className="t-meta">{recs.length}</span>}
              {recs.length > 0 && loc && !fixture && <span className="workspace-caption font-normal">{t('urban.picksFor', { place: loc.label })}</span>}
            </h2>
            {aheadMonth != null && (
              <p role="status" className="flex items-start gap-2.5 rounded-sm border border-line-2 bg-surface-2 p-3">
                <CalendarClock aria-hidden size={20} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-2" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="workspace-card-title">{t('urban.aheadTitle', { now: monthName(month) })}</span>
                  <span className="workspace-copy">{t('urban.aheadBody', { month: monthName(aheadMonth) })}</span>
                </span>
              </p>
            )}
            {recs.length > 0 ? (
              <PlantGrid recs={recs} month={month} onOpen={openGuide} />
            ) : !loc && !fixture ? (
              <EmptyState icon={<Sprout />} title={t('urban.noLoc')} body={t('urban.noLocBody')} />
            ) : climateState === 'loading' ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-busy="true">
                <Skeleton className="h-72" />
                <Skeleton className="h-72" />
                <Skeleton className="h-72" />
              </div>
            ) : (
              <EmptyState icon={<Sprout />} title={t('urban.noPicks')} body={t(climateState === 'error' ? 'urban.noClimateBody' : 'urban.noPicksBody')} />
            )}
          </section>
        </div>
      </div>
      <PlantDetail rec={active ? open : null} month={month} onClose={closeGuide} />
    </main>
  );
}
