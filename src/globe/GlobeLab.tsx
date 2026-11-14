/**
 * Bench for the map at `#/globe-lab`: every state of the globe reachable from one panel, driven
 * through the same mission store the real UI uses, with a frame meter. Scripted runs are also
 * exposed on `window.__globeLab` so measurements can be repeated from the console.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BaseLayerId, DrawMode, FieldRaster, LngLat, OverlayId } from '@/contracts';
import { BRANCHES, pick } from '@/contracts';
import { SAMPLE_PARCELS } from '@/data';
import { useT } from '@/i18n';
import { bboxOf } from '@/lib/geo';
import { encodeFrame, valueToByte } from '@/lib/raster';
import { addDays, diffDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { draftToParcel, isLockable, squareDraft } from './draft';
import { getActiveGlobe, type MotionPref } from './engine';
import { GlobeCanvas, motionFromQuery } from './GlobeCanvas';
import { getTileStats } from './net';
import { OVERLAYS } from './overlays';
import { FrameMeter, type FrameStats } from './perf';
import { paintForSeries } from './ramps';
import { useGlobeStatus } from './status';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(test: () => boolean, timeoutMs: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (test()) return true;
    await sleep(50);
  }
  return false;
}

const meter = new FrameMeter();

/** Waits until a flight that is expected to start has started and finished. */
async function flightDone(timeoutMs = 16_000): Promise<void> {
  await waitFor(() => useGlobeStatus.getState().flying, 400);
  await waitFor(() => !useGlobeStatus.getState().flying, timeoutMs);
}

