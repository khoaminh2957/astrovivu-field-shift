import { useEffect, useState } from 'react';
import { BRANCHES, pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES } from '@/lib/series';
import { BranchIcon } from '../BranchIcon';
import { Button } from '../Button';
import { cn } from '../cn';
import { RampLegend } from '../Feedback';
import { Panel } from '../Panel';
import { Sparkline } from '../Sparkline';
import { StatusGlyph, StatusTag } from '../Tag';
import { BRANCH_HEX, COLOR, contrastRatio, type MapMetric, STATUSES, Z } from '../tokens';
import { seriesOf, WINDOW } from './demo';
import { Group, Section, Token } from './parts';

const ratio = (fg: string, bg: string) => contrastRatio(fg, bg).toFixed(1);

const SURFACES: [name: string, hex: string][] = [
  ['void', COLOR.void],
  ['surface-0', COLOR.surface0],
  ['surface-1', COLOR.surface1],
  ['surface-2', COLOR.surface2],
  ['surface-3', COLOR.surface3],
  ['inset', COLOR.inset],
];
const INKS: [name: string, hex: string][] = [
  ['ink-1', COLOR.ink1],
  ['ink-2', COLOR.ink2],
  ['ink-3', COLOR.ink3],
  ['ink-4', COLOR.ink4],
];
const LINES: [name: string, hex: string][] = [
  ['line-1', COLOR.line1],
  ['line-2', COLOR.line2],
  ['line-3', COLOR.line3],
];
const STATE_HEX = { nominal: COLOR.nominal, watch: COLOR.watch, alert: COLOR.alert, stale: COLOR.stale, simulated: COLOR.simulated, 'ground-truth': COLOR.truth } as const;

