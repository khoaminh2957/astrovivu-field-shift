/**
 * DEV-ONLY LAYOUT FIXTURE for the tracking view, shaped like the robusta demo field. Every record is
 * flagged simulated. Never shown outside `?fixture=1` on the dev server.
 */
import type { Sample, TrackingData } from '@/contracts';
import { tx } from '@/contracts';

/** A coffee-like NDVI year: dry-season dip in March, plateau through the rains. */
function ndviYear(year: number, amp: number, shift: number, endDoy = 365): Sample[] {
  const out: Sample[] = [];
  for (let doy = 1; doy <= endDoy; doy += 16) {
    const d = new Date(Date.UTC(year, 0, doy));
    const season = 0.62 + amp * Math.sin(((doy - 100 - shift) / 365) * 2 * Math.PI);
    const noise = Math.sin(doy * 0.37 + year) * 0.015;
    out.push({ t: d.toISOString().slice(0, 10), v: Math.round((season + noise) * 1000) / 1000 });
  }
  return out;
}

export const TRACKING_FIXTURE: TrackingData = {
  parcelId: 'daklak-coffee',
  simulated: true,
  seasons: [2021, 2022, 2023, 2024, 2025].map((y, i) => ({
    id: `s${y}`,
    label: tx(`Harvest ${y}-${y + 1}`, `Vụ ${y}-${y + 1}`),
    cropId: 'coffea-canephora',
    start: `${y}-01-01`,
    end: `${y}-12-31`,
    yieldTHa: [2.6, 2.9, 2.4, 3.1, 2.8][i],
    revenueUsd: [8100, 9200, 8700, 12600, 11800][i],
    costUsd: [5200, 5400, 5600, 5900, 6100][i],
    ndviPeak: [0.74, 0.77, 0.71, 0.79, 0.76][i],
    rainMm: [1720, 1890, 1410, 1960, 1780][i],
    simulated: true,
  })),
  journal: [
    { id: 'j1', t: '2026-11-02', kind: 'harvest', title: tx('Harvest started, block A', 'Bắt đầu thu hoạch, lô A'), body: tx('About 40 % red cherries.', 'Khoảng 40 % quả chín đỏ.'), simulated: true },
    { id: 'j2', t: '2026-09-18', kind: 'operation', title: tx('Fertiliser round 3 (NPK 16-8-16)', 'Bón phân đợt 3 (NPK 16-8-16)'), body: tx('350 kg/ha', '350 kg/ha'), simulated: true },
    { id: 'j3', t: '2026-08-04', kind: 'scouting', title: tx('Borer damage on 3 of 20 trees', 'Mọt đục cành 3 trên 20 cây'), simulated: true },
    { id: 'j4', t: '2026-05-12', kind: 'soil-test', title: tx('Soil sampled, sent to lab', 'Lấy mẫu đất gửi phòng thí nghiệm'), simulated: true },
    { id: 'j5', t: '2026-03-20', kind: 'alert', title: tx('Dry spell: root-zone moisture at p10', 'Khô hạn: ẩm vùng rễ ở mức p10'), simulated: true },
    { id: 'j6', t: '2026-02-03', kind: 'operation', title: tx('Irrigation round 2, 450 L/tree', 'Tưới đợt 2, 450 L/gốc'), simulated: true },
  ],
  soilTests: [
    {
      t: '2024-05-10',
      lab: 'WASI Buon Ma Thuot',
      simulated: true,
      values: [
        { key: 'ph', label: tx('pH (KCl)', 'pH (KCl)'), value: 4.4, unit: '', rating: 'low' },
        { key: 'om', label: tx('Organic matter', 'Chất hữu cơ'), value: 2.6, unit: '%', rating: 'low' },
        { key: 'p', label: tx('Available P', 'Lân dễ tiêu'), value: 9, unit: 'mg/100 g', rating: 'optimal' },
        { key: 'k', label: tx('Exchangeable K', 'Kali trao đổi'), value: 0.18, unit: 'cmol/kg', rating: 'low' },
      ],
    },
    {
      t: '2026-05-12',
      lab: 'WASI Buon Ma Thuot',
      simulated: true,
      values: [
        { key: 'ph', label: tx('pH (KCl)', 'pH (KCl)'), value: 4.7, unit: '', rating: 'low' },
        { key: 'om', label: tx('Organic matter', 'Chất hữu cơ'), value: 3.1, unit: '%', rating: 'optimal' },
        { key: 'p', label: tx('Available P', 'Lân dễ tiêu'), value: 11, unit: 'mg/100 g', rating: 'optimal' },
        { key: 'k', label: tx('Exchangeable K', 'Kali trao đổi'), value: 0.24, unit: 'cmol/kg', rating: 'optimal' },
      ],
    },
  ],
  alerts: [
    { id: 'a1', t: '2026-11-10', severity: 'watch', title: tx('Heavy rain forecast during harvest', 'Dự báo mưa lớn khi thu hoạch'), body: tx('62 mm expected 16-18 Nov; delay drying on open yards.', 'Dự kiến 62 mm ngày 16-18/11; hoãn phơi trên sân trống.'), branch: 'risk' },
    { id: 'a2', t: '2026-10-02', severity: 'info', title: tx('Vegetation back to normal', 'Thực vật trở lại bình thường'), body: tx('NDVI within the 2016-2025 band again.', 'NDVI đã về trong dải 2016-2025.'), branch: 'vegetation' },
    { id: 'a3', t: '2026-03-20', severity: 'alert', title: tx('Root-zone moisture at the 10th percentile', 'Ẩm vùng rễ ở bách phân vị thứ 10'), body: tx('Irrigate within 5 days to protect fruit set.', 'Tưới trong 5 ngày để giữ quả non.'), branch: 'soilMoisture' },
  ],
  planVsActual: Array.from({ length: 12 }, (_, i) => {
    const plannedCost = [620, 540, 480, 260, 780, 220, 640, 120, 560, 680, 720, 300][i];
    const plannedRev = [2600, 0, 0, 0, 0, 0, 820, 0, 0, 2900, 3400, 680][i];
    const done = i < 10;
    return {
      month: i + 1,
      plannedCostUsd: plannedCost,
      actualCostUsd: done ? Math.round(plannedCost * [1.05, 0.96, 1.22, 1, 1.08, 0.9, 1.1, 1.3, 0.98, 1.02][i]) : null,
      plannedRevenueUsd: plannedRev,
      actualRevenueUsd: done ? Math.round(plannedRev * [0.92, 1, 1, 1, 1, 1, 0.8, 1, 1, 1.06][i]) : null,
    };
  }),
  ndviByYear: [
    { year: 2023, samples: ndviYear(2023, 0.06, 10), simulated: true },
    { year: 2024, samples: ndviYear(2024, 0.08, 0), simulated: true },
    { year: 2025, samples: ndviYear(2025, 0.07, -8), simulated: true },
    { year: 2026, samples: ndviYear(2026, 0.1, 5, 318), simulated: true },
  ],
};
