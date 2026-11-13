/**
 * DEV-ONLY LAYOUT FIXTURE. Invented numbers shaped like the Central Highlands robusta demo field,
 * used to review the advisory layout while the engine (src/core/advisory) is still a placeholder.
 * Never shown outside `?fixture=1` on the dev server.
 */
import type { AdvisoryReport, FarmerPriority, I18nText, RotationStrategy, SeasonEconomics } from '@/contracts';
import { tx } from '@/contracts';

const coffeeSeason = (marginUsd: number, costUsd: number): SeasonEconomics => ({
  cropId: 'coffea-canephora',
  areaHa: 2,
  yield: { expectedTHa: 2.9, lowTHa: 2.3, highTHa: 3.4, refTHa: 3.5, basis: tx('Reference yield scaled by suitability', 'Năng suất tham chiếu nhân với độ phù hợp') },
  productionT: 5.8,
  priceUsdPerT: (marginUsd + costUsd) / 5.8,
  revenueUsd: marginUsd + costUsd,
  costUsd,
  marginUsd,
  marginPct: (marginUsd / (marginUsd + costUsd)) * 100,
  breakEvenYieldTHa: 1.6,
  sources: ['fixture'],
  usesReferenceValues: true,
});

const coffee = (year?: number) => ({ cropId: 'coffea-canephora', label: tx('Robusta coffee', 'Cà phê vối'), startMonth: 1, endMonth: 12, year });

