import { useState } from 'react';
import { CloudOff, Crosshair, Layers, LocateFixed, MapPin, Pause, Play, Search } from 'lucide-react';
import type { Provenance } from '@/contracts';
import { useT } from '@/i18n';
import { AnomalyMarker } from '../AnomalyMarker';
import { Button, IconButton } from '../Button';
import { ConfidenceBadge } from '../ConfidenceBadge';
import { Dialog, Sheet } from '../Dialog';
import { EmptyState, RampLegend, Skeleton, SkeletonText } from '../Feedback';
import { Field, Input, Select, Textarea } from '../Field';
import { Panel } from '../Panel';
import { Segmented, Toggle } from '../Segmented';
import { Slider } from '../Slider';
import { KeyValue, Meter, Stat } from '../Stat';
import { TabPanel, Tabs } from '../Tabs';
import { ProvenanceTag, StatusTag, Tag } from '../Tag';
import { Popover, Tooltip } from '../Tooltip';
import { PROVENANCES, STATUSES } from '../tokens';
import { specimenConfidence } from './demo';
import { Group, Section, Spec } from './parts';

type Overlay = 'none' | 'ndvi' | 'sm' | 'rain' | 'lst';
type Draw = 'quad' | 'coords' | 'gps';
type Track = 'journal' | 'seasons' | 'finance';

