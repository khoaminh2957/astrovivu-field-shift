/**
 * The column dictionary of the atlas: one entry per column of every table, in the order the build
 * writes them (the build takes its headers from here, so the dictionary cannot drift from the data).
 * The Vietnamese text is documentation written for the team, not data.
 */
export interface ColumnDoc {
  table: string;
  column: string;
  en: string;
  vi: string;
  unit: string;
  source: string;
  rule: string;
}

const ECO = 'FAO EcoCrop';
const FAO = 'FAOSTAT QCL';
const DEF = 'FAO commodity definitions; CPC 2.1';
const SPAM = 'MapSPAM 2020 V2r2';
const BUILD = 'build';
const CUR = 'curated-crops.csv';

const out: ColumnDoc[] = [];
const add = (table: string, column: string, en: string, vi: string, unit = '', source = BUILD, rule = '') => out.push({ table, column, en, vi, unit, source, rule });

// ------------------------------------------------------------------------------------------------ crops
const T = 'crops';
add(T, 'crop_id', 'Our identifier: slug of the EcoCrop scientific name, the same rule as the app catalogue (src/core/crops); curated crops keep their curated id.', 'Mã cây trồng của dự án: slug của tên khoa học EcoCrop, cùng quy tắc với danh mục trong ứng dụng; cây trong danh sách chọn lọc giữ mã đã có.', '', `${ECO}; ${CUR}`, 'slugify(name); the EcoCrop id is appended when two rows share a name');
add(T, 'ecocrop_id', 'EcoCrop species id: the join key to the EcoCrop file.', 'Mã loài trong EcoCrop: khóa để nối với tệp EcoCrop.', '', ECO, 'copied');
add(T, 'scientific_name', 'Scientific name as EcoCrop prints it.', 'Tên khoa học đúng như EcoCrop ghi.', '', ECO, 'copied (from the curated list for a crop EcoCrop lacks)');
add(T, 'authority', 'Author of the scientific name.', 'Tác giả đặt tên khoa học.', '', ECO, 'copied');
add(T, 'name_en', 'English name, when a source gives one.', 'Tên tiếng Anh, nếu có nguồn nêu rõ.', '', `${CUR}; ${FAO}; FAO commodity definitions`, 'curated name; else the FAOSTAT item name when the item is this one species; else the name the FAO definition prints before the scientific name ("durian (Durio zibethinus)"); else empty');
add(T, 'name_en_source', 'Where name_en came from: curated, faostat-item or fao-definition.', 'Nguồn của name_en: curated, faostat-item hoặc fao-definition.', '', BUILD, 'see name_en');
add(T, 'name_ecocrop_first', 'First EcoCrop common name written in plain Latin letters: the display name the app catalogue uses. Its language is not known (often not English).', 'Tên thường gọi đầu tiên trong EcoCrop viết bằng chữ Latinh không dấu: tên hiển thị mà danh mục ứng dụng đang dùng. Không rõ ngôn ngữ (thường không phải tiếng Anh).', '', ECO, 'same rule as scripts/crops/parse.ts');
add(T, 'name_vi', 'Vietnamese name. Only curated crops have one; the build never translates.', 'Tên tiếng Việt. Chỉ cây trong danh sách chọn lọc mới có; chương trình không tự dịch.', '', CUR, 'copied');
add(T, 'common_names', 'Common names in many languages, verbatim.', 'Tên thường gọi bằng nhiều thứ tiếng, giữ nguyên văn.', '', ECO, 'copied');
add(T, 'synonyms', 'Scientific synonyms, verbatim. Used to match item definitions that use an older name.', 'Tên đồng nghĩa khoa học, giữ nguyên văn. Dùng để khớp với định nghĩa mặt hàng còn ghi tên cũ.', '', ECO, 'copied');
add(T, 'family', 'Botanical family.', 'Họ thực vật.', '', ECO, 'last part of the EcoCrop taxonomy string');
add(T, 'life_form', 'Life form (herb, grass, shrub, tree, vine).', 'Dạng sống (thân thảo, cỏ, cây bụi, cây gỗ, dây leo).', '', ECO, 'copied');
add(T, 'physiology', 'Physiology notes (stems, deciduous or evergreen, C3 or C4).', 'Đặc điểm sinh lý (kiểu thân, rụng lá hay thường xanh, quang hợp C3 hay C4).', '', ECO, 'copied');
add(T, 'habit', 'Growth habit (erect, prostrate, climber).', 'Dáng mọc (đứng thẳng, bò, leo).', '', ECO, 'copied');
add(T, 'category', 'Use categories (cereals, vegetables, forage ...).', 'Nhóm công dụng (ngũ cốc, rau, thức ăn gia súc ...).', '', ECO, 'copied');
add(T, 'life_span', 'Life span (annual, biennial, perennial).', 'Vòng đời (hằng năm, hai năm, lâu năm).', '', ECO, 'copied');
add(T, 'plant_attributes', 'How the plant is used by people: grown on large scale, grown on small scale, harvested from wild.', 'Mức độ canh tác: trồng quy mô lớn, trồng quy mô nhỏ, thu hái từ tự nhiên.', '', ECO, 'copied; "grown on large/small scale" is the test for "cultivated"');
add(T, 'uses_main', 'Main uses, verbatim.', 'Công dụng chính, giữ nguyên văn.', '', ECO, 'copied');

