import type { I18nText, ModelInput, PhPlan } from '@/contracts';
import { tx } from '@/contracts';
import { leachingRequirement, LR_METHOD } from './salinity';
import type { SoilDiagnosis, SoilPlan, SoilPlanItem, SoilStatus } from './types';

/**
 * How to obtain each reading the crop has a requirement for and the field lacks. No amendment and
 * no rate is proposed for a factor without a reading: the step is the measurement. A missing
 * reading that no requirement and no dose depends on (organic matter, CEC, available water) is
 * reported by the diagnosis and asks for no step here.
 */
const HOW_TO_MEASURE: Record<string, I18nText> = {
  ph: tx(
    'Take a composite soil sample (0-20 cm) and have its pH measured by a laboratory.',
    'Lấy mẫu đất hỗn hợp (tầng 0-20 cm) và gửi phòng phân tích đo pH.',
  ),
  texture: tx(
    'Have the particle-size distribution (sand, silt, clay) of a composite sample (0-20 cm) determined by a laboratory.',
    'Gửi mẫu đất hỗn hợp (tầng 0-20 cm) đến phòng phân tích để xác định thành phần cấp hạt (cát, limon, sét).',
  ),
  drainage: tx(
    'After a heavy rain, note how long water stands on the field; dig a pit and look for grey or mottled layers that show where water stagnates.',
    'Sau một trận mưa lớn, ghi lại nước đọng trên ruộng trong bao lâu; đào một hố và tìm các lớp đất xám hoặc loang lổ cho thấy nơi nước ứ đọng.',
  ),
  depth: tx(
    'Dig a pit or use an auger down to rock, hardpan or the water table, and measure the depth roots can reach.',
    'Đào hố hoặc khoan đến tầng đá, tầng cứng hay mực nước ngầm, rồi đo độ sâu rễ có thể xuống tới.',
  ),
  salinity: tx(
    'Have the electrical conductivity of the saturated paste extract (ECe) of a composite sample (0-20 cm) measured by a laboratory.',
    'Gửi mẫu đất hỗn hợp (tầng 0-20 cm) đến phòng phân tích để đo độ dẫn điện của dịch chiết bão hòa (ECe).',
  ),
};

/**
 * The soil plan: one item per row of the diagnosis that calls for a step.
 *
 * - No reading: the step is to measure. No rate.
 * - pH away from the optimum: the item carries the dose of the pH plan of the advisory report
 *   (`ph`, built by `phPlan` in `src/core/advisory/actions.ts`), so the report never shows two
 *   different lime figures. Without that plan the item carries no dose.
 * - Salinity above the crop's threshold: drainage and leaching, with the leaching requirement of
 *   FAO 29 when the irrigation water has been measured.
 * - Drainage the crop does not tolerate: drains and raised beds.
 *
 * Items that rested on numbers without a source are not produced: a yearly N-P-K rate per soil
 * group and compost rates (see docs/SOIL.md, "Removed").
 */
