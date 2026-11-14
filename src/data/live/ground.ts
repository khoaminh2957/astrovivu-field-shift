/** Static branches: terrain (DEM) and soil (SoilGrids, SSURGO); US crop history (CDL). */
import type { CropHistoryYear, I18nText, StaticFact } from '@/contracts';
import { tx } from '@/contracts';
import { offsetMetres } from '@/lib/geo';
import { cdlHistory, cdlSamplePoints } from '../adapters/cdl';
import { elevation as omElevation } from '../adapters/openmeteo';
import { openTopoDem } from '../adapters/opentopo';
import { soilGrids, type SoilProp, type SoilValue } from '../adapters/soilgrids';
import { ssurgoAtPoint, type SsurgoSoil } from '../adapters/ssurgo';
import { terrariumDem } from '../adapters/terrarium';
import { isNode } from '../env';
import { analyseDem, type TerrainStats } from '../harmonize/terrain';
import { ecoTextureClass, usdaTexture } from '../harmonize/texture';
import { round } from '../harmonize/units';
import { errText, makeFact } from '../build';
import { SOURCES } from '../sources';
import type { LiveContext } from './context';

// ---------------------------------------------------------------------------------------------
// terrain

function terrainFacts(st: TerrainStats, sourceId: string, detail: I18nText): StaticFact[] {
  return [
    makeFact('elevation_m', 'terrain', sourceId, Math.round(st.elevationMean), 'm', { detail, uncertainty: [Math.round(st.elevationMin), Math.round(st.elevationMax)] }),
    makeFact('slope_deg', 'terrain', sourceId, round(st.slopeMeanDeg, 1), '°'),
    makeFact('aspect_deg', 'terrain', sourceId, st.aspectDeg == null ? null : Math.round(st.aspectDeg), '°'),
    makeFact('aspect_label', 'terrain', sourceId, st.aspectLabel),
    makeFact('flow_dir_label', 'terrain', sourceId, st.flowDirLabel),
    makeFact('relief_m', 'terrain', sourceId, round(st.reliefM, 1), 'm'),
  ];
}

export async function terrain(ctx: LiveContext): Promise<void> {
  const notes: I18nText[] = [];
  let facts: StaticFact[] | null = null;
  let sourceId: string = SOURCES.terrarium.id;
  if (isNode && ctx.opts.full) {
    try {
      const grid = await openTopoDem(ctx.parcel, ctx.signal);
      const st = analyseDem(grid);
      if (st) {
        sourceId = SOURCES.opentopo.id;
        facts = terrainFacts(st, sourceId, tx(`Zonal mean of ${st.cells} SRTM 30 m points inside the parcel.`, `Trung bình ${st.cells} điểm SRTM 30 m trong thửa.`));
      }
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      notes.push(tx(`OpenTopoData SRTM unavailable (${errText(e)}); used terrain tiles.`, 'OpenTopoData không phản hồi; dùng ô địa hình.'));
    }
  }
  if (!facts) {
    try {
      const { grid, pixelM } = await terrariumDem(ctx.parcel, ctx.signal);
      const st = analyseDem(grid);
      if (!st) throw new Error('no valid DEM cells');
      sourceId = SOURCES.terrarium.id;
      facts = terrainFacts(
        st,
        sourceId,
        tx(`Zonal mean of ${st.cells} terrain-tile cells (${Math.round(pixelM)} m) inside the parcel.`, `Trung bình ${st.cells} ô địa hình (${Math.round(pixelM)} m) trong thửa.`),
      );
      if (st.cells < 4) notes.push(tx('Parcel covers fewer than 4 DEM cells; slope is indicative only.', 'Thửa phủ ít hơn 4 ô DEM; độ dốc chỉ mang tính tham khảo.'));
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      notes.push(tx(`Terrain tiles unavailable (${errText(e)}); elevation only, from Copernicus DEM.`, 'Không có ô địa hình; chỉ có độ cao từ Copernicus DEM.'));
    }
  }
  if (!facts) {
    try {
      const v = await omElevation(ctx.parcel.centroid, ctx.signal);
      sourceId = SOURCES.copernicusDem.id;
      facts = [makeFact('elevation_m', 'terrain', sourceId, v == null ? null : Math.round(v), 'm')];
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      notes.push(tx(`Elevation unavailable (${errText(e)}).`, 'Không có dữ liệu độ cao.'));
      facts = [];
    }
  }
  const elev = facts.find((f) => f.key === 'elevation_m')?.value;
  ctx.setElevation(typeof elev === 'number' ? elev : null, sourceId);
  // A flat field legitimately has no aspect: that is a complete answer, not a missing value.
  const flat = facts.some((f) => f.key === 'aspect_label' && f.value === 'flat');
  ctx.emit(ctx.branch('terrain', { series: [], facts, notes, expected: flat ? 5 : 6 }));
}

