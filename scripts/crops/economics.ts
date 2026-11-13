/**
 * Reference economics, keyed by crop id and region. Collected on 2026-11-14; see
 * docs/ECONOMICS.md for the full table, the conversions and what could not be found.
 *
 * Conversions: 1 acre = 0.404686 ha; maize and sorghum 1 bu = 25.401 kg; soybean and wheat
 * 1 bu = 27.216 kg; oats 1 bu = 14.515 kg; barley 1 bu = 21.772 kg; 1 short ton = 0.907185 t;
 * 1 cwt = 45.359 kg; VND to USD at 25,600 (State Bank of Vietnam central rate, 10 Nov 2026).
 *
 * `cost` is the operating (variable) cost. Where a source publishes total cost including land
 * and overhead, the total is quoted in the source line and not used.
 */
import type { EconRegion, ReferenceEconomics, ReferenceTable, SourceQuality } from '../../src/core/economics/types';

export const VND_PER_USD = 25_600;
export const FX_SOURCE = 'State Bank of Vietnam central rate, 25,600 VND per USD on 10 Nov 2026 (reported by https://thitruongtaichinhtiente.vn/ngay-10-11-ty-gia-trung-tam-giam-10-dong-86927.html)';
export const FX_DATE = '2026-11-10';

const ACRE = 0.404686;
const perAcre = (usd: number) => Math.round((usd / ACRE) * 10) / 10;
const vnd = (millionPerHa: number) => Math.round((millionPerHa * 1e6) / VND_PER_USD);
const vndPerKg = (v: number) => Math.round(((v * 1000) / VND_PER_USD) * 10) / 10;

const FAO_Q = 'FAOSTAT, Crops and livestock products, Viet Nam 2024 (https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_Asia.zip)';
const FAO_P = 'FAOSTAT, Producer prices in USD/tonne, Viet Nam 2024 (https://bulks-faostat.fao.org/production/Prices_E_Asia.zip)';
const ERS = 'USDA ERS, Commodity Costs and Returns, 2025, per planted acre (https://www.ers.usda.gov/data-products/commodity-costs-and-returns/)';
const NASS_CP = 'USDA NASS, Crop Production 2025 Summary (https://release.nass.usda.gov/reports/cropan26.txt)';
const NASS_CV = 'USDA NASS, Crop Values 2025 Summary, marketing-year price (https://release.nass.usda.gov/reports/cpvl0226.txt)';
const NASS_VG = 'USDA NASS, Vegetables 2025 Summary (https://release.nass.usda.gov/reports/vegean26.txt)';
const ISU = 'Iowa State University Extension, Ag Decision Maker A1-20, Estimated Costs of Crop Production in Iowa 2026 (https://www.extension.iastate.edu/agdm/crops/pdf/a1-20.pdf)';
const NDSU = 'NDSU Extension, Projected 2026 Crop Budgets, North Central North Dakota, EC1654, direct costs (https://www.ndsu.edu/agriculture/sites/default/files/2026-02/ec1654.pdf)';
const IDAHO = 'University of Idaho Extension crop budgets (https://www.uidaho.edu/extension/food/idaho-agbiz/crop-budgets)';
const ARS = 'USDA-ARS National Soil Dynamics Laboratory, Fact Sheet 04o "Cover Crop Costs", October 2014: seed at the listed rate plus no-till drilling at $9.71/acre (https://www.mssoy.org/sites/default/files/documents/usda-costs-2014.pdf)';

interface Item {
  v: number | null;
  q: SourceQuality;
  src: string;
}
const official = (v: number, src: string): Item => ({ v, q: 'official', src });
const budget = (v: number, src: string): Item => ({ v, q: 'budget', src });
const press = (v: number, src: string): Item => ({ v, q: 'press', src });
const derived = (v: number, src: string): Item => ({ v, q: 'derived', src });
const none = (why: string): Item => ({ v: null, q: 'none', src: `NOT FOUND: ${why}` });

