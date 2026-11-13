import type { BranchId, BranchTelemetry, Cadence, FieldTelemetry, ISODate, Parcel, Series, SourceRef, StaticFact } from '@/contracts';
import { tx } from '@/contracts';
import { BRANCH_TITLES } from '@/lib/series';
import { addDays, dayOfYear, eachDay, todayISO } from '@/lib/time';

/**
 * Simulated telemetry. Exists so the globe, HUD and timeline can be built before the live
 * adapters land, and as the last-resort fallback when every source is unreachable. Everything it
 * emits is tagged `simulated` so the UI can never present it as an observation.
 */

function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIM: SourceRef = {
  id: 'sim',
  name: 'Simulated placeholder',
  agency: 'Astrovivu',
  provenance: 'simulated',
  resolutionM: null,
  cadenceDays: null,
  latencyDays: 0,
  access: 'local generator',
  url: '',
};

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export function mockTelemetry(parcel: Parcel, today: ISODate = todayISO()): FieldTelemetry {
  const rand = seeded(parcel.id);
  const start = addDays(today, -364);
  const lat = parcel.centroid[1];
  const peak = lat >= 0 ? 215 : 35;
  /** 0..1 seasonal wetness/warmth, optionally lagged by `lag` days. */
  const season = (t: ISODate, lag = 0) => (Math.cos(((dayOfYear(t) - peak - lag) / 365) * 2 * Math.PI) + 1) / 2;
  const days = eachDay(start, today);

  const rain = new Map<ISODate, number>();
  const smSurface = new Map<ISODate, number>();
  const smRoot = new Map<ISODate, number>();
  let wet = 0.4;
  let root = 0.4;
  for (const t of days) {
    const r = rand() < 0.08 + 0.42 * season(t) ? -Math.log(1 - rand()) * (4 + 14 * season(t)) : 0;
    rain.set(t, r);
    wet = Math.min(1, wet * 0.9 + r / 60);
    root = root * 0.97 + wet * 0.03;
    smSurface.set(t, 0.08 + 0.3 * wet);
    smRoot.set(t, 0.12 + 0.26 * root);
  }

  const mk = (
    key: string,
    branch: BranchId,
    label: [string, string],
    unit: string,
    cadence: Cadence,
    step: number,
    f: (t: ISODate) => number,
    opts: { primary?: boolean; range?: [number, number]; from?: ISODate; to?: ISODate } = {},
  ): Series => ({
    key,
    branch,
    label: tx(label[0], label[1]),
    unit,
    sourceId: SIM.id,
    cadence,
    primary: opts.primary,
    range: opts.range,
    samples: eachDay(opts.from ?? start, opts.to ?? today, step).map((t) => ({ t, v: round(f(t)) })),
  });
  const noise = (amp: number) => (rand() - 0.5) * 2 * amp;
  const tempBase = 31 - Math.min(Math.abs(lat), 50) * 0.35;

  const fact = (key: string, branch: BranchId, label: [string, string], value: number | string, unit?: string): StaticFact => ({
    key,
    branch,
    label: tx(label[0], label[1]),
    value,
    unit,
    sourceId: SIM.id,
  });

  const forecastEnd = addDays(today, 15);
  const series: Record<BranchId, Series[]> = {
    soilMoisture: [
      mk('sm_surface', 'soilMoisture', ['Surface (0-5 cm)', 'Tầng mặt (0-5 cm)'], 'm³/m³', 'daily', 1, (t) => smSurface.get(t) ?? 0.2, { range: [0.05, 0.45] }),
      mk('sm_root', 'soilMoisture', ['Root zone (0-100 cm)', 'Vùng rễ (0-100 cm)'], 'm³/m³', 'daily', 1, (t) => smRoot.get(t) ?? 0.2, { primary: true, range: [0.05, 0.45] }),
    ],
    vegetation: [
      mk('ndvi', 'vegetation', ['NDVI', 'NDVI'], '', '16-day', 16, (t) => 0.3 + 0.45 * season(t, 35) + noise(0.03), { primary: true, range: [0, 1] }),
      mk('evi', 'vegetation', ['EVI', 'EVI'], '', '16-day', 16, (t) => 0.18 + 0.3 * season(t, 35) + noise(0.02), { range: [0, 1] }),
    ],
    thermal: [
      mk('lst_day', 'thermal', ['Land surface temperature', 'Nhiệt độ bề mặt đất'], '°C', '8-day', 8, (t) => tempBase + 9 - 8 * season(t, 20) + noise(1.5), { primary: true, range: [10, 50] }),
      mk('esi', 'thermal', ['Evaporative stress index', 'Chỉ số stress bốc thoát hơi'], 'σ', 'weekly', 7, (t) => -1.4 + 2.2 * season(t, 25) + noise(0.4), { range: [-3, 3] }),
    ],
    rainfall: [mk('rain', 'rainfall', ['Daily rainfall', 'Mưa ngày'], 'mm/day', 'daily', 1, (t) => rain.get(t) ?? 0, { primary: true, range: [0, 60] })],
    agromet: [
      mk('par', 'agromet', ['Photosynthetic radiation', 'Bức xạ quang hợp'], 'MJ/m²/day', 'daily', 1, (t) => 9.5 - 2.5 * season(t) + noise(1.2), { primary: true, range: [0, 14] }),
      mk('t2m_max', 'agromet', ['Air temperature max', 'Nhiệt độ không khí cao nhất'], '°C', 'daily', 1, (t) => tempBase + 3 - 3 * season(t, 30) + noise(1.5), { range: [0, 45] }),
      mk('t2m_min', 'agromet', ['Air temperature min', 'Nhiệt độ không khí thấp nhất'], '°C', 'daily', 1, (t) => tempBase - 9 + 2 * season(t, 30) + noise(1.2), { range: [-10, 35] }),
      mk('rh', 'agromet', ['Relative humidity', 'Độ ẩm không khí'], '%', 'daily', 1, (t) => 55 + 30 * season(t) + noise(5), { range: [0, 100] }),
      mk('et0', 'agromet', ['Reference evapotranspiration', 'Bốc thoát hơi tham chiếu'], 'mm/day', 'daily', 1, (t) => 5.2 - 1.8 * season(t) + noise(0.4), { range: [0, 9] }),
    ],
    terrain: [],
    soil: [],
    risk: [
      mk('fc_tmax', 'risk', ['Forecast max temperature', 'Dự báo nhiệt độ cao nhất'], '°C', 'daily', 1, (t) => tempBase + 3 - 3 * season(t, 30) + noise(2), { primary: true, from: today, to: forecastEnd, range: [0, 45] }),
      mk('fc_rain', 'risk', ['Forecast rainfall', 'Dự báo mưa'], 'mm/day', 'daily', 1, (t) => (rand() < 0.3 ? rand() * 25 * season(t) : 0), { from: today, to: forecastEnd, range: [0, 60] }),
    ],
  };

  const facts: Record<BranchId, StaticFact[]> = {
    soilMoisture: [],
    vegetation: [],
    thermal: [],
    rainfall: [],
    agromet: [],
    terrain: [
      fact('elevation_m', 'terrain', ['Elevation', 'Độ cao'], Math.round(200 + rand() * 500), 'm'),
      fact('slope_deg', 'terrain', ['Slope', 'Độ dốc'], round(1 + rand() * 6, 1), '°'),
      fact('aspect_label', 'terrain', ['Aspect', 'Hướng dốc'], 'SE'),
      fact('flow_dir_label', 'terrain', ['Drains toward', 'Hướng thoát nước'], 'SE'),
    ],
    soil: [
      fact('ph', 'soil', ['pH (water)', 'pH (nước)'], round(5.2 + rand() * 1.6, 1)),
      fact('soc_gkg', 'soil', ['Organic carbon', 'Carbon hữu cơ'], round(12 + rand() * 20, 1), 'g/kg'),
      fact('clay_pct', 'soil', ['Clay', 'Sét'], Math.round(18 + rand() * 25), '%'),
      fact('sand_pct', 'soil', ['Sand', 'Cát'], Math.round(20 + rand() * 30), '%'),
      fact('texture_class', 'soil', ['Texture', 'Kết cấu'], 'medium'),
    ],
    risk: [],
  };

  const branches = {} as Record<BranchId, BranchTelemetry>;
  for (const id of Object.keys(series) as BranchId[]) {
    branches[id] = {
      id,
      title: BRANCH_TITLES[id],
      series: series[id],
      facts: facts[id],
      sources: [SIM.id],
      status: 'ok',
      confidence: {
        level: 'low',
        score: 0.3,
        reasons: [tx('Simulated placeholder data, not an observation.', 'Dữ liệu giả lập, không phải quan sát thật.')],
      },
    };
  }
  branches.risk.events = [
    {
      id: 'sim-heat',
      kind: 'heat',
      start: addDays(today, 3),
      end: addDays(today, 5),
      severity: 2,
      title: tx('Heat spell (simulated)', 'Đợt nắng nóng (giả lập)'),
      detail: tx('Three days above 35 °C in the forecast.', 'Ba ngày trên 35 °C trong dự báo.'),
      sourceId: SIM.id,
    },
  ];

  const thisYear = Number(today.slice(0, 4));
  const climateHistory = Array.from({ length: 10 }, (_, k) => {
    const year = thisYear - 10 + k;
    return {
      year,
      months: Array.from({ length: 12 }, (_, m) => {
        const mid = `${year}-${String(m + 1).padStart(2, '0')}-15`;
        const tMax = round(tempBase + 3 - 3 * season(mid, 30) + noise(0.8), 1);
        const tMin = round(tempBase - 9 + 2 * season(mid, 30) + noise(0.8), 1);
        return { month: m + 1, rainMm: Math.round((8 + 250 * season(mid)) * (0.7 + 0.6 * rand())), tMean: round((tMax + tMin) / 2, 1), tMin, tMax };
      }),
    };
  });

  return {
    parcelId: parcel.id,
    generatedAt: new Date().toISOString(),
    window: { start, end: today, today, forecastEnd },
    branches,
    sources: { [SIM.id]: SIM },
    mode: 'mock',
    climateHistory,
    climateSourceId: SIM.id,
  };
}