// ---------------------------------------------------------------------------------------------
// soil

const NEIGHBOUR_M = 300;

async function soilGridsWithNeighbours(ctx: LiveContext): Promise<{ v: Record<SoilProp, SoilValue>; moved: string | null } | null> {
  const c = ctx.parcel.centroid;
  const tries: [string | null, [number, number]][] = [
    [null, c],
    ['north', offsetMetres(c, 0, NEIGHBOUR_M)],
    ['east', offsetMetres(c, NEIGHBOUR_M, 0)],
    ['south', offsetMetres(c, 0, -NEIGHBOUR_M)],
    ['west', offsetMetres(c, -NEIGHBOUR_M, 0)],
  ];
  for (const [dir, at] of tries) {
    const v = await soilGrids(at, ctx.signal);
    if (v && v.clay.mean != null) return { v, moved: dir };
  }
  return null;
}

const unc = (s: SoilValue, d: number): [number, number] | undefined => (s.q05 != null && s.q95 != null ? [round(s.q05, d)!, round(s.q95, d)!] : undefined);

function soilGridsFacts(v: Record<SoilProp, SoilValue>): StaticFact[] {
  const id = SOURCES.soilgrids.id;
  const f = (key: string, p: SoilProp, unit: string | undefined, d: number) => makeFact(key, 'soil', id, round(v[p].mean, d), unit, { uncertainty: unc(v[p], d) });
  return [
    f('ph', 'phh2o', undefined, 1),
    f('soc_gkg', 'soc', 'g/kg', 1),
    f('clay_pct', 'clay', '%', 0),
    f('sand_pct', 'sand', '%', 0),
    f('silt_pct', 'silt', '%', 0),
    f('cec_cmolkg', 'cec', 'cmol(+)/kg', 1),
    f('nitrogen_gkg', 'nitrogen', 'g/kg', 2),
    f('bulk_density', 'bdod', 'g/cm³', 2),
  ];
}

function ssurgoFacts(s: SsurgoSoil): StaticFact[] {
  const id = SOURCES.ssurgo.id;
  const out: StaticFact[] = [
    makeFact('map_unit', 'soil', id, s.muname, undefined, { detail: tx(`${s.compname} (${s.comppct ?? '?'} % of map unit ${s.mukey})`) }),
    makeFact('drainage_class', 'soil', id, s.drainage),
    makeFact('awc_cmcm', 'soil', id, s.awc, 'cm/cm'),
    makeFact('ec_dsm', 'soil', id, s.ecDsm, 'dS/m'),
    makeFact('depth_cm', 'soil', id, s.restrictiveDepthCm, 'cm', {
      detail: s.restrictiveDepthCm == null ? tx('No restrictive layer recorded for the dominant component.', 'Không ghi nhận tầng hạn chế cho thành phần chính.') : undefined,
    }),
    makeFact('hydrologic_group', 'soil', id, s.hydgrp),
    makeFact('om_pct', 'soil', id, s.omPct, '%'),
  ];
  if (s.ph != null) out.push(makeFact('ph', 'soil', id, round(s.ph, 1)));
  if (s.clayPct != null) out.push(makeFact('clay_pct', 'soil', id, round(s.clayPct, 0), '%'));
  if (s.sandPct != null) out.push(makeFact('sand_pct', 'soil', id, round(s.sandPct, 0), '%'));
  if (s.siltPct != null) out.push(makeFact('silt_pct', 'soil', id, round(s.siltPct, 0), '%'));
  if (s.cec != null) out.push(makeFact('cec_cmolkg', 'soil', id, round(s.cec, 1), 'cmol(+)/kg'));
  return out;
}

/** SSURGO facts win over SoilGrids for the same key; the estimate it replaced goes into `detail`. */
function mergeSoil(ss: StaticFact[], sg: StaticFact[]): StaticFact[] {
  const out = [...ss];
  for (const f of sg) {
    const i = out.findIndex((x) => x.key === f.key);
    if (i < 0) out.push(f);
    else if (f.value != null)
      out[i] = { ...out[i], detail: tx(`SoilGrids estimate: ${f.value}${f.unit ? ' ' + f.unit : ''}`, `Ước tính SoilGrids: ${f.value}${f.unit ? ' ' + f.unit : ''}`) };
  }
  return out;
}