const quads: [string, string, string, string, string][] = [
  ['temp', 'c', 'temperature', 'nhiệt độ', '°C'],
  ['rain', 'mm', 'annual rainfall', 'lượng mưa năm', 'mm/year'],
  ['ph', '', 'soil pH', 'pH đất', 'pH'],
];
const bounds: [string, string, string][] = [
  ['opt_min', 'Lower limit of the optimal', 'Giới hạn dưới của khoảng tối ưu về'],
  ['opt_max', 'Upper limit of the optimal', 'Giới hạn trên của khoảng tối ưu về'],
  ['abs_min', 'Lower limit of the tolerated (absolute)', 'Giới hạn dưới của khoảng chịu đựng (tuyệt đối) về'],
  ['abs_max', 'Upper limit of the tolerated (absolute)', 'Giới hạn trên của khoảng chịu đựng (tuyệt đối) về'],
];
for (const [stem, suffix, en, vi, unit] of quads) {
  for (const [b, ben, bvi] of bounds) {
    add(T, [stem, b, suffix].filter(Boolean).join('_'), `${ben} ${en} range.`, `${bvi} ${vi}.`, unit, ECO, '"-", "---", "no input" = empty; a value outside the plausible range is dropped and noted in ecocrop_cleaning; never repaired or imputed');
  }
}
const soil: [string, string, string][] = [
  ['soil_depth', 'soil depth class', 'cấp độ sâu tầng đất'],
  ['soil_texture', 'soil texture classes', 'thành phần cơ giới đất'],
  ['soil_fertility', 'soil fertility class', 'cấp độ phì của đất'],
  ['soil_salinity', 'soil salinity class', 'cấp độ mặn của đất'],
  ['soil_drainage', 'soil drainage classes', 'khả năng thoát nước của đất'],
  ['soil_al_toxicity', 'aluminium toxicity class', 'cấp độ độc nhôm'],
];
for (const [stem, en, vi] of soil) {
  add(T, `${stem}_opt`, `Optimal ${en}, as EcoCrop words it.`, `Mức tối ưu về ${vi}, theo cách ghi của EcoCrop.`, '', ECO, 'copied; missing markers = empty');
  add(T, `${stem}_abs`, `Tolerated (absolute) ${en}, as EcoCrop words it.`, `Mức chịu đựng (tuyệt đối) về ${vi}, theo cách ghi của EcoCrop.`, '', ECO, 'copied; missing markers = empty');
}
for (const [b, ben, bvi] of bounds) add(T, `light_${b}`, `${ben} light intensity range (very bright, clear skies, cloudy skies, light shade, heavy shade).`, `${bvi} cường độ ánh sáng (rất sáng, trời quang, trời nhiều mây, bóng râm nhẹ, bóng râm dày).`, '', ECO, 'copied; missing markers = empty');
for (const [b, ben, bvi] of bounds) add(T, `latitude_${b}_deg`, `${ben} latitude range (degrees from the equator).`, `${bvi} vĩ độ (số độ tính từ xích đạo).`, 'degrees', ECO, 'a value above 90 is an altitude typed into the wrong field: dropped and noted');
for (const [b, ben, bvi] of bounds) add(T, `altitude_${b}_m`, `${ben} altitude range.`, `${bvi} độ cao so với mực nước biển.`, 'm', ECO, 'missing markers = empty; outside -500..9000 dropped');
add(T, 'climate_zones', 'Köppen-Trewartha climate zones the plant is found in, verbatim.', 'Các vùng khí hậu Köppen-Trewartha mà cây thích hợp, giữ nguyên văn.', '', ECO, 'copied');
add(T, 'photoperiod', 'Day-length response, verbatim.', 'Phản ứng với độ dài ngày, giữ nguyên văn.', '', ECO, 'copied');
add(T, 'killing_temp_rest_c', 'Temperature that kills the plant during rest.', 'Nhiệt độ làm chết cây trong giai đoạn nghỉ.', '°C', ECO, '"no input" = empty');
add(T, 'killing_temp_early_growth_c', 'Temperature that kills the plant in early growth.', 'Nhiệt độ làm chết cây ở giai đoạn sinh trưởng đầu.', '°C', ECO, '"no input" = empty');
add(T, 'cycle_min_days', 'Shortest crop cycle.', 'Thời gian sinh trưởng ngắn nhất.', 'days', ECO, '0 = missing; a thousands separator or a value outside 1..366 is dropped and noted');
add(T, 'cycle_max_days', 'Longest crop cycle.', 'Thời gian sinh trưởng dài nhất.', 'days', ECO, 'as cycle_min_days');
add(T, 'ecocrop_cleaning', 'What the cleaning dropped or noticed in this row (empty when nothing).', 'Những giá trị bị loại hoặc điểm bất thường phát hiện khi làm sạch dòng này (để trống nếu không có).', '', BUILD, 'one note per dropped value; limits that are out of order are reported, not changed');
add(T, 'faostat_item_code', 'FAOSTAT item the crop is attached to (for an exact match with several items: the one with the largest world area).', 'Mã mặt hàng FAOSTAT gắn với cây (nếu khớp chính xác với nhiều mặt hàng: mặt hàng có diện tích thế giới lớn nhất).', '', `${FAO}; ${DEF}`, 'scientific name of the species or of a synonym found in the item definition; see match_method');
add(T, 'faostat_item', 'Name of that FAOSTAT item.', 'Tên mặt hàng FAOSTAT đó.', '', FAO, 'copied');
add(T, 'cpc_code', 'CPC 2.1 (expanded) code of that item.', 'Mã CPC 2.1 (mở rộng) của mặt hàng đó.', '', FAO, 'copied');
add(T, 'faostat_other_item_codes', 'Other FAOSTAT items of the same crop (e.g. dry and green peas); their quantities are added in crop_country.', 'Các mặt hàng FAOSTAT khác của cùng cây (ví dụ đậu Hà Lan khô và tươi); số liệu được cộng lại trong crop_country.', '', `${FAO}; ${DEF}`, 'all single-class items with the best match score');
add(T, 'match', 'exact: the item is this species, or names only its genus. group: the item covers several genera, is a residual (n.e.c.) class, or singles out other species of the genus. none: no item names it.', 'exact: mặt hàng chính là loài này, hoặc chỉ nêu tên chi của nó. group: mặt hàng gộp nhiều chi, là nhóm "khác" (n.e.c.), hoặc nêu đích danh loài khác trong cùng chi. none: không mặt hàng nào nhắc tới.', '', BUILD, 'docs/CROP_DATA.md section 4');
add(T, 'match_method', 'How the match was made: variety, species, synonym, species-variety, genus (scientific name) or name (common name, weaker).', 'Cách khớp: variety, species, synonym, species-variety, genus (theo tên khoa học) hoặc name (theo tên thường gọi, kém chắc chắn hơn).', '', BUILD, 'docs/CROP_DATA.md section 4');
add(T, 'matched_common_name', 'For match_method = name: the EcoCrop common name that equals the item name.', 'Khi match_method = name: tên thường gọi trong EcoCrop trùng với tên mặt hàng.', '', `${ECO}; ${FAO}`, 'singular/plural and spaces ignored');
add(T, 'item_shared_by_n_crops', 'Number of kept crops attached to the same FAOSTAT item (for an exact match: the crops whose own item it is). Above 1, the item quantities are shared by these crops and cannot be split.', 'Số cây được giữ lại cùng gắn với một mặt hàng FAOSTAT (với khớp chính xác: các cây mà mặt hàng là của chính chúng). Lớn hơn 1 nghĩa là số liệu của mặt hàng dùng chung, không tách được cho từng cây.', 'count', BUILD, 'count');
add(T, 'spam_crop', 'MapSPAM 2020 crop code(s) the species falls under (several when its FAOSTAT items belong to different SPAM crops).', 'Mã (các) cây trồng MapSPAM 2020 mà loài này thuộc về (nhiều mã khi các mặt hàng FAOSTAT của loài thuộc những cây SPAM khác nhau).', '', `${SPAM}; mapspamc`, 'FAOSTAT item to SPAM crop crosswalk over all items of the crop; a residual class only when no item has a SPAM crop of its own; see spam_crops.csv');
add(T, 'spam_crop_name', 'MapSPAM crop name.', 'Tên cây trồng theo MapSPAM.', '', SPAM, 'copied from the SPAM readme');
add(T, 'spam_class', 'individual: a SPAM crop of its own. residual: a pooled class (other vegetables, rest of crops).', 'individual: cây có lớp riêng trong SPAM. residual: lớp gộp (rau khác, cây trồng còn lại).', '', BUILD, 'name starts with Other/Rest, or more than 3 FAOSTAT items');
add(T, 'evidence', 'Why the crop is kept: faostat-exact, faostat-group, mapspam, curated; curated-only when nothing else holds.', 'Lý do giữ cây: faostat-exact, faostat-group, mapspam, curated; curated-only khi chỉ có trong danh sách chọn lọc.', '', BUILD, 'docs/CROP_DATA.md section 5');
add(T, 'commonness', 'Tier for exact matches: global, widespread, regional, local.', 'Mức phổ biến (chỉ cho khớp chính xác): global (toàn cầu), widespread (rộng), regional (khu vực), local (cục bộ).', '', FAO, 'global: 50 countries and 1,000,000 ha; widespread: 20 and 100,000 ha; regional: 5 and 10,000 ha; else local');
add(T, 'n_countries_producing', 'Countries with area or production above zero (exact matches only).', 'Số quốc gia có diện tích hoặc sản lượng lớn hơn 0 (chỉ cho khớp chính xác).', 'count', FAO, 'count over the crop\'s own items');
add(T, 'world_area_ha', 'Sum of the countries\' harvested area (exact matches only; shared when item_shared_by_n_crops > 1).', 'Tổng diện tích thu hoạch của các nước (chỉ cho khớp chính xác; là số dùng chung khi item_shared_by_n_crops > 1).', 'ha', FAO, 'sum of country means, not the FAOSTAT World aggregate');
add(T, 'world_production_t', 'Sum of the countries\' production (exact matches only). Tonnes of different products are added when the crop has several items.', 'Tổng sản lượng của các nước (chỉ cho khớp chính xác). Nếu cây có nhiều mặt hàng thì cộng tấn của các sản phẩm khác nhau.', 't', FAO, 'sum of country means');
add(T, 'data_years', 'Years the FAOSTAT means cover.', 'Các năm mà số trung bình FAOSTAT bao phủ.', 'years', FAO, 'earliest and latest year used in any country');
add(T, 'curated', 'yes when the crop is in our curated list of 73.', 'yes nếu cây thuộc danh sách 73 cây chọn lọc của dự án.', '', CUR, 'join on ecocrop_id');

