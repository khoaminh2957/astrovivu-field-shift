/**
 * Urban Grower Companion: match balcony/rooftop conditions and preferences to the curated crops
 * marked suitable for urban growing. Rules in docs/ADVISORY.md §6.
 */
import type { CropProfile, I18nText, UrbanClimate, UrbanPreference, UrbanRecommendation, UrbanSite } from '@/contracts';
import { tx } from '@/contracts';
import { monthEn, monthVi, monthsFrom, wrapMonth } from '@/core/advisory/util';
import { listUrbanCrops } from '@/core/crops';
import { trapezoid, windowMonths } from '@/core/scoring';
import { SOW_FIT } from './calendar';
import { FAMILIARITY_FACTOR, familiarityFactor, familiarityReason, selectFamiliarity, type FamiliarityLevel, type RegionFamiliarityInput, type UrbanFamiliarity } from './familiarity';
import { canopyFromPot, potWater } from './water';
import { lightClass, sunHoursByMonth } from './sun';

export { MARGINAL_FIT, SOW_FIT, climateScale, nextSow, sowLevel, sowLevels, yearFrom } from './calendar';
export type { ClimateScale, SowLevel } from './calendar';
export { FAMILIARITY_FACTOR, familiarityFactor, familiarityReason, selectFamiliarity };
export type { FamiliarityLevel, RegionFamiliarityInput, UrbanFamiliarity };
export { ECOCROP_CREDIT, ECOCROP_TERMS_URL, cropImage, ecocropPageUrl, ecocropPhotoUrl } from './ecocrop';
export type { CropImageManifest, CropImageSize } from './ecocrop';
export { canopyFromPot, potWater } from './water';
export type { PotWaterMonth } from './water';
export { MID_DOY, lightClass, solarPosition, sunHours, sunHoursByMonth } from './sun';
export type { SolarPosition, SunHoursOptions } from './sun';

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

export function recommendUrban(
  site: UrbanSite,
  climate: UrbanClimate,
  prefs: UrbanPreference[],
  month?: number,
  familiarity?: (cropId: string) => UrbanFamiliarity | null,
): UrbanRecommendation[] {
  return rank(site, climate, prefs, month ?? 1, false, familiarity);
}

/**
 * When nothing can be sown this month (a temperate winter), the picks of the first later month in
 * which one of them can be sown, scored as if that month were now. A month whose picks only count
 * on the month after it is passed over, so the month named is one sowing really opens in. Null
 * when no month of the year has any pick.
 */
export function recommendUrbanAhead(
  site: UrbanSite,
  climate: UrbanClimate,
  prefs: UrbanPreference[],
  month: number,
  familiarity?: (cropId: string) => UrbanFamiliarity | null,
): { month: number; picks: UrbanRecommendation[] } | null {
  let first: { month: number; picks: UrbanRecommendation[] } | null = null;
  for (let k = 1; k < 12; k++) {
    const m = wrapMonth(month + k);
    const picks = rank(site, climate, prefs, m, true, familiarity);
    if (!picks.length) continue;
    if (picks.some((p) => p.care.sowMonths.includes(m))) return { month: m, picks };
    first ??= { month: m, picks };
  }
  return first;
}

