import { memo, useMemo, type Ref } from 'react';
import { type BranchId, pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES } from '@/lib/series';
import { addDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { Callout, CalloutFacts, ConfidenceBadge, ProvenanceTag, Sparkline, type SparkAnomaly, type Status } from '@/ui/design';
import { fmtNum } from './format';
import { factOf, readBranch, riskHistory } from './readings';
import './strings';

export interface BranchCalloutProps {
  branch: BranchId;
  side: 'left' | 'right';
  sparkHeight: number;
  anchorRef?: Ref<HTMLSpanElement>;
  className?: string;
}

/**
 * One telemetry branch on the HUD. Subscribes to exactly what it shows, so a cursor tick
 * re-renders eight small plates and nothing above them; sparkline geometry is memoised inside
 * the primitive, so a tick only moves the cursor marks.
 */
export const BranchCallout = memo(function BranchCallout({ branch: id, side, sparkHeight, anchorRef, className }: BranchCalloutProps) {
  const t = useT();
  const lang = useLang();
  const telemetry = useMission((s) => s.telemetry);
  const status = useMission((s) => s.branchStatus[id]);
  const parcel = useMission((s) => s.parcel);
  const cursor = useMission((s) => s.timeline.cursor);
  const insights = useMission((s) => s.insights);
  const groundTruth = useMission((s) => s.groundTruth);
  const active = useMission((s) => s.focusBranch === id);
  const setFocusBranch = useMission((s) => s.setFocusBranch);
  const setParcelMetric = useMission((s) => s.setParcelMetric);

  const branch = telemetry?.branches[id];
  const title = pick(branch?.title ?? BRANCH_TITLES[id], lang);

  const marks = useMemo<SparkAnomaly[]>(
    () => insights.filter((i) => i.branch === id).map((i) => ({ t: i.t, severity: i.severity, label: pick(i.text, lang) })),
    [insights, id, lang],
  );
  const riskPast = useMemo(() => (telemetry && id === 'risk' ? riskHistory(telemetry) : []), [telemetry, id]);

  const select = () => {
    if (active) {
      setFocusBranch(null);
      return;
    }
    setFocusBranch(id);
    const key = branch?.series.find((s) => s.primary)?.key ?? branch?.series[0]?.key;
    // Static branches have no paint; the parcel keeps its outline and the previous fill key.
    if (key) setParcelMetric(key);
  };

  const common = { side, branch: id, title, active, anchorRef, className, onSelect: select };
  const loading = status === 'loading' || status === 'idle' || (!branch && status !== 'error');
  if (loading || !telemetry || !parcel) return <Callout {...common} loading />;

  if (!branch || status === 'error' || branch.status === 'unavailable') {
    const why = branch?.notes?.map((n) => pick(n, lang)).join(' ') || t('hud.unavailable.generic');
    return <Callout {...common} unavailable={why} />;
  }

  const r = readBranch({ telemetry, branch, cursor, parcel, insights, groundTruth, lang, t });
  const badge = <ConfidenceBadge badge={r.badge} variant="glyph" />;
  const meta = <ProvenanceTag compact provenance={r.provenance} source={r.sourceName} detail={r.sourceDetail || undefined} />;
  const tone = active ? id : 'ink';
  const sim = telemetry.mode === 'mock';
  const domain: [string, string] = [telemetry.window.start, telemetry.window.end];
  const shared = { ...common, value: r.value, unit: r.unit, delta: r.delta, status: r.status as Status | null, estimate: r.estimate, badge, meta };

  if (id === 'terrain') {
    const slope = factOf(branch, 'slope_deg')?.value;
    return (
      <Callout {...shared}>
        <CalloutFacts
          items={[
            { label: t('hud.fact.slope'), value: typeof slope === 'number' ? fmtNum(slope, 1) : slope, unit: '°' },
            { label: t('hud.fact.aspect'), value: factOf(branch, 'aspect_label')?.value },
            { label: t('hud.fact.flow'), value: factOf(branch, 'flow_dir_label')?.value },
          ]}
        />
      </Callout>
    );
  }

  if (id === 'soil') {
    const clay = factOf(branch, 'clay_pct')?.value;
    const soc = factOf(branch, 'soc_gkg')?.value;
    const drainage = groundTruth.drainage ?? (factOf(branch, 'drainage_class')?.value as string | undefined);
    return (
      <Callout {...shared}>
        <CalloutFacts
          items={[
            { label: t('hud.fact.clay'), value: typeof clay === 'number' ? fmtNum(clay, 0) : clay, unit: '%' },
            { label: t('hud.fact.soc'), value: typeof soc === 'number' ? fmtNum(soc, 1) : soc, unit: 'g/kg' },
            groundTruth.ecDsM != null
              ? { label: t('hud.fact.ec'), value: fmtNum(groundTruth.ecDsM, 1), unit: 'dS/m' }
              : { label: t('hud.fact.drainage'), value: drainage ? (['poor', 'well', 'excessive'].includes(drainage) ? t(`hud.drainage.${drainage}`) : drainage) : null },
          ]}
        />
      </Callout>
    );
  }

  if (id === 'risk') {
    const from = addDays(telemetry.window.today, -45);
    const end = telemetry.window.forecastEnd ?? telemetry.window.today;
    const events = (branch.events ?? []).filter((e) => e.severity > 0).map<SparkAnomaly>((e) => ({ t: e.start, severity: e.severity >= 2 ? 'alert' : 'watch', label: pick(e.title, lang) }));
    return (
      <Callout {...shared}>
        <Sparkline
          samples={riskPast}
          forecast={r.series?.samples}
          domain={[from, end]}
          range={r.series?.range}
          today={telemetry.window.today}
          cursor={cursor >= from ? cursor : null}
          tone={tone}
          anomalies={events}
          height={sparkHeight}
          points={false}
          provenance={sim ? 'simulated' : undefined}
          label={r.series ? pick(r.series.label, lang) : title}
          unit="°C"
        />
      </Callout>
    );
  }

  const s = r.series;
  return (
    <Callout {...shared}>
      {s && (
        <Sparkline
          samples={s.samples}
          domain={domain}
          range={s.range}
          cadence={s.cadence}
          baseline={s.baseline}
          cursor={cursor}
          today={telemetry.window.today}
          tone={tone}
          anomalies={marks}
          variant={id === 'rainfall' ? 'bars' : 'line'}
          points={id === 'vegetation' ? 'auto' : false}
          provenance={sim ? 'simulated' : undefined}
          height={sparkHeight}
          label={pick(s.label, lang)}
          unit={s.unit}
        />
      )}
    </Callout>
  );
});