// ------------------------------------------------------------------------------------------------ urban_candidates
// Not columns of crops: the market database mirrors crops.csv column for column (scripts/market/atlas.ts).
const UC = 'urban_candidates';
add(UC, 'crop_id', 'Crop (see crops.csv). One row per crop of crops.csv, in the same order.', 'Cây trồng (xem crops.csv). Mỗi cây trong crops.csv một dòng, cùng thứ tự.', '', BUILD, 'join key');
add(UC, 'urban_candidate', 'yes when the crop qualifies as an urban/container candidate by the EcoCrop rule (scripts/crops/atlas/urban.ts); empty otherwise.', 'yes nếu cây đạt điều kiện ứng viên trồng chậu/đô thị theo quy tắc EcoCrop (scripts/crops/atlas/urban.ts); để trống nếu không.', '', `${ECO}; ${BUILD}`, 'urbanCandidate(s) in scripts/crops/atlas/urban.ts');
add(UC, 'urban_candidate_rule', 'Clause(s) of the urban candidate rule that matched: short-cycle, perennial-aromatic-herb, or both separated by ";".', 'Vế của quy tắc ứng viên đô thị đã khớp: short-cycle (chu kỳ ngắn), perennial-aromatic-herb (cây thơm lâu năm), hoặc cả hai cách nhau bởi ";".', '', BUILD, 'urbanCandidate(s).rule');

