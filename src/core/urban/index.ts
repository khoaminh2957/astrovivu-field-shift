/**
 * Urban Grower Companion: match balcony/rooftop conditions and preferences to the curated crops
 * marked suitable for urban growing. Rules in docs/ADVISORY.md §6.
 */
import type { CropProfile, I18nText, UrbanClimate, UrbanPreference, UrbanRecommendation, UrbanSite } from '@/contracts';
import { tx } from '@/contracts';
import { monthEn, monthVi, monthsFrom, wrapMonth } from '@/core/advisory/util';
import { listCrops } from '@/core/crops';
import { trapezoid, windowMonths } from '@/core/scoring';

const LIGHT_RANK = { shade: 0, partial: 1, full: 2 } as const;
const TAG_TIPS: Record<string, I18nText> = {
  climber: tx('Give it a trellis, net or railing to climb.', 'Làm giàn, lưới hoặc tận dụng lan can cho cây leo.'),
  'cut-and-come-again': tx('Harvest outer leaves or tips often: it keeps producing.', 'Thu lá ngoài hoặc ngọn thường xuyên: cây sẽ ra tiếp.'),
  fast: tx('Sow a little every 2-3 weeks for a steady harvest.', 'Gieo từng ít một mỗi 2-3 tuần để thu hoạch đều.'),
  'cool-season': tx('Grow it in the coolest months; it bolts in heat.', 'Trồng vào những tháng mát nhất; trời nóng cây dễ trổ ngồng.'),
  'heat-tolerant': tx('Copes with hot balconies; mulch the pot to keep roots cool.', 'Chịu được ban công nóng; phủ gốc chậu để giữ mát rễ.'),
  'shade-easy': tx('Fine with a few hours of direct sun.', 'Chỉ cần vài giờ nắng trực tiếp.'),
  pollinator: tx('Flowers attract bees and other pollinators.', 'Hoa thu hút ong và côn trùng thụ phấn.'),
  'pest-repellent': tx('Often planted beside vegetables as a companion plant.', 'Thường trồng cạnh rau như cây đồng hành.'),
  fruit: tx('Feed regularly once flowering starts; fruit needs nutrients.', 'Bón phân đều khi bắt đầu ra hoa; cây cần dinh dưỡng để nuôi quả.'),
};
const PREF_TAG: Record<UrbanPreference, string> = { vegetables: 'vegetables', herbs: 'herbs', flowers: 'flowers', 'shade-easy': 'shade-easy', fruit: 'fruit' };

function windowFit(c: CropProfile, climate: UrbanClimate, start: number): number {
  const n = windowMonths(c);
  const ms = monthsFrom(start, Math.min(n, 6)).map((m) => climate.months.find((x) => x.month === m)).filter((x) => x != null);
  if (!ms.length) return 0;
  // Pots are watered by hand, so only temperature limits the season; frost kills tender crops.
  let f = 1;
  for (const m of ms) {
    f = Math.min(f, trapezoid(m!.tMean, c.req.tempC));
    if (c.req.killTempC != null && m!.tMin <= c.req.killTempC) f = Math.min(f, 0.1);
  }
  return f;
}

