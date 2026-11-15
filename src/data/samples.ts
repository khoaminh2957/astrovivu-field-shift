import type { SampleParcel } from '@/contracts';
import { tx } from '@/contracts';
import { circlePolygon, closeRing, makeParcel } from '@/lib/geo';

/**
 * Demo fields. Telemetry for these is pre-cached (`npm run data:samples`) so the story plays
 * instantly; every other location on Earth goes through the live adapters.
 *
 * Nevada and Iowa follow the field visible on Esri World Imagery under the verified centre
 * (traced at zoom 14, about 4 m per pixel). Dak Lak and the Mekong paddy are field outlines found by
 * `detectFieldBoundary` from Sentinel-2 NDVI (scripts/data/boundary-demo.ts); the crop on them is assumed, not verified.
 */
export const SAMPLE_PARCELS: SampleParcel[] = [
  {
    ...makeParcel({
      id: 'daklak-coffee',
      name: 'Central Highlands robusta block',
      // Found by detectFieldBoundary (Sentinel-2 NDVI, conf 0.87) on a 1.5 km grid within 3 km of the old centre.
      polygon: { type: 'Polygon', coordinates: [[[108.226389, 12.814519], [108.228067, 12.813556], [108.228165, 12.81346], [108.227968, 12.813171], [108.227277, 12.812979], [108.226389, 12.81346], [108.226093, 12.814134], [108.226389, 12.814519]]] },
      source: 'sample',
      place: { label: 'Đắk Lắk, Vietnam', country: 'Vietnam', countryCode: 'VN', iso3: 'VNM', admin1: 'Đắk Lắk' },
    }),
    defaultCropId: 'coffea-canephora',
    defaultGroundTruth: { irrigation: 'supplemental', waterSource: 'well', currentRotation: [{ cropId: 'coffea-canephora', startMonth: 1, endMonth: 12 }] },
    tagline: tx('Dry-season water is the limit', 'Nước mùa khô là giới hạn'),
    story: tx(
      'Robusta coffee on basalt soil. Rain stops for four months; irrigation timing decides the harvest.',
      'Cà phê vối trên đất bazan. Mưa ngừng bốn tháng; thời điểm tưới quyết định vụ thu hoạch.',
    ),
  },
  {
    ...makeParcel({
      id: 'cantho-rice',
      name: 'Mekong Delta paddy',
      // Found by detectFieldBoundary (Sentinel-2 NDVI, conf 0.82) among the regular paddies of An Giang.
      polygon: { type: 'Polygon', coordinates: [[[105.172489, 10.52764], [105.173413, 10.527135], [105.173105, 10.527034], [105.172797, 10.526631], [105.171873, 10.526631], [105.171771, 10.527438], [105.172489, 10.52764]]] },
      source: 'sample',
      place: { label: 'An Giang, Vietnam', country: 'Vietnam', countryCode: 'VN', iso3: 'VNM', admin1: 'An Giang' },
    }),
    defaultCropId: 'oryza-sativa',
    // Three rice crops a year (winter-spring, summer-autumn, autumn-winter), irrigated from river and canals.
    defaultGroundTruth: {
      irrigation: 'full',
      waterSource: 'river-canal',
      currentRotation: [
        { cropId: 'oryza-sativa', startMonth: 11, endMonth: 2 },
        { cropId: 'oryza-sativa', startMonth: 3, endMonth: 6 },
        { cropId: 'oryza-sativa', startMonth: 7, endMonth: 10 },
      ],
    },
    tagline: tx('Flood, salt and a third rice crop', 'Ngập, mặn và vụ lúa thứ ba'),
    story: tx(
      'Triple-cropped rice in the delta. Should the third crop become a short legume or vegetable season?',
      'Lúa ba vụ ở đồng bằng. Có nên đổi vụ ba sang đậu hoặc rau màu ngắn ngày?',
    ),
  },
  {
    ...makeParcel({
      id: 'iowa-corn-soy',
      name: 'Story County corn-soybean field',
      // The field block between the section roads, minus the farmstead in its north-west corner.
      polygon: {
        type: 'Polygon',
        coordinates: [
          closeRing([
            [-93.50556, 42.10682],
            [-93.50207, 42.10681],
            [-93.50205, 42.0999],
            [-93.50678, 42.09992],
            [-93.50679, 42.10622],
            [-93.50556, 42.10621],
          ]),
        ],
      },
      source: 'sample',
      place: { label: 'Iowa, United States', country: 'United States', countryCode: 'US', iso3: 'USA', admin1: 'Iowa' },
    }),
    defaultCropId: 'zea-mays',
    // Rainfed corn-soybean alternation, as the Cropland Data Layer history in the cache shows (2018-2025).
    defaultGroundTruth: { irrigation: 'rainfed', waterSource: 'rain', currentRotation: [{ cropId: 'zea-mays', startMonth: 5, endMonth: 10 }, { cropId: 'glycine-max', startMonth: 5, endMonth: 10 }] },
    tagline: tx('The classic rotation, re-examined', 'Luân canh kinh điển, nhìn lại'),
    story: tx(
      'Corn-soybean on prairie soil. US-only layers (SSURGO, Cropland Data Layer) show the real rotation history.',
      'Ngô-đậu nành trên đất thảo nguyên. Lớp dữ liệu riêng của Mỹ (SSURGO, CDL) cho thấy lịch sử luân canh thật.',
    ),
  },
  {
    ...makeParcel({
      id: 'nevada-alfalfa',
      name: 'Diamond Valley alfalfa pivot',
      // The pivot circle around the verified point: its pivot at the centre, wetted radius about 395 m.
      polygon: circlePolygon([-115.96894, 39.71961], 395),
      source: 'sample',
      place: { label: 'Nevada, United States', country: 'United States', countryCode: 'US', iso3: 'USA', admin1: 'Nevada' },
    }),
    defaultCropId: 'medicago-sativa',
    // Continuous alfalfa under a centre pivot fed by a well (Cropland Data Layer: alfalfa every year 2019-2025).
    defaultGroundTruth: { irrigation: 'full', waterSource: 'well', currentRotation: [{ cropId: 'medicago-sativa', startMonth: 1, endMonth: 12 }] },
    tagline: tx('Every millimetre is pumped', 'Từng milimét nước đều phải bơm'),
    story: tx(
      'Irrigated alfalfa in a high desert basin: which rotation keeps income while using less groundwater?',
      'Cỏ linh lăng tưới ở lòng chảo hoang mạc cao: luân canh nào giữ thu nhập mà dùng ít nước ngầm hơn?',
    ),
  },
];

export const getSampleParcel = (id: string): SampleParcel | undefined => SAMPLE_PARCELS.find((p) => p.id === id);

/**
 * The one demo field the app offers: on the landing, in the field list and as the beacon on the
 * globe. The others stay above for tests, fixtures and `?sample=<id>` deep links.
 */
export const DEMO_FIELD: SampleParcel = SAMPLE_PARCELS.find((p) => p.id === 'nevada-alfalfa') ?? SAMPLE_PARCELS[0];