// ------------------------------------------------------------------------------------------------ crop_country / item_country
const quantities = (table: string, unitOf: string) => {
  add(table, 'area_ha', `Harvested area of ${unitOf}.`, `Diện tích thu hoạch của ${unitOf === 'the crop' ? 'cây' : 'mặt hàng'}.`, 'ha', FAO, 'mean of the latest 3 years with data within the last 10 years of the file');
  add(table, 'production_t', `Production of ${unitOf}.`, `Sản lượng của ${unitOf === 'the crop' ? 'cây' : 'mặt hàng'}.`, 't', FAO, 'mean of the latest 3 years with data within the last 10 years of the file');
  add(table, 'yield_t_ha', 'Yield as FAOSTAT reports it.', 'Năng suất theo FAOSTAT.', 't/ha', FAO, 'FAOSTAT yield (kg/ha) / 1000, mean of the latest 3 years; when several items were added, the yield of the item with the largest area (first code)');
  add(table, 'year_from', 'First year in the mean.', 'Năm đầu của kỳ tính trung bình.', 'year', FAO, 'from the area series (production when no area)');
  add(table, 'year_to', 'Last year in the mean.', 'Năm cuối của kỳ tính trung bình.', 'year', FAO, 'from the area series (production when no area)');
  add(table, 'share_of_country_harvested_area_pct', 'Share of the country\'s harvested area (all FAOSTAT crop items).', 'Tỷ lệ trong tổng diện tích thu hoạch của quốc gia (mọi mặt hàng cây trồng FAOSTAT).', '%', FAO, 'area / sum of the areas of all crop items of the country');
  add(table, 'rank_in_country', 'Rank by harvested area among the crop items of the country (1 = largest).', 'Thứ hạng theo diện tích thu hoạch trong các mặt hàng cây trồng của quốc gia (1 = lớn nhất).', 'rank', FAO, '1 + number of other items with a larger area');
  add(table, 'level', 'major: at least 5 % of the country\'s harvested area. common: at least 0.5 %. minor: below. present: production without area. absent: FAOSTAT covers the country and reports nothing above zero. unknown: group item.', 'major: từ 5 % diện tích thu hoạch của quốc gia. common: từ 0,5 %. minor: thấp hơn. present: có sản lượng nhưng không có diện tích. absent: FAOSTAT có số liệu quốc gia nhưng không ghi nhận cây này. unknown: thuộc mặt hàng gộp nên không xác định được.', '', BUILD, 'thresholds in scripts/crops/atlas/levels.ts');
  // crop_country names the national statistic on a national row; its URL, access date, table and
  // note are not repeated here (the file keeps the columns the market database mirrors).
  if (table === 'crop_country') add(table, 'source', 'Source of the row: FAOSTAT QCL, or the national statistic of a row with match = national.', 'Nguồn của dòng số liệu: FAOSTAT QCL, hoặc thống kê quốc gia với dòng có match = national.', '', BUILD, 'constant, or the source column of data/crops/national/prevalence.csv, which also holds the URL, access date, table and note of that row');
  else add(table, 'source', 'Source of the row.', 'Nguồn của dòng số liệu.', '', BUILD, 'constant');
};
const CC = 'crop_country';
add(CC, 'crop_id', 'Crop (see crops.csv).', 'Cây trồng (xem crops.csv).', '', BUILD, 'join key');
add(CC, 'iso3', 'ISO 3166-1 alpha-3 country code.', 'Mã quốc gia ISO 3166-1 alpha-3.', '', 'UN M49', 'FAOSTAT M49 code looked up in the UN M49 list');
add(CC, 'country', 'Country name as FAOSTAT writes it.', 'Tên quốc gia theo FAOSTAT.', '', FAO, 'copied');
add(CC, 'faostat_item_code', 'FAOSTAT item(s) the quantities come from, largest first, separated by ";".', 'Mã (các) mặt hàng FAOSTAT cho ra số liệu, lớn nhất đứng trước, cách nhau bằng ";".', '', FAO, 'items of the crop reported above zero in the country (all its items on an absent row; the group item on an unknown row)');
add(CC, 'match', 'exact, group or national (from national statistics; see crops.csv).', 'exact, group hoặc national (từ thống kê quốc gia; xem crops.csv).', '', BUILD, 'copied from crops.csv, or national when supplied by data/crops/national/prevalence.csv');
add(CC, 'item_reported', 'yes when the country reports the item(s) above zero. For a group crop this is all the source says: the item is reported, the species is unknown.', 'yes nếu quốc gia có báo cáo (các) mặt hàng này với giá trị lớn hơn 0. Với cây thuộc mặt hàng gộp, đây là tất cả những gì nguồn cho biết: mặt hàng có báo cáo, còn loài thì không rõ.', '', FAO, 'area or production mean above zero');
quantities(CC, 'the crop');

