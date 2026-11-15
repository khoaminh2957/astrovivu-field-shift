import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCrop, isPrevalenceLoaded, listCrops, loadPrevalence } from '../../src/core/crops';
import { REFERENCE_ECONOMICS } from '../../src/core/crops/curated.generated';
import { CURATED_IDS, readEconomics, readPrevalence } from './atlas-tables';
import { REFERENCE_ECONOMICS as LEGACY_ECONOMICS } from './economics';

const ATLAS_DIR = 'data/crops/atlas';

describe('scripts/crops/atlas-tables', () => {
  const prevalence = readPrevalence(ATLAS_DIR);
  const economics = readEconomics(ATLAS_DIR);

  it('all 73 curated ids resolve in crops.csv', () => {
    expect(CURATED_IDS).toHaveLength(73);
    expect(Object.keys(prevalence)).toHaveLength(387);
    for (const id of CURATED_IDS) {
      expect(prevalence[id], `missing prevalence map for ${id}`).toBeDefined();
    }

    const cropsWithoutRice = readFileSync(`${ATLAS_DIR}/crops.csv`, 'utf8')
      .split('\n')
      .filter((l) => !l.startsWith('oryza-sativa,'))
      .join('\n');
    expect(() => readPrevalence(ATLAS_DIR, { cropsCsv: cropsWithoutRice })).toThrow(
      /Curated crop "oryza-sativa" is missing from crops\.csv/,
    );
  });

  it('every crop_country row with level major, common, minor or present has a source and year_from, year_to', () => {
    for (const [cropId, byIso] of Object.entries(prevalence)) {
      for (const [iso3, rec] of Object.entries(byIso)) {
        expect(rec.source.trim().length, `${cropId} ${iso3}: empty source`).toBeGreaterThan(0);
        if (rec.level === 'major' || rec.level === 'common' || rec.level === 'minor' || rec.level === 'present') {
          expect(rec.years, `${cropId} ${iso3}: missing years for ${rec.level}`).toBeDefined();
          expect(rec.years![0]).toBeGreaterThanOrEqual(1960);
          expect(rec.years![1]).toBeGreaterThanOrEqual(rec.years![0]);
          expect(rec.year_from).toBe(rec.years![0]);
          expect(rec.year_to).toBe(rec.years![1]);
        }
      }
    }

    const brokenYearCsv = [
      'crop_id,iso3,country_name,match,faostat_item_code,faostat_item_name,level,share_of_country_harvested_area_pct,rank_in_country,area_ha,production_t,yield_t_ha,year_from,year_to,item_reported,source',
      'oryza-sativa,VNM,Viet Nam,exact,27,Rice,major,52.49,1,7089041,43140000,6.09,,,yes,FAOSTAT QCL',
    ].join('\n');
    expect(() => readPrevalence(ATLAS_DIR, { cropCountryCsv: brokenYearCsv })).toThrow(/missing year_from or year_to/);

    const brokenSourceCsv = [
      'crop_id,iso3,country_name,match,faostat_item_code,faostat_item_name,level,share_of_country_harvested_area_pct,rank_in_country,area_ha,production_t,yield_t_ha,year_from,year_to,item_reported,source',
      'oryza-sativa,VNM,Viet Nam,exact,27,Rice,major,52.49,1,7089041,43140000,6.09,2022,2024,yes,',
    ].join('\n');
    expect(() => readPrevalence(ATLAS_DIR, { cropCountryCsv: brokenSourceCsv })).toThrow(/missing source/);
  });

  it('every economics row with a figure has a source and a year', () => {
    for (const [cropId, byRegion] of Object.entries(economics)) {
      for (const rec of Object.values(byRegion)) {
        if (!rec) continue;
        expect(rec.year, `${cropId} ${rec.region}: invalid year`).toBeGreaterThanOrEqual(2000);
        expect(rec.sources.length, `${cropId} ${rec.region}: empty sources`).toBeGreaterThanOrEqual(3);
      }
    }

    const brokenEconYear = [
      'crop_id,iso3,region,yield_t_ha,price_usd_t,cost_usd_ha,year,quality_yield,quality_price,quality_cost,source,url,accessed',
      'oryza-sativa,VNM,,6.09,259.8,1054.7,,official,press,press,yield: FAOSTAT | price: Press | cost: Press,https://www.fao.org/faostat/en/#data/QCL,2026-11-10',
    ].join('\n');
    expect(() => readEconomics(ATLAS_DIR, { economicsCsv: brokenEconYear })).toThrow(/missing a 4-digit year/);

    const brokenEconSource = [
      'crop_id,iso3,region,yield_t_ha,price_usd_t,cost_usd_ha,year,quality_yield,quality_price,quality_cost,source,url,accessed',
      'oryza-sativa,VNM,,6.09,259.8,1054.7,2025,official,press,press,,https://www.fao.org/faostat/en/#data/QCL,2026-11-10',
    ].join('\n');
    expect(() => readEconomics(ATLAS_DIR, { economicsCsv: brokenEconSource })).toThrow(/missing source/);
  });

  it('matches real atlas figures: oryza-sativa in VNM is major (7,089,041 ha) and glycine-max in USA is major (34,330,527 ha)', () => {
    expect(prevalence['oryza-sativa'].VNM).toMatchObject({
      level: 'major',
      match: 'exact',
      areaHa: 7089041,
      area_ha: 7089041,
      years: [2022, 2024],
      year_from: 2022,
      year_to: 2024,
    });
    expect(prevalence['glycine-max'].USA).toMatchObject({
      level: 'major',
      match: 'exact',
      areaHa: 34330527,
      area_ha: 34330527,
      years: [2022, 2024],
      year_from: 2022,
      year_to: 2024,
    });

    const rice = getCrop('oryza-sativa');
    const soy = getCrop('glycine-max');
    expect(rice?.prevalence?.VNM?.level).toBe('major');
    expect(rice?.prevalence?.VNM?.areaHa).toBe(7089041);
    expect(soy?.prevalence?.USA?.level).toBe('major');
    expect(soy?.prevalence?.USA?.areaHa).toBe(34330527);
    expect(listCrops().filter((c) => c.prevalence?.VNM != null && c.prevalence?.USA != null).length).toBeGreaterThanOrEqual(53);
  });

  it('the 49 reference records keep their numbers', () => {
    let legacyCount = 0;
    for (const [cropId, legacyByRegion] of Object.entries(LEGACY_ECONOMICS)) {
      const actualByRegion = REFERENCE_ECONOMICS[cropId] ?? {};
      for (const [region, leg] of Object.entries(legacyByRegion)) {
        if (!leg) continue;
        legacyCount++;
        const match = actualByRegion[region as keyof typeof actualByRegion];
        expect(match, `missing reference record ${cropId} (${region})`).toBeDefined();
        expect(match!.refYieldTHa).toBe(leg.refYieldTHa);
        expect(match!.priceUsdPerT).toBe(leg.priceUsdPerT);
        expect(match!.costUsdPerHa).toBe(leg.costUsdPerHa);
        expect(match!.year).toBe(leg.year);
        expect(match!.quality).toEqual(leg.quality);
      }
    }
    expect(legacyCount).toBe(49);
  });

  it('loadPrevalence loads public/data/crops/prevalence.json for all 387 atlas crops', async () => {
    const rawJson = JSON.parse(readFileSync('public/data/crops/prevalence.json', 'utf8'));
    const loaded = await loadPrevalence(() => Promise.resolve(rawJson));
    expect(isPrevalenceLoaded()).toBe(true);
    expect(Object.keys(loaded)).toHaveLength(387);
    expect(getCrop('oryza-sativa')?.prevalence?.JPN?.level).toBe('major');
  });
});
