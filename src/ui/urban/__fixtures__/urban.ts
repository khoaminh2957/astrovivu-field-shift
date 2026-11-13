/** DEV-ONLY LAYOUT FIXTURE: invented plant picks for reviewing the urban layout (`?fixture=1`). */
import type { UrbanRecommendation } from '@/contracts';
import { tx } from '@/contracts';

export const URBAN_FIXTURE: UrbanRecommendation[] = [
  {
    cropId: 'ocimum-basilicum',
    name: tx('Thai basil', 'Húng quế'),
    score: 92,
    difficulty: 1,
    why: [tx('Warm all year (25-29 °C): basil never stops growing here.', 'Ấm quanh năm (25-29 °C): húng quế phát triển liên tục.'), tx('Fine in a 20 cm pot on a balcony.', 'Trồng tốt trong chậu 20 cm ngoài ban công.')],
    care: {
      water: tx('Every morning in the dry season; every 2-3 days in the rains.', 'Mỗi sáng vào mùa khô; 2-3 ngày một lần mùa mưa.'),
      light: tx('4-6 h of direct sun.', '4-6 giờ nắng trực tiếp.'),
      sowMonths: [2, 3, 4, 5, 9, 10],
      harvestDays: [35, 50],
      tips: [tx('Pinch flower buds to keep leaves coming.', 'Ngắt nụ hoa để cây ra lá liên tục.')],
    },
    calendar: [],
  },
  {
    cropId: 'ipomoea-aquatica',
    name: tx('Water spinach', 'Rau muống'),
    score: 88,
    difficulty: 1,
    why: [tx('Loves heat and the 1,900 mm of rain from May to November.', 'Ưa nóng và lượng mưa 1.900 mm từ tháng 5 đến tháng 11.')],
    care: {
      water: tx('Keep the soil wet; a tray under the pot helps.', 'Giữ đất luôn ẩm; đặt khay dưới chậu.'),
      light: tx('Full or partial sun.', 'Nắng toàn phần hoặc một phần.'),
      sowMonths: [4, 5, 6, 7, 8],
      harvestDays: [25, 30],
      tips: [tx('Cut 5 cm above the soil and it regrows.', 'Cắt cách gốc 5 cm để cây mọc lại.')],
    },
    calendar: [],
  },
  {
    cropId: 'capsicum-frutescens',
    name: tx('Bird chilli', 'Ớt chỉ thiên'),
    score: 74,
    difficulty: 2,
    why: [tx('Needs the full sun a rooftop gets; fruits best in the dry season.', 'Cần nắng toàn phần như trên sân thượng; ra trái tốt mùa khô.')],
    care: {
      water: tx('When the top 2 cm of soil is dry.', 'Khi 2 cm đất mặt đã khô.'),
      light: tx('6 h or more of direct sun.', 'Từ 6 giờ nắng trực tiếp.'),
      sowMonths: [1, 2, 10, 11],
      harvestDays: [80, 100],
      tips: [tx('Stake the plant before the first fruits.', 'Cắm cọc trước khi cây ra trái.')],
    },
    calendar: [],
  },
];