export function recommendUrban(site: UrbanSite, climate: UrbanClimate, prefs: UrbanPreference[], month?: number): UrbanRecommendation[] {
  if (!climate.months.length) return [];
  const now = month ?? 1;
  const out: UrbanRecommendation[] = [];
  for (const c of listCrops()) {
    const u = c.urban;
    if (!u?.suitable) continue;
    if ((site.space === 'windowsill' || site.space === 'balcony') && !u.container) continue;
    if (site.space === 'windowsill' && (u.tags.includes('climber') || u.difficulty === 3 || c.category === 'fruit')) continue;
    const fits = Array.from({ length: 12 }, (_, i) => windowFit(c, climate, i + 1));
    const sowMonths = fits.map((f, i) => (f >= 0.6 ? i + 1 : 0)).filter((m) => m > 0);
    if (!sowMonths.length) continue;
    const soon = Math.max(fits[now - 1], 0.85 * fits[wrapMonth(now + 1) - 1]);
    const gap = LIGHT_RANK[u.light] - LIGHT_RANK[site.light];
    const light = gap <= 0 ? 1 : gap === 1 ? 0.5 : 0.1;
    const pref = prefs.length ? (prefs.some((p) => u.tags.includes(PREF_TAG[p])) ? 1 : 0.55) : 0.8;
    const par = climate.months.find((m) => m.month === now)?.par;
    const lowLight = u.light === 'full' && par != null && par < 6 ? 0.8 : 1;
    const score = Math.round(100 * (0.45 * soon + 0.15 * (sowMonths.length / 12)) / 0.6 * light * pref * lowLight * (1 - 0.06 * (u.difficulty - 1)));
    if (score < 20) continue;
    const name = tx(c.names.en, c.names.vi ?? c.names.en);
    const why: I18nText[] = [];
    if (fits[now - 1] >= 0.6) why.push(tx(`Can be sown now: this month's mean ${Math.round(climate.months[now - 1]?.tMean ?? 0)} °C suits it.`, `Có thể gieo ngay: nhiệt độ trung bình tháng này ${Math.round(climate.months[now - 1]?.tMean ?? 0)} °C phù hợp.`));
    else why.push(tx(`Best sown in ${sowMonths.map(monthEn).join(', ')}.`, `Nên gieo vào ${sowMonths.map(monthVi).join(', ')}.`));
    why.push(gap <= 0 ? tx(`Your ${site.light} light is enough (needs ${u.light}).`, `Ánh sáng ${site.light === 'full' ? 'nắng đủ' : site.light === 'partial' ? 'nắng một phần' : 'râm'} của bạn là đủ.`) : tx(`Needs ${u.light} sun; expect a smaller harvest with ${site.light} light.`, `Cần ${u.light === 'full' ? 'nắng đủ' : 'nắng một phần'}; thiếu sáng sẽ cho thu hoạch ít hơn.`));
    if (prefs.some((p) => u.tags.includes(PREF_TAG[p]))) why.push(tx('Matches what you want to grow.', 'Phù hợp với thứ bạn muốn trồng.'));
    if (u.difficulty === 1) why.push(tx('Easy for beginners.', 'Dễ trồng cho người mới.'));
    const harvestDays: [number, number] = [c.cycleDays[0], c.cycleDays[1]];
    const wu = c.rotation?.waterUse ?? 'medium';
    const hot = Math.max(...climate.months.map((m) => m.tMax)) >= 32;
    const water = wu === 'high' ? tx(`Keep the mix evenly moist: water daily in hot weather${hot ? ', twice on the hottest days' : ''}.`, `Giữ đất luôn ẩm: tưới hằng ngày khi trời nóng${hot ? ', ngày nắng gắt tưới hai lần' : ''}.`) : wu === 'low' ? tx('Water when the top 2-3 cm of mix are dry; avoid soggy pots.', 'Tưới khi lớp đất mặt 2-3 cm đã khô; tránh để chậu úng.') : tx('Water when the top 1-2 cm are dry, usually every 1-3 days.', 'Tưới khi lớp mặt 1-2 cm khô, thường 1-3 ngày một lần.');
    const lightTxt = u.light === 'full' ? tx('6 or more hours of direct sun a day.', 'Từ 6 giờ nắng trực tiếp mỗi ngày.') : u.light === 'partial' ? tx('3-6 hours of sun; shade at midday in hot months.', '3-6 giờ nắng; che nắng buổi trưa vào tháng nóng.') : tx('Bright shade or 2-3 hours of morning sun.', 'Bóng râm sáng hoặc 2-3 giờ nắng sáng.');
    const tips = u.tags.map((t) => TAG_TIPS[t]).filter((x): x is I18nText => !!x).slice(0, 3);
    tips.push(tx(site.space === 'windowsill' ? 'Use a pot at least 15 cm deep with drainage holes.' : 'Use containers at least 20-30 cm deep with drainage holes and a light potting mix.', site.space === 'windowsill' ? 'Dùng chậu sâu ít nhất 15 cm có lỗ thoát nước.' : 'Dùng chậu sâu ít nhất 20-30 cm có lỗ thoát nước và giá thể nhẹ.'));
    const harvestOffset = Math.max(1, Math.round((harvestDays[0] + harvestDays[1]) / 2 / 30.4));
    const calendar = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const tasks: I18nText[] = [];
      if (sowMonths.includes(m)) tasks.push(tx(`Sow ${c.names.en}`, `Gieo ${name.vi}`));
      if (sowMonths.includes(wrapMonth(m - harvestOffset))) tasks.push(tx('Harvest', 'Thu hoạch'));
      if (sowMonths.some((s) => monthsFrom(s, harvestOffset).includes(m)) && !tasks.length) tasks.push(tx('Water, feed every 2 weeks, check for pests', 'Tưới, bón phân 2 tuần một lần, kiểm tra sâu bệnh'));
      return { month: m, tasks };
    });
    out.push({ cropId: c.id, name, score: Math.min(100, score), why, difficulty: u.difficulty, care: { water, light: lightTxt, sowMonths, harvestDays, tips }, calendar });
  }
  return out.sort((a, b) => b.score - a.score || a.difficulty - b.difficulty).slice(0, 10);
}