const scenarios = {
  /** Explore view to a locked demo field: frame intervals during the flight, then while tiles settle. */
  async flyIn(id: string = SAMPLE_PARCELS[0].id): Promise<{ flight: FrameStats; settle: FrameStats }> {
    const m = useMission.getState();
    if (m.parcel) {
      m.unlockParcel();
      await flightDone();
      await sleep(1200);
    } else if (m.phase !== 'explore') {
      m.setPhase('explore');
      await flightDone();
      await sleep(1200);
    }
    meter.beginRecording();
    void useMission.getState().lockSample(id);
    await flightDone();
    const flight = meter.endRecording();
    meter.beginRecording();
    await sleep(2500);
    return { flight, settle: meter.endRecording() };
  },

  /** Drags the timeline cursor across the whole window, one store write per frame. */
  async scrub(seconds = 6): Promise<FrameStats> {
    const { timeline, setCursor } = useMission.getState();
    const days = diffDays(timeline.end, timeline.start);
    meter.beginRecording();
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / (seconds * 1000));
        // There and back, so the run ends where it started.
        const u = t < 0.5 ? t * 2 : 2 - t * 2;
        setCursor(addDays(timeline.start, Math.round(u * days)));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return meter.endRecording();
  },

  /** The hero globe turning on its own. */
  async hero(seconds = 5): Promise<FrameStats> {
    const m = useMission.getState();
    if (m.parcel) m.unlockParcel();
    useMission.getState().setPhase('hero');
    await flightDone();
    await sleep(1500);
    meter.beginRecording();
    await sleep(seconds * 1000);
    return meter.endRecording();
  },

  /** Timeline playback as the store runs it (one step every 110 ms). */
  async play(seconds = 6): Promise<FrameStats> {
    const m = useMission.getState();
    m.setCursor(m.timeline.start);
    meter.beginRecording();
    m.play();
    await sleep(seconds * 1000);
    useMission.getState().pause();
    return meter.endRecording();
  },

  /**
   * SYNTHETIC test raster over the locked parcel (bench only, never shipped into the app): an
   * NDVI-like field with a gradient and a wet patch that grows through the year, one frame a month.
   */
  syntheticRaster(key = 'ndvi'): boolean {
    const m = useMission.getState();
    if (!m.parcel) return false;
    const [w, s, e, n] = bboxOf(m.parcel.polygon);
    const width = 36;
    const height = Math.max(8, Math.round((width * (n - s)) / ((e - w) * Math.cos(((n + s) / 2) * (Math.PI / 180)))));
    const frames: FieldRaster['frames'] = [];
    for (let k = 0; k < 12; k++) {
      const t = addDays(m.timeline.start, Math.round((k * diffDays(m.timeline.end, m.timeline.start)) / 11));
      const bytes = new Uint8Array(width * height);
      const season = 0.5 + 0.45 * Math.sin((k / 12) * Math.PI * 2);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const patch = Math.exp(-(((x - width * 0.3) / (width * 0.25)) ** 2 + ((y - height * 0.6) / (height * 0.3)) ** 2));
          const v = Math.max(0, Math.min(1, season * (0.55 + 0.35 * (x / width)) - 0.35 * patch * (k / 11) + 0.04 * Math.sin(x * 1.7 + y)));
          bytes[y * width + x] = valueToByte({ scale: 1 / 254, offset: 0 }, v);
        }
      frames.push({ t, data: encodeFrame(bytes), coverage: 1, scene: 'SYNTHETIC' });
    }
    const raster: FieldRaster = {
      key,
      branch: 'vegetation',
      label: { en: 'SYNTHETIC test raster (bench)', vi: 'Raster thử nghiệm GIẢ LẬP (bench)' },
      unit: '',
      sourceId: 'synthetic-bench',
      ramp: 'vegetation',
      cellM: 10,
      width,
      height,
      corners: [
        [w, n],
        [e, n],
        [e, s],
        [w, s],
      ],
      scale: 1 / 254,
      offset: 0,
      range: [0, 1],
      cadence: 'monthly' as FieldRaster['cadence'],
      frames,
    };
    useMission.setState({ rasters: [raster] });
    useMission.getState().setParcelMetric(key);
    return true;
  },

  /** Simulated user input on the canvas: a drag of `px` pixels, then wheel zoom in and out. */
  async gesture(): Promise<{ drag: FrameStats; wheel: FrameStats }> {
    const canvas = getActiveGlobe()?.map.getCanvas();
    if (!canvas) throw new Error('no map');
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const opts = (x: number, y: number, buttons: number): MouseEventInit => ({ bubbles: true, clientX: x, clientY: y, button: 0, buttons });
    meter.beginRecording();
    canvas.dispatchEvent(new MouseEvent('mousedown', opts(cx, cy, 1)));
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 1500);
        window.dispatchEvent(new MouseEvent('mousemove', opts(cx - 220 * Math.sin(t * Math.PI), cy - 60 * t, 1)));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    window.dispatchEvent(new MouseEvent('mouseup', opts(cx, cy - 60, 0)));
    await sleep(600);
    const drag = meter.endRecording();
    meter.beginRecording();
    for (let i = 0; i < 24; i++) {
      canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: i < 12 ? -100 : 100, deltaMode: 0 }));
      await sleep(60);
    }
    await sleep(700);
    return { drag, wheel: meter.endRecording() };
  },

  /** Records while nothing is asked of the map: the baseline. */
  async idle(seconds = 3): Promise<FrameStats> {
    meter.beginRecording();
    await sleep(seconds * 1000);
    return meter.endRecording();
  },
};

declare global {
  interface Window {
    __globeLab?: typeof scenarios & { meter: FrameMeter; mission: typeof useMission; status: typeof useGlobeStatus; globe: typeof getActiveGlobe; tiles: typeof getTileStats };
  }
}

const formatStats = (s: FrameStats): string =>
  `${s.fps} fps over ${s.seconds} s (${s.frames} frames)\np50 ${s.p50}  p95 ${s.p95}  p99 ${s.p99}  max ${s.max} ms\ndropped >25 ms: ${s.dropped}   hitches >50 ms: ${s.hitches}`;