function rec(region: EconRegion, yieldRegion: string, year: number, y: Item, p: Item, c: Item): ReferenceEconomics {
  return {
    region,
    yieldRegion,
    refYieldTHa: y.v,
    priceUsdPerT: p.v,
    costUsdPerHa: c.v,
    year,
    quality: { yield: y.q, price: p.q, cost: c.q },
    sources: [`yield: ${y.src}`, `price: ${p.src}`, `cost: ${c.src}`],
  };
}

const vn = (crop: string, year: number, y: Item, p: Item, c: Item) => rec('VN', `Viet Nam, national average (${crop})`, year, y, p, c);
const us = (crop: string, y: Item, p: Item, c: Item, year = 2025) => rec('US', `United States, national average (${crop})`, year, y, p, c);

/** Cover crops are not harvested: no yield, no price, only the cost of establishing them. */
const cover = (region: EconRegion, costPerAcre: number, year: number, src: string, q: SourceQuality = 'budget'): ReferenceEconomics =>
  rec(
    region,
    'not harvested (cover crop)',
    year,
    { v: 0, q: 'official', src: 'cover crop: nothing is sold' },
    { v: 0, q: 'official', src: 'cover crop: nothing is sold' },
    { v: perAcre(costPerAcre), q, src: `$${costPerAcre.toFixed(2)}/acre; ${src}` },
  );

const NO_VN_COST = 'no Vietnamese production cost per hectare was found in an opened source';