const IC = 'item_country';
add(IC, 'faostat_item_code', 'FAOSTAT item code.', 'Mã mặt hàng FAOSTAT.', '', FAO, 'copied');
add(IC, 'faostat_item', 'FAOSTAT item name.', 'Tên mặt hàng FAOSTAT.', '', FAO, 'copied');
add(IC, 'cpc_code', 'CPC 2.1 (expanded) code.', 'Mã CPC 2.1 (mở rộng).', '', FAO, 'copied');
add(IC, 'item_class', 'single: one species or one genus. group: several genera or a residual class; its area is not the area of any one species.', 'single: một loài hoặc một chi. group: nhiều chi hoặc nhóm "khác"; diện tích của nó không phải của riêng loài nào.', '', BUILD, 'docs/CROP_DATA.md section 4');
add(IC, 'iso3', 'ISO 3166-1 alpha-3 country code.', 'Mã quốc gia ISO 3166-1 alpha-3.', '', 'UN M49', 'FAOSTAT M49 code looked up in the UN M49 list');
add(IC, 'country', 'Country name as FAOSTAT writes it.', 'Tên quốc gia theo FAOSTAT.', '', FAO, 'copied');
quantities(IC, 'the item');

// ------------------------------------------------------------------------------------------------ country_crops
const CO = 'country_crops';
add(CO, 'iso3', 'ISO 3166-1 alpha-3 country code.', 'Mã quốc gia ISO 3166-1 alpha-3.', '', 'UN M49', 'lookup');
add(CO, 'country', 'Country name as FAOSTAT writes it.', 'Tên quốc gia theo FAOSTAT.', '', FAO, 'copied');
add(CO, 'year_from', 'Earliest year used for this country.', 'Năm sớm nhất được dùng cho quốc gia này.', 'year', FAO, 'minimum over items');
add(CO, 'year_to', 'Latest year used for this country.', 'Năm muộn nhất được dùng cho quốc gia này.', 'year', FAO, 'maximum over items');
add(CO, 'total_harvested_area_ha', 'Harvested area of all FAOSTAT crop items of the country.', 'Tổng diện tích thu hoạch của mọi mặt hàng cây trồng FAOSTAT trong nước.', 'ha', FAO, 'sum of item means');
add(CO, 'n_items_reported', 'FAOSTAT crop items with area or production above zero.', 'Số mặt hàng cây trồng FAOSTAT có diện tích hoặc sản lượng lớn hơn 0.', 'count', FAO, 'count');
add(CO, 'top_items', 'The 15 largest FAOSTAT items by harvested area: name [code]: area, share.', '15 mặt hàng FAOSTAT lớn nhất theo diện tích thu hoạch: tên [mã]: diện tích, tỷ lệ.', '', FAO, 'sorted by area');
add(CO, 'major_crop_ids', 'Crops with level = major, largest first.', 'Các cây ở mức major, lớn nhất đứng trước.', '', BUILD, 'from crop_country');
add(CO, 'common_crop_ids', 'Crops with level = common, largest first.', 'Các cây ở mức common, lớn nhất đứng trước.', '', BUILD, 'from crop_country');
add(CO, 'minor_crop_ids', 'Crops with level = minor, largest first.', 'Các cây ở mức minor, lớn nhất đứng trước.', '', BUILD, 'from crop_country');
add(CO, 'present_crop_ids', 'Crops with production but no area reported.', 'Các cây có sản lượng nhưng không có số liệu diện tích.', '', BUILD, 'from crop_country');
add(CO, 'crops_by_area', 'What is grown in the country, largest first: FAOSTAT item [code]: area, level -> the crops whose item it is. Several crops after one arrow share that area.', 'Những gì được trồng trong nước, lớn nhất đứng trước: mặt hàng FAOSTAT [mã]: diện tích, mức -> các cây ứng với mặt hàng đó. Nhiều cây sau một mũi tên nghĩa là chúng dùng chung diện tích ấy.', '', BUILD, 'single-class items above zero that have at least one kept crop');
add(CO, 'group_items', 'Group items reported by the country, with their area: which of their species is grown is not known.', 'Các mặt hàng gộp mà quốc gia có báo cáo, kèm diện tích: không biết cụ thể loài nào trong nhóm được trồng.', '', FAO, 'items of class group above zero');
add(CO, 'possible_crop_ids', 'Kept crops that belong to those group items (level = unknown).', 'Các cây được giữ lại thuộc những mặt hàng gộp đó (mức unknown).', '', BUILD, 'from crop_country');

