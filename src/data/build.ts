/** Helpers that turn adapter output into contract objects, with bilingual labels. */
import type { BranchId, Cadence, I18nText, Sample, Series, StaticFact } from '@/contracts';
import { tx } from '@/contracts';

export const LABELS: Record<string, I18nText> = {
  sm_surface: tx('Surface soil moisture (0-7 cm)', 'Độ ẩm đất tầng mặt (0-7 cm)'),
  sm_root: tx('Root-zone soil moisture (0-100 cm)', 'Độ ẩm vùng rễ (0-100 cm)'),
  gwet_top: tx('Surface soil wetness (MERRA-2)', 'Độ ướt đất tầng mặt (MERRA-2)'),
  gwet_root: tx('Root-zone soil wetness (MERRA-2)', 'Độ ướt đất vùng rễ (MERRA-2)'),
  ndvi: tx('NDVI', 'NDVI'),
  evi: tx('EVI', 'EVI'),
  lst_day: tx('Daytime land surface temperature', 'Nhiệt độ bề mặt đất ban ngày'),
  lst_night: tx('Night-time land surface temperature', 'Nhiệt độ bề mặt đất ban đêm'),
  esi: tx('Evaporative stress index', 'Chỉ số stress bốc thoát hơi'),
  et: tx('Actual evapotranspiration', 'Bốc thoát hơi thực tế'),
  rain: tx('Daily rainfall', 'Mưa ngày'),
  rain_era5: tx('Daily rainfall (ERA5, to today)', 'Mưa ngày (ERA5, đến hôm nay)'),
  rain_anom: tx('30-day rainfall, % of normal', 'Mưa 30 ngày, % so với bình thường'),
  par: tx('Photosynthetic radiation', 'Bức xạ quang hợp'),
  t2m_max: tx('Air temperature max', 'Nhiệt độ không khí cao nhất'),
  t2m_min: tx('Air temperature min', 'Nhiệt độ không khí thấp nhất'),
  t2m: tx('Air temperature mean', 'Nhiệt độ không khí trung bình'),
  rh: tx('Relative humidity', 'Độ ẩm không khí'),
  wind: tx('Wind speed (2 m)', 'Tốc độ gió (2 m)'),
  et0: tx('Reference evapotranspiration (FAO-56)', 'Bốc thoát hơi tham chiếu (FAO-56)'),
  fc_tmax: tx('Forecast max temperature', 'Dự báo nhiệt độ cao nhất'),
  fc_tmin: tx('Forecast min temperature', 'Dự báo nhiệt độ thấp nhất'),
  fc_rain: tx('Forecast rainfall', 'Dự báo mưa'),
  elevation_m: tx('Elevation', 'Độ cao'),
  slope_deg: tx('Slope', 'Độ dốc'),
  aspect_deg: tx('Aspect', 'Hướng dốc (độ)'),
  aspect_label: tx('Faces', 'Hướng dốc'),
  flow_dir_label: tx('Drains toward', 'Hướng thoát nước'),
  relief_m: tx('Relief within the parcel', 'Chênh cao trong thửa'),
  ph: tx('pH (water)', 'pH (nước)'),
  soc_gkg: tx('Organic carbon', 'Carbon hữu cơ'),
  clay_pct: tx('Clay', 'Sét'),
  sand_pct: tx('Sand', 'Cát'),
  silt_pct: tx('Silt', 'Limon'),
  texture_class: tx('Texture class', 'Nhóm kết cấu'),
  cec_cmolkg: tx('Cation exchange capacity', 'Dung tích trao đổi cation'),
  nitrogen_gkg: tx('Total nitrogen', 'Đạm tổng số'),
  bulk_density: tx('Bulk density', 'Dung trọng'),
  drainage_class: tx('Drainage class', 'Cấp thoát nước'),
  awc_cmcm: tx('Available water capacity', 'Sức chứa nước hữu hiệu'),
  ec_dsm: tx('Electrical conductivity (salinity)', 'Độ dẫn điện (độ mặn)'),
  depth_cm: tx('Depth to restrictive layer', 'Độ sâu đến tầng hạn chế'),
  om_pct: tx('Organic matter', 'Chất hữu cơ'),
  hydrologic_group: tx('Hydrologic soil group', 'Nhóm thủy văn đất'),
  map_unit: tx('Soil map unit', 'Đơn vị bản đồ đất'),
  usda_texture: tx('USDA texture', 'Kết cấu theo USDA'),
};

const label = (key: string): I18nText => LABELS[key] ?? tx(key);

export function makeSeries(
  key: string,
  branch: BranchId,
  sourceId: string,
  unit: string,
  cadence: Cadence,
  samples: Sample[],
  extra: Partial<Pick<Series, 'baseline' | 'range' | 'primary' | 'label'>> = {},
): Series {
  return {
    key,
    branch,
    label: extra.label ?? label(key),
    unit,
    sourceId,
    cadence,
    samples: [...samples].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)),
    ...(extra.baseline && extra.baseline.length ? { baseline: extra.baseline } : {}),
    ...(extra.range ? { range: extra.range } : {}),
    ...(extra.primary ? { primary: true } : {}),
  };
}

export function makeFact(
  key: string,
  branch: BranchId,
  sourceId: string,
  value: number | string | null,
  unit?: string,
  extra: Partial<Pick<StaticFact, 'detail' | 'uncertainty'>> = {},
): StaticFact {
  return { key, branch, label: label(key), value, ...(unit ? { unit } : {}), sourceId, ...extra };
}

/** Keep only samples within [start, end]. */
export const within = (s: Sample[], start: string, end: string): Sample[] => s.filter((x) => x.t >= start && x.t <= end);

/** Latest sample date with a value. */
export function latestDate(s: Sample[]): string | null {
  for (let i = s.length - 1; i >= 0; i--) if (s[i].v != null) return s[i].t;
  return null;
}

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 160);