export function ColourSection() {
  const t = useT();
  const lang = useLang();
  return (
    <Section id="color" title={t('sg.nav.color')}>
      <Group title={t('sg.color.surfaces')} note={t('sg.color.surfaces.note')}>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-2 bg-line-2 md:grid-cols-3 xl:grid-cols-6">
          {SURFACES.map(([name, hex]) => (
            <div key={name} className="flex min-h-36 flex-col justify-between p-3" style={{ background: hex }}>
              <div>
                <Token>{name}</Token>
                <div className="t-meta uppercase">{hex}</div>
              </div>
              <dl className="m-0 flex flex-col">
                {INKS.map(([ink, inkHex]) => (
                  <div key={ink} className="flex items-baseline justify-between gap-2" style={{ color: inkHex }}>
                    <dt className="text-xs">{ink}</dt>
                    <dd className="t-value m-0 text-xs">{ratio(inkHex, hex)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Group>

      <div className="grid gap-12 lg:grid-cols-2">
        <Group title={t('sg.color.lines')} note={t('sg.color.lines.note')}>
          <Panel pad="md">
            <dl className="m-0 flex flex-col gap-4">
              {LINES.map(([name, hex]) => (
                <div key={name} className="flex items-center gap-4">
                  <dt className="w-16 shrink-0">
                    <Token>{name}</Token>
                  </dt>
                  <dd className="m-0 h-px flex-1" style={{ background: hex }} />
                  <dd className="t-meta m-0 w-36 shrink-0 text-right uppercase">
                    {hex} · {ratio(hex, COLOR.surface1)}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </Group>

        <Group title={t('sg.color.signal')} note={t('sg.color.signal.note')}>
          <div className="flex flex-wrap items-stretch gap-3">
            <div className="flex min-h-20 min-w-48 flex-1 flex-col justify-between rounded-sm bg-signal p-3 text-on-signal">
              <code className="font-mono text-2xs">signal / on-signal</code>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-2xs uppercase">{COLOR.signal}</span>
                <span className="t-value text-xs">{ratio(COLOR.onSignal, COLOR.signal)}</span>
              </div>
            </div>
            <Panel pad="md" className="flex-1 justify-center">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary">{t('sg.ctl.lock')}</Button>
                <StatusTag status="ground-truth" />
                <span className="t-value rounded-xs bg-signal px-1.5 text-xl text-on-signal">5.8</span>
              </div>
            </Panel>
          </div>
        </Group>
      </div>

      <Group title={t('sg.color.states')} note={t('sg.color.states.note')}>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-1 bg-line-1 md:grid-cols-3 xl:grid-cols-6">
          {STATUSES.map((s) => (
            <div key={s} className="flex flex-col gap-3 bg-surface-1 p-3">
              <div className="flex items-center gap-2">
                <StatusGlyph status={s} size={14} />
                <StatusTag status={s} />
              </div>
              <div>
                <Token>{s === 'ground-truth' ? 'truth' : s}</Token>
                <div className="t-meta uppercase">
                  {STATE_HEX[s]} · {ratio(STATE_HEX[s], COLOR.surface1)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Group>

      <Group title={t('sg.color.branches')} note={t('sg.color.branches.note')}>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-line-1 bg-line-1 sm:grid-cols-2 xl:grid-cols-4">
          {BRANCHES.map((b) => {
            const series = seriesOf(b);
            return (
              <div key={b} className="flex min-w-0 flex-col gap-2 bg-surface-1 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <BranchIcon branch={b} colored />
                  <span className="t-label truncate text-ink-1">{pick(BRANCH_TITLES[b], lang)}</span>
                </div>
                <div className="h-7">{series ? <Sparkline samples={series.samples} range={series.range} domain={[WINDOW.start, WINDOW.end]} tone={b} height={28} variant={b === 'rainfall' ? 'bars' : 'line'} points={false} /> : <div className="mt-3 h-0.5" style={{ background: BRANCH_HEX[b] }} />}</div>
                <div className="t-meta flex justify-between gap-2 uppercase">
                  <span className="truncate normal-case">branch-{b.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}</span>
                  <span className="shrink-0">
                    {BRANCH_HEX[b]} · {ratio(BRANCH_HEX[b], COLOR.surface1)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Group>

      <Group title={t('sg.color.ramps')} note={t('sg.color.ramps.note')}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t('sg.color.sequential')} pad="md">
            <div className="flex flex-col gap-4">
              {(['vegetation', 'moisture', 'heat', 'rain'] as MapMetric[]).map((m) => (
                <RampLegend key={m} metric={m} label={<Token>--ramp-{m}</Token>} />
              ))}
            </div>
          </Panel>
          <Panel title={t('sg.color.diverging')} pad="md">
            <div className="flex flex-col gap-4">
              <RampLegend metric="moisture" mode="diverging" label={<Token>--ramp-anomaly-wet</Token>} />
              <RampLegend metric="heat" mode="diverging" label={<Token>--ramp-anomaly-heat</Token>} />
            </div>
          </Panel>
        </div>
      </Group>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------------------------

const VI_LETTERS: string[] = (() => {
  const bases = ['a', 'ă', 'â', 'e', 'ê', 'i', 'o', 'ô', 'ơ', 'u', 'ư', 'y'];
  const tones = ['́', '̀', '̉', '̃', '̣'];
  const lower = ['ă', 'â', 'ê', 'ô', 'ơ', 'ư', 'đ'];
  for (const b of bases) for (const m of tones) lower.push((b + m).normalize('NFC'));
  return [...lower, ...lower.map((c) => c.toUpperCase())];
})();

interface AuditRow {
  family: string;
  label: string;
  weight: number;
  stretch: string;
  missing: string[] | null;
}

const AUDIT: Omit<AuditRow, 'missing'>[] = [
  { family: 'Archivo Variable', label: 'Archivo', weight: 400, stretch: '100%' },
  { family: 'Archivo Variable', label: 'Archivo', weight: 500, stretch: '90%' },
  { family: 'Archivo Variable', label: 'Archivo', weight: 600, stretch: '100%' },
  { family: 'Archivo Variable', label: 'Archivo', weight: 600, stretch: '125%' },
  { family: 'Chivo Mono Variable', label: 'Chivo Mono', weight: 400, stretch: '100%' },
  { family: 'Chivo Mono Variable', label: 'Chivo Mono', weight: 500, stretch: '100%' },
];

/**
 * A letter is drawn by the webfont when its width does not depend on which fallback follows it in
 * the stack: a missing glyph falls through to `monospace` or `serif`, which differ in width.
 */
async function auditFont(family: string, weight: number): Promise<string[]> {
  await document.fonts.load(`${weight} 32px "${family}"`, VI_LETTERS.join(''));
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return VI_LETTERS;
  const missing: string[] = [];
  for (const ch of VI_LETTERS) {
    ctx.font = `${weight} 32px "${family}", monospace`;
    const a = ctx.measureText(ch).width;
    ctx.font = `${weight} 32px "${family}", serif`;
    const b = ctx.measureText(ch).width;
    if (Math.abs(a - b) > 0.01) missing.push(ch);
  }
  return missing;
}

function useGlyphAudit(): AuditRow[] {
  const [rows, setRows] = useState<AuditRow[]>(() => AUDIT.map((r) => ({ ...r, missing: null })));
  useEffect(() => {
    let live = true;
    void Promise.all(AUDIT.map((r) => auditFont(r.family, r.weight).catch(() => VI_LETTERS))).then((res) => {
      if (live) setRows(AUDIT.map((r, i) => ({ ...r, missing: res[i] })));
    });
    return () => {
      live = false;
    };
  }, []);
  return rows;
}

const PANGRAM = 'Ếch ộp, ruộng lúa chín vàng, mưa giữa tháng Mười ở Đắk Lắk. Ữ Ợ Ặ Ỗ Ỷ Ẵ Đ';

const ROLES: { cls: string; spec: string; key: string }[] = [
  { cls: 't-title', spec: '18 / 24 / 600 / 100', key: 'title' },
  { cls: 't-heading', spec: '14 / 20 / 600 / 100', key: 'heading' },
  { cls: 't-body', spec: '14 / 20 / 400 / 100', key: 'body' },
  { cls: 't-reading', spec: '16 / 24 / 400 / 100', key: 'reading' },
  { cls: 't-label', spec: '12 / 16 / 500 / 90', key: 'label' },
  { cls: 't-caption', spec: '12 / 16 / 400 / 100', key: 'caption' },
  { cls: 't-status', spec: '11 / 14 / 600 / 90, caps', key: 'status' },
];

export function TypeSection() {
  const t = useT();
  const audit = useGlyphAudit();
  return (
    <Section id="type" title={t('sg.nav.type')} note={t('sg.type.note')}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Archivo" meta={t('sg.type.sans')} pad="md">
          <p className="text-4xl leading-none font-semibold">Aa Ăă Đđ Ơơ Ưư</p>
          <p className="t-reading mt-4 text-ink-2">{PANGRAM}</p>
          <p className="t-meta mt-3">--font-sans · 100-900 · wdth 62-125</p>
        </Panel>
        <Panel title="Chivo Mono" meta={t('sg.type.mono')} pad="md">
          <p className="t-value text-4xl leading-none">0.274 m³/m³</p>
          <p className="t-value mt-4 text-md text-ink-2">12.8000°N 108.2000°E · 14-11-2026 · 31.6 °C · pH 5.8 · 24 mm · 1 250 ₫</p>
          <p className="t-meta mt-3">--font-mono · 100-900 · tabular</p>
        </Panel>
      </div>

      <Group title={t('sg.type.widths')}>
        <dl className="m-0 flex flex-col">
          {(
            [
              ['--stretch-condensed', '80%', 500, 'text-xl'],
              ['--stretch-semi', '90%', 500, 'text-xl'],
              ['--stretch-normal', '100%', 400, 'text-xl'],
              ['--stretch-expanded', '125%', 600, 'text-xl tracking-wider uppercase'],
            ] as const
          ).map(([name, stretch, weight, cls]) => (
            <div key={name} className="flex flex-col gap-1 border-b border-line-1 py-3 last:border-b-0 md:flex-row md:items-baseline md:gap-6">
              <dt className="w-56 shrink-0">
                <Token>
                  {name} · {stretch}
                </Token>
              </dt>
              <dd className={cn('m-0 min-w-0', cls)} style={{ fontStretch: stretch, fontWeight: weight }}>
                {t('sg.type.sample.body')}
              </dd>
            </div>
          ))}
        </dl>
      </Group>

      <Group title={t('sg.type.roles')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line-2">
                <th className="t-label py-2 pr-4 font-medium">{t('sg.type.role')}</th>
                <th className="t-label py-2 pr-4 font-medium">English · Tiếng Việt</th>
                <th className="t-label py-2 font-medium">{t('sg.type.spec')}</th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r.cls} className="border-b border-line-1 align-baseline">
                  <td className="py-3 pr-4">
                    <Token>{r.cls}</Token>
                  </td>
                  <td className="max-w-[60ch] py-3 pr-4">
                    <RoleSample cls={r.cls} k={r.key} />
                  </td>
                  <td className="t-meta py-3 whitespace-nowrap">{r.spec}</td>
                </tr>
              ))}
              <tr className="border-b border-line-1 align-baseline">
                <td className="py-3 pr-4">
                  <Token>t-value + t-unit</Token>
                </td>
                <td className="py-3 pr-4">
                  <span className="t-value text-2xl">0.274</span> <span className="t-unit">m³/m³</span>
                </td>
                <td className="t-meta py-3 whitespace-nowrap">mono / 500 / tabular</td>
              </tr>
              <tr className="align-baseline">
                <td className="py-3 pr-4">
                  <Token>t-meta</Token>
                </td>
                <td className="t-meta py-3 pr-4">SMAP L4 · 9 km · 3 d</td>
                <td className="t-meta py-3 whitespace-nowrap">mono / 11 / 14 / 400</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Group>

      <Group title={t('sg.type.audit')} note={t('sg.type.audit.note')}>
        <div className="grid gap-px overflow-hidden rounded-sm border border-line-1 bg-line-1 md:grid-cols-2 xl:grid-cols-3">
          {audit.map((r) => {
            const total = VI_LETTERS.length;
            const ok = r.missing != null && r.missing.length === 0;
            return (
              <div key={`${r.family}-${r.weight}-${r.stretch}`} className="flex min-w-0 flex-col gap-2 bg-surface-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="t-meta text-ink-2">
                    {r.label} · {r.weight} · {r.stretch}
                  </span>
                  {r.missing == null ? <StatusTag status="stale" label={t('sg.type.audit.pending')} /> : <StatusTag status={ok ? 'nominal' : 'alert'} label={`${total - r.missing.length} / ${total}`} />}
                </div>
                <p className="text-md leading-7 break-words" style={{ fontFamily: `"${r.family}", sans-serif`, fontWeight: r.weight, fontStretch: r.stretch }}>
                  ắằẳẵặ ấầẩẫậ ếềểễệ ốồổỗộ ớờởỡợ ứừửữự ỷỹỵ đ ẮẰẲẴẶ ẤẦẨẪẬ ẾỀỂỄỆ ỐỒỔỖỘ ỚỜỞỠỢ ỨỪỬỮỰ Đ
                </p>
                <p className="t-caption" aria-live="polite">
                  {r.missing == null ? t('sg.type.audit.pending') : r.missing.length === 0 ? t('sg.type.audit.pass', { n: total, total }) : r.missing.join(' ')}
                </p>
              </div>
            );
          })}
        </div>
      </Group>
    </Section>
  );
}

function RoleSample({ cls, k }: { cls: string; k: string }) {
  // Both languages side by side whatever the page language is: the roles must hold in each.
  const en = SAMPLE_EN[k];
  const vi = SAMPLE_VI[k];
  return (
    <div className="flex flex-col gap-1">
      <span className={cls} lang="en">
        {en}
      </span>
      <span className={cls} lang="vi">
        {vi}
      </span>
    </div>
  );
}

const SAMPLE_EN: Record<string, string> = {
  title: 'Soil moisture is falling',
  heading: 'Irrigation schedule',
  body: 'Rain stops for four months. Irrigation timing decides the harvest.',
  reading: 'Root-zone moisture has been below normal for nineteen days. Irrigate 24 mm this week, before flowering.',
  label: 'Root zone (0-100 cm)',
  caption: '12 % below normal for this week of the year',
  status: 'Watch',
};
const SAMPLE_VI: Record<string, string> = {
  title: 'Độ ẩm đất đang giảm',
  heading: 'Lịch tưới',
  body: 'Mưa ngừng bốn tháng. Thời điểm tưới quyết định vụ thu hoạch.',
  reading: 'Độ ẩm vùng rễ đã thấp hơn mức thường mười chín ngày. Hãy tưới 24 mm trong tuần này, trước khi cây ra hoa.',
  label: 'Vùng rễ (0-100 cm)',
  caption: 'Thấp hơn 12 % so với mức thường của tuần này trong năm',
  status: 'Theo dõi',
};

// ---------------------------------------------------------------------------------------------
// Space, depth, motion
// ---------------------------------------------------------------------------------------------

const SPACES = [4, 8, 12, 16, 24, 32, 48];
const RADII: [string, string][] = [
  ['none', '0'],
  ['xs', '1px'],
  ['sm', '2px'],
  ['md', '3px'],
  ['lg', '4px'],
  ['full', '9999px'],
];
const DURATIONS: [token: string, ms: number, key: string][] = [
  ['--dur-instant', 80, 'instant'],
  ['--dur-fast', 140, 'fast'],
  ['--dur-base', 220, 'base'],
  ['--dur-slow', 420, 'slow'],
  ['--dur-camera', 1600, 'camera'],
];

export function LayoutSection() {
  const t = useT();
  const [run, setRun] = useState(false);
  return (
    <Section id="layout" title={t('sg.nav.layout')}>
      <div className="grid gap-12 lg:grid-cols-2">
        <Group title={t('sg.layout.spacing')} note={t('sg.layout.spacing.note')}>
          <dl className="m-0 flex flex-col gap-2">
            {SPACES.map((s) => (
              <div key={s} className="flex items-center gap-4">
                <dt className="t-meta w-20 shrink-0">
                  {s / 4} · {s} px
                </dt>
                <dd className="m-0 h-2 bg-ink-3" style={{ width: s * 4 }} />
              </div>
            ))}
          </dl>
        </Group>

        <Group title={t('sg.layout.radius')} note={t('sg.layout.radius.note')}>
          <div className="flex flex-wrap gap-4">
            {RADII.map(([name, value]) => (
              <div key={name} className="flex flex-col items-start gap-2">
                <div className={cn('border border-line-3 bg-surface-2', name === 'full' ? 'size-14' : 'h-14 w-20')} style={{ borderRadius: value }} />
                <Token>
                  {name} · {value}
                </Token>
              </div>
            ))}
          </div>
        </Group>
      </div>

      <div className="grid gap-12 lg:grid-cols-2">
        <Group title={t('sg.layout.elevation')} note={t('sg.layout.elevation.note')}>
          <div className="relative overflow-hidden rounded-sm border border-line-1 p-6" style={{ background: 'linear-gradient(115deg, #2c3a22 0 22%, #4a4326 22% 41%, #1f3b2b 41% 63%, #5a4a2c 63% 80%, #27402a 80%)' }}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="plate p-3">
                <Token>plate</Token>
                <p className="t-caption mt-1">shadow-md</p>
              </div>
              <div className="plate-raised p-3">
                <Token>plate-raised</Token>
                <p className="t-caption mt-1">shadow-lg</p>
              </div>
              <div className="rounded-sm border border-line-1 bg-surface-1 p-3 shadow-sm">
                <Token>shadow-sm</Token>
                <p className="t-caption mt-1">surface-1</p>
              </div>
            </div>
          </div>
        </Group>

        <Group title={t('sg.layout.layers')}>
          <dl className="m-0 flex flex-col-reverse">
            {(Object.entries(Z) as [keyof typeof Z, number][]).map(([name, z]) => (
              <div key={name} className="flex items-baseline gap-4 border-b border-line-1 py-1.5 first:border-b-0">
                <dt className="t-value w-8 shrink-0 text-right text-xs text-ink-1">{z}</dt>
                <dd className="m-0 w-28 shrink-0">
                  <Token>--z-{name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}</Token>
                </dd>
                <dd className="t-caption m-0 min-w-0">{t(`sg.z.${name}`)}</dd>
              </div>
            ))}
          </dl>
        </Group>
      </div>

      <Group title={t('sg.layout.motion')} note={t('sg.layout.motion.note')}>
        <Panel pad="md" actions={<Button size="sm" onClick={() => setRun((v) => !v)}>{t('sg.layout.motion.replay')}</Button>} title={<Token>--ease-out · cubic-bezier(0.16, 1, 0.3, 1)</Token>}>
          <dl className="m-0 flex flex-col gap-3">
            {DURATIONS.map(([token, ms, key]) => (
              <div key={token} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-center gap-x-4 gap-y-1 md:grid-cols-[11rem_minmax(0,1fr)_minmax(0,16rem)]">
                <dt className="t-meta text-ink-2">
                  {token} · {ms} ms
                </dt>
                <dd className="relative m-0 h-3 border-x border-line-2">
                  <span className="absolute inset-y-1/2 right-0 left-0 h-px bg-line-1" />
                  <span
                    className="absolute top-0 h-3 w-[3px] bg-signal"
                    style={{ left: run ? 'calc(100% - 3px)' : '0%', transition: `left var(${token}) var(--ease-out)` }}
                  />
                </dd>
                <dd className="t-caption col-span-2 m-0 md:col-span-1">{t(`sg.dur.${key}`)}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </Group>
    </Section>
  );
}