export const REFERENCE_ECONOMICS: ReferenceTable = {
  // ------------------------------------------------------------------------------------- cereals
  'oryza-sativa': {
    VN: vn(
      'paddy',
      2026,
      official(6.15, `6,151.7 kg/ha; ${FAO_Q}`),
      press(vndPerKg(5850), 'paddy bought by traders at 5,700-6,000 VND/kg (midpoint used), An Giang, April 2026; Nhân Dân 22 Apr 2026 (https://nhandan.vn/lien-ket-ben-vung-cung-nha-nong-vuot-kho-post957604.html). FAOSTAT 2024: 356 USD/t'),
      press(vnd(22.2), '22.2 million VND/ha in eight demonstration models, winter-spring 2025-26, An Giang (same article; scope of the cost not stated; conventional practice is given as more than 3.2 million VND/ha higher)'),
    ),
    US: us('rough rice', official(9.08, `81 cwt/acre; ${ERS}`), official(291.2, `$13.21/cwt at harvest; ${ERS}`), official(1957.4, `operating costs $792.12/acre (total costs listed $1,343.42/acre); ${ERS}`)),
  },
  'zea-mays': {
    VN: vn(
      'dry grain',
      2026,
      official(5.11, `5,106.6 kg/ha; ${FAO_Q}`),
      official(260.1, FAO_P),
      press(vnd(26.96), '26.96 million VND/ha (seed, fertiliser, pesticides, land preparation, sowing, care labour) in a 5 ha demonstration of hybrid maize at 6.54 t/ha, Gia Lai, main season 2026; Việt Báo 30 Oct 2026 (https://vietbao.vn/index%2Ephp/print-613755.html)'),
    ),
    US: us('grain', official(12.43, `198 bu/acre; ${ERS}`), official(154.7, `$3.93/bu at harvest; ${ERS}`), official(1126.3, `operating costs $455.80/acre (total costs listed $900.52/acre); ${ERS}`)),
    'US-HEARTLAND': rec(
      'US-HEARTLAND',
      'Iowa (grain)',
      2026,
      official(13.18, `210.0 bu/acre, Iowa 2025; ${NASS_CP}`),
      official(161.4, `$4.10/bu; ${NASS_CV}`),
      budget(perAcre(483.6), `variable costs $483.60/acre for corn following soybeans at 211 bu/acre (total incl. land and labour $911.98/acre); ${ISU}`),
    ),
  },
  'triticum-aestivum': {
    US: us('all wheat', official(3.63, `54 bu/acre; ${ERS}`), official(186.3, `$5.07/bu at harvest; ${ERS}`), official(402.7, `operating costs $162.96/acre (total costs listed $408.55/acre); ${ERS}`)),
    'US-HEARTLAND': rec('US-HEARTLAND', 'ERS Heartland region', 2025, official(5.85, `87 bu/acre; ${ERS}`), official(190.3, `$5.18/bu; ${ERS}`), official(570.4, `operating costs $230.85/acre (total $566.53/acre); ${ERS}`)),
  },
  'sorghum-bicolor': {
    US: us('grain', official(4.96, `79 bu/acre; ${ERS}`), official(133.9, `$3.40/bu at harvest; ${ERS}`), official(452.8, `operating costs $183.24/acre (total costs listed $447.66/acre); ${ERS}`)),
  },
  'hordeum-vulgare': {
    US: us('grain', official(3.66, `68 bu/acre; ${ERS}`), official(242.1, `$5.27/bu at harvest; ${ERS}`), official(483.5, `operating costs $195.66/acre (total costs listed $503.77/acre); ${ERS}`)),
  },
  'avena-sativa': {
    US: us('grain', official(2.3, `64 bu/acre; ${ERS}`), official(230.1, `$3.34/bu at harvest; ${ERS}`), official(432.8, `operating costs $175.16/acre (total costs listed $498.35/acre); ${ERS}`)),
    'US-HEARTLAND': rec('US-HEARTLAND', 'Iowa (grain)', 2025, official(3.3, `92.0 bu/acre, Iowa 2025; ${NASS_CP}`), official(234.2, `$3.40/bu; ${NASS_CV}`), official(413.9, `operating costs $167.51/acre, ERS Heartland region; ${ERS}`)),
  },

  // -------------------------------------------------------------------------------------- pulses
  'glycine-max': {
    VN: vn(
      'dry grain',
      2026,
      official(1.63, `1,626.9 kg/ha; ${FAO_Q}`),
      official(927.9, FAO_P),
      derived(
        Math.round(vnd(26.96) * 0.7),
        'DERIVED, not a published per-hectare figure: 70 % of the maize cost above, from the statement that soybean inputs and care cost about 30 % less than maize (Báo Văn Hoá 21 Apr 2026, https://baovanhoa.vn/kinh-te/lien-ket-trong-dau-nanh-mo-loi-nong-nghiep-hang-hoa-o-quang-ngai-221172.html)',
      ),
    ),
    US: us('grain', official(3.9, `58 bu/acre; ${ERS}`), official(358.6, `$9.76/bu at harvest; ${ERS}`), official(619.9, `operating costs $250.88/acre (total costs listed $660.62/acre); ${ERS}`)),
    'US-HEARTLAND': rec(
      'US-HEARTLAND',
      'Iowa (grain)',
      2026,
      official(4.27, `63.5 bu/acre, Iowa 2025; ${NASS_CP}`),
      official(374.8, `$10.20/bu; ${NASS_CV}`),
      budget(perAcre(290.21), `variable costs $290.21/acre for herbicide-tolerant soybeans following corn at 61 bu/acre (total incl. land and labour $679.11/acre); ${ISU}`),
    ),
  },
  'arachis-hypogaea': {
    VN: vn(
      'in shell',
      2024,
      official(2.68, `2,682.3 kg/ha; ${FAO_Q}`),
      official(1226.7, FAO_P),
      press(vnd(61.5), 'about 61.5 million VND/ha on the conventional plot of an extension trial (63 million with water-saving irrigation), Bình Định, autumn 2023, not itemised; Nông nghiệp và Môi trường 30 Oct 2023 (https://nongnghiepmoitruong.vn/tuoi-tiet-kiem-giai-khat-cho-dau-phong-d365622.html)'),
    ),
    US: us('in shell', official(4.74, `4,231 lb/acre; ${ERS}`), official(529.1, `$0.24/lb at harvest; ${ERS}`), official(1588.0, `operating costs $642.64/acre (total costs listed $1,178.08/acre); ${ERS}`)),
  },
  'vigna-radiata': {
    VN: vn('dry beans, proxy', 2024, official(1.25, `1,248.6 kg/ha for the FAOSTAT item "Beans, dry"; mung bean is not reported separately; ${FAO_Q}`), official(1273.0, `item "Beans, dry"; ${FAO_P}`), none(NO_VN_COST)),
  },
  'phaseolus-vulgaris': {
    US: us('dry edible beans', official(2.26, `2,012 lb/acre; ${NASS_CP}`), official(665.8, `$30.20/cwt; ${NASS_CV}`), budget(perAcre(283.67), `direct costs $283.67/acre at 1,580 lb/acre (total listed costs $403.48/acre); ${NDSU}`), 2026),
  },
  'cicer-arietinum': {
    US: us('chickpeas', official(1.47, `1,315 lb/acre; ${NASS_CP}`), official(628.3, `$28.50/cwt; ${NASS_CV}`), none('chickpea is not in the ERS series or the NDSU budgets consulted')),
  },
  'pisum-sativum': {
    US: us('dry edible peas', official(1.95, `1,738 lb/acre; ${NASS_CP}`), official(249.1, `$11.30/cwt; ${NASS_CV}`), budget(perAcre(174.48), `direct costs $174.48/acre for field peas at 36.4 bu/acre (total listed costs $285.60/acre); ${NDSU}`), 2026),
  },

  // ------------------------------------------------------------------------------------ oilseeds
  'sesamum-indicum': {
    VN: vn('seed', 2024, official(0.85, `849.6 kg/ha; ${FAO_Q}`), official(2100.2, FAO_P), none(NO_VN_COST)),
  },
  'helianthus-annuus': {
    US: us('seed', official(2.09, `1,863 lb/acre; ${NASS_CP}`), official(504.9, `$22.90/cwt; ${NASS_CV}`), budget(perAcre(219.97), `direct costs $219.97/acre for oil sunflower at 1,860 lb/acre (total listed costs $337.88/acre); ${NDSU}`), 2026),
  },
  'brassica-napus': {
    US: us('seed', official(2.26, `2,017 lb/acre; ${NASS_CP}`), official(452.0, `$20.50/cwt; ${NASS_CV}`), budget(perAcre(259.23), `direct costs $259.23/acre at 1,960 lb/acre (total listed costs $370.41/acre); ${NDSU}`), 2026),
  },

  // ------------------------------------------------------------------------- roots, tubers, sugar
  'manihot-esculenta': {
    VN: vn(
      'fresh root',
      2026,
      official(20.39, `20,387.2 kg/ha; ${FAO_Q}`),
      press(vndPerKg(4150), 'fresh root with 30 % starch bought by factories at 4,100-4,200 VND/kg (midpoint used), Tây Ninh; Nông nghiệp và Môi trường 4 Aug 2026 (https://nongnghiepmoitruong.vn/san-vao-chu-ky-gia-bai-1-gia-san-tang-manh-nong-dan-huong-loi-d824041.html). FAOSTAT 2024 gives 260 USD/t, not cross-checked'),
      none(NO_VN_COST),
    ),
  },
  'ipomoea-batatas': {
    VN: vn(
      'fresh tuber',
      2024,
      official(12.04, `12,039.7 kg/ha; ${FAO_Q}`),
      official(480.0, FAO_P),
      press(vnd(120), 'about 120 million VND/ha "investment" stated by one grower for 2022, Lắk district, Đắk Lắk (export-grade crop at 25-30 t/ha); VnBusiness 19 May 2023 (https://vnbusiness.vn/nong-dan-dak-lak-ky-vong-thoat-ngheo-lam-giau-voi-cay-khoai-lang.html)'),
    ),
  },
  'solanum-tuberosum': {
    US: us(
      'potatoes',
      official(51.56, `460 cwt/acre; ${NASS_CP}`),
      official(246.9, `$11.20/cwt; ${NASS_CV}`),
      budget(perAcre(1626.8), `operating costs $1,626.80/acre for Russet Burbank, eastern Idaho, 2019 dollars (total $2,626.45/acre; storage excluded), budget EBB4-Po5-19; ${IDAHO}`),
    ),
  },
  'saccharum-officinarum': {
    VN: vn(
      'cane',
      2026,
      official(67.75, `67,749.9 kg/ha (the 2024 value equals 2023 and was probably carried forward); ${FAO_Q}`),
      press(Math.round((1.17e6 / VND_PER_USD) * 10) / 10, 'about 1.17 million VND per tonne of cane, Tây Ninh 2026; Thanh Tra 7 Jun 2026 (https://thanhtra.com.vn/an-sinh-AFA9C5670/bai-1-tay-ninh-nguoi-trong-mia-gap-kho-kien-nghi-ngan-chan-duong-nhap-lau-799602c7d.html). FAOSTAT 2024: 43.9 USD/t'),
      press(vnd(50), 'about 50 million VND/ha per year for ratoon cane in years 2-3 (plant cane about 75 million; harvest and transport deductions are separate), same article'),
    ),
  },
  'allium-cepa': {
    US: us('onions', official(67.21, `599.6 cwt/acre; ${NASS_VG}`), official(432.1, `$19.60/cwt; ${NASS_VG}`), none('no onion budget was found in the sources consulted')),
  },
  'citrullus-lanatus': {
    VN: vn(
      'fruit',
      2024,
      official(25.66, `25,663.2 kg/ha; ${FAO_Q}`),
      official(327.1, FAO_P),
      press(vnd(155), '150-160 million VND/ha including land rent (midpoint used), Gia Lai; VnBusiness 24 Nov 2024 (https://vnbusiness.vn/bat-ngo-dua-hau-giam-gia-hon-mot-nua-nhieu-nha-vuon-vut-bo-vi-qua-re.html)'),
    ),
  },

  // ---------------------------------------------------------------------------------- perennials
  'coffea-canephora': {
    VN: vn(
      'green bean',
      2026,
      official(2.97, `2,969.9 kg/ha, all coffee (about 95 % robusta); ${FAO_Q}`),
      press(vndPerKg(86000), '86,000 VND/kg of green bean, Central Highlands, 3 Nov 2026; Báo Lào Cai (https://baolaocai.vn/gia-ca-phe-hom-nay-311-cao-nhat-86000-dongkg-ap-luc-vu-moi-gia-tang-post913400.html), read from the search result, page not opened. The FAOSTAT 2024 producer price (709 USD/t) contradicts the market and is not used'),
      press(vnd(60.5), '60.5 million VND/ha (fertiliser 25 + other operations 35.5, all work hired; no land, no establishment) in a 3 t/ha budget for the 2021 season by Dr Trương Hồng; Công Thương 22 Dec 2022 (https://kinhte.congthuong.vn/gia-vat-tu-tang-cao-nguoi-trong-ca-phe-co-loi-khong-231902.html). Input prices have risen since'),
    ),
  },
  'piper-nigrum': {
    VN: vn(
      'dried berries',
      2026,
      official(2.66, `2,659.1 kg/ha; ${FAO_Q}`),
      press(vndPerKg(136500), '136,500 VND/kg, 4 Nov 2026; Báo Văn Hoá (https://baovanhoa.vn/gia-ho-tieu-hom-nay-4-11-2026-cho-luc-mua-sau-phien-giu-gia.html), read from the search result, page not opened. FAOSTAT 2024: 4,205 USD/t'),
      none(NO_VN_COST),
    ),
  },
  'anacardium-occidentale': { VN: vn('raw nut in shell', 2024, official(1.08, `1,079.0 kg/ha; ${FAO_Q}`), official(1959.6, FAO_P), none(NO_VN_COST)) },
  'camellia-sinensis': { VN: vn('fresh leaf', 2024, official(10.21, `10,213.6 kg/ha; ${FAO_Q}`), official(406.1, FAO_P), none(NO_VN_COST)) },
  'mangifera-indica': { VN: vn('fruit', 2024, official(12.23, `12,226.9 kg/ha, item "Mangoes, guavas and mangosteens"; ${FAO_Q}`), official(1048.6, FAO_P), none(NO_VN_COST)) },
  'musa-acuminata': { VN: vn('fruit', 2024, official(18.26, `18,259.0 kg/ha; ${FAO_Q}`), official(304.2, FAO_P), none(NO_VN_COST)) },
  'citrus-grandis': { VN: vn('fruit', 2024, official(13.53, `13,528.9 kg/ha, item "Pomelos and grapefruits"; ${FAO_Q}`), official(1030.9, FAO_P), none(NO_VN_COST)) },
  'brassica-oleracea-var-capitata': { VN: vn('heads', 2024, official(30.46, `30,464.8 kg/ha; ${FAO_Q}`), official(400.8, FAO_P), none(NO_VN_COST)) },
  'persea-americana': { VN: vn('fruit', 2024, official(11.45, `11,446.6 kg/ha; ${FAO_Q}`), none('no Vietnamese farm-gate price was found'), none(NO_VN_COST)) },
  'cocos-nucifera': { VN: vn('nuts in shell', 2024, official(12.56, `12,562.2 kg/ha; ${FAO_Q}`), none('no Vietnamese farm-gate price was found'), none(NO_VN_COST)) },

  // ------------------------------------------------------------------------------------- forages
  'medicago-sativa': {
    US: us('hay', official(7.67, `3.42 tons/acre; ${NASS_CP}`), official(187.4, `$170/ton; ${NASS_CV}`), budget(perAcre(479.16), `operating costs $479.16/acre in a production year at 4.2 tons/acre, eastern Idaho 2025 (total $746.72/acre); ${IDAHO}`)),
    'US-HEARTLAND': rec('US-HEARTLAND', 'Iowa (hay, not irrigated)', 2026, official(9.42, `4.20 tons/acre, Iowa 2025; ${NASS_CP}`), official(117.9, `$107/ton; ${NASS_CV}`), budget(perAcre(242.56), `variable costs $242.56/acre at 4 tons/acre, large round bales (total incl. land and labour $596.80/acre); ${ISU}`)),
    'US-WEST': rec(
      'US-WEST',
      'Nevada (irrigated hay)',
      2025,
      official(10.54, `4.70 tons/acre, Nevada 2025; ${NASS_CP}`),
      official(179.7, `$163/ton; ${NASS_CV}`),
      budget(perAcre(479.16), `operating costs $479.16/acre in a production year, eastern Idaho 2025, the nearest current Intermountain budget (total $746.72/acre); ${IDAHO}. The only Nevada study found is from 2008: operating $618.04/acre, total $943.36/acre (https://naes.unr.edu/publication.aspx?PubID=3855)`),
    ),
  },

  // ---------------------------------------------------------------------------------- cover crops
  'secale-cereale': {
    US: cover('US', 51.6 + 9.71, 2014, `cereal rye, 90 lb/acre at $0.57/lb; ${ARS}`),
    'US-HEARTLAND': cover('US-HEARTLAND', 28.4, 2018, 'cereal rye, 60 lb/acre at $0.25/lb plus drilling $13.40/acre, central Illinois; farmdoc daily 28 Jun 2018 (https://farmdocdaily.illinois.edu/2018/06/understanding-budget-implications-of-cover-crops.html)'),
  },
  'vicia-villosa-ssp-villosa': { US: cover('US', 52.0 + 9.71, 2014, `hairy vetch, 20 lb/acre at $2.60/lb; ${ARS}`) },
  'trifolium-incarnatum': { US: cover('US', 26.13 + 9.71, 2014, `crimson clover, 16 lb/acre at $1.63/lb; ${ARS}`) },
  'fagopyrum-esculentum': { US: cover('US', 55.0 + 9.71, 2014, `buckwheat, 55 lb/acre at $1.00/lb; ${ARS}`) },
  'raphanus-sativus': { US: cover('US', 30.88 + 9.71, 2014, `radish, 10 lb/acre at $3.09/lb; ${ARS}`) },
  'crotalaria-juncea': { US: cover('US', 77.4 + 9.71, 2014, `sunn hemp, 30 lb/acre at $2.58/lb; ${ARS}`) },
};

/** Region whose record becomes `CropProfile.economics` (the contract holds one record per crop). */
export const DEFAULT_REGION_ORDER: EconRegion[] = ['US', 'VN', 'US-HEARTLAND', 'US-WEST'];
export const PREFER_VN = new Set(['oryza-sativa', 'arachis-hypogaea', 'ipomoea-batatas', 'saccharum-officinarum', 'citrullus-lanatus', 'coffea-canephora']);