export function GlobeLab() {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [motion, setMotion] = useState<MotionPref>(motionFromQuery);
  const [coords, setCoords] = useState({ lat: 12.8012, lng: 108.2021, area: 2 });
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [, setTick] = useState(0);

  const phase = useMission((s) => s.phase);
  const lang = useMission((s) => s.lang);
  const parcelId = useMission((s) => s.parcel?.id ?? null);
  const drawMode = useMission((s) => s.drawMode);
  const draft = useMission((s) => s.draft);
  const layers = useMission((s) => s.layers);
  const timeline = useMission((s) => s.timeline);
  const telemetry = useMission((s) => s.telemetry);
  const status = useGlobeStatus();

  const anchorRef = useRef<HTMLDivElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLPreElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);

  // Everything that changes per frame is written straight to the DOM: a bench that re-rendered
  // React on every frame would be measuring itself.
  useEffect(() => {
    meter.start();
    window.__globeLab = { ...scenarios, meter, mission: useMission, status: useGlobeStatus, globe: getActiveGlobe, tiles: getTileStats };
    const unsubscribe = useMission.subscribe((s, prev) => {
      if (s.anchor === prev.anchor) return;
      const el = anchorRef.current;
      if (!el) return;
      const a = s.anchor;
      el.style.display = a && a.visible ? 'block' : 'none';
      if (a) {
        el.style.left = `${a.x - a.w / 2}px`;
        el.style.top = `${a.y - a.h / 2}px`;
        el.style.width = `${a.w}px`;
        el.style.height = `${a.h}px`;
      }
    });
    const interval = setInterval(() => {
      const fps = meter.liveFps();
      if (fpsRef.current) fpsRef.current.textContent = `${fps.toFixed(0)} fps`;
      const globe = getActiveGlobe();
      const a = useMission.getState().anchor;
      if (readoutRef.current && globe) {
        const c = globe.getCamera();
        const tiles = [...getTileStats()].map(([host, s]) => `${host.split('.').slice(-3, -1).join('.')}: ${s.ok} ok, ${s.failed} failed, ${s.missing} missing, ${s.inFlight}+${s.queued} busy`);
        readoutRef.current.textContent = [
          `camera  ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}  z ${c.zoom.toFixed(2)}  pitch ${c.pitch.toFixed(0)}  bearing ${c.bearing.toFixed(0)}`,
          `anchor  ${a ? `${a.x}, ${a.y}  ${a.w} x ${a.h}  ${a.visible ? 'visible' : 'hidden'}` : 'null'}`,
          ...tiles,
        ].join('\n');
      }
      const canvas = sparkRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const w = (canvas.width = canvas.clientWidth);
        const h = (canvas.height = canvas.clientHeight);
        ctx.clearRect(0, 0, w, h);
        // One bar per frame, 50 ms full scale; the line marks the 16.7 ms budget.
        const data = meter.recent;
        const bar = w / 240;
        for (let i = 0; i < data.length; i++) {
          const v = Math.min(1, data[i] / 50);
          ctx.fillStyle = data[i] > 25 ? '#ff5a50' : data[i] > 18 ? '#f8bd40' : '#58da98';
          ctx.fillRect(i * bar, h - v * h, Math.max(1, bar - 0.5), v * h);
        }
        ctx.fillStyle = 'rgba(237,235,228,0.5)';
        ctx.fillRect(0, h - (16.7 / 50) * h, w, 1);
      }
    }, 250);
    return () => {
      meter.stop();
      unsubscribe();
      clearInterval(interval);
      delete window.__globeLab;
    };
  }, []);

  // A slow tick keeps status text (overlay date, flight flag) fresh without per-frame renders.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const metricOptions = useMemo(() => {
    if (!telemetry) return [];
    return BRANCHES.flatMap((b) => telemetry.branches[b].series).filter((s) => paintForSeries(s));
  }, [telemetry]);

  const run = async (name: string, fn: () => Promise<FrameStats | { flight: FrameStats; settle: FrameStats }>) => {
    setBusy(true);
    setResult(`${name} ...`);
    try {
      const out = await fn();
      const text = 'flight' in out ? `flight\n${formatStats(out.flight)}\nsettle\n${formatStats(out.settle)}` : formatStats(out);
      setResult(`${name}\n${text}`);
    } catch (err) {
      setResult(`${name} failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const store = useMission.getState;
  const startMode = (mode: DrawMode) => {
    const s = store();
    if (s.parcel) s.unlockParcel();
    if (store().phase !== 'explore') store().setPhase('explore');
    store().startDraw(mode);
    if (mode === 'coords') store().setDraft(squareDraft('coords', [coords.lng, coords.lat], coords.area));
    if (mode === 'gps') {
      const place = (at: LngLat) => store().setDraft(squareDraft('gps', at, coords.area));
      if (!navigator.geolocation) place([coords.lng, coords.lat]);
      else
        navigator.geolocation.getCurrentPosition(
          (p) => place([p.coords.longitude, p.coords.latitude]),
          () => place([coords.lng, coords.lat]),
          { timeout: 5000 },
        );
    }
  };
  const lockDraft = () => {
    const parcel = draftToParcel(store().draft, 'Bench field');
    if (parcel) void store().lockParcel(parcel);
  };

  const days = diffDays(timeline.end, timeline.start);
  const day = diffDays(timeline.cursor, timeline.start);
  const pressed = (on: boolean) => ({ 'aria-pressed': on }) as const;

  return (
    <div className="globe-lab">
      <GlobeCanvas motion={motion} />
      <div className="globe-lab__anchor" ref={anchorRef} style={{ display: 'none' }} />
      {!open && (
        <button type="button" className="globe-lab__toggle" onClick={() => setOpen(true)}>
          {t('globe.lab.expand')}
        </button>
      )}
      <aside className="globe-lab__panel" hidden={!open} aria-label={t('globe.lab.title')}>
        <div className="globe-lab__row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('globe.lab.title')}</h2>
          <button type="button" onClick={() => setOpen(false)}>
            {t('globe.lab.collapse')}
          </button>
        </div>

        <fieldset>
          <legend>{t('globe.lab.perf')}</legend>
          <div className="globe-lab__row" style={{ justifyContent: 'space-between' }}>
            <div className="globe-lab__fps" ref={fpsRef}>
              -- fps
            </div>
            <button
              type="button"
              {...pressed(recording)}
              onClick={() => {
                if (meter.isRecording) {
                  setResult(`manual\n${formatStats(meter.endRecording())}`);
                  setRecording(false);
                } else {
                  meter.beginRecording();
                  setRecording(true);
                }
              }}
            >
              {recording ? t('globe.lab.stop') : t('globe.lab.record')}
            </button>
          </div>
          <canvas className="globe-lab__spark" ref={sparkRef} />
          <div className="globe-lab__row">
            <button type="button" disabled={busy} onClick={() => void run('fly-in', () => scenarios.flyIn(parcelId ?? SAMPLE_PARCELS[0].id))}>
              {t('globe.lab.runFly')}
            </button>
            <button type="button" disabled={busy || !parcelId} onClick={() => void run('scrub', () => scenarios.scrub())}>
              {t('globe.lab.runScrub')}
            </button>
            <button type="button" disabled={busy} onClick={() => void run('hero', () => scenarios.hero())}>
              {t('globe.lab.runRotate')}
            </button>
          </div>
          {result && <pre className="globe-lab__mono">{result}</pre>}
        </fieldset>

        <fieldset>
          <legend>
            {t('globe.lab.state')}: {phase}
            {status.flying ? ' (flying)' : ''}
          </legend>
          <div className="globe-lab__row">
            <button
              type="button"
              {...pressed(phase === 'hero')}
              onClick={() => {
                if (store().parcel) store().unlockParcel();
                store().cancelDraw();
                store().setPhase('hero');
              }}
            >
              {t('globe.lab.hero')}
            </button>
            <button
              type="button"
              {...pressed(phase === 'explore' && !parcelId)}
              onClick={() => {
                if (store().parcel) store().unlockParcel();
                else store().setPhase('explore');
              }}
            >
              {t('globe.lab.explore')}
            </button>
            <button type="button" disabled={!parcelId} onClick={() => store().unlockParcel()}>
              {t('globe.lab.unlock')}
            </button>
          </div>
          <div className="globe-lab__row">
            {SAMPLE_PARCELS.map((p) => (
              <button key={p.id} type="button" {...pressed(parcelId === p.id)} onClick={() => void store().lockSample(p.id)} title={p.name}>
                {p.id}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>{t('globe.lab.draw')}</legend>
          <div className="globe-lab__row">
            <button type="button" {...pressed(drawMode === 'quad')} onClick={() => startMode('quad')}>
              {t('globe.lab.quad')}
            </button>
            <button type="button" {...pressed(drawMode === 'coords')} onClick={() => startMode('coords')}>
              {t('globe.lab.coords')}
            </button>
            <button type="button" {...pressed(drawMode === 'gps')} onClick={() => startMode('gps')}>
              {t('globe.lab.gps')}
            </button>
          </div>
          <div className="globe-lab__row">
            <label>
              {t('globe.lab.lat')}
              <input type="number" step="0.0001" value={coords.lat} onChange={(e) => setCoords({ ...coords, lat: Number(e.target.value) })} />
            </label>
            <label>
              {t('globe.lab.lng')}
              <input type="number" step="0.0001" value={coords.lng} onChange={(e) => setCoords({ ...coords, lng: Number(e.target.value) })} />
            </label>
            <label>
              {t('globe.lab.area')}
              <input type="number" step="0.5" min="0.1" value={coords.area} onChange={(e) => setCoords({ ...coords, area: Number(e.target.value) })} />
            </label>
          </div>
          <div className="globe-lab__row">
            <button type="button" disabled={!drawMode && !draft} onClick={() => store().cancelDraw()}>
              {t('globe.lab.cancel')}
            </button>
            <button type="button" disabled={!isLockable(draft)} onClick={lockDraft}>
              {t('globe.lab.lockDraft')}
            </button>
          </div>
          <div className="globe-lab__mono">
            {t('globe.lab.draft')}: {draft ? `${draft.mode}, ${draft.vertices.length} pts, ${draft.closed ? 'closed' : 'open'}, ${draft.areaHa ?? '--'} ha` : 'null'}
            {status.notice ? `\n${t(status.notice)}` : ''}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            {t('globe.lab.time')}: {timeline.cursor}
          </legend>
          <div className="globe-lab__row">
            <input type="range" min={0} max={days} value={day} onChange={(e) => store().setCursor(addDays(timeline.start, Number(e.target.value)))} aria-label={t('globe.lab.time')} />
            <button type="button" onClick={() => (timeline.playing ? store().pause() : store().play())}>
              {timeline.playing ? t('globe.lab.pause') : t('globe.lab.play')}
            </button>
          </div>
          <label>
            {t('globe.lab.metric')}
            <select value={layers.parcelMetric ?? ''} onChange={(e) => store().setParcelMetric(e.target.value || null)}>
              <option value="">{t('globe.lab.none')}</option>
              {metricOptions.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.key} ({pick(s.label, lang)})
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>{t('globe.lab.overlay')}</legend>
          <select value={layers.overlay} onChange={(e) => store().setOverlay(e.target.value as OverlayId)}>
            {OVERLAYS.map((o) => (
              <option key={o.id} value={o.id}>
                {pick(o.label, lang)}
              </option>
            ))}
          </select>
          <div className="globe-lab__row">
            {t('globe.lab.opacity')}
            <input type="range" min={0} max={1} step={0.05} value={layers.overlayOpacity} onChange={(e) => store().setOverlayOpacity(Number(e.target.value))} aria-label={t('globe.lab.opacity')} />
          </div>
          <div className="globe-lab__mono">
            {t('globe.lab.overlayDate')}: {status.overlay.date ?? '--'} ({status.overlay.state}
            {status.overlay.ageDays != null ? `, ${status.overlay.ageDays} d` : ''}
            {status.overlay.stale ? ', stale' : ''})
          </div>
        </fieldset>

        <fieldset>
          <legend>{t('globe.lab.base')}</legend>
          <div className="globe-lab__row">
            {(['satellite', 'terrain', 'labels'] as BaseLayerId[]).map((id) => (
              <label key={id}>
                <input type="checkbox" checked={layers.base[id]} onChange={(e) => store().setBaseLayer(id, e.target.checked)} />
                {t(`globe.lab.${id}`)}
              </label>
            ))}
          </div>
          <div className="globe-lab__mono">
            imagery {status.imagery} | terrain {status.terrain ? 'on' : 'off'} | webgl {status.webgl ? 'ok' : 'none'}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            {t('globe.lab.motion')}: {status.reducedMotion ? 'reduced' : 'full'}
          </legend>
          <div className="globe-lab__row">
            {(['auto', 'full', 'reduced'] as MotionPref[]).map((m) => (
              <button key={m} type="button" {...pressed(motion === m)} onClick={() => setMotion(m)}>
                {t(m === 'auto' ? 'globe.lab.motionAuto' : m === 'full' ? 'globe.lab.motionFull' : 'globe.lab.motionReduced')}
              </button>
            ))}
          </div>
          <div className="globe-lab__row">
            {t('globe.lab.lang')}
            <button type="button" {...pressed(lang === 'en')} onClick={() => store().setLang('en')}>
              EN
            </button>
            <button type="button" {...pressed(lang === 'vi')} onClick={() => store().setLang('vi')}>
              VI
            </button>
          </div>
        </fieldset>

        <pre className="globe-lab__mono" ref={readoutRef} />
      </aside>
    </div>
  );
}
