/**
 * Crops that matter most for Astrovivu's users (staples, pulses, oilseeds, roots, Central
 * Highlands perennials, cover crops, common vegetables and herbs). They get Wikipedia sections in
 * English and Vietnamese, a Vietnamese fact sheet, and ship in the small first-load index.
 *
 * `eco` is the exact EcoCrop `name`; the crop id is its slug. Vietnamese names are the common
 * southern/northern forms; the first one is used in answers.
 */
export interface CuratedCrop {
  eco: string;
  en: string;
  enAliases?: string[];
  vi: string[];
  wiki: string;
  group: 'cereal' | 'pulse' | 'oilseed' | 'root' | 'perennial' | 'fruit' | 'cover' | 'vegetable' | 'herb' | 'fibre';
}

export const CURATED: CuratedCrop[] = [
  // Cereals
  { eco: 'Oryza sativa', en: 'Rice', enAliases: ['paddy'], vi: ['Lúa', 'lúa gạo', 'lúa nước'], wiki: 'Rice', group: 'cereal' },
  { eco: 'Zea mays', en: 'Maize', enAliases: ['corn'], vi: ['Ngô', 'bắp'], wiki: 'Maize', group: 'cereal' },
  { eco: 'Triticum aestivum', en: 'Wheat', vi: ['Lúa mì'], wiki: 'Wheat', group: 'cereal' },
  { eco: 'Sorghum bicolor', en: 'Sorghum', vi: ['Cao lương', 'lúa miến'], wiki: 'Sorghum bicolor', group: 'cereal' },
  { eco: 'Hordeum vulgare', en: 'Barley', vi: ['Lúa mạch'], wiki: 'Barley', group: 'cereal' },
  { eco: 'Pennisetum glaucum', en: 'Pearl millet', enAliases: ['millet'], vi: ['Kê ngọc trai', 'kê'], wiki: 'Pearl millet', group: 'cereal' },
  { eco: 'Avena sativa', en: 'Oat', enAliases: ['oats'], vi: ['Yến mạch'], wiki: 'Oat', group: 'cereal' },
  // Pulses
  { eco: 'Glycine max', en: 'Soybean', enAliases: ['soya', 'soy', 'soya bean'], vi: ['Đậu nành', 'đậu tương'], wiki: 'Soybean', group: 'pulse' },
  { eco: 'Arachis hypogaea', en: 'Groundnut', enAliases: ['peanut', 'peanuts'], vi: ['Đậu phộng', 'lạc'], wiki: 'Peanut', group: 'pulse' },
  { eco: 'Vigna radiata', en: 'Mung bean', enAliases: ['green gram'], vi: ['Đậu xanh'], wiki: 'Mung bean', group: 'pulse' },
  { eco: 'Vigna unguiculata', en: 'Cowpea', enAliases: ['black-eyed pea'], vi: ['Đậu đũa', 'đậu trắng', 'đậu mắt cua'], wiki: 'Cowpea', group: 'pulse' },
  { eco: 'Phaseolus vulgaris', en: 'Common bean', enAliases: ['kidney bean', 'green bean', 'french bean'], vi: ['Đậu cô ve', 'đậu que', 'đậu đỏ'], wiki: 'Phaseolus vulgaris', group: 'pulse' },
  { eco: 'Cicer arietinum', en: 'Chickpea', vi: ['Đậu gà', 'đậu răng ngựa'], wiki: 'Chickpea', group: 'pulse' },
  { eco: 'Cajanus cajan', en: 'Pigeon pea', vi: ['Đậu triều', 'đậu săng'], wiki: 'Pigeon pea', group: 'pulse' },
  { eco: 'Lens culinaris', en: 'Lentil', vi: ['Đậu lăng'], wiki: 'Lentil', group: 'pulse' },
  { eco: 'Pisum sativum', en: 'Pea', vi: ['Đậu Hà Lan'], wiki: 'Pea', group: 'pulse' },
  // Oilseeds
  { eco: 'Sesamum indicum', en: 'Sesame', vi: ['Mè', 'vừng'], wiki: 'Sesame', group: 'oilseed' },
  { eco: 'Helianthus annuus', en: 'Sunflower', vi: ['Hướng dương'], wiki: 'Common sunflower', group: 'oilseed' },
  { eco: 'Brassica napus', en: 'Rapeseed', enAliases: ['canola'], vi: ['Cải dầu'], wiki: 'Rapeseed', group: 'oilseed' },
  { eco: 'Elaeis guineensis', en: 'Oil palm', vi: ['Cọ dầu'], wiki: 'Elaeis guineensis', group: 'oilseed' },
  // Roots and tubers
  { eco: 'Manihot esculenta', en: 'Cassava', enAliases: ['manioc', 'tapioca'], vi: ['Sắn', 'khoai mì'], wiki: 'Cassava', group: 'root' },
  { eco: 'Ipomoea batatas', en: 'Sweet potato', vi: ['Khoai lang'], wiki: 'Sweet potato', group: 'root' },
  { eco: 'Solanum tuberosum', en: 'Potato', vi: ['Khoai tây'], wiki: 'Potato', group: 'root' },
  { eco: 'Colocasia esculenta', en: 'Taro', vi: ['Khoai môn', 'khoai sọ'], wiki: 'Taro', group: 'root' },
  { eco: 'Dioscorea alata', en: 'Greater yam', enAliases: ['yam', 'purple yam'], vi: ['Khoai mỡ', 'khoai tím'], wiki: 'Dioscorea alata', group: 'root' },
  // Perennials and industrial crops
  { eco: 'Coffea canephora', en: 'Robusta coffee', enAliases: ['robusta', 'coffee'], vi: ['Cà phê vối', 'cà phê robusta', 'cà phê'], wiki: 'Coffea canephora', group: 'perennial' },
  { eco: 'Coffea arabica', en: 'Arabica coffee', enAliases: ['arabica'], vi: ['Cà phê chè', 'cà phê arabica'], wiki: 'Coffea arabica', group: 'perennial' },
  { eco: 'Piper nigrum', en: 'Black pepper', enAliases: ['pepper vine'], vi: ['Hồ tiêu', 'tiêu'], wiki: 'Black pepper', group: 'perennial' },
  { eco: 'Camellia sinensis', en: 'Tea', vi: ['Chè', 'trà'], wiki: 'Camellia sinensis', group: 'perennial' },
  { eco: 'Theobroma cacao', en: 'Cacao', enAliases: ['cocoa'], vi: ['Ca cao'], wiki: 'Theobroma cacao', group: 'perennial' },
  { eco: 'Hevea brasiliensis', en: 'Rubber tree', enAliases: ['rubber'], vi: ['Cao su'], wiki: 'Hevea brasiliensis', group: 'perennial' },
  { eco: 'Saccharum officinarum', en: 'Sugarcane', vi: ['Mía'], wiki: 'Sugarcane', group: 'perennial' },
  { eco: 'Gossypium hirsutum', en: 'Cotton', vi: ['Bông', 'bông vải'], wiki: 'Gossypium hirsutum', group: 'fibre' },
  { eco: 'Anacardium occidentale', en: 'Cashew', vi: ['Điều', 'đào lộn hột'], wiki: 'Cashew', group: 'perennial' },
  { eco: 'Macadamia integrifolia', en: 'Macadamia', vi: ['Mắc ca'], wiki: 'Macadamia integrifolia', group: 'perennial' },
  // Fruit
  { eco: 'Musa acuminata', en: 'Banana', vi: ['Chuối'], wiki: 'Banana', group: 'fruit' },
  { eco: 'Durio zibethinus', en: 'Durian', vi: ['Sầu riêng'], wiki: 'Durio zibethinus', group: 'fruit' },
  { eco: 'Persea americana', en: 'Avocado', vi: ['Bơ'], wiki: 'Avocado', group: 'fruit' },
  { eco: 'Mangifera indica', en: 'Mango', vi: ['Xoài'], wiki: 'Mango', group: 'fruit' },
  { eco: 'Carica papaya', en: 'Papaya', vi: ['Đu đủ'], wiki: 'Papaya', group: 'fruit' },
  { eco: 'Citrus sinensis', en: 'Sweet orange', enAliases: ['orange'], vi: ['Cam'], wiki: 'Orange (fruit)', group: 'fruit' },
  { eco: 'Citrullus lanatus', en: 'Watermelon', vi: ['Dưa hấu'], wiki: 'Watermelon', group: 'fruit' },
  // Forage and cover crops
  { eco: 'Medicago sativa', en: 'Alfalfa', enAliases: ['lucerne'], vi: ['Cỏ linh lăng', 'cỏ alfalfa'], wiki: 'Alfalfa', group: 'cover' },
  { eco: 'Trifolium repens', en: 'White clover', vi: ['Cỏ ba lá trắng'], wiki: 'Trifolium repens', group: 'cover' },
  { eco: 'Trifolium pratense', en: 'Red clover', vi: ['Cỏ ba lá đỏ'], wiki: 'Trifolium pratense', group: 'cover' },
  { eco: 'Vicia villosa ssp. villosa', en: 'Hairy vetch', enAliases: ['vetch'], vi: ['Đậu tằm lông'], wiki: 'Vicia villosa', group: 'cover' },
  { eco: 'Secale cereale', en: 'Cereal rye', enAliases: ['rye'], vi: ['Lúa mạch đen'], wiki: 'Rye', group: 'cover' },
  { eco: 'Crotalaria juncea', en: 'Sunn hemp', vi: ['Muồng sợi', 'lục lạc sợi'], wiki: 'Crotalaria juncea', group: 'cover' },
  { eco: 'Mucuna pruriens', en: 'Velvet bean', enAliases: ['mucuna'], vi: ['Đậu mèo', 'đậu ván lông'], wiki: 'Mucuna pruriens', group: 'cover' },
  { eco: 'Stylosanthes guianensis var. guianensis', en: 'Stylo', enAliases: ['stylosanthes'], vi: ['Cỏ stylo', 'cỏ stylosanthes'], wiki: 'Stylosanthes guianensis', group: 'cover' },
  { eco: 'Lablab purpureus', en: 'Lablab', enAliases: ['hyacinth bean'], vi: ['Đậu ván'], wiki: 'Lablab', group: 'cover' },
  { eco: 'Fagopyrum esculentum', en: 'Buckwheat', vi: ['Kiều mạch', 'tam giác mạch'], wiki: 'Buckwheat', group: 'cover' },
  { eco: 'Raphanus sativus', en: 'Radish', enAliases: ['daikon', 'tillage radish'], vi: ['Củ cải', 'củ cải trắng'], wiki: 'Radish', group: 'vegetable' },
  // Vegetables
  { eco: 'Lycopersicon esculentum', en: 'Tomato', enAliases: ['solanum lycopersicum'], vi: ['Cà chua'], wiki: 'Tomato', group: 'vegetable' },
  { eco: 'Capsicum annuum', en: 'Chili pepper', enAliases: ['chilli', 'chili', 'bell pepper', 'capsicum'], vi: ['Ớt'], wiki: 'Capsicum annuum', group: 'vegetable' },
  { eco: 'Brassica oleracea var. capitata', en: 'Cabbage', vi: ['Bắp cải', 'cải bắp'], wiki: 'Cabbage', group: 'vegetable' },
  { eco: 'Brassica rapa Pak Choi', en: 'Bok choy', enAliases: ['pak choi'], vi: ['Cải thìa', 'cải bẹ trắng'], wiki: 'Bok choy', group: 'vegetable' },
  { eco: 'Lactuca sativa var. capitata', en: 'Lettuce', vi: ['Xà lách', 'rau diếp'], wiki: 'Lettuce', group: 'vegetable' },
  { eco: 'Cucumis sativus', en: 'Cucumber', vi: ['Dưa leo', 'dưa chuột'], wiki: 'Cucumber', group: 'vegetable' },
  { eco: 'Cucurbita moschata', en: 'Pumpkin', enAliases: ['squash', 'butternut squash'], vi: ['Bí đỏ', 'bí ngô'], wiki: 'Cucurbita moschata', group: 'vegetable' },
  { eco: 'Abelmoschus esculentus', en: 'Okra', vi: ['Đậu bắp'], wiki: 'Okra', group: 'vegetable' },
  { eco: 'Allium cepa', en: 'Onion', vi: ['Hành tây', 'hành'], wiki: 'Onion', group: 'vegetable' },
  { eco: 'Allium sativum', en: 'Garlic', vi: ['Tỏi'], wiki: 'Garlic', group: 'vegetable' },
  { eco: 'Daucus carota', en: 'Carrot', vi: ['Cà rốt'], wiki: 'Carrot', group: 'vegetable' },
  { eco: 'Ipomoea aquatica', en: 'Water spinach', enAliases: ['morning glory', 'kangkong'], vi: ['Rau muống'], wiki: 'Ipomoea aquatica', group: 'vegetable' },
  { eco: 'Solanum melongena', en: 'Eggplant', enAliases: ['aubergine', 'brinjal'], vi: ['Cà tím'], wiki: 'Eggplant', group: 'vegetable' },
  { eco: 'Spinacia oleracea', en: 'Spinach', vi: ['Rau chân vịt', 'cải bó xôi'], wiki: 'Spinach', group: 'vegetable' },
  // Herbs and spices
  { eco: 'Ocimum basilicum', en: 'Basil', vi: ['Húng quế', 'rau quế'], wiki: 'Basil', group: 'herb' },
  { eco: 'Coriandrum sativum', en: 'Coriander', enAliases: ['cilantro'], vi: ['Rau mùi', 'ngò'], wiki: 'Coriander', group: 'herb' },
  { eco: 'Mentha spicata var. crispa', en: 'Spearmint', enAliases: ['mint'], vi: ['Bạc hà', 'húng lủi'], wiki: 'Spearmint', group: 'herb' },
  { eco: 'Cymbopogon citratus', en: 'Lemongrass', vi: ['Sả'], wiki: 'Cymbopogon citratus', group: 'herb' },
  { eco: 'Zingiber officinale', en: 'Ginger', vi: ['Gừng'], wiki: 'Ginger', group: 'herb' },
  { eco: 'Curcuma longa', en: 'Turmeric', vi: ['Nghệ'], wiki: 'Turmeric', group: 'herb' },
  { eco: 'Perilla frutescens', en: 'Perilla', enAliases: ['shiso'], vi: ['Tía tô'], wiki: 'Perilla frutescens', group: 'herb' },
];

