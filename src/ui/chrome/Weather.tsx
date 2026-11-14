/** The latest weather reading of the open field, as plain white text over the imagery. */
import { CloudSun, Wind } from 'lucide-react';
import { useT } from '@/i18n';
import { findSeries } from '@/lib/series';
import { useMission } from '@/state/mission';
import { cn } from '@/ui/design';
import { fmtNum } from '@/ui/hud/format';
import './strings';

export interface WeatherNow {
  tmax: number | null;
  rain: number | null;
  wind: number | null;
}

/** The latest daily values at or before today from the field's own telemetry; null before it loads. */
export function useWeatherNow(): WeatherNow | null {
  const tel = useMission((s) => s.telemetry);
  if (!tel) return null;
  const last = (key: string, b: 'agromet' | 'rainfall') => findSeries(tel.branches[b], key)?.samples.filter((v) => v.t <= tel.window.today && v.v != null).at(-1)?.v ?? null;
  return { tmax: last('t2m_max', 'agromet'), rain: last('rain', 'rainfall'), wind: last('wind', 'agromet') };
}

/** Weather for the locked field, white text straight on the map. Hidden until there is a reading. */
export function WeatherChip({ className }: { className?: string }) {
  const t = useT();
  const w = useWeatherNow();
  if (!w || w.tmax == null) return null;
  return (
    <div title={t('field.weather')} className={cn('t-value flex h-8 shrink-0 items-center gap-3 px-2 text-base font-normal whitespace-nowrap text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]', className)}>
      <span className="inline-flex items-center gap-1.5">
        <CloudSun size={18} strokeWidth={1.5} aria-hidden />
        {fmtNum(w.tmax, 0)}°
      </span>
      {w.wind != null && (
        <span className="inline-flex items-center gap-1.5">
          <Wind size={16} strokeWidth={1.5} aria-hidden />
          {fmtNum(w.wind, 0)} m/s
        </span>
      )}
      <span className="sr-only">{t('field.weather')}</span>
    </div>
  );
}
