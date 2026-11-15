/**
 * The weather of the field inside the overview: the latest readings, the days ahead, the forecast
 * warnings. It replaces the separate Weather page of the rail: weather is part of how the field is.
 * The history of the week is one press away; the year of weather is in the data tab and the dossier.
 */
import { useState } from 'react';
import { CloudRain, Thermometer, Wind } from 'lucide-react';
import { METRICS, type FieldTelemetry, type MetricKey, pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { WEATHER_FORECAST, WEATHER_HISTORY, latestWeather, weatherDays, weatherSeries } from '@/ui/chrome/workspaceWeather';
import '@/ui/chrome/workspaceStrings';
import { Segmented } from '@/ui/design';
import { fmtDate } from '@/ui/hud/format';

const LABEL: Record<(typeof WEATHER_HISTORY | typeof WEATHER_FORECAST)[number], string> = {
  t2m_max: 'maxTemperature',
  t2m_min: 'minTemperature',
  rain: 'rain',
  wind: 'wind',
  fc_tmax: 'maxTemperature',
  fc_tmin: 'minTemperature',
  fc_rain: 'rain',
};
const ICON = [Thermometer, Thermometer, CloudRain, Wind] as const;

function useNumber() {
  const lang = useLang();
  const f = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 1 });
  return (v: number | null | undefined) => (v == null ? '—' : f.format(v));
}

function Latest({ telemetry }: { telemetry: FieldTelemetry }) {
  const t = useT();
  const lang = useLang();
  const num = useNumber();
  return (
    <dl className="workspace-weather-readings">
      {WEATHER_HISTORY.map((key, i) => {
        const Icon = ICON[i];
        const r = latestWeather(telemetry, key);
        return (
          <div key={key} className="workspace-summary-card">
            <dt>
              <Icon size={18} aria-hidden />
              {t(`workspace.${LABEL[key]}`)}
            </dt>
            <dd>
              {num(r?.value)} {r && <small>{r.unit}</small>}
            </dd>
            {r && (
              <dd className="workspace-weather-reading-meta">
                <p>
                  {fmtDate(r.date, lang)}
                  {r.stale && ` · ${t('workspace.stale')}`}
                </p>
                {r.source && (
                  <a className="workspace-weather-reading-source" href={r.source.url} target="_blank" rel="noreferrer">
                    {r.source.agency}
                  </a>
                )}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}

function Days({ telemetry, forecast }: { telemetry: FieldTelemetry; forecast: boolean }) {
  const t = useT();
  const lang = useLang();
  const num = useNumber();
  const keys = forecast ? WEATHER_FORECAST : WEATHER_HISTORY;
  const days = weatherDays(telemetry, forecast);
  const sources = [...new Set(keys.map((k: MetricKey) => weatherSeries(telemetry, k)?.sourceId))].flatMap((id) => (id && telemetry.sources[id] ? [telemetry.sources[id]] : []));
  if (!days.length) return <p className="t-caption">{t('workspace.noWeather')}</p>;
  return (
    <>
      <table className="workspace-weather-table">
        <caption className="sr-only">{t(forecast ? 'workspace.forecast' : 'workspace.history')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('workspace.date')}</th>
            {keys.map((k) => (
              <th scope="col" key={k}>
                {t(`workspace.${LABEL[k]}`)}
                <small>{weatherSeries(telemetry, k)?.unit ?? METRICS[k].unit}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map(([date, row]) => (
            <tr key={date}>
              <th scope="row">{fmtDate(date, lang, false)}</th>
              {keys.map((k) => (
                <td key={k}>{num(row[k])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!!sources.length && (
        <div className="workspace-weather-sources">
          {t('workspace.sources')}{' '}
          {sources.map((s) => (
            <a key={s.id} href={s.url} target="_blank" rel="noreferrer">
              {s.name}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

export function FieldWeather({ workspace }: { workspace: boolean }) {
  const t = useT();
  const lang = useLang();
  const telemetry = useMission((s) => s.telemetry);
  const [mode, setMode] = useState<'forecast' | 'history'>('forecast');
  if (!telemetry) return null;
  const risks = (telemetry.branches.risk.events ?? []).filter((e) => e.end >= telemetry.window.today && e.severity > 0);
  return (
    <section aria-labelledby="field-weather" className="flex flex-col gap-3" data-field-weather>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="field-weather" className={workspace ? 'workspace-section-title' : 'text-lg font-medium text-ink-1'}>
          {t('workspace.latestWeather')}
        </h2>
        <Segmented
          size="sm"
          ariaLabel={t('workspace.latestWeather')}
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'forecast', label: t('workspace.forecast') },
            { value: 'history', label: t('workspace.history') },
          ]}
        />
      </div>
      {telemetry.mode === 'mock' && <p className="t-caption">{t('workspace.simulated')}</p>}
      <Latest telemetry={telemetry} />
      {risks.length > 0 && (
        <div className="workspace-summary-card workspace-weather-events">
          <h3 className="text-base font-semibold text-ink-1">{t('workspace.forecastRisks')}</h3>
          <ul>
            {risks.slice(0, 4).map((e) => (
              <li key={e.id}>
                <strong>{pick(e.title, lang)}</strong> · {fmtDate(e.start, lang, false)}
                {e.end !== e.start && ` – ${fmtDate(e.end, lang, false)}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Days telemetry={telemetry} forecast={mode === 'forecast'} />
    </section>
  );
}
