import { useMemo } from 'react';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES } from '@/lib/series';
import { addDays } from '@/lib/time';
import { Callout, CalloutFacts } from '../Callout';
import { ConfidenceBadge } from '../ConfidenceBadge';
import { HubGauge } from '../HubGauge';
import { Panel } from '../Panel';
import { Sparkline } from '../Sparkline';
import { ProvenanceTag } from '../Tag';
import { baselineOf, between, DEMO_TELEMETRY, everyNth, factOf, fmtRes, FORECAST_END, readingAt, seriesOf, SOURCE, specimenConfidence, specimenInsights, TODAY, WINDOW } from './demo';
import { Group, Section, Spec } from './parts';

const DOMAIN: [string, string] = [WINDOW.start, WINDOW.end];
const CURSOR = addDays(TODAY, -118);

export function InstrumentsSection() {
  const t = useT();
  const lang = useLang();
  const insights = useMemo(() => specimenInsights(), []);
  const sm = seriesOf('soilMoisture')!;
  const ndvi = seriesOf('vegetation')!;
  const lst = seriesOf('thermal')!;
  const rain = seriesOf('rainfall')!;
  const tmax = DEMO_TELEMETRY.branches.agromet.series.find((s) => s.key === 't2m_max')!;
  const fc = seriesOf('risk')!;
  const title = (b: keyof typeof BRANCH_TITLES) => pick(BRANCH_TITLES[b], lang);
  const meta = (b: keyof typeof SOURCE, age?: number) => {
    const s = SOURCE[b];
    return <ProvenanceTag compact provenance={s.provenance} source={s.name} detail={[fmtRes(s.resolutionM), age != null ? `${age} d` : null].filter(Boolean).join(' · ')} />;
  };
  const badge = (b: keyof typeof SOURCE) => <ConfidenceBadge badge={specimenConfidence(b)} variant="glyph" />;
  const smNow = readingAt('soilMoisture', CURSOR);
  const ndviNow = readingAt('vegetation', CURSOR);
  const lstNow = readingAt('thermal', CURSOR);
  const delta = (pct: number | null) => (pct == null ? undefined : Math.abs(pct) < 4 ? t('sg.delta.normal') : t(pct < 0 ? 'sg.delta.below' : 'sg.delta.above', { n: Math.abs(pct) }));

  const gapped = useMemo(() => sm.samples.filter((s) => s.t < addDays(TODAY, -210) || s.t > addDays(TODAY, -165)), [sm]);
  const staleNdvi = useMemo(() => between(ndvi.samples, WINDOW.start, addDays(TODAY, -52)), [ndvi]);
  const pendingSm = useMemo(() => between(sm.samples, WINDOW.start, addDays(TODAY, -4)), [sm]);
  const recentTmax = useMemo(() => between(tmax.samples, addDays(TODAY, -75), TODAY), [tmax]);

  return (
    <Section id="instruments" title={t('sg.nav.instruments')}>
      <Group title={t('sg.ins.spark')} note={t('sg.ins.spark.note')}>
        <div className="grid gap-px overflow-hidden rounded-sm border border-line-1 bg-line-1 md:grid-cols-2 xl:grid-cols-3">
          {[
            {
              name: t('sg.ins.spark.band'),
              node: <Sparkline samples={sm.samples} range={sm.range} domain={DOMAIN} cadence="daily" baseline={baselineOf('soilMoisture')} cursor={CURSOR} anomalies={insights.filter((i) => i.branch === 'soilMoisture')} height={48} label={pick(sm.label, lang)} unit={sm.unit} />,
            },
            {
              name: t('sg.ins.spark.sparse'),
              node: <Sparkline samples={ndvi.samples} range={[0.2, 0.9]} domain={DOMAIN} cadence="16-day" cursor={addDays(TODAY, -100)} height={48} label="NDVI" />,
            },
            {
              name: t('sg.ins.spark.bars'),
              node: <Sparkline samples={rain.samples} range={rain.range} domain={DOMAIN} variant="bars" cursor={CURSOR} anomalies={insights.filter((i) => i.branch === 'rainfall')} height={48} label={pick(rain.label, lang)} unit={rain.unit} />,
            },
            {
              name: t('sg.ins.spark.pending'),
              node: <Sparkline samples={between(pendingSm, addDays(TODAY, -60), TODAY)} range={sm.range} domain={[addDays(TODAY, -60), TODAY]} cadence="daily" today={TODAY} cursor={TODAY} height={48} label={pick(sm.label, lang)} unit={sm.unit} />,
            },
            {
              name: t('sg.ins.spark.forecast'),
              node: <Sparkline samples={recentTmax} forecast={fc.samples} range={[18, 40]} domain={[addDays(TODAY, -75), FORECAST_END]} today={TODAY} cursor={addDays(TODAY, 6)} anomalies={[{ t: addDays(TODAY, 4), severity: 'alert', label: 'Heat spell' }]} height={48} label={pick(tmax.label, lang)} unit={tmax.unit} />,
            },
            {
              name: t('sg.ins.spark.stale'),
              node: <Sparkline samples={staleNdvi} range={[0.2, 0.9]} domain={DOMAIN} cadence="16-day" cursor={addDays(TODAY, -8)} height={48} label="NDVI" />,
            },
            {
              name: t('sg.ins.spark.gap'),
              node: <Sparkline samples={gapped} range={sm.range} domain={DOMAIN} cadence="daily" height={48} label={pick(sm.label, lang)} unit={sm.unit} />,
            },
            {
              name: t('sg.ins.spark.sim'),
              node: <Sparkline samples={everyNth(lst.samples, 1)} range={lst.range} domain={DOMAIN} provenance="simulated" height={48} points={false} label={pick(lst.label, lang)} unit={lst.unit} />,
            },
            {
              name: t('sg.ins.spark.focus'),
              node: <Sparkline samples={ndvi.samples} range={[0.2, 0.9]} domain={DOMAIN} cadence="16-day" tone="vegetation" baseline={baselineOf('vegetation')} cursor={CURSOR} height={48} label="NDVI" />,
            },
          ].map((s, i, all) => (
            // The ninth cell spans two columns on medium screens so the hairline grid has no empty cell.
            <Spec key={s.name} name={s.name} className={i === all.length - 1 ? 'bg-surface-1 p-3 md:col-span-2 xl:col-span-1' : 'bg-surface-1 p-3'}>
              {s.node}
            </Spec>
          ))}
          <Spec name={t('sg.ins.spark.empty')} className="bg-surface-1 p-3 md:col-span-2 xl:col-span-3">
            <Sparkline samples={[]} height={48} />
          </Spec>
        </div>
      </Group>

      <Group title={t('sg.ins.callout')} note={t('sg.ins.callout.note')}>
        <div className="grid justify-start gap-x-8 gap-y-6 [grid-template-columns:repeat(auto-fill,minmax(var(--hud-callout-w),max-content))] stacked:[grid-template-columns:minmax(0,1fr)]">
          <Spec name={t('sg.ins.state.default')}>
            <Callout side="left" branch="soilMoisture" title={title('soilMoisture')} value={smNow.text} unit={smNow.unit} delta={delta(smNow.deltaPct)} badge={badge('soilMoisture')} meta={meta('soilMoisture', 3)}>
              <Sparkline samples={sm.samples} range={sm.range} domain={DOMAIN} cadence="daily" baseline={baselineOf('soilMoisture')} cursor={CURSOR} height={32} />
            </Callout>
          </Spec>
          <Spec name={t('sg.ins.state.active')}>
            <Callout side="left" active onSelect={() => {}} branch="vegetation" title={title('vegetation')} value={ndviNow.text} unit="NDVI" delta={delta(ndviNow.deltaPct)} badge={badge('vegetation')} meta={meta('vegetation', ndviNow.ageDays ?? undefined)}>
              <Sparkline samples={ndvi.samples} range={[0.2, 0.9]} domain={DOMAIN} cadence="16-day" tone="vegetation" baseline={baselineOf('vegetation')} cursor={CURSOR} height={32} />
            </Callout>
          </Spec>
          <Spec name={t('sg.ins.state.watch')}>
            <Callout side="right" status="watch" branch="thermal" title={title('thermal')} value={lstNow.text} unit="°C" delta={t('sg.delta.above', { n: 9 })} badge={badge('thermal')} meta={meta('thermal', 6)}>
              <Sparkline samples={lst.samples} range={lst.range} domain={DOMAIN} cadence="8-day" baseline={baselineOf('thermal')} cursor={CURSOR} anomalies={insights.filter((i) => i.branch === 'thermal')} height={32} points={false} />
            </Callout>
          </Spec>
          <Spec name={t('sg.ins.state.alert')}>
            <Callout side="right" status="alert" branch="soilMoisture" title={title('soilMoisture')} value="0.14" unit="m³/m³" delta={t('sg.delta.below', { n: 31 })} badge={badge('soilMoisture')} meta={meta('soilMoisture', 3)}>
              <Sparkline samples={sm.samples} range={sm.range} domain={DOMAIN} cadence="daily" baseline={baselineOf('soilMoisture')} cursor={insights.find((i) => i.branch === 'soilMoisture')?.t} anomalies={insights.filter((i) => i.branch === 'soilMoisture')} height={32} />
            </Callout>
          </Spec>
          <Spec name={t('sg.ins.state.stale')}>
            <Callout side="left" status="stale" branch="vegetation" title={title('vegetation')} value="0.61" unit="NDVI" delta={t('sg.delta.stale', { n: 44 })} badge={<ConfidenceBadge level="low" score={0.26} variant="glyph" reasons={specimenConfidence('vegetation').reasons} />} meta={meta('vegetation', 44)}>
              <Sparkline samples={staleNdvi} range={[0.2, 0.9]} domain={DOMAIN} cadence="16-day" cursor={addDays(TODAY, -8)} height={32} />
            </Callout>
          </Spec>
          <Spec name={t('sg.ins.state.truth')}>
            <Callout side="right" status="ground-truth" branch="soil" title={title('soil')} value="5.8" unit="pH" estimate="5.2" delta={t('sg.delta.measured')} badge={<ConfidenceBadge level="high" score={1} variant="glyph" />} meta={<ProvenanceTag provenance="ground-truth" source="pH" detail="02-11-2026" compact />}>
              <CalloutFacts
                items={[
                  { label: pick(factOf('soil', 'clay_pct')?.label, lang), value: factOf('soil', 'clay_pct')?.value, unit: '%' },
                  { label: pick(factOf('soil', 'soc_gkg')?.label, lang), value: factOf('soil', 'soc_gkg')?.value, unit: 'g/kg' },
                ]}
              />
            </Callout>
          </Spec>
          <Spec name={t('sg.ins.state.sim')}>
            <Callout side="left" status="simulated" branch="agromet" title={title('agromet')} value="8.4" unit="MJ/m²/day" delta={t('sg.delta.sim')} badge={<ConfidenceBadge badge={DEMO_TELEMETRY.branches.agromet.confidence} variant="glyph" />} meta={<ProvenanceTag provenance="simulated" source="mockTelemetry" compact />}>
              <Sparkline samples={seriesOf('agromet')!.samples} range={seriesOf('agromet')!.range} domain={DOMAIN} provenance="simulated" cursor={CURSOR} height={32} />
            </Callout>
          </Spec>
          <Spec name={t('sg.ins.state.facts')}>
            <Callout side="right" branch="terrain" title={title('terrain')} value={factOf('terrain', 'elevation_m')?.value} unit="m" delta={`${pick(factOf('terrain', 'flow_dir_label')?.label, lang)}: ${factOf('terrain', 'flow_dir_label')?.value}`} badge={badge('terrain')} meta={meta('terrain')}>
              <CalloutFacts
                items={[
                  { label: pick(factOf('terrain', 'slope_deg')?.label, lang), value: factOf('terrain', 'slope_deg')?.value, unit: '°' },
                  { label: pick(factOf('terrain', 'aspect_label')?.label, lang), value: factOf('terrain', 'aspect_label')?.value },
                ]}
              />
            </Callout>
          </Spec>
          <Spec name={t('sg.ins.state.loading')}>
            <Callout side="left" loading branch="rainfall" title={title('rainfall')} />
          </Spec>
          <Spec name={t('sg.ins.state.unavailable')}>
            <Callout side="right" branch="soilMoisture" title={title('soilMoisture')} unavailable={t('sg.unavail.smap')} />
          </Spec>
        </div>
      </Group>

      <Group title={t('sg.ins.hub')} note={t('sg.ins.hub.note')}>
        <Panel pad="md">
          <div className="flex flex-wrap items-start gap-x-12 gap-y-14 pb-12">
            <HubGauge value={86} secondary={91} label={t('sg.ins.hub.label')} secondaryLabel={t('sg.ins.hub.secondary')} limiting={lang === 'vi' ? 'pH đất' : 'Soil pH'} size={148} />
            <HubGauge value={52} secondary={82} label={t('sg.ins.hub.label')} secondaryLabel={t('sg.ins.hub.secondary')} limiting={lang === 'vi' ? 'Nước' : 'Water'} size={148} />
            <HubGauge value={31} secondary={82} label={t('sg.ins.hub.label')} secondaryLabel={t('sg.ins.hub.secondary')} limiting={lang === 'vi' ? 'Nước' : 'Water'} size={148} simulated />
            <HubGauge value={null} secondary={null} label={t('sg.ins.hub.label')} secondaryLabel={t('sg.ins.hub.secondary')} size={128} />
            <HubGauge value={null} loading label={t('sg.ins.hub.label')} size={128} />
            <HubGauge value={74} label={t('sg.ins.hub.label')} size={112} />
          </div>
        </Panel>
      </Group>
    </Section>
  );
}