export function buildSoilPlan(diagnosis: SoilDiagnosis, input: ModelInput, ph?: PhPlan): SoilPlan {
  const items: SoilPlanItem[] = [];

  for (const metric of diagnosis.metrics) {
    // A reading without a requirement leads to no step.
    if (metric.status === 'reading_only') continue;
    const status: SoilStatus = metric.status;

    // 1. Missing data: the step is to measure, never an amendment.
    if (status === 'no_data') {
      const how = HOW_TO_MEASURE[metric.key];
      if (!how) continue;
      items.push({
        metric: metric.key,
        status: 'no_data',
        title: tx(`Measure first: ${metric.label.en}`, `Cần đo trước: ${metric.label.vi}`),
        action: tx(
          `${how.en} Do not apply an amendment for this factor before the result is in.`,
          `${how.vi} Không bón chất cải tạo cho chỉ tiêu này khi chưa có kết quả.`,
        ),
        rateRange: null,
        timing: tx('Before land preparation and sowing', 'Trước khi làm đất và gieo trồng'),
        verification: tx(
          'Set the result against what the crop needs and enter it for this field.',
          'So kết quả với yêu cầu của cây và nhập vào cho thửa ruộng này.',
        ),
        evidence: [
          {
            label: tx('Why', 'Lý do'),
            value: tx(
              'No reading is held for this factor, so no amendment and no rate is proposed.',
              'Chưa có số đo cho chỉ tiêu này nên không đề xuất chất cải tạo hay liều lượng nào.',
            ),
          },
        ],
        caveats: [
          tx(
            'Satellite and soil-map layers do not carry this reading for the field; on-site verification is required.',
            'Vệ tinh và bản đồ đất không có số đo này cho thửa ruộng; cần kiểm tra tại chỗ.',
          ),
        ],
        needsLocalReview: true,
      });
      continue;
    }

    // 2. pH away from the optimum: the dose is the one of the advisory report's pH plan.
    if (metric.key === 'ph' && status !== 'optimal') {
      if (ph && ph.amendment !== 'none') {
        const isLime = ph.amendment === 'lime';
        items.push({
          metric: 'ph',
          status,
          title: isLime ? tx('Raise soil pH (liming)', 'Nâng pH đất (bón vôi)') : tx('Lower soil pH (elemental sulfur)', 'Hạ pH đất (lưu huỳnh nguyên tố)'),
          action: isLime
            ? tx(
                `Broadcast agricultural limestone (CaCO3) or dolomite to raise pH from ${ph.current} towards ${ph.target}.`,
                `Rải vôi nông nghiệp (CaCO3) hoặc dolomite để nâng pH từ ${ph.current} về ${ph.target}.`,
              )
            : ph.rateTHa
              ? tx(`Apply elemental sulfur to lower pH from ${ph.current} towards ${ph.target}.`, `Bón lưu huỳnh nguyên tố để hạ pH từ ${ph.current} về ${ph.target}.`)
              : tx(
                  `pH ${ph.current} is above what the crop grows best in (target ${ph.target}), but no sulfur rate is given: it cannot be estimated without a laboratory test.`,
                  `pH ${ph.current} cao hơn mức cây phát triển tốt nhất (mục tiêu ${ph.target}), nhưng không đưa ra liều lưu huỳnh: không thể ước tính khi chưa phân tích đất.`,
                ),
          rateRange: ph.rateTHa ? { min: ph.rateTHa[0], max: ph.rateTHa[1], unit: 't/ha' } : null,
          timing: isLime
            ? tx('Before sowing, worked into the soil; see the notes for the lead time', 'Trước khi gieo trồng, trộn vào đất; xem ghi chú về thời gian bón trước')
            : tx('Well before planting: sulfur acts slowly', 'Trước vụ trồng một thời gian dài: lưu huỳnh tác dụng chậm'),
          verification: tx(
            'Measure soil pH again once the amendment has reacted, and before any further application.',
            'Đo lại pH đất sau khi chất cải tạo đã phản ứng, và trước mọi lần bón tiếp theo.',
          ),
          evidence: [{ label: tx('Basis of the rate', 'Cơ sở của liều lượng'), value: ph.basis }],
          caveats: [
            ...ph.caveats,
            tx(
              'The rate is indicative: on-site verification with a laboratory soil test is required before buying any amendment.',
              'Liều lượng chỉ mang tính định hướng: cần kiểm tra tại chỗ bằng phân tích đất ở phòng thí nghiệm trước khi mua chất cải tạo.',
            ),
          ],
          needsLocalReview: true,
        });
      } else if (!ph && typeof metric.deficit === 'number' && metric.deficit > 0) {
        items.push({
          metric: 'ph',
          status,
          title: tx('Correct soil pH', 'Điều chỉnh pH đất'),
          action: tx(
            `pH is ${metric.deficit} unit${metric.deficit === 1 ? '' : 's'} away from the range the crop grows best in. No dose is computed here: it is the one of the pH plan of the advisory report.`,
            `pH lệch ${metric.deficit} đơn vị so với khoảng cây phát triển tốt nhất. Ở đây không tính liều: liều là của kế hoạch pH trong báo cáo khuyến nghị.`,
          ),
          rateRange: null,
          timing: tx('Before sowing', 'Trước khi gieo trồng'),
          verification: tx('Measure soil pH again after any amendment.', 'Đo lại pH đất sau mỗi lần bón chất cải tạo.'),
          evidence: [{ label: tx('Finding', 'Kết quả chẩn đoán'), value: metric.note }],
          caveats: [tx('Indicative: on-site verification with a laboratory soil test is required.', 'Mang tính định hướng: cần kiểm tra tại chỗ bằng phân tích đất ở phòng thí nghiệm.')],
          needsLocalReview: true,
        });
      }
    }

    // 3. Salinity above the level at which the crop's yield begins to fall.
    if (metric.key === 'salinity' && (status === 'outside' || status === 'tolerable')) {
      const salt = leachingRequirement(input);
      items.push({
        metric: 'salinity',
        status,
        title: tx('Leach salts and keep the field drained', 'Rửa mặn và giữ ruộng tiêu thoát nước'),
        action: tx(
          'Keep the drainage outlets open, leach with water less saline than the soil, and avoid irrigating with saline water.',
          'Giữ mương tiêu thông suốt, rửa mặn bằng nước ít mặn hơn đất, và tránh tưới bằng nước nhiễm mặn.',
        ),
        // The leaching requirement is a share of the irrigation water, not a rate of a product.
        rateRange: null,
        timing: tx('Before the season and after heavy rain', 'Trước mùa vụ và sau những trận mưa lớn'),
        verification: tx(
          'Measure the EC of the irrigation water and of the topsoil regularly with a conductivity meter.',
          'Đo EC của nước tưới và của tầng đất mặt thường xuyên bằng bút đo độ dẫn điện.',
        ),
        evidence: [
          { label: tx('Finding', 'Kết quả chẩn đoán'), value: metric.note },
          { label: tx('Leaching requirement', 'Nhu cầu rửa mặn'), value: salt.leaching.note },
          { label: tx('Citation', 'Nguồn tài liệu'), value: tx(LR_METHOD, LR_METHOD) },
        ],
        caveats: salt.caveats,
        needsLocalReview: true,
      });
    }

    // 4. Drainage the crop does not tolerate.
    if (metric.key === 'drainage' && status === 'outside') {
      items.push({
        metric: 'drainage',
        status: 'outside',
        title: tx('Improve drainage: drains and raised beds', 'Cải thiện thoát nước: mương tiêu và lên luống'),
        action: tx(
          'Dig collector drains around the field and grow on raised beds or ridges so that the root zone does not stay waterlogged.',
          'Đào mương tiêu quanh thửa ruộng và trồng trên luống cao để vùng rễ không bị ngập úng kéo dài.',
        ),
        rateRange: null,
        timing: tx('Before the rainy season and before planting', 'Trước mùa mưa và trước khi gieo trồng'),
        verification: tx(
          'After a heavy rain, check how long water stands on the field.',
          'Sau một trận mưa lớn, kiểm tra nước đọng trên ruộng trong bao lâu.',
        ),
        evidence: [
          { label: tx('Finding', 'Kết quả chẩn đoán'), value: metric.note },
          {
            label: tx('Citation', 'Nguồn tài liệu'),
            value: tx(
              'FAO Irrigation and Drainage Paper 38: Drainage design factors; USDA NRCS National Engineering Handbook, Part 650.',
              'FAO Irrigation and Drainage Paper 38: Drainage design factors; USDA NRCS National Engineering Handbook, Part 650.',
            ),
          },
        ],
        caveats: [
          tx(
            'On sloping land, lay drains along the contour so that they do not start erosion gullies. On-site verification is required before any earthwork.',
            'Trên đất dốc, bố trí mương tiêu theo đường đồng mức để không tạo rãnh xói mòn. Cần kiểm tra tại chỗ trước khi đào đắp.',
          ),
        ],
        needsLocalReview: true,
      });
    }
  }

  const toMeasure = items.filter((i) => i.status === 'no_data').length;
  const toAct = items.length - toMeasure;
  const first = diagnosis.mostLimitingFactor;
  const summary = tx(
    `${toAct} soil ${toAct === 1 ? 'step' : 'steps'} to take and ${toMeasure} ${toMeasure === 1 ? 'reading' : 'readings'} to measure first.${first ? ` Look first at: ${first.label.en}.` : ''}`,
    `${toAct} biện pháp cải tạo đất và ${toMeasure} chỉ tiêu cần đo trước.${first ? ` Xem trước: ${first.label.vi}.` : ''}`,
  );

  return {
    items,
    summary,
    mostLimitingFactor: diagnosis.mostLimitingFactor?.key ?? null,
  };
}