function withTexture(facts: StaticFact[]): StaticFact[] {
  const n = (k: string) => {
    const v = facts.find((f) => f.key === k)?.value;
    return typeof v === 'number' ? v : null;
  };
  const clay = n('clay_pct');
  const sand = n('sand_pct');
  const silt = n('silt_pct');
  let soc = n('soc_gkg');
  const om = n('om_pct');
  if (soc == null && om != null) soc = (om / 1.724) * 10; // van Bemmelen factor
  const cls = ecoTextureClass(clay, sand, soc);
  const src = facts.find((f) => f.key === 'clay_pct')?.sourceId ?? SOURCES.soilgrids.id;
  const usda = clay != null && sand != null && silt != null ? usdaTexture(clay, sand, silt) : null;
  const rest = facts.filter((f) => f.key !== 'texture_class' && f.key !== 'usda_texture');
  return [
    ...rest,
    makeFact('texture_class', 'soil', src, cls, undefined, {
      detail: usda ? tx(`USDA ${usda}; EcoCrop class from clay/sand thresholds`, `USDA ${usda}; nhóm EcoCrop theo ngưỡng sét/cát`) : undefined,
    }),
    ...(usda ? [makeFact('usda_texture', 'soil', src, usda)] : []),
  ];
}

export async function soil(ctx: LiveContext): Promise<void> {
  const notes: I18nText[] = [];
  let ss: StaticFact[] = [];
  if (ctx.parcel.isUS) {
    try {
      const s = await ssurgoAtPoint(ctx.parcel.centroid, ctx.signal);
      if (s) {
        ss = ssurgoFacts(s);
        ctx.emit(ctx.branch('soil', { series: [], facts: withTexture(ss), notes: [...notes, tx('SoilGrids loading.', 'Đang tải SoilGrids.')], expected: 9, primarySource: SOURCES.ssurgo.id }));
      } else notes.push(tx('No SSURGO map unit at this point.', 'Không có đơn vị bản đồ SSURGO tại điểm này.'));
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      notes.push(tx(`SSURGO unavailable (${errText(e)}).`, 'Không lấy được SSURGO.'));
    }
    if (!isNode)
      notes.push(
        tx(
          'Crop history (Cropland Data Layer) is in the demo caches only: CropScape does not allow browser requests.',
          'Lịch sử cây trồng (CDL) chỉ có trong dữ liệu mẫu: CropScape chặn yêu cầu từ trình duyệt.',
        ),
      );
  }
  let sg: StaticFact[] = [];
  try {
    const r = await soilGridsWithNeighbours(ctx);
    if (r) {
      sg = soilGridsFacts(r.v);
      if (r.moved)
        notes.push(
          tx(
            `SoilGrids pixel under the parcel is masked; values read ${NEIGHBOUR_M} m ${r.moved}.`,
            `Điểm ảnh SoilGrids dưới thửa bị che; giá trị lấy cách ${NEIGHBOUR_M} m về phía ${r.moved}.`,
          ),
        );
    } else notes.push(tx('SoilGrids has no data here or within 300 m (urban or water mask).', 'SoilGrids không có dữ liệu tại đây hoặc trong 300 m.'));
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    notes.push(tx(`SoilGrids unavailable (${errText(e)}).`, 'Không lấy được SoilGrids.'));
  }
  if (sg.length)
    notes.push(
      tx(
        'SoilGrids values are 0-30 cm depth-weighted model estimates for the 250 m neighbourhood; ranges are the 5-95 % prediction interval.',
        'Giá trị SoilGrids là ước tính mô hình 0-30 cm cho vùng 250 m; khoảng là khoảng dự báo 5-95 %.',
      ),
    );
  const facts = withTexture(ss.length ? mergeSoil(ss, sg) : sg);
  ctx.emit(ctx.branch('soil', { series: [], facts, notes, expected: ctx.parcel.isUS ? 12 : 9, primarySource: ss.length ? SOURCES.ssurgo.id : SOURCES.soilgrids.id }));
}

// ---------------------------------------------------------------------------------------------
// crop history (US)

export async function cropHistory(ctx: LiveContext): Promise<CropHistoryYear[] | null> {
  if (!ctx.parcel.isUS || !isNode) return null;
  const years = Array.from({ length: 8 }, (_, i) => ctx.thisYear - 8 + i);
  const rows = await cdlHistory(cdlSamplePoints(ctx.parcel), years, ctx.signal);
  if (rows.length) ctx.addSource(SOURCES.cdl);
  return rows.length ? rows : null;
}