const base: Omit<RotationStrategy, 'score'>[] = [
  {
    id: 'current',
    kind: 'current',
    name: tx('Robusta, clean-weeded rows', 'Cà phê vối, làm sạch cỏ giữa hàng'),
    years: 3,
    seasons: [coffee()],
    metrics: { suitability: 74, soilHealth: 41, waterUseMm: 1450, waterFit: 58, marginUsdPerHaYr: 2150, risk: 52, nitrogenKgHaYr: 0, groundCoverPct: 35, pestBreak: 10 },
    economics: { perYear: { revenueUsd: 9800, costUsd: 5500, marginUsd: 4300 }, perHaMarginUsd: 2150, seasons: [coffeeSeason(4300, 5500)] },
    why: [tx('This is the rotation you run today; every other strategy is compared with it.', 'Đây là cách canh tác hiện tại; các phương án khác được so với nó.')],
    evidence: [
      { label: tx('Dry-season root-zone moisture', 'Ẩm vùng rễ mùa khô'), value: '0.17 m³/m³ (−18 % vs normal)', sourceId: 'smap-l4', branch: 'soilMoisture' },
      { label: tx('Bare inter-row share', 'Tỷ lệ đất trống giữa hàng'), value: '65 %', branch: 'vegetation' },
    ],
    benefits: [tx('No new skills or inputs needed.', 'Không cần kỹ năng hay vật tư mới.'), tx('Known market and buyer.', 'Thị trường và người mua đã quen.')],
    gaps: [tx('Irrigation volume per tree is not recorded; water use is a reference value.', 'Chưa ghi lượng nước tưới mỗi gốc; lượng nước dùng là giá trị tham chiếu.')],
    risks: [tx('Bare soil on a 6° slope loses topsoil in the first rains.', 'Đất trống trên dốc 6° bị rửa trôi lớp mặt khi mưa đầu mùa.')],
  },
  {
    id: 'soil',
    kind: 'soil-health',
    name: tx('Robusta + pinto peanut living mulch', 'Cà phê vối + lạc dại phủ đất'),
    years: 3,
    seasons: [coffee(), ...[0, 1, 2].map((year) => ({ cropId: 'arachis-pintoi', label: tx('Pinto peanut cover', 'Lạc dại phủ đất'), startMonth: 5, endMonth: 11, year }))],
    metrics: { suitability: 76, soilHealth: 72, waterUseMm: 1380, waterFit: 64, marginUsdPerHaYr: 2050, risk: 44, nitrogenKgHaYr: 45, groundCoverPct: 85, pestBreak: 35 },
    economics: { perYear: { revenueUsd: 9800, costUsd: 5700, marginUsd: 4100 }, perHaMarginUsd: 2050, seasons: [coffeeSeason(4100, 5700)] },
    why: [
      tx('Soil organic carbon is low for basalt soils (14 g/kg).', 'Các-bon hữu cơ thấp so với đất bazan (14 g/kg).'),
      tx('Inter-rows are bare for most of the rainy season.', 'Giữa hàng để trống gần suốt mùa mưa.'),
    ],
    evidence: [
      { label: tx('Soil organic carbon, 0-30 cm', 'Các-bon hữu cơ, 0-30 cm'), value: '14 g/kg', sourceId: 'soilgrids', branch: 'soil' },
      { label: tx('Slope', 'Độ dốc'), value: '6.1°', sourceId: 'srtm-terrarium', branch: 'terrain' },
      { label: tx('Rainy-season rain', 'Mưa mùa mưa'), value: '1,520 mm (May-Oct)', sourceId: 'chirps', branch: 'rainfall' },
    ],
    benefits: [
      tx('About 45 kg N/ha a year fixed by the cover.', 'Cây phủ cố định khoảng 45 kg N/ha mỗi năm.'),
      tx('Ground covered 85 % of the year; less erosion.', 'Đất được phủ 85 % thời gian; giảm xói mòn.'),
    ],
    gaps: [
      tx('No local data on pinto peanut competition with young coffee under 3 years.', 'Chưa có số liệu địa phương về cạnh tranh của lạc dại với cà phê dưới 3 năm tuổi.'),
      tx('Seed source and cost in Dak Lak not confirmed.', 'Chưa xác nhận nguồn giống và giá ở Đắk Lắk.'),
    ],
    risks: [tx('The cover must be cut back in the dry season or it competes for water.', 'Phải cắt cây phủ vào mùa khô, nếu không sẽ tranh nước.')],
  },
  {
    id: 'water',
    kind: 'water-saver',
    name: tx('Robusta + rainy-season legumes, mulched dry season', 'Cà phê vối + đậu mùa mưa, phủ rơm mùa khô'),
    years: 3,
    seasons: [
      coffee(),
      { cropId: 'vigna-radiata', label: tx('Mung bean', 'Đậu xanh'), startMonth: 5, endMonth: 7, year: 0 },
      { cropId: 'fallow', label: tx('Mulch', 'Phủ rơm'), startMonth: 11, endMonth: 3, year: 0 },
      { cropId: 'glycine-max', label: tx('Soybean', 'Đậu nành'), startMonth: 5, endMonth: 8, year: 1 },
      { cropId: 'fallow', label: tx('Mulch', 'Phủ rơm'), startMonth: 11, endMonth: 3, year: 1 },
      { cropId: 'arachis-hypogaea', label: tx('Groundnut', 'Đậu phộng'), startMonth: 5, endMonth: 8, year: 2 },
    ],
    metrics: { suitability: 75, soilHealth: 60, waterUseMm: 1180, waterFit: 78, marginUsdPerHaYr: 2240, risk: 40, nitrogenKgHaYr: 25, groundCoverPct: 70, pestBreak: 30 },
    economics: { perYear: { revenueUsd: 10400, costUsd: 5920, marginUsd: 4480 }, perHaMarginUsd: 2240, seasons: [coffeeSeason(4100, 5500)] },
    why: [
      tx('Dry-season root-zone moisture ran 18 % below normal this year.', 'Ẩm vùng rễ mùa khô năm nay thấp hơn bình thường 18 %.'),
      tx('Three irrigation rounds account for most of the cash cost from January to April.', 'Ba đợt tưới chiếm phần lớn chi phí tiền mặt từ tháng 1 đến tháng 4.'),
    ],
    evidence: [
      { label: tx('Root-zone moisture, Feb-Mar', 'Ẩm vùng rễ, T2-T3'), value: '0.15 m³/m³ (p10 of 2016-2025)', sourceId: 'smap-l4', branch: 'soilMoisture' },
      { label: tx('Reference evapotranspiration, dry season', 'Bốc thoát hơi chuẩn, mùa khô'), value: '4.6 mm/day', sourceId: 'nasa-power', branch: 'agromet' },
      { label: tx('Land surface temperature, March', 'Nhiệt độ bề mặt, tháng 3'), value: '36.2 °C', sourceId: 'modis-mod11a2', branch: 'thermal' },
    ],
    benefits: [
      tx('About 270 mm less irrigation a year.', 'Giảm khoảng 270 mm nước tưới mỗi năm.'),
      tx('A short legume crop adds cash in the rains.', 'Vụ đậu ngắn ngày có thêm thu nhập mùa mưa.'),
    ],
    gaps: [
      tx('Mulch supply (rice straw, coffee husk) and its price are not known for this farm.', 'Chưa rõ nguồn và giá vật liệu phủ (rơm, vỏ cà phê) cho nông hộ này.'),
      tx('Legume yields under coffee shade are reference values.', 'Năng suất đậu dưới tán cà phê là giá trị tham chiếu.'),
    ],
    risks: [
      tx('Mulch near the trunk can harbour termites; keep 20 cm clear.', 'Phủ sát gốc dễ có mối; chừa 20 cm quanh gốc.'),
      tx('Extra labour at sowing overlaps with fertiliser in May.', 'Công gieo trùng với đợt bón phân tháng 5.'),
    ],
  },
  {
    id: 'income',
    kind: 'income',
    name: tx('Robusta intercropped with black pepper', 'Cà phê vối xen hồ tiêu'),
    years: 3,
    seasons: [coffee(), { cropId: 'piper-nigrum', label: tx('Black pepper', 'Hồ tiêu'), startMonth: 1, endMonth: 12 }],
    metrics: { suitability: 70, soilHealth: 48, waterUseMm: 1620, waterFit: 49, marginUsdPerHaYr: 3150, risk: 66, nitrogenKgHaYr: 0, groundCoverPct: 45, pestBreak: 15 },
    economics: { perYear: { revenueUsd: 14600, costUsd: 8300, marginUsd: 6300 }, perHaMarginUsd: 3150, seasons: [coffeeSeason(4300, 5500)] },
    why: [tx('Pepper prices recovered in 2025-2026 and the field already has shade-tree rows.', 'Giá tiêu phục hồi 2025-2026 và vườn đã có hàng cây che bóng.')],
    evidence: [
      { label: tx('Annual rain', 'Mưa cả năm'), value: '1,780 mm', sourceId: 'chirps', branch: 'rainfall' },
      { label: tx('Drainage class', 'Cấp thoát nước'), value: 'well drained', sourceId: 'soilgrids', branch: 'soil' },
    ],
    benefits: [tx('Highest margin per hectare of the four, about +1,000 USD/ha a year.', 'Lãi trên mỗi ha cao nhất trong bốn phương án, khoảng +1.000 USD/ha mỗi năm.')],
    gaps: [
      tx('Pepper price is a 2026 reference; it swings ±40 % between years.', 'Giá tiêu là tham chiếu 2026; dao động ±40 % giữa các năm.'),
      tx('No soil test for Phytophthora history on this block.', 'Chưa xét nghiệm đất về tiền sử nấm Phytophthora ở lô này.'),
    ],
    risks: [
      tx('Foot rot (Phytophthora) can kill pepper vines in wet years; needs drainage checks.', 'Bệnh chết nhanh (Phytophthora) có thể làm chết tiêu năm mưa nhiều; cần kiểm tra thoát nước.'),
      tx('Water demand is above what the well delivered in March.', 'Nhu cầu nước cao hơn lượng giếng cung cấp trong tháng 3.'),
    ],
  },
];

