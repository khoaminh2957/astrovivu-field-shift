/**
 * Crop catalogue public API.
 *
 * PLACEHOLDER IMPLEMENTATION (owner: Agent 2b). Eight crops with EcoCrop thresholds so the app
 * runs end to end; the real catalogue is built from data/ecocrop (2,568 species) plus a curated
 * agronomy and economics overlay.
 */
import type { CropCategory, CropProfile, Lang, Quad } from '@/contracts';

const crop = (
  id: string,
  scientificName: string,
  en: string,
  vi: string,
  category: CropCategory,
  lifeSpan: CropProfile['lifeSpan'],
  tempC: Quad,
  rainMm: Quad,
  ph: Quad,
  cycleDays: [number, number],
): CropProfile => ({ id, scientificName, names: { en, vi }, category, lifeSpan, req: { tempC, rainMm, ph }, cycleDays, curated: false });

const CATALOG: CropProfile[] = [
  crop('coffea-canephora', 'Coffea canephora', 'Robusta coffee', 'Cà phê vối', 'industrial', 'perennial', [12, 20, 30, 36], [900, 1700, 3000, 4000], [4.3, 5, 6.3, 8], [270, 330]),
  crop('oryza-sativa', 'Oryza sativa', 'Rice', 'Lúa', 'cereal', 'annual', [10, 20, 30, 36], [1000, 1500, 2000, 4000], [4.5, 5.5, 7, 9], [90, 150]),
  crop('zea-mays', 'Zea mays', 'Maize', 'Ngô', 'cereal', 'annual', [10, 18, 33, 47], [400, 600, 1200, 1800], [4.5, 5, 7, 8.5], [90, 150]),
  crop('glycine-max', 'Glycine max', 'Soybean', 'Đậu nành', 'pulse', 'annual', [10, 20, 33, 38], [450, 600, 1500, 1800], [4.5, 5.5, 6.5, 8.4], [75, 150]),
  crop('arachis-hypogaea', 'Arachis hypogaea', 'Groundnut', 'Đậu phộng', 'pulse', 'annual', [10, 22, 32, 45], [400, 600, 1500, 4000], [4.5, 5.5, 6.5, 8.5], [90, 150]),
  crop('sesamum-indicum', 'Sesamum indicum', 'Sesame', 'Mè', 'oilseed', 'annual', [10, 20, 30, 40], [300, 500, 1000, 1500], [4.5, 5.5, 7.5, 8], [80, 130]),
  crop('medicago-sativa', 'Medicago sativa', 'Alfalfa', 'Cỏ linh lăng', 'forage', 'perennial', [5, 21, 27, 45], [350, 600, 1200, 2700], [5.3, 6.5, 7.5, 8.7], [100, 210]),
  crop('vigna-radiata', 'Vigna radiata', 'Mung bean', 'Đậu xanh', 'pulse', 'annual', [8, 21, 36, 40], [500, 650, 900, 1250], [4.3, 5.5, 6.2, 8.1], [60, 100]),
];

export function listCrops(): CropProfile[] {
  return CATALOG;
}

export function getCrop(id: string | null | undefined): CropProfile | undefined {
  return id ? CATALOG.find((c) => c.id === id) : undefined;
}

export function searchCrops(query: string, lang: Lang, limit = 12): CropProfile[] {
  const q = query.trim().toLowerCase();
  if (!q) return CATALOG.slice(0, limit);
  return CATALOG.filter((c) =>
    [c.scientificName, c.names.en, c.names.vi ?? '', ...(c.names.aliases ?? [])].some((n) => n.toLowerCase().includes(q)),
  ).slice(0, limit);
}
