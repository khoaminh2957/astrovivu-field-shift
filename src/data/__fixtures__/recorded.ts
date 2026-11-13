/**
 * Responses recorded from the real services on 2026-11-14 (trimmed to what the tests need).
 * They pin the parsing and unit handling against what the APIs actually send.
 */
import type { SoilGridsResponse } from '../adapters/soilgrids';

/** SoilGrids, 12.8 N 108.2 E, clay + phh2o, 0-5 and 5-15 cm (query_time 2.5 s after a 78 s wait). */
export const SOILGRIDS_DAKLAK: SoilGridsResponse = {
  properties: {
    layers: [
      {
        name: 'clay',
        unit_measure: { d_factor: 10, target_units: '%' },
        depths: [
          { label: '0-5cm', values: { 'Q0.05': 35, mean: 339 } },
          { label: '5-15cm', values: { 'Q0.05': 34, mean: 334 } },
        ],
      },
      {
        name: 'phh2o',
        unit_measure: { d_factor: 10, target_units: '-' },
        depths: [
          { label: '0-5cm', values: { 'Q0.05': 44, mean: 56 } },
          { label: '5-15cm', values: { 'Q0.05': 43, mean: 56 } },
        ],
      },
    ],
  },
};

/** CropScape GetCDLValue, year 2023, x=126000 y=2100000 (EPSG:5070). */
export const CDL_XML =
  '<ns1:GetCDLValueResponse xmlns:ns1="http://cropscape.csiss.gmu.edu/CDLService/"><Result>{x: 126000.0, y: 2100000.0, value: 1, category: "Corn", color: "#FFD400"}</Result></ns1:GetCDLValueResponse>';

/** ORNL MOD13Q1 subset header + NDVI raw values, 12.8 N 108.2 E, kmAboveBelow=0. */
export const ORNL_MOD13Q1 = {
  xllcorner: '11732236.27',
  yllcorner: '1423065.05',
  cellsize: 231.656358264,
  nrows: 1,
  ncols: 1,
  subset: [
    { calendar_date: '2026-09-14', data: [6337] },
    { calendar_date: '2026-09-30', data: [9491] },
    { calendar_date: '2026-10-16', data: [8080] },
  ],
};

/** NASA POWER daily, 12.8 N 108.2 E: PAR (MJ/m²/day, verified unit) vs shortwave on the same days. */
export const POWER_PAR_SW = {
  cellElevationM: 397.95,
  par: { '20260801': 7.83, '20260802': 8.26 },
  sw: { '20260801': 16.08, '20260802': 17.09 },
};