/** `ahead` only changes the wording: the month being scored is then a future one, not "now". */
function rank(
  site: UrbanSite,
  climate: UrbanClimate,
  prefs: UrbanPreference[],
  now: number,
  ahead: boolean,
  familiarity?: (cropId: string) => UrbanFamiliarity | null,
): UrbanRecommendation[] {
  if (!climate.months.length) return [];
  const monthlySun =
    site.facingDeg != null
      ? sunHoursByMonth(site.location[1], site.facingDeg, { horizonDeg: site.horizonDeg, overhangDeg: site.overhangDeg })
      : null;
  const sunHoursNow = monthlySun ? (monthlySun[now - 1] ?? 0) : null;
  const effectiveLight = sunHoursNow != null ? lightClass(sunHoursNow) : site.light;
  const out: Array<{ rec: UrbanRecommendation; rawScore: number }> = [];
  for (const c of listUrbanCrops()) {
    const u = c.urban;
    if (!u?.suitable) continue;
    if ((site.space === 'windowsill' || site.space === 'balcony') && !u.container) continue;
    if (site.space === 'windowsill' && (u.tags.includes('climber') || u.difficulty === 3 || c.category === 'fruit')) continue;
    const fits = Array.from({ length: 12 }, (_, i) => windowFit(c, climate, i + 1));
    const sowMonths = fits.map((f, i) => (f >= SOW_FIT ? i + 1 : 0)).filter((m) => m > 0);
    if (!sowMonths.length) continue;
    const soon = Math.max(fits[now - 1], 0.85 * fits[wrapMonth(now + 1) - 1]);
    const gap = LIGHT_RANK[u.light] - LIGHT_RANK[effectiveLight];
    const light = gap <= 0 ? 1 : gap === 1 ? 0.5 : 0.1;
    const pref = prefs.length ? (prefs.some((p) => u.tags.includes(PREF_TAG[p])) ? 1 : 0.55) : 0.8;
    const par = climate.months.find((m) => m.month === now)?.par;
    const lowLight = u.light === 'full' && par != null && par < 6 ? 0.8 : 1;
    const fam = familiarity ? familiarity(c.id) : null;
    const famFactor = familiarityFactor(fam);
    const rawScore = Math.round(100 * (0.45 * soon + 0.15 * (sowMonths.length / 12)) / 0.6 * light * pref * lowLight * (1 - 0.06 * (u.difficulty - 1)) * famFactor);
    if (rawScore < 20) continue;
    const score = Math.min(100, rawScore);
    const name = tx(c.names.en, c.names.vi ?? c.names.en);
    const why: I18nText[] = [];
    const tNow = Math.round(climate.months[now - 1]?.tMean ?? 0);
    if (ahead && fits[now - 1] >= SOW_FIT) why.push(tx(`Can be sown from ${monthEn(now)}: that month's mean ${tNow} °C suits it.`, `Có thể gieo từ ${monthVi(now)}: nhiệt độ trung bình tháng đó ${tNow} °C phù hợp.`));
    else if (fits[now - 1] >= SOW_FIT) why.push(tx(`Can be sown now: this month's mean ${Math.round(climate.months[now - 1]?.tMean ?? 0)} °C suits it.`, `Có thể gieo ngay: nhiệt độ trung bình tháng này ${Math.round(climate.months[now - 1]?.tMean ?? 0)} °C phù hợp.`));
    else why.push(tx(`Best sown in ${sowMonths.map(monthEn).join(', ')}.`, `Nên gieo vào ${sowMonths.map(monthVi).join(', ')}.`));
    if (sunHoursNow != null) {
      const hStr = sunHoursNow.toFixed(1).replace(/\.0$/, '');
      why.push(
        gap <= 0
          ? tx(
              `Your balcony gets about ${hStr} hours of direct sun this month under clear skies, which is enough (needs ${u.light}).`,
              `Ban công của bạn có khoảng ${hStr} giờ nắng trực tiếp trong tháng này, khi trời quang (đủ mức ${u.light === 'full' ? 'nắng đủ' : u.light === 'partial' ? 'nắng một phần' : 'râm'}).`,
            )
          : tx(
              `Your balcony gets about ${hStr} hours of direct sun this month under clear skies; needs ${u.light} sun, so expect a smaller harvest.`,
              `Ban công của bạn có khoảng ${hStr} giờ nắng trực tiếp trong tháng này, khi trời quang; cây cần ${u.light === 'full' ? 'nắng đủ' : 'nắng một phần'} nên thu hoạch sẽ ít hơn.`,
            ),
      );
    } else {
      why.push(gap <= 0 ? tx(`Your ${site.light} light is enough (needs ${u.light}).`, `Ánh sáng ${site.light === 'full' ? 'nắng đủ' : site.light === 'partial' ? 'nắng một phần' : 'râm'} của bạn là đủ.`) : tx(`Needs ${u.light} sun; expect a smaller harvest with ${site.light} light.`, `Cần ${u.light === 'full' ? 'nắng đủ' : 'nắng một phần'}; thiếu sáng sẽ cho thu hoạch ít hơn.`));
    }
    if (prefs.some((p) => u.tags.includes(PREF_TAG[p]))) why.push(tx('Matches what you want to grow.', 'Phù hợp với thứ bạn muốn trồng.'));
    if (u.difficulty === 1) why.push(tx('Easy for beginners.', 'Dễ trồng cho người mới.'));
    const famReason = familiarityReason(fam, site.place);
    if (famReason) why.push(famReason);
    const harvestDays: [number, number] = [c.cycleDays[0], c.cycleDays[1]];
    const wu = c.rotation?.waterUse ?? 'medium';
    const hot = Math.max(...climate.months.map((m) => m.tMax)) >= 32;
    const water = wu === 'high' ? tx(`Keep the mix evenly moist: water daily in hot weather${hot ? ', twice on the hottest days' : ''}.`, `Giữ đất luôn ẩm: tưới hằng ngày khi trời nóng${hot ? ', ngày nắng gắt tưới hai lần' : ''}.`) : wu === 'low' ? tx('Water when the top 2-3 cm of mix are dry; avoid soggy pots.', 'Tưới khi lớp đất mặt 2-3 cm đã khô; tránh để chậu úng.') : tx('Water when the top 1-2 cm are dry, usually every 1-3 days.', 'Tưới khi lớp mặt 1-2 cm khô, thường 1-3 ngày một lần.');
    const canopyM2 = site.potDiameterCm != null ? canopyFromPot(site.potDiameterCm) : 0;
    const pw = canopyM2 > 0 ? potWater(c, climate, { canopyM2 }) : [];
    const waterLitres = pw.length ? pw.map((p) => ({ month: p.month, min: p.litresMin, max: p.litresMax })) : undefined;
    const assumedWater = c.flags?.includes('water-model-assumed') ?? false;
    const usesEra5 = pw.length > 0 && pw.every((p) => p.et0From === 'era5');
    const waterBasis =
      pw.length && c.water
        ? tx(
            `Estimated for a ${site.potDiameterCm} cm round pot (${canopyM2.toFixed(3)} m² surface); ET0 from ${usesEra5 ? 'ERA5-Land (Open-Meteo, CC BY 4.0)' : 'FAO-56 Eq. 52 Hargreaves temperature estimate'}; crop coefficients Kc = ${c.water.kc.ini}–${c.water.kc.mid} from ${c.water.source}${assumedWater ? ' (water-model-assumed: proxy Kc borrowed from a similar crop)' : ''}. Rain is not subtracted; water less when outdoor pots receive rain.`,
            `Ước tính cho chậu tròn đường kính ${site.potDiameterCm} cm (diện tích mặt ${canopyM2.toFixed(3)} m²); ET0 từ ${usesEra5 ? 'ERA5-Land (Open-Meteo, CC BY 4.0)' : 'ước lượng nhiệt độ Hargreaves (FAO-56 công thức 52)'}; hệ số cây trồng Kc = ${c.water.kc.ini}–${c.water.kc.mid} theo ${c.water.source}${assumedWater ? ' (hệ số mượn của cây khác — water-model-assumed)' : ''}. Chưa trừ mưa; chậu ngoài trời gặp mưa thì bớt tưới.`,
          )
        : undefined;
    const lightTxt = u.light === 'full' ? tx('6 or more hours of direct sun a day.', 'Từ 6 giờ nắng trực tiếp mỗi ngày.') : u.light === 'partial' ? tx('3-6 hours of sun; shade at midday in hot months.', '3-6 giờ nắng; che nắng buổi trưa vào tháng nóng.') : tx('Bright shade or 2-3 hours of morning sun.', 'Bóng râm sáng hoặc 2-3 giờ nắng sáng.');
    const tips = u.tags.map((t) => TAG_TIPS[t]).filter((x): x is I18nText => !!x).slice(0, 3);
    if (u.potDepthCm != null) {
      const volEn = u.potVolumeL != null ? ` (at least ${u.potVolumeL} L)` : '';
      const volVi = u.potVolumeL != null ? ` (ít nhất ${u.potVolumeL} lít)` : '';
      const spEn = u.spacingCm != null ? `, spaced ${u.spacingCm} cm apart` : '';
      const spVi = u.spacingCm != null ? `, cây cách cây ${u.spacingCm} cm` : '';
      tips.push(
        tx(
          `Use a pot at least ${u.potDepthCm} cm deep${volEn}${spEn} with drainage holes and a light potting mix.`,
          `Dùng chậu sâu ít nhất ${u.potDepthCm} cm${volVi}${spVi}, có lỗ thoát nước và giá thể nhẹ.`,
        ),
      );
    } else {
      tips.push(
        tx(
          site.space === 'windowsill'
            ? 'Use a pot at least 15 cm deep with drainage holes.'
            : 'Use containers at least 20-30 cm deep with drainage holes and a light potting mix.',
          site.space === 'windowsill'
            ? 'Dùng chậu sâu ít nhất 15 cm có lỗ thoát nước.'
            : 'Dùng chậu sâu ít nhất 20-30 cm có lỗ thoát nước và giá thể nhẹ.',
        ),
      );
    }
    const harvestOffset = Math.max(1, Math.round((harvestDays[0] + harvestDays[1]) / 2 / 30.4));
    const calendar = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const tasks: I18nText[] = [];
      if (sowMonths.includes(m)) tasks.push(tx(`Sow ${c.names.en}`, `Gieo ${name.vi}`));
      if (sowMonths.includes(wrapMonth(m - harvestOffset))) tasks.push(tx('Harvest', 'Thu hoạch'));
      if (sowMonths.some((s) => monthsFrom(s, harvestOffset).includes(m)) && !tasks.length) tasks.push(tx('Water, feed every 2 weeks, check for pests', 'Tưới, bón phân 2 tuần một lần, kiểm tra sâu bệnh'));
      return { month: m, tasks };
    });
    out.push({
      rawScore,
      rec: {
        cropId: c.id,
        name,
        score,
        why,
        difficulty: u.difficulty,
        care: {
          water,
          ...(waterLitres ? { waterLitres } : {}),
          ...(waterBasis ? { waterBasis } : {}),
          light: lightTxt,
          sowMonths,
          sowFit: fits.map((f) => Math.round(f * 100) / 100),
          harvestDays,
          tips,
        },
        calendar,
      },
    });
  }
  return out
    .sort((a, b) => b.rec.score - a.rec.score || b.rawScore - a.rawScore || a.rec.difficulty - b.rec.difficulty)
    .slice(0, 10)
    .map((x) => x.rec);
}
