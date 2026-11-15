import { useState } from 'react';
import { ArrowRight, Building2, CloudRain, CloudSun, Map as MapIcon, RefreshCw, Thermometer, Wind } from 'lucide-react';
import { METRICS, pick, type FieldTelemetry, type MetricKey } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, EmptyState, Tabs, TabPanel } from '@/ui/design';
import { fmtDate } from '@/ui/hud/format';
import { latestWeather, weatherDays, weatherSeries, WEATHER_FORECAST, WEATHER_HISTORY } from './workspaceWeather';
import './workspaceStrings';

function useWeatherNumber() {
  const lang = useLang();
  const formatter = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 1 });
  return (value: number | null | undefined) => value == null ? '—' : formatter.format(value);
}

const WEATHER_LABELS: Record<(typeof WEATHER_HISTORY | typeof WEATHER_FORECAST)[number], string> = {
  t2m_max: 'maxTemperature',
  t2m_min: 'minTemperature',
  rain: 'rain',
  wind: 'wind',
  fc_tmax: 'maxTemperature',
  fc_tmin: 'minTemperature',
  fc_rain: 'rain',
};

const HISTORY_ICONS = [Thermometer, Thermometer, CloudRain, Wind] as const;

function LatestWeather({ telemetry }: { telemetry: FieldTelemetry }) {
  const t = useT();
  const lang = useLang();
  const number = useWeatherNumber();
  return (
    <dl className="workspace-weather-readings">
      {WEATHER_HISTORY.map((key, index) => {
        const Icon = HISTORY_ICONS[index];
        const reading = latestWeather(telemetry, key);
        return (
          <div key={key} className="workspace-summary-card">
            <dt><Icon size={18} aria-hidden />{t(`workspace.${WEATHER_LABELS[key]}`)}</dt>
            <dd>{number(reading?.value)} {reading && <small>{reading.unit}</small>}</dd>
            {reading && <dd className="workspace-weather-reading-meta">
              <p>{fmtDate(reading.date, lang)}{reading.stale && ` · ${t('workspace.stale')}`}</p>
              {reading.source && <a className="workspace-weather-reading-source" href={reading.source.url} target="_blank" rel="noreferrer">{reading.source.agency}</a>}
            </dd>}
          </div>
        );
      })}
    </dl>
  );
}

export function HomePage({ onField, onWeather, onRotation, onUrban }: {
  onField: () => void;
  onWeather: () => void;
  onRotation: () => void;
  onUrban: () => void;
}) {
  const t = useT();
  const parcel = useMission((s) => s.parcel);
  const telemetry = useMission((s) => s.telemetry);
  const number = useWeatherNumber();
  return (
    <main aria-labelledby="workspace-home-title" className="workspace-theme workspace-dashboard">
      <div className="workspace-page-inner">
        <header>
          <h1 id="workspace-home-title" className="workspace-page-title">{t('chrome.nav.home')}</h1>
          <p>{t('workspace.homeLead')}</p>
        </header>
        <section className="workspace-summary-card workspace-home-field" aria-labelledby="workspace-active-field">
          <MapIcon size={25} aria-hidden />
          <div>
            <h2 id="workspace-active-field">{parcel ? parcel.name : t('workspace.noField')}</h2>
            <p>{parcel ? [`${number(parcel.areaHa)} ha`, parcel.place?.label].filter(Boolean).join(' · ') : t('workspace.noFieldBody')}</p>
          </div>
          <Button onClick={onField} icon={<ArrowRight />}>{t(parcel ? 'workspace.openField' : 'workspace.findField')}</Button>
        </section>
        {parcel && telemetry && (
          <section aria-labelledby="workspace-home-weather" className="workspace-home-weather">
            <h2 id="workspace-home-weather" className="workspace-section-title">{t('workspace.latestWeather')}</h2>
            {telemetry.mode === 'mock' && <p>{t('workspace.simulated')}</p>}
            <LatestWeather telemetry={telemetry} />
          </section>
        )}
        <div className="workspace-shortcuts">
          <Button variant="secondary" icon={<CloudSun />} onClick={onWeather}>{t('chrome.nav.weather')}</Button>
          {parcel && <Button variant="secondary" icon={<RefreshCw />} onClick={onRotation}>{t('chrome.nav.advisory')}</Button>}
          <Button variant="secondary" icon={<Building2 />} onClick={onUrban}>{t('chrome.nav.urbanLong')}</Button>
        </div>
      </div>
    </main>
  );
}

type WeatherMode = 'forecast' | 'history';

