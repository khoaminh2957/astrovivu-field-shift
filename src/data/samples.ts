import type { SampleParcel } from '@/contracts';
import { tx } from '@/contracts';
import { circlePolygon, makeParcel, rectPolygon } from '@/lib/geo';

/**
 * Demo fields. Telemetry for these is pre-cached (`npm run data:samples`) so the story plays
 * instantly; every other location on Earth goes through the live adapters.
 *
 * Geometry is provisional: rectangles/circles around verified coordinates. Agent 3 aligns the
 * vertices with field edges visible on the imagery; ids and default crops must not change.
 */
export const SAMPLE_PARCELS: SampleParcel[] = [
  {
    ...makeParcel({
      id: 'daklak-coffee',
      name: 'Central Highlands robusta block',
      polygon: rectPolygon([108.2, 12.8], 190, 130, 12),
      source: 'sample',
      place: { label: 'Đắk Lắk, Vietnam', country: 'Vietnam', countryCode: 'VN', admin1: 'Đắk Lắk' },
    }),
    defaultCropId: 'coffea-canephora',
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
      polygon: rectPolygon([105.44, 10.11], 210, 90, 78),
      source: 'sample',
      place: { label: 'Cần Thơ, Vietnam', country: 'Vietnam', countryCode: 'VN', admin1: 'Cần Thơ' },
    }),
    defaultCropId: 'oryza-sativa',
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
      polygon: rectPolygon([-93.505, 42.105], 780, 390, 0),
      source: 'sample',
      place: { label: 'Iowa, United States', country: 'United States', countryCode: 'US', admin1: 'Iowa' },
    }),
    defaultCropId: 'zea-mays',
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
      polygon: circlePolygon([-115.97, 39.72], 400),
      source: 'sample',
      place: { label: 'Nevada, United States', country: 'United States', countryCode: 'US', admin1: 'Nevada' },
    }),
    defaultCropId: 'medicago-sativa',
    tagline: tx('Every millimetre is pumped', 'Từng milimét nước đều phải bơm'),
    story: tx(
      'Irrigated alfalfa in a high desert basin: which rotation keeps income while using less groundwater?',
      'Cỏ linh lăng tưới ở lòng chảo hoang mạc cao: luân canh nào giữ thu nhập mà dùng ít nước ngầm hơn?',
    ),
  },
];

export const getSampleParcel = (id: string): SampleParcel | undefined => SAMPLE_PARCELS.find((p) => p.id === id);
