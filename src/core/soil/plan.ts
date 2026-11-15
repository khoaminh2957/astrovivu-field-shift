import type { EvidenceItem, I18nText, ModelInput } from '@/contracts';
import { tx } from '@/contracts';
import { calculateBufferPhPlan } from './buffer';
import { SOIL_TYPE_REFERENCES } from './reference';
import type { SoilDiagnosis, SoilPlan, SoilPlanItem } from './types';

export function buildSoilPlan(diagnosis: SoilDiagnosis, input: ModelInput): SoilPlan {
  const items: SoilPlanItem[] = [];
  const ref = SOIL_TYPE_REFERENCES[diagnosis.soilType];

  for (const metric of diagnosis.metrics) {
    // 1. Missing data: Action must be "Measure first" rather than blind inputs
    if (metric.status === 'no_data') {
      items.push({
        metric: metric.key,
        status: 'no_data',
        title: tx(`Measure & Validate: ${metric.label.en}`, `Đo kiểm tra thực địa: ${metric.label.vi}`),
        action: tx(
          `Take a composite soil sample (0-20 cm) and send to an accredited lab to test ${metric.label.en}. Do not apply amendments blindly without diagnostic numbers.`,
          `Lấy mẫu đất hỗn hợp (tầng 0-20 cm) gửi phòng phân tích để kiểm tra ${metric.label.vi}. Tuyệt đối không bón vật tư cải tạo đại trà khi chưa có kết quả đo đạc tin cậy.`,
        ),
        rateRange: null,
        timing: tx('Prior to land preparation and seasonal sowing', 'Trước khi làm đất và gieo cấy vụ mùa'),
        verification: tx(
          'Compare certified soil laboratory test report against target crop requirements.',
          'So sánh phiếu kết quả thử nghiệm được chứng nhận với ngưỡng yêu cầu của cây trồng.',
        ),
        evidence: [
          {
            label: tx('Data Gap Principle', 'Nguyên tắc thiếu số liệu'),
            value: tx(
              'FAO Soil Bulletin 80: Diagnostic soil testing must precede chemical soil reclamation.',
              'FAO Soil Bulletin 80: Phải phân tích chẩn đoán đất trước khi quyết định cải tạo hóa học.',
            ),
          },
        ],
        caveats: [
          tx(
            'Satellite and remote estimates do not map this metric directly; local testing is required.',
            'Vệ tinh và bản đồ không đo trực tiếp chỉ tiêu này; bắt buộc phải lấy mẫu kiểm tra tại chỗ.',
          ),
        ],
        needsLocalReview: true,
      });
      continue;
    }

    // 2. pH Amendment
    if (metric.key === 'ph' && (metric.status === 'outside' || metric.status === 'tolerable' || metric.status === 'uncertain')) {
      const phPlan = calculateBufferPhPlan(input);
      if (phPlan && phPlan.amendment !== 'none') {
        const isLime = phPlan.amendment === 'lime';
        const unit = 't/ha';
        const rate = phPlan.rateTHa ? { min: phPlan.rateTHa[0], max: phPlan.rateTHa[1], unit } : null;

        items.push({
          metric: 'ph',
          status: metric.status,
          title: isLime
            ? tx('Soil Acidity Neutralization (Liming)', 'Khử chua và nâng pH đất (Bón vôi/Dolomite)')
            : tx('Soil Acidification (Elemental Sulfur)', 'Hạ kiềm và cân bằng pH đất (Lưu huỳnh)'),
          action: isLime
            ? tx(
                `Broadcast agricultural limestone (CaCO3) or dolomite to raise pH towards target ${phPlan.target}. Rate is calibrated to the buffering capacity of ${diagnosis.soilType} soil.`,
                `Rải vôi nông nghiệp (CaCO3) hoặc dolomite để nâng pH về ngưỡng mục tiêu ${phPlan.target}. Liều lượng được hiệu chỉnh theo khả năng đệm của nhóm đất ${diagnosis.soilType}.`,
              )
            : tx(
                `Apply elemental sulfur to lower pH towards target ${phPlan.target}.`,
                `Bón lưu huỳnh nguyên tố để hạ pH về ngưỡng mục tiêu ${phPlan.target}.`,
              ),
          rateRange: rate,
          timing: isLime
            ? tx('1-3 months before sowing; split if rate > 4.0 t/ha', '1-3 tháng trước khi gieo trồng; chia 2 đợt nếu liều > 4,0 t/ha')
            : tx('3-6 months prior to planting under warm moist conditions', '3-6 tháng trước vụ trồng trong điều kiện đất đủ ẩm và ấm'),
          verification: tx(
            'Re-test soil pH (in 1:2.5 H2O and buffer solution) 60-90 days post-application.',
            'Kiểm tra lại pH đất (tỷ lệ 1:2,5 H2O và dung dịch đệm) sau khi bón 60-90 ngày.',
          ),
          evidence: [
            {
              label: tx('Liming / Acidification Basis', 'Cơ sở cải tạo pH'),
              value: phPlan.basis,
            },
            {
              label: tx('Citation', 'Nguồn tài liệu'),
              value: tx(
                'McLean (1982) Soil pH and Lime Requirement (ASA-SSSA); USDA NRCS NSSH §618.45.',
                'McLean (1982) Soil pH and Lime Requirement (ASA-SSSA); USDA NRCS NSSH §618.45.',
              ),
            },
          ],
          caveats: phPlan.caveats,
          needsLocalReview: true,
        });
      }
    }

    // 3. Salinity
    if (metric.key === 'salinity' && (metric.status === 'outside' || metric.status === 'tolerable')) {
      items.push({
        metric: 'salinity',
        status: metric.status,
        title: tx('Salinity Leaching & Drainage Management', 'Rửa mặn và quản lý tiêu thoát nước'),
        action: tx(
          'Ensure continuous surface drainage outlets, apply fresh water leaching flushes, and avoid saline irrigation water.',
          'Đảm bảo hệ thống mương tiêu thoát nước thông suốt, tháo rửa bằng nước ngọt và tuyệt đối tránh nguồn nước tưới nhiễm mặn.',
        ),
        rateRange: null,
        timing: tx('Pre-season leaching cycles and following heavy rain events', 'Các chu kỳ rửa mặn trước mùa vụ và sau những cơn mưa lớn'),
        verification: tx(
          'Monitor water and topsoil EC weekly using a handheld conductivity meter.',
          'Đo kiểm tra EC của nước mặt và tầng đất mặt hàng tuần bằng bút đo độ dẫn điện.',
        ),
        evidence: [
          {
            label: tx('Citation', 'Nguồn tài liệu'),
            value: tx(
              'FAO Irrigation and Drainage Paper 29: Water Quality for Agriculture; USDA NRCS Soil Quality Technical Note 9.',
              'FAO Irrigation and Drainage Paper 29: Water Quality for Agriculture; USDA NRCS Soil Quality Technical Note 9.',
            ),
          },
        ],
        caveats: [
          tx(
            'Ensure water table is maintained below 1.2 m to prevent capillary resalination.',
            'Cần khống chế mực nước ngầm sâu dưới 1,2 m để tránh hiện tượng mao dẫn đưa muối ngược lên tầng rễ.',
          ),
        ],
        needsLocalReview: true,
      });
    }

    // 4. Organic Matter replenishment
    if (metric.key === 'organic_matter' && (metric.status === 'outside' || metric.status === 'tolerable')) {
      const compostMin = diagnosis.soilType === 'Sandy' ? 10 : 5;
      const compostMax = diagnosis.soilType === 'Sandy' ? 20 : 12;

      items.push({
        metric: 'organic_matter',
        status: metric.status,
        title: tx('Organic Soil Conditioning & Humus Building', 'Bổ sung hữu cơ và cải thiện cấu trúc đất'),
        action: tx(
          `Incorporate well-matured compost, farmyard manure, or establish legume cover crops to boost cation exchange and moisture retention for ${diagnosis.soilType} soil.`,
          `Bón phân chuồng ủ hoai mục, phân compost hoặc gieo xen cây phân xanh họ đậu để tăng dung tích hấp phụ (CEC) và khả năng giữ ẩm cho đất ${diagnosis.soilType}.`,
        ),
        rateRange: { min: compostMin, max: compostMax, unit: 't/ha' },
        timing: tx('During primary land preparation, thoroughly disced in', 'Khi cày ải làm đất cơ bản, bừa trộn đều vào lớp đất mặt'),
        verification: tx(
          'Re-evaluate soil organic carbon (SOC) annually through soil analysis.',
          'Kiểm tra lại hàm lượng cacbon hữu cơ (SOC) định kỳ hàng năm qua phiếu phân tích.',
        ),
        evidence: [
          {
            label: tx('Citation', 'Nguồn tài liệu'),
            value: tx(
              'FAO Fertilizer and Plant Nutrition Bulletin 16; USDA NRCS Soil Quality for Environmental Health.',
              'FAO Fertilizer and Plant Nutrition Bulletin 16; USDA NRCS Soil Quality for Environmental Health.',
            ),
          },
        ],
        caveats: [
          tx(
            'Use only fully stabilized compost to avoid nitrogen immobilisation (drawdown).',
            'Chỉ sử dụng phân hữu cơ đã hoai mục hoàn toàn để tránh hiện tượng vi sinh vật cạnh tranh đạm.',
          ),
        ],
        needsLocalReview: false,
      });
    }

    // 5. Drainage improvement
    if (metric.key === 'drainage' && metric.status === 'outside') {
      items.push({
        metric: 'drainage',
        status: 'outside',
        title: tx('Drainage Remediation & Raised Beds', 'Cải tạo hệ thống thoát nước và lên luống'),
        action: tx(
          'Excavate perimeter collector trenches and form elevated beds or ridges to avoid root zone anoxia.',
          'Đào rãnh thoát nước quanh bờ thửa và lên luống cao để tránh tình trạng yếm khí ngập úng vùng rễ.',
        ),
        rateRange: null,
        timing: tx('Before planting season and rainy onset', 'Trước mùa mưa và trước khi gieo trồng'),
        verification: tx(
          'Inspect surface water stagnation 24 hours after a significant rain event (>30 mm).',
          'Quan sát mức độ rút nước đọng trên mặt ruộng sau 24 giờ kể từ cơn mưa lớn (>30 mm).',
        ),
        evidence: [
          {
            label: tx('Citation', 'Nguồn tài liệu'),
            value: tx('FAO Drainage Paper 38: Drainage Design; USDA NRCS NEH Part 650.', 'FAO Drainage Paper 38: Drainage Design; USDA NRCS NEH Part 650.'),
          },
        ],
        caveats: [
          tx(
            'On sloping terrain, align drainage channels with contours to prevent erosion gullies.',
            'Trên địa hình dốc, kênh tiêu phải bố trí theo đường đồng mức để ngăn xói mòn tạo rãnh.',
          ),
        ],
        needsLocalReview: true,
      });
    }
  }

  // 6. Annual Macronutrient Maintenance Reference baseline
  items.push({
    metric: 'macronutrients',
    status: 'optimal',
    title: tx(
      `Baseline Annual Maintenance Fertilizer (${diagnosis.soilType})`,
      `Định mức phân bón duy trì hàng năm (${diagnosis.soilType})`,
    ),
    action: tx(
      `Recommended baseline annual inputs for ${diagnosis.soilType}: ${ref.macronutrientsKgHa.n} kg N/ha, ${ref.macronutrientsKgHa.p2o5} kg P2O5/ha, ${ref.macronutrientsKgHa.k2o} kg K2O/ha. Adjust for crop uptake and soil test P/K.`,
      `Định mức bón duy trì tham chiếu cho đất ${diagnosis.soilType}: ${ref.macronutrientsKgHa.n} kg N/ha, ${ref.macronutrientsKgHa.p2o5} kg P2O5/ha, ${ref.macronutrientsKgHa.k2o} kg K2O/ha. Điều chỉnh theo nhu cầu lấy đi của cây và lượng P/K dễ tiêu trong đất.`,
    ),
    rateRange: { min: ref.macronutrientsKgHa.n, max: ref.macronutrientsKgHa.n + ref.macronutrientsKgHa.k2o, unit: 'kg nutrient/ha/yr' },
    timing: tx('Split applications matching crop phenological stages', 'Chia đợt bón lót và bón thúc theo các giai đoạn sinh trưởng của cây'),
    verification: tx(
      'Foliar tissue analysis at peak flowering or leaf flush.',
      'Phân tích hàm lượng dinh dưỡng lá vào thời kỳ ra hoa hoặc đâm chồi rộ.',
    ),
    evidence: [
      {
        label: tx('Nutrient Reference', 'Định mức tham chiếu'),
        value: tx(
          'IFA World Fertilizer Use Manual; FAO Fertilizer and Plant Nutrition Bulletin 16.',
          'Cẩm nang sử dụng phân bón IFA; FAO Bulletin 16.',
        ),
      },
    ],
    caveats: [
      tx(
        'For Sandy soils, split N and K into multiple small doses to curb leaching losses.',
        'Đối với đất Cát (Sandy), cần chia nhỏ lượng Đạm và Kali thành nhiều lần bón để giảm thiểu thất thoát do trực di rửa trôi.',
      ),
    ],
    needsLocalReview: false,
  });

  const summary = tx(
    `Formulated ${items.length} soil management interventions for ${diagnosis.soilType} soil. Priority: ${diagnosis.mostLimitingFactor ? diagnosis.mostLimitingFactor.label.en : 'Maintenance'}.`,
    `Đã lập ${items.length} biện pháp quản lý và cải tạo cho đất ${diagnosis.soilType}. Ưu tiên hàng đầu: ${diagnosis.mostLimitingFactor ? diagnosis.mostLimitingFactor.label.vi : 'Bảo dưỡng định kỳ'}.`,
  );

  return {
    items,
    summary,
    mostLimitingFactor: diagnosis.mostLimitingFactor?.key ?? null,
  };
}

