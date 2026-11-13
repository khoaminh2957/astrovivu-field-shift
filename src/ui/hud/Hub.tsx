import { useEffect, useMemo, useRef } from 'react';
import { pick } from '@/contracts';
import { listCrops } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { scoreAt } from '@/lib/series';
import { useMission } from '@/state/mission';
import { HubGauge, Select } from '@/ui/design';
import { cropName } from './format';
import { useMissionUi, useTimeMoving } from '@/ui/chrome/uiState';
import './strings';

/** Productivity at the cursor date, compatibility when a crop is set, and what limits the score. */
function HubReading({ size }: { size?: number }) {
  const t = useT();
  const lang = useLang();
  const score = useMission((s) => s.score);
  const cursor = useMission((s) => s.timeline.cursor);
  const cropId = useMission((s) => s.cropId);
  const mode = useMission((s) => s.telemetry?.mode);
  const anyReady = useMission((s) => Object.values(s.branchStatus).some((x) => x === 'ready'));
  const instant = useTimeMoving();
  const openOverride = useMissionUi((s) => s.setOverrideOpen);
  const snap = scoreAt(score, cursor);
  const limiting = snap?.limiting ? snap.factors.find((f) => f.key === snap.limiting) : null;
  return (
    <HubGauge
      value={snap?.productivity ?? null}
      label={t('hud.hub.label')}
      secondary={cropId ? (snap?.compatibility ?? null) : (snap?.condition ?? null)}
      secondaryLabel={cropId ? t('hud.hub.compat') : t('hud.hub.condition')}
      limiting={limiting ? pick(limiting.label, lang) : undefined}
      size={size}
      instant={instant}
      simulated={mode === 'mock'}
      loading={!snap && !anyReady}
      onSelect={() => openOverride(true)}
    />
  );
}

/** Quick crop chooser under the hub while no crop is set; the full search lives in the override panel. */
function QuickCrop() {
  const t = useT();
  const lang = useLang();
  const setCrop = useMission((s) => s.setCrop);
  const options = useMemo(() => listCrops().map((c) => ({ value: c.id, label: cropName(c.names, lang), hint: c.scientificName })), [lang]);
  return (
    <div className="plate flex w-56 flex-col gap-1.5 p-2">
      <p className="t-caption">{t('hud.hub.noCrop')}</p>
      <Select ariaLabel={t('hud.hub.cropLabel')} options={options} value={undefined} onValueChange={(v) => setCrop(v)} placeholder={t('hud.hub.pickCrop')} />
    </div>
  );
}

/**
 * Center Productivity Hub, pinned to the parcel centre the globe publishes. The position is
 * written straight to the element's transform on every camera frame; React only renders when the
 * reading changes.
 */
export function Hub({ stacked }: { stacked?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cropId = useMission((s) => s.cropId);

  useEffect(() => {
    if (stacked) return;
    const place = (a: ReturnType<typeof useMission.getState>['anchor']) => {
      const el = ref.current;
      if (!el) return;
      if (!a || !a.visible) {
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px) translate(-50%, -50%)`;
    };
    place(useMission.getState().anchor);
    return useMission.subscribe((s, prev) => {
      if (s.anchor !== prev.anchor) place(s.anchor);
    });
  }, [stacked]);

  if (stacked) {
    return (
      <div className="flex flex-col items-center gap-10 py-3">
        <HubReading />
        {!cropId && <QuickCrop />}
      </div>
    );
  }

  return (
    <div ref={ref} className="pointer-events-none absolute top-0 left-0 z-(--z-hud)" style={{ visibility: 'hidden' }}>
      <div className="pointer-events-auto relative">
        <HubReading />
        {!cropId && (
          // Below the limiting-factor tag, so the chooser never covers the score.
          <div className="absolute top-full left-1/2 mt-11 -translate-x-1/2">
            <QuickCrop />
          </div>
        )}
      </div>
    </div>
  );
}