function WeatherTable({ telemetry, forecast, loading }: { telemetry: FieldTelemetry; forecast: boolean; loading: boolean }) {
  const t = useT();
  const lang = useLang();
  const number = useWeatherNumber();
  const keys = forecast ? WEATHER_FORECAST : WEATHER_HISTORY;
  const days = weatherDays(telemetry, forecast);
  const sources = [...new Set(keys.map((key: MetricKey) => weatherSeries(telemetry, key)?.sourceId))]
    .flatMap((id) => id && telemetry.sources[id] ? [telemetry.sources[id]] : []);
  const events = forecast ? telemetry.branches.risk.events?.filter(({ end, severity }) => end >= telemetry.window.today && severity > 0) : undefined;
  if (!days.length) return <p role="status" className="workspace-summary-card">{t(loading ? 'workspace.loadingWeather' : 'workspace.noWeather')}</p>;
  return (
    <>
      <table className="workspace-weather-table">
        <caption className="sr-only">{t(forecast ? 'workspace.forecast' : 'workspace.history')}</caption>
        <thead><tr>
          <th scope="col">{t('workspace.date')}</th>
          {keys.map((key) => <th scope="col" key={key}>{t(`workspace.${WEATHER_LABELS[key]}`)}<small>{weatherSeries(telemetry, key)?.unit ?? METRICS[key].unit}</small></th>)}
        </tr></thead>
        <tbody>
          {days.map(([date, row]) => <tr key={date}>
            <th scope="row">{fmtDate(date, lang, false)}</th>
            {keys.map((key) => <td key={key}>{number(row[key])}</td>)}
          </tr>)}
        </tbody>
      </table>
      {!!events?.length && <section className="workspace-summary-card workspace-weather-events">
        <h2>{t('workspace.forecastRisks')}</h2>
        <ul>{events.map((event) => <li key={event.id}>
          <strong>{pick(event.title, lang)}</strong> · {fmtDate(event.start, lang, false)}
          {event.end !== event.start && ` – ${fmtDate(event.end, lang, false)}`}
          <p>{pick(event.detail, lang)}</p>
        </li>)}</ul>
      </section>}
      {!!sources.length && <div className="workspace-weather-sources">
        {t('workspace.sources')} {sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.name}</a>)}
      </div>}
    </>
  );
}

export function WeatherPage({ onField }: { onField: () => void }) {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const telemetry = useMission((s) => s.telemetry);
  const status = useMission((s) => s.branchStatus);
  const loadError = useMission((s) => s.loadError);
  const [mode, setMode] = useState<WeatherMode>('forecast');
  const forecastLoading = status.risk === 'loading';
  const historyLoading = status.agromet === 'loading' || status.rainfall === 'loading';
  return (
    <main aria-labelledby="workspace-weather-title" className="workspace-theme workspace-dashboard">
      <div className="workspace-page-inner">
        <header>
          <h1 id="workspace-weather-title" className="workspace-page-title">{t('chrome.nav.weather')}</h1>
          {parcel && <p>{parcel.name}{parcel.place?.label && ` · ${parcel.place.label}`}</p>}
        </header>
        {!parcel ? (
          <EmptyState icon={<CloudSun />} title={t('workspace.noField')} body={t('workspace.weatherNeedsField')} action={<Button onClick={onField}>{t('workspace.findField')}</Button>} />
        ) : !telemetry ? (
          <p className="workspace-summary-card" role="status">{t(loadError || (!forecastLoading && !historyLoading) ? 'workspace.noWeather' : 'workspace.loadingWeather')}</p>
        ) : (
          <>
            {telemetry.mode === 'mock' && <p className="workspace-summary-card" role="status">{t('workspace.simulated')}</p>}
            {telemetry.mode === 'cached' && <p className="t-caption">{t('workspace.cached', { date: fmtDate(telemetry.window.today, lang) })}</p>}
            <section aria-labelledby="workspace-weather-latest" className="workspace-home-weather">
              <h2 id="workspace-weather-latest" className="workspace-section-title">{t('workspace.latestWeather')}</h2>
              <LatestWeather telemetry={telemetry} />
            </section>
            <Tabs<WeatherMode> className="workspace-weather-tabs" value={mode} onValueChange={setMode} ariaLabel={t('chrome.nav.weather')}
              tabs={[{ value: 'forecast', label: t('workspace.forecast') }, { value: 'history', label: t('workspace.history') }]}>
              <TabPanel value="forecast"><WeatherTable telemetry={telemetry} forecast loading={forecastLoading} /></TabPanel>
              <TabPanel value="history"><WeatherTable telemetry={telemetry} forecast={false} loading={historyLoading} /></TabPanel>
            </Tabs>
          </>
        )}
      </div>
    </main>
  );
}