// ------------------------------------------------------------------------------------------------ region_crops
const RC = 'region_crops';
add(RC, 'iso3', 'ISO 3166-1 alpha-3 country code (empty when SPAM\'s FIPS code is not in GeoNames).', 'Mã quốc gia ISO 3166-1 alpha-3 (để trống nếu mã FIPS của SPAM không có trong GeoNames).', '', 'GeoNames', 'SPAM FIPS0 looked up in GeoNames countryInfo (fips column)');
add(RC, 'country', 'Country name as MapSPAM writes it.', 'Tên quốc gia theo MapSPAM.', '', SPAM, 'copied (ADM0_NAME)');
add(RC, 'level', 'country: national total. admin1: first-level administrative unit (province, state).', 'country: tổng cả nước. admin1: đơn vị hành chính cấp một (tỉnh, bang).', '', BUILD, 'aggregation level');
add(RC, 'admin1_code', 'MapSPAM code of the first-level unit (FIPS1); empty on a country row.', 'Mã đơn vị cấp một theo MapSPAM (FIPS1); để trống ở dòng cấp quốc gia.', '', SPAM, 'copied');
add(RC, 'admin1', 'Name of the first-level unit as MapSPAM writes it.', 'Tên đơn vị cấp một theo MapSPAM.', '', SPAM, 'copied (ADM1_NAME)');
add(RC, 'spam_crop', 'MapSPAM crop code.', 'Mã cây trồng MapSPAM.', '', SPAM, 'column name of the cell table');
add(RC, 'spam_crop_name', 'MapSPAM crop name.', 'Tên cây trồng MapSPAM.', '', SPAM, 'from the SPAM readme');
add(RC, 'spam_class', 'individual or residual (see spam_crops.csv).', 'individual hoặc residual (xem spam_crops.csv).', '', BUILD, 'see spam_crops');
add(RC, 'harvested_area_ha', 'Harvested area, all technologies (irrigated and rainfed), circa 2020.', 'Diện tích thu hoạch, mọi hình thức canh tác (có tưới và nhờ nước trời), khoảng năm 2020.', 'ha', SPAM, 'sum of the 5-arc-minute cells of the unit; rows that round to 0 ha are left out');
add(RC, 'share_of_region_pct', 'Share of the unit\'s harvested area (all 46 SPAM crops).', 'Tỷ lệ trong tổng diện tích thu hoạch của đơn vị (cả 46 cây SPAM).', '%', SPAM, 'area / sum of the 46 crops');
add(RC, 'rank_in_region', 'Rank by harvested area in the unit (1 = largest).', 'Thứ hạng theo diện tích thu hoạch trong đơn vị (1 = lớn nhất).', 'rank', SPAM, '1 + number of crops with a larger area');
add(RC, 'crop_ids', 'Our crops whose own FAOSTAT item is this SPAM crop (individual SPAM crops only; members and residual classes are in spam_crops.csv).', 'Các cây của dự án thuộc cây SPAM này (chỉ với lớp individual; thành viên của lớp gộp nằm trong spam_crops.csv).', '', BUILD, 'crops.csv spam_crop');
add(RC, 'source', 'Source of the row.', 'Nguồn của dòng số liệu.', '', BUILD, 'constant');

// ------------------------------------------------------------------------------------------------ items
const IT = 'items';
add(IT, 'faostat_item_code', 'FAOSTAT item code (also the code of the FAO commodity definitions).', 'Mã mặt hàng FAOSTAT (cũng là mã trong bộ định nghĩa hàng hóa của FAO).', '', FAO, 'items with an area-harvested element');
add(IT, 'faostat_item', 'FAOSTAT item name.', 'Tên mặt hàng FAOSTAT.', '', FAO, 'copied');
add(IT, 'cpc_code', 'CPC 2.1 (expanded) code.', 'Mã CPC 2.1 (mở rộng).', '', FAO, 'copied');
add(IT, 'item_class', 'single or group.', 'single hoặc group.', '', BUILD, 'docs/CROP_DATA.md section 4');
add(IT, 'class_reason', 'Why the item is single or group.', 'Lý do xếp mặt hàng là single hay group.', '', BUILD, 'rule that fired');
add(IT, 'fao_definition_name', 'Commodity name in the FAO definitions.', 'Tên hàng hóa trong bộ định nghĩa của FAO.', '', 'FAO commodity definitions', 'copied');
add(IT, 'definition', 'Definition text the plant names were read from (FAO definitions, CPC notes).', 'Đoạn định nghĩa dùng để đọc tên thực vật (định nghĩa FAO, chú giải CPC).', '', DEF, 'copied, tags removed');
add(IT, 'definition_sources', 'Which definition sources name plants for this item.', 'Nguồn định nghĩa nào có nêu tên thực vật cho mặt hàng này.', '', BUILD, 'fao-definitions, cpc-2.1');
add(IT, 'taxa_named', 'Scientific names read from the definition.', 'Các tên khoa học đọc được từ định nghĩa.', '', DEF, 'italic names; abbreviations expanded (T. aestivum = Triticum aestivum)');
add(IT, 'n_crops', 'Kept crops whose own item this is (match = exact).', 'Số cây được giữ lại mà mặt hàng là của chính chúng (match = exact).', 'count', BUILD, 'count');
add(IT, 'crop_ids', 'Those crops.', 'Các cây đó.', '', BUILD, 'list');
add(IT, 'member_crop_ids', 'Kept crops that are only members of the item (match = group): their level per country is unknown.', 'Các cây được giữ lại chỉ là thành viên của mặt hàng (match = group): không xác định được mức theo từng nước.', '', BUILD, 'list');
add(IT, 'spam_crop', 'MapSPAM crop(s) the item belongs to.', '(Các) cây MapSPAM mà mặt hàng thuộc về.', '', 'mapspamc; SPAM readme', 'see spam_crops.csv');
add(IT, 'n_countries_producing', 'Countries with area or production above zero.', 'Số quốc gia có diện tích hoặc sản lượng lớn hơn 0.', 'count', FAO, 'count');
add(IT, 'world_area_ha', 'Sum of the countries\' harvested area.', 'Tổng diện tích thu hoạch của các nước.', 'ha', FAO, 'sum of country means');
add(IT, 'world_production_t', 'Sum of the countries\' production.', 'Tổng sản lượng của các nước.', 't', FAO, 'sum of country means');