const PRIORITY_METRIC: Record<FarmerPriority, (m: RotationStrategy['metrics'], e: RotationStrategy['economics']) => number> = {
  profit: (m) => Math.min(100, m.marginUsdPerHaYr / 35),
  yield: (m) => m.suitability,
  water: (m) => m.waterFit,
  soil: (m) => m.soilHealth,
  risk: (m) => 100 - m.risk,
  cost: (_m, e) => Math.max(0, 100 - e.perYear.costUsd / 100),
};

/** Re-ranks the fixture by the chosen priorities so the priority picker can be reviewed. */
export function advisoryFixture(priorities: FarmerPriority[]): AdvisoryReport {
  const weights: [FarmerPriority, number][] = priorities.length ? priorities.map((p, i) => [p, 3 - i]) : [['yield', 1]];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  const rotations = base.map((r) => ({
    ...r,
    score: Math.round(weights.reduce((a, [p, w]) => a + PRIORITY_METRIC[p](r.metrics, r.economics) * w, 0) / total),
  })) as RotationStrategy[];
  const best = rotations.reduce((a, b) => (b.score > a.score ? b : a));

  const t = (en: string, vi: string): I18nText => tx(en, vi);
  const months = [
    { tasks: [t('Irrigation round 1 (400 L/tree)', 'Tưới đợt 1 (400 L/gốc)'), t('Finish harvest drying', 'Phơi xong cà phê')], costUsd: 620, revenueUsd: 2600 },
    { tasks: [t('Irrigation round 2', 'Tưới đợt 2'), t('Pruning after harvest', 'Tỉa cành sau thu hoạch')], costUsd: 540, revenueUsd: 0 },
    { tasks: [t('Irrigation round 3', 'Tưới đợt 3')], costUsd: 480, revenueUsd: 0 },
    { tasks: [t('Lime if pH below 5.0', 'Bón vôi nếu pH dưới 5,0')], costUsd: 260, revenueUsd: 0 },
    { tasks: [t('Fertiliser 1 (NPK)', 'Bón phân đợt 1 (NPK)'), t('Sow legume in rows', 'Gieo đậu giữa hàng')], costUsd: 780, revenueUsd: 0 },
    { tasks: [t('Weed and scout for borer', 'Làm cỏ, kiểm tra mọt đục cành')], costUsd: 220, revenueUsd: 0 },
    { tasks: [t('Fertiliser 2', 'Bón phân đợt 2'), t('Harvest mung bean', 'Thu đậu xanh')], costUsd: 640, revenueUsd: 820 },
    { tasks: [t('Drainage check after heavy rain', 'Kiểm tra thoát nước sau mưa lớn')], costUsd: 120, revenueUsd: 0 },
    { tasks: [t('Fertiliser 3', 'Bón phân đợt 3')], costUsd: 560, revenueUsd: 0 },
    { tasks: [t('Harvest begins', 'Bắt đầu thu hoạch')], costUsd: 680, revenueUsd: 2900 },
    { tasks: [t('Main harvest', 'Thu hoạch chính'), t('Spread mulch', 'Phủ rơm')], costUsd: 720, revenueUsd: 3400 },
    { tasks: [t('Finish harvest, sell beans', 'Kết thúc thu hoạch, bán cà phê')], costUsd: 300, revenueUsd: 680 },
  ];
  let cash = 0;
  const plan = months.map((m, i) => {
    cash += m.revenueUsd - m.costUsd;
    return { month: i + 1, ...m, cashUsd: cash };
  });
  const rev = plan.reduce((a, m) => a + m.revenueUsd, 0);
  const cost = plan.reduce((a, m) => a + m.costUsd, 0);

  const today = '2026-11-14';
  return {
    generatedAt: today,
    cropId: 'coffea-canephora',
    priorities,
    rotations,
    annualPlan: {
      strategyId: best.id,
      months: plan,
      totals: { revenueUsd: rev, costUsd: cost, marginUsd: rev - cost, marginPct: ((rev - cost) / rev) * 100 },
      assumptions: [
        t('Robusta farm-gate price 4,250 USD/t (reference, Nov 2026).', 'Giá cà phê vối tại vườn 4.250 USD/t (tham chiếu, 11/2026).'),
        t('Yield 2.9 t/ha green bean from suitability 75.', 'Năng suất 2,9 t/ha nhân xanh từ độ phù hợp 75.'),
        t('Labour at 9 USD/day; your own costs replace these in Ground truth.', 'Công lao động 9 USD/ngày; chi phí thực của bạn thay thế ở mục Đo thực địa.'),
      ],
    },
    irrigation: {
      events: [
        { t: '2026-12-20', mm: 0, reason: t('Check only: rain ended late', 'Chỉ kiểm tra: mưa kết thúc muộn') },
        { t: '2027-01-08', mm: 45, reason: t('Root zone at 50 % of available water', 'Vùng rễ còn 50 % nước dễ tiêu') },
        { t: '2027-02-02', mm: 50, reason: t('Flowering trigger', 'Tưới kích hoa') },
        { t: '2027-02-24', mm: 45, reason: t('Fruit set', 'Đậu quả') },
        { t: '2027-03-18', mm: 40, reason: t('Deficit above 60 mm', 'Thiếu hụt trên 60 mm') },
        { t: '2027-04-10', mm: 30, reason: t('Before first rains', 'Trước mưa đầu mùa') },
      ].filter((e) => e.mm > 0),
      totalMm: 210,
      savedVsFixedMm: 90,
      method: t('Basin irrigation, 4 rounds by soil water balance', 'Tưới bồn, 4 đợt theo cân bằng nước đất'),
      basis: t('FAO-56 water balance with SMAP root-zone moisture and POWER reference ET', 'Cân bằng nước FAO-56 với ẩm vùng rễ SMAP và ET chuẩn POWER'),
    },
    ph: {
      current: 4.7,
      target: 5.5,
      amendment: 'lime',
      rateTHa: [1.5, 2.5],
      basis: t('SoilGrids 0-30 cm pH (250 m) and CEC 11 cmol/kg', 'pH 0-30 cm SoilGrids (250 m) và CEC 11 cmol/kg'),
      caveats: [
        t('SoilGrids is a 250 m model estimate; test the soil before buying lime.', 'SoilGrids là ước tính mô hình 250 m; hãy xét nghiệm đất trước khi mua vôi.'),
        t('Split the rate over two years on young trees.', 'Chia lượng vôi trong hai năm với cây non.'),
      ],
    },
    sowing: [62, 58, 54, 71, 88, 84, 72, 60, 48, 40, 44, 52].map((score, i) => ({
      month: i + 1,
      score,
      reliability: [0.6, 0.55, 0.5, 0.7, 0.85, 0.85, 0.75, 0.6, 0.5, 0.45, 0.5, 0.55][i],
      limiting: score < 60 ? (i < 4 || i > 9 ? 'water' : 'waterlogging') : null,
    })),
    advisories: [
      {
        id: 'irr',
        kind: 'irrigation',
        priority: 1,
        title: t('Irrigate by soil water, not by calendar', 'Tưới theo ẩm độ đất, không theo lịch'),
        summary: t('Four rounds from January to April keep the root zone above half of its available water and use 90 mm less than a fixed 20-day interval.', 'Bốn đợt từ tháng 1 đến tháng 4 giữ vùng rễ trên một nửa lượng nước dễ tiêu và ít hơn 90 mm so với tưới cố định 20 ngày.'),
        actions: [
          { when: t('8 Jan', '8/1'), what: t('First round once the root zone reaches 50 %', 'Đợt đầu khi vùng rễ còn 50 %'), amount: '45 mm' },
          { when: t('Early Feb', 'Đầu T2'), what: t('Flowering round', 'Đợt kích hoa'), amount: '50 mm' },
        ],
        impact: { waterSavedMm: 90, marginDeltaUsdPerHa: 85, scoreDelta: 4 },
        evidence: [
          { label: tx('Root-zone moisture now', 'Ẩm vùng rễ hiện tại'), value: '0.21 m³/m³', sourceId: 'smap-l4', branch: 'soilMoisture' },
          { label: tx('Reference ET, Jan-Apr', 'ET chuẩn, T1-T4'), value: '4.6 mm/day', sourceId: 'nasa-power', branch: 'agromet' },
        ],
        confidence: 0.58,
        caveats: [t('SMAP is a 9 km pixel; a soil probe or a hand test in the root zone overrides it.', 'SMAP là ô 9 km; đo đất tại vùng rễ sẽ thay thế giá trị này.')],
        needsLocalReview: true,
      },
      {
        id: 'ph',
        kind: 'ph',
        priority: 2,
        title: t('Raise soil pH from 4.7 towards 5.5', 'Nâng pH đất từ 4,7 lên khoảng 5,5'),
        summary: t('Acid basalt soil limits phosphorus uptake. Lime in April before the rains.', 'Đất bazan chua hạn chế hấp thu lân. Bón vôi tháng 4 trước mùa mưa.'),
        actions: [{ when: t('April', 'Tháng 4'), what: t('Broadcast agricultural lime under the canopy', 'Rải vôi nông nghiệp dưới tán'), amount: '1.5-2.5 t/ha' }],
        impact: { scoreDelta: 6, marginDeltaUsdPerHa: 120 },
        evidence: [{ label: tx('Soil pH (H₂O), 0-30 cm', 'pH đất (H₂O), 0-30 cm'), value: '4.7 (4.3-5.2)', sourceId: 'soilgrids', branch: 'soil' }],
        confidence: 0.42,
        caveats: [t('A field soil test is needed before any purchase.', 'Cần xét nghiệm đất trước khi mua.')],
        needsLocalReview: true,
      },
      {
        id: 'sow',
        kind: 'sowing',
        priority: 3,
        title: t('Sow the inter-row legume in May', 'Gieo đậu giữa hàng vào tháng 5'),
        summary: t('May scores best in 17 of 20 years: rains are established and harvest is out of the way.', 'Tháng 5 tốt nhất trong 17/20 năm: mưa đã ổn định và không vướng thu hoạch.'),
        actions: [{ when: t('10-25 May', '10-25/5'), what: t('Sow after 40 mm of cumulative rain', 'Gieo sau khi mưa tích lũy 40 mm') }],
        impact: { scoreDelta: 3 },
        evidence: [{ label: tx('Onset of rains (median)', 'Bắt đầu mùa mưa (trung vị)'), value: '6 May', sourceId: 'chirps', branch: 'rainfall' }],
        confidence: 0.71,
        caveats: [],
        needsLocalReview: false,
      },
      {
        id: 'borer',
        kind: 'risk',
        priority: 2,
        title: t('Coffee berry borer pressure after a warm dry season', 'Nguy cơ mọt đục quả sau mùa khô nóng'),
        summary: t('Night temperatures above 20 °C in March favour borer flights. Scout 20 trees in April.', 'Nhiệt độ đêm trên 20 °C tháng 3 thuận lợi cho mọt bay. Kiểm tra 20 cây vào tháng 4.'),
        actions: [{ when: t('April', 'Tháng 4'), what: t('Scout 20 trees, collect fallen berries', 'Kiểm tra 20 cây, nhặt quả rụng') }],
        impact: {},
        evidence: [{ label: tx('Mean night LST, March', 'LST đêm trung bình, T3'), value: '20.8 °C', sourceId: 'modis-mod11a2', branch: 'thermal' }],
        confidence: 0.38,
        caveats: [t('Pest rules are generic; ask the extension officer about local thresholds.', 'Quy tắc sâu bệnh là tổng quát; hỏi cán bộ khuyến nông về ngưỡng địa phương.')],
        needsLocalReview: true,
      },
      {
        id: 'erosion',
        kind: 'erosion',
        priority: 3,
        title: t('Contour the inter-rows on the 6° slope', 'Làm rãnh theo đường đồng mức trên dốc 6°'),
        summary: t('The first heavy rains of May fall on bare soil.', 'Những trận mưa lớn đầu tháng 5 rơi trên đất trống.'),
        actions: [{ when: t('Before May', 'Trước tháng 5'), what: t('Cut shallow contour trenches every 10 rows', 'Đào rãnh nông theo đồng mức mỗi 10 hàng') }],
        impact: { scoreDelta: 1 },
        evidence: [{ label: tx('Slope', 'Độ dốc'), value: '6.1°', sourceId: 'srtm-terrarium', branch: 'terrain' }],
        confidence: 0.8,
        caveats: [],
        needsLocalReview: false,
      },
    ],
  };
}