export function ControlsSection() {
  const t = useT();
  const [overlay, setOverlay] = useState<Overlay>('ndvi');
  const [draw, setDraw] = useState<Draw>('quad');
  const [terrain, setTerrain] = useState(true);
  const [labels, setLabels] = useState(false);
  const [opacity, setOpacity] = useState(70);
  const [playing, setPlaying] = useState(false);
  const [ph, setPh] = useState('5.8');
  const [crop, setCrop] = useState<string | undefined>('coffee');
  const [tab, setTab] = useState<Track>('journal');
  const [sheet, setSheet] = useState(false);
  const phBad = ph !== '' && (Number.isNaN(Number(ph)) || Number(ph) < 3 || Number(ph) > 10);

  return (
    <Section id="controls" title={t('sg.nav.controls')}>
      <Group title={t('sg.ctl.buttons')} note={t('sg.ctl.buttons.note')}>
        <Panel pad="md">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" icon={<Crosshair />}>
                {t('sg.ctl.lock')}
              </Button>
              <Button variant="secondary">{t('sg.ctl.adjust')}</Button>
              <Button variant="ghost">{t('sg.ctl.cancel')}</Button>
              <Button variant="danger">{t('sg.ctl.discard')}</Button>
              <Button variant="primary" loading>
                {t('sg.ctl.loading')}
              </Button>
              <Button variant="primary" disabled>
                {t('sg.ctl.disabled')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="primary">
                {t('sg.ctl.lock')}
              </Button>
              <Button size="sm">{t('sg.ctl.adjust')}</Button>
              <Button size="lg" variant="primary" icon={<Crosshair />}>
                {t('sg.ctl.lock')}
              </Button>
              <Button size="lg" icon={<LocateFixed />}>
                {t('sg.ctl.locate')}
              </Button>
              <span className="mx-1 h-6 w-px bg-line-2" aria-hidden />
              <IconButton label={playing ? t('sg.ctl.pause') : t('sg.ctl.play')} icon={playing ? <Pause /> : <Play />} variant="secondary" onClick={() => setPlaying((v) => !v)} />
              <IconButton label={t('sg.ctl.layers')} icon={<Layers />} pressed={terrain} onClick={() => setTerrain((v) => !v)} />
              <IconButton label={t('sg.ctl.locate')} icon={<LocateFixed />} size="lg" variant="secondary" />
              <IconButton label={t('sg.ctl.locate')} icon={<LocateFixed />} disabled />
            </div>
          </div>
        </Panel>
      </Group>

      <Group title={t('sg.ctl.choice')}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel pad="md">
            <div className="flex flex-col gap-5">
              <Spec name="Segmented · md">
                <Segmented<Overlay>
                  ariaLabel={t('sg.ctl.overlay')}
                  value={overlay}
                  onValueChange={setOverlay}
                  options={[
                    { value: 'none', label: t('sg.ctl.overlay.none') },
                    { value: 'ndvi', label: t('sg.ctl.overlay.ndvi') },
                    { value: 'sm', label: t('sg.ctl.overlay.sm') },
                    { value: 'rain', label: t('sg.ctl.overlay.rain') },
                    { value: 'lst', label: t('sg.ctl.overlay.lst') },
                  ]}
                />
              </Spec>
              <Spec name="Segmented · lg · block">
                <Segmented<Draw>
                  ariaLabel={t('sg.ctl.draw')}
                  size="lg"
                  block
                  value={draw}
                  onValueChange={setDraw}
                  options={[
                    { value: 'quad', label: t('sg.ctl.draw.quad'), icon: <Crosshair /> },
                    { value: 'coords', label: t('sg.ctl.draw.coords'), icon: <MapPin /> },
                    { value: 'gps', label: t('sg.ctl.draw.gps'), icon: <LocateFixed /> },
                  ]}
                />
              </Spec>
            </div>
          </Panel>
          <Panel pad="md">
            <div className="flex flex-col gap-4">
              <Toggle checked={terrain} onCheckedChange={setTerrain} label={t('sg.ctl.terrain')} hint={t('sg.ctl.terrain.hint')} trailing />
              <Toggle checked={labels} onCheckedChange={setLabels} label={t('sg.ctl.labels')} trailing />
              <Toggle checked={false} onCheckedChange={() => {}} label={t('sg.ctl.overlay.lst')} disabled trailing />
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="t-label">{t('sg.ctl.opacity')}</span>
                  <span className="t-value text-xs">{opacity} %</span>
                </div>
                <Slider ariaLabel={t('sg.ctl.opacity')} value={opacity} onValueChange={setOpacity} min={0} max={100} step={5} fill formatValue={(v) => `${v} %`} />
              </div>
            </div>
          </Panel>
        </div>
      </Group>

      <Group title={t('sg.ctl.fields')} note={t('sg.ctl.fields.note')}>
        <Panel pad="md">
          <div className="grid gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
            <Field label={t('sg.ctl.ph')} htmlFor="sg-ph" hint={t('sg.ctl.ph.hint')} error={phBad ? t('sg.ctl.ph.error') : undefined} aside={<ProvenanceTag provenance="ground-truth" />}>
              <Input id="sg-ph" inputMode="decimal" numeric unit="pH" value={ph} onChange={(e) => setPh(e.target.value)} invalid={phBad} />
            </Field>
            <Field label={t('sg.ctl.area')} htmlFor="sg-area">
              <Input id="sg-area" numeric unit="ha" defaultValue="2.47" />
            </Field>
            <Field label={t('sg.ctl.sowing')} htmlFor="sg-sow">
              <Input id="sg-sow" type="date" defaultValue="2026-05-12" />
            </Field>
            <Field label={t('sg.ctl.crop')} htmlFor="sg-crop">
              <Select
                id="sg-crop"
                value={crop}
                onValueChange={setCrop}
                placeholder={t('sg.ctl.crop.placeholder')}
                options={[
                  { value: 'coffee', label: t('sg.ctl.crop.coffee'), hint: t('sg.ctl.crop.perennial') },
                  { value: 'pepper', label: t('sg.ctl.crop.pepper'), hint: t('sg.ctl.crop.perennial') },
                  { value: 'rice', label: t('sg.ctl.crop.rice'), hint: t('sg.ctl.crop.annual') },
                  { value: 'maize', label: t('sg.ctl.crop.maize'), hint: t('sg.ctl.crop.annual') },
                  { value: 'soy', label: t('sg.ctl.crop.soy'), hint: t('sg.ctl.crop.annual'), disabled: true },
                ]}
              />
            </Field>
            <Field label={t('sg.ctl.search')} htmlFor="sg-search">
              <Input id="sg-search" size="lg" prefix={<Search />} placeholder="Buôn Ma Thuột · 12.67, 108.04" />
            </Field>
            <Field label={t('sg.ctl.area')} htmlFor="sg-disabled">
              <Input id="sg-disabled" numeric unit="ha" defaultValue="2.47" disabled />
            </Field>
            <Field label={t('sg.ctl.note')} htmlFor="sg-note" className="md:col-span-2 xl:col-span-3">
              <Textarea id="sg-note" placeholder={t('sg.ctl.note.placeholder')} />
            </Field>
          </div>
        </Panel>
      </Group>

      <div className="grid gap-12 lg:grid-cols-2">
        <Group title={t('sg.ctl.tabs')}>
          <Panel pad="md">
            <Tabs<Track>
              ariaLabel={t('sg.ctl.tabs')}
              value={tab}
              onValueChange={setTab}
              tabs={[
                { value: 'journal', label: t('sg.ctl.tab.journal') },
                { value: 'seasons', label: t('sg.ctl.tab.seasons'), badge: <Tag tone="simulated">{t('design.status.simulated')}</Tag> },
                { value: 'finance', label: t('sg.ctl.tab.finance') },
              ]}
            >
              <TabPanel value="journal">
                <p className="text-sm text-ink-2">{t('sg.ctl.tab.journal.body')}</p>
              </TabPanel>
              <TabPanel value="seasons">
                <p className="text-sm text-ink-2">{t('sg.ctl.tab.seasons.body')}</p>
              </TabPanel>
              <TabPanel value="finance">
                <p className="text-sm text-ink-2">{t('sg.ctl.tab.finance.body')}</p>
              </TabPanel>
            </Tabs>
          </Panel>
        </Group>

        <Group title={t('sg.ctl.overlays')} note={t('sg.ctl.overlays.note')}>
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip content={t('sg.ctl.tooltip.body')}>
              <Button variant="ghost">{t('sg.ctl.tooltip')}</Button>
            </Tooltip>
            <Popover trigger={<Button>Popover</Button>} label={t('sg.hon.confidence')}>
              <ConfidenceBadge badge={specimenConfidence('soilMoisture')} variant="full" />
            </Popover>
            <Dialog
              trigger={<Button>{t('sg.ctl.dialog.open')}</Button>}
              title={t('sg.ctl.dialog.title')}
              description={t('sg.ctl.dialog.body')}
              size="sm"
              footer={
                <>
                  <Button variant="ghost">{t('sg.ctl.keep')}</Button>
                  <Button variant="danger">{t('sg.ctl.discard')}</Button>
                </>
              }
            />
            <Button onClick={() => setSheet(true)}>{t('sg.ctl.sheet.open')}</Button>
            <Sheet open={sheet} onOpenChange={setSheet} title={t('sg.ctl.sheet.title')} description={t('sg.ctl.sheet.body')} footer={<Button variant="primary" onClick={() => setSheet(false)}>{t('sg.ctl.apply')}</Button>}>
              <div className="flex flex-col gap-4">
                <Field label={t('sg.ctl.ph')} htmlFor="sg-sheet-ph" hint={t('sg.ctl.ph.hint')}>
                  <Input id="sg-sheet-ph" size="lg" numeric unit="pH" defaultValue="5.8" />
                </Field>
                <Field label={t('sg.ctl.sowing')} htmlFor="sg-sheet-sow">
                  <Input id="sg-sheet-sow" size="lg" type="date" defaultValue="2026-05-12" />
                </Field>
              </div>
            </Sheet>
          </div>
        </Group>
      </div>
    </Section>
  );
}

const PROV_SPEC: Record<Provenance, { source: string; detail: string }> = {
  observed: { source: 'MODIS MOD13Q1', detail: '250 m · 8 d' },
  modelled: { source: 'SMAP L4', detail: '9 km · 3 d' },
  derived: { source: 'FAO-56 ET0', detail: '50 km · 1 d' },
  forecast: { source: 'Open-Meteo', detail: '11 km · +15 d' },
  simulated: { source: 'mockTelemetry', detail: '' },
  'ground-truth': { source: 'pH', detail: '02-11-2026' },
};

export function HonestySection() {
  const t = useT();
  return (
    <Section id="honesty" title={t('sg.nav.honesty')}>
      <div className="grid gap-12 lg:grid-cols-2">
        <Group title={t('sg.hon.states')} note={t('sg.color.states.note')}>
          <Panel pad="md">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <StatusTag key={s} status={s} />
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-1 pt-4">
              {STATUSES.map((s) => (
                <StatusTag key={s} status={s} compact />
              ))}
              <span className="t-caption">compact</span>
            </div>
          </Panel>
        </Group>

        <Group title={t('sg.hon.provenance')} note={t('sg.hon.provenance.note')}>
          <Panel pad="md">
            <div className="flex flex-col gap-2">
              {PROVENANCES.map((p) => (
                <ProvenanceTag key={p} provenance={p} source={PROV_SPEC[p].source} detail={PROV_SPEC[p].detail || undefined} />
              ))}
            </div>
          </Panel>
        </Group>
      </div>

      <div className="grid gap-12 lg:grid-cols-2">
        <Group title={t('sg.hon.confidence')} note={t('sg.hon.confidence.note')}>
          <Panel pad="md">
            <div className="flex flex-wrap items-center gap-4">
              <ConfidenceBadge badge={specimenConfidence('vegetation')} />
              <ConfidenceBadge badge={specimenConfidence('thermal')} />
              <ConfidenceBadge badge={specimenConfidence('soilMoisture')} />
              <span className="h-5 w-px bg-line-2" aria-hidden />
              <ConfidenceBadge badge={specimenConfidence('vegetation')} variant="glyph" />
              <ConfidenceBadge badge={specimenConfidence('thermal')} variant="glyph" />
              <ConfidenceBadge badge={specimenConfidence('soilMoisture')} variant="glyph" />
            </div>
            <div className="mt-4 border-t border-line-1 pt-4">
              <ConfidenceBadge badge={specimenConfidence('rainfall')} variant="full" />
            </div>
          </Panel>
        </Group>

        <div className="flex flex-col gap-12">
          <Group title={t('sg.hon.anomaly')} note={t('sg.hon.anomaly.note')}>
            <Panel pad="md">
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {(['info', 'watch', 'alert'] as const).map((s) => (
                  <li key={s} className="flex items-center gap-2 text-sm">
                    <AnomalyMarker severity={s} label={t(`sg.hon.anomaly.${s}`)} />
                    <span className="text-ink-2">{t(`sg.hon.anomaly.${s}`)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </Group>
          <Group title={t('sg.hon.tags')}>
            <div className="flex flex-wrap gap-2">
              <Tag>{t('sg.hon.tag.perennial')}</Tag>
              <Tag variant="soft">{t('sg.hon.tag.us')}</Tag>
              <Tag tone="watch" size="md">
                {t('sg.hon.tag.review')}
              </Tag>
              <Tag tone="alert" variant="soft">
                pH 4.6
              </Tag>
              <Tag tone="nominal">17 / 20</Tag>
              <Tag tone="simulated">{t('design.status.simulated')}</Tag>
            </div>
          </Group>
        </div>
      </div>

      <Group title={t('sg.hon.stats')}>
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel pad="md">
            <div className="flex flex-col gap-4">
              <Stat label={t('sg.hon.stat.margin')} value="1 420" unit="USD/ha" delta="+18 %" deltaLabel={t('sg.hon.stat.margin.delta')} trend="up" tone="nominal" size="lg" />
              <div className="grid grid-cols-2 gap-4 border-t border-line-1 pt-4">
                <Stat label={t('sg.hon.stat.water')} value="212" unit="mm" hint={t('sg.hon.stat.water.hint')} />
                <Stat label={t('sg.hon.stat.yield')} value="2.8" unit="t/ha" hint={t('sg.hon.stat.yield.hint')} />
              </div>
              <Stat label={t('sg.hon.stat.yield')} value={null} unit="t/ha" size="sm" />
            </div>
          </Panel>
          <Panel pad="md">
            <div className="flex flex-col gap-4">
              <Meter label={t('sg.hon.meter.suit')} value={78} reference={64} valueLabel="78" />
              <Meter label={t('sg.hon.meter.soil')} value={61} reference={48} valueLabel="61" />
              <Meter label={t('sg.hon.meter.risk')} value={72} valueLabel="72" tone="watch" />
              <Meter label={t('sg.hon.meter.ph')} value={5.2} min={3} max={9} target={[5.5, 6.5]} valueLabel="5.2" />
              <Meter label={t('sg.hon.meter.suit')} value={null} valueLabel="--" />
            </div>
          </Panel>
          <Panel pad="md">
            <dl className="m-0">
              <KeyValue label={t('sg.hon.kv.elevation')} numeric>
                512 m
              </KeyValue>
              <KeyValue label={t('sg.hon.kv.slope')} numeric>
                3.2°
              </KeyValue>
              <KeyValue label={t('sg.hon.kv.texture')}>{t('sg.hon.kv.texture.v')}</KeyValue>
              <KeyValue label={t('sg.hon.kv.centroid')} numeric>
                12.8000°N 108.2000°E
              </KeyValue>
            </dl>
          </Panel>
        </div>
      </Group>

      <div className="grid gap-12 lg:grid-cols-2">
        <Group title={t('sg.hon.feedback')}>
          <div className="flex flex-col gap-4">
            <EmptyState icon={<Crosshair />} title={t('sg.hon.empty.title')} body={t('sg.hon.empty.body')} action={<Button variant="primary">{t('sg.hon.empty.action')}</Button>} />
            <Panel pad="md">
              <EmptyState layout="inline" icon={<CloudOff />} title={t('sg.hon.empty.inline')} body={t('sg.hon.empty.inline.body')} action={<Button size="sm">{t('sg.hon.retry')}</Button>} />
              <div className="mt-3 flex flex-col gap-3 border-t border-line-1 pt-3">
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-9 w-full" />
                <SkeletonText lines={3} />
              </div>
            </Panel>
          </div>
        </Group>
        <Group title={t('sg.hon.legend')}>
          <Panel pad="md">
            <div className="flex flex-col gap-5">
              <RampLegend metric="vegetation" label={t('sg.hon.legend.ndvi')} min={0} max={1} value={0.63} />
              <RampLegend metric="rain" mode="diverging" label={t('sg.hon.legend.rain')} min={-100} max={100} unit="%" value={-32} />
            </div>
          </Panel>
        </Group>
      </div>
    </Section>
  );
}