// ------------------------------------------------------------------------------------------------ spam_crops
const SC = 'spam_crops';
add(SC, 'spam_crop', 'MapSPAM 2020 crop code.', 'Mã cây trồng MapSPAM 2020.', '', SPAM, 'SPAM readme');
add(SC, 'spam_crop_name', 'MapSPAM crop name.', 'Tên cây trồng MapSPAM.', '', SPAM, 'SPAM readme');
add(SC, 'spam_class', 'individual or residual.', 'individual (lớp riêng) hoặc residual (lớp gộp).', '', BUILD, 'residual: name starts with Other/Rest, or more than 3 FAOSTAT items');
add(SC, 'crosswalk_method', 'mapspamc: from the crosswalk table. name: SPAM 2020 crop absent from the table, matched on its name.', 'mapspamc: lấy từ bảng đối chiếu. name: cây SPAM 2020 không có trong bảng, khớp theo tên.', '', BUILD, 'docs/CROP_DATA.md section 6');
add(SC, 'faostat_item_codes', 'FAOSTAT items of the SPAM crop that exist in the current FAOSTAT file.', 'Các mặt hàng FAOSTAT của cây SPAM còn tồn tại trong tệp FAOSTAT hiện hành.', '', 'mapspamc; FAOSTAT QCL', 'join');
add(SC, 'faostat_items', 'Names of those items.', 'Tên các mặt hàng đó.', '', FAO, 'copied');
add(SC, 'faostat_item_codes_not_in_qcl', 'Codes of the crosswalk table that the current FAOSTAT crop items do not have.', 'Các mã trong bảng đối chiếu không còn trong danh sách mặt hàng cây trồng FAOSTAT hiện hành.', '', 'mapspamc', 'left as found');
add(SC, 'crop_ids', 'Kept crops whose own FAOSTAT item belongs to this SPAM crop (match = exact).', 'Các cây được giữ lại mà mặt hàng FAOSTAT của chính chúng thuộc cây SPAM này (match = exact).', '', BUILD, 'crops.csv spam_crop');
add(SC, 'member_crop_ids', 'Kept crops that are only members of an item of this SPAM crop (match = group): SPAM cannot tell them apart.', 'Các cây được giữ lại chỉ là thành viên của một mặt hàng thuộc cây SPAM này (match = group): SPAM không tách riêng được.', '', BUILD, 'crops.csv spam_crop');
add(SC, 'world_harvested_area_ha', 'World harvested area in MapSPAM 2020.', 'Diện tích thu hoạch toàn cầu theo MapSPAM 2020.', 'ha', SPAM, 'sum of all cells');

// ------------------------------------------------------------------------------------------------ dropped
const DR = 'dropped';
add(DR, 'crop_id', 'The id the species would have had.', 'Mã mà loài này lẽ ra có.', '', BUILD, 'slug');
add(DR, 'ecocrop_id', 'EcoCrop species id.', 'Mã loài trong EcoCrop.', '', ECO, 'copied');
add(DR, 'scientific_name', 'Scientific name.', 'Tên khoa học.', '', ECO, 'copied');
add(DR, 'family', 'Botanical family.', 'Họ thực vật.', '', ECO, 'copied');
add(DR, 'common_names', 'Common names, verbatim.', 'Tên thường gọi, giữ nguyên văn.', '', ECO, 'copied');
add(DR, 'category', 'Use categories.', 'Nhóm công dụng.', '', ECO, 'copied');
add(DR, 'plant_attributes', 'Grown on large/small scale, harvested from wild.', 'Trồng quy mô lớn/nhỏ, thu hái từ tự nhiên.', '', ECO, 'copied');
add(DR, 'reason', 'Why the species was not kept.', 'Lý do loài không được giữ lại.', '', BUILD, 'docs/CROP_DATA.md section 5');
add(DR, 'match', 'exact, group or none.', 'exact, group hoặc none.', '', BUILD, 'as in crops.csv');
add(DR, 'match_method', 'How the match was made.', 'Cách khớp.', '', BUILD, 'as in crops.csv');
add(DR, 'faostat_item_code', 'FAOSTAT item the species was matched to, if any.', 'Mặt hàng FAOSTAT mà loài được khớp, nếu có.', '', FAO, 'as in crops.csv');
add(DR, 'faostat_item', 'Name of that item.', 'Tên mặt hàng đó.', '', FAO, 'copied');