/**
 * Method and concept articles (Wikipedia) that back the hand-written glossary with a second,
 * citable source. Vietnamese versions are fetched through langlinks when they exist.
 */
export const CONCEPT_ARTICLES: { wiki: string; tags: string[] }[] = [
  { wiki: 'Evapotranspiration', tags: ['term', 'evapotranspiration', 'water'] },
  { wiki: 'Normalized difference vegetation index', tags: ['term', 'ndvi', 'satellite'] },
  { wiki: 'Enhanced vegetation index', tags: ['term', 'evi', 'satellite'] },
  { wiki: 'Soil moisture', tags: ['term', 'soil-moisture'] },
  { wiki: 'Soil Moisture Active Passive', tags: ['term', 'smap', 'satellite'] },
  { wiki: 'Moderate Resolution Imaging Spectroradiometer', tags: ['term', 'modis', 'satellite'] },
  { wiki: 'Global Precipitation Measurement', tags: ['term', 'imerg', 'rain', 'satellite'] },
  { wiki: 'Shuttle Radar Topography Mission', tags: ['term', 'srtm', 'terrain'] },
  { wiki: 'Remote sensing', tags: ['term', 'satellite'] },
  { wiki: 'Crop rotation', tags: ['rotation'] },
  { wiki: 'Cover crop', tags: ['rotation', 'cover-crop'] },
  { wiki: 'Green manure', tags: ['rotation', 'cover-crop'] },
  { wiki: 'Intercropping', tags: ['rotation'] },
  { wiki: 'Nitrogen fixation', tags: ['rotation', 'nitrogen'] },
  { wiki: 'Soil pH', tags: ['term', 'ph', 'soil'] },
  { wiki: 'Liming (soil)', tags: ['ph', 'soil', 'care'] },
  { wiki: 'Soil texture', tags: ['term', 'soil'] },
  { wiki: 'Growing degree-day', tags: ['term', 'gdd', 'temperature'] },
  { wiki: 'Frost', tags: ['term', 'frost', 'risk'] },
  { wiki: 'Water balance', tags: ['term', 'water-balance', 'water'] },
  { wiki: 'Irrigation', tags: ['water', 'care'] },
  { wiki: 'Drip irrigation', tags: ['water', 'care'] },
  { wiki: 'Agroforestry', tags: ['rotation'] },
  { wiki: 'Drought', tags: ['term', 'risk', 'water'] },
];