// ------------------------------------------------------------------------------------------------ sources, columns, summary
const SO = 'sources';
add(SO, 'source', 'Source identifier used by the build.', 'Mã nguồn dùng trong chương trình.', '', BUILD, '');
add(SO, 'title', 'What the file is.', 'Nội dung của tệp.', '', BUILD, '');
add(SO, 'publisher', 'Who publishes it.', 'Đơn vị công bố.', '', BUILD, '');
add(SO, 'url', 'Address the bytes were downloaded from (or the repository path).', 'Địa chỉ tải tệp (hoặc đường dẫn trong kho mã).', '', BUILD, '');
add(SO, 'landing_page', 'Page to cite or visit.', 'Trang để trích dẫn hoặc tham khảo.', '', BUILD, '');
add(SO, 'licence', 'Licence as read on the publisher\'s terms page.', 'Giấy phép theo trang điều khoản của đơn vị công bố.', '', BUILD, '');
add(SO, 'accessed', 'Date of download.', 'Ngày tải về.', 'date', BUILD, 'empty for repository files; for a national source, the date it was read (data/crops/national/prevalence.csv)');
add(SO, 'file', 'Where the file is kept.', 'Nơi lưu tệp.', '', BUILD, 'for a national source, the file its figures were read into by hand: the build keeps no copy of the publication');
add(SO, 'sha256', 'SHA-256 checksum of the file.', 'Mã kiểm tra SHA-256 của tệp.', '', BUILD, 'empty for a national source (no copy kept)');
add(SO, 'bytes', 'File size.', 'Kích thước tệp.', 'bytes', BUILD, 'empty for a national source (no copy kept)');
add(SO, 'rows_used', 'What the build took from it.', 'Phần dữ liệu chương trình đã dùng.', '', BUILD, '');
const CL = 'columns';
add(CL, 'table', 'Table (file name without .csv).', 'Bảng (tên tệp không kèm .csv).', '', BUILD, '');
add(CL, 'column', 'Column name.', 'Tên cột.', '', BUILD, '');
add(CL, 'meaning_en', 'Meaning in English.', 'Ý nghĩa bằng tiếng Anh.', '', BUILD, '');
add(CL, 'meaning_vi', 'Meaning in Vietnamese.', 'Ý nghĩa bằng tiếng Việt.', '', BUILD, '');
add(CL, 'unit', 'Unit.', 'Đơn vị.', '', BUILD, '');
add(CL, 'source', 'Source of the values.', 'Nguồn của giá trị.', '', BUILD, '');
add(CL, 'rule', 'Rule that produced the values.', 'Quy tắc tạo ra giá trị.', '', BUILD, '');
add('summary', 'metric', 'Count or check computed by the build.', 'Số đếm hoặc phép kiểm do chương trình tính.', '', BUILD, '');
add('summary', 'value', 'Its value.', 'Giá trị tương ứng.', '', BUILD, '');

// The price table is a template: header only, filled in by the team.
const EC = 'economics_template';
add(EC, 'crop_id', 'Crop (see crops.csv).', 'Cây trồng (xem crops.csv).', '', 'to be filled', '');
add(EC, 'iso3', 'Country.', 'Quốc gia.', '', 'to be filled', '');
add(EC, 'region', 'Region inside the country, if the figure is regional.', 'Vùng trong nước, nếu số liệu theo vùng.', '', 'to be filled', '');
add(EC, 'yield_t_ha', 'Yield.', 'Năng suất.', 't/ha', 'to be filled', '');
add(EC, 'price_usd_t', 'Farm-gate price.', 'Giá bán tại ruộng.', 'USD/t', 'to be filled', '');
add(EC, 'cost_usd_ha', 'Production cost.', 'Chi phí sản xuất.', 'USD/ha', 'to be filled', '');
add(EC, 'year', 'Year of the figures.', 'Năm của số liệu.', 'year', 'to be filled', '');
add(EC, 'quality_yield', 'Quality of the yield figure (official, press, estimate).', 'Độ tin cậy của số năng suất (chính thức, báo chí, ước tính).', '', 'to be filled', '');
add(EC, 'quality_price', 'Quality of the price figure.', 'Độ tin cậy của số giá.', '', 'to be filled', '');
add(EC, 'quality_cost', 'Quality of the cost figure.', 'Độ tin cậy của số chi phí.', '', 'to be filled', '');
add(EC, 'source', 'Source of the figures.', 'Nguồn số liệu.', '', 'to be filled', '');
add(EC, 'url', 'Link to the source.', 'Đường dẫn tới nguồn.', '', 'to be filled', '');
add(EC, 'accessed', 'Date the source was read.', 'Ngày tra cứu nguồn.', 'date', 'to be filled', '');

export const COLUMNS: readonly ColumnDoc[] = out;
export const ECONOMICS_COLUMNS = out.filter((c) => c.table === EC).map((c) => c.column);
