/** Follow-up and starter questions, in the user's language. */
import type { FieldContext, Lang } from '@/contracts';
import { cropShortName } from './facts';
import type { Analysis } from './retrieve';
import type { KnowledgeStore } from './store';
import { cap, fold } from './text';

const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Month (1-12) of the largest month-on-month score drop in the context, if any. */
function worstDropMonth(ctx: FieldContext | undefined): number | null {
  if (!ctx) return null;
  const keys = Object.keys(ctx.facts).filter((k) => /^score_\d{4}-\d{2}$/.test(k)).sort();
  let worst = 0;
  let month: number | null = null;
  for (let i = 1; i < keys.length; i++) {
    const d = Number(ctx.facts[keys[i]].match(/^(\d+)/)?.[1]) - Number(ctx.facts[keys[i - 1]].match(/^(\d+)/)?.[1]);
    if (d < worst) {
      worst = d;
      month = Number(keys[i].slice(-2));
    }
  }
  return month;
}

export function starterQuestions(cropName: string | null, ctx: FieldContext | undefined, lang: Lang): string[] {
  const vi = lang === 'vi';
  const out: string[] = [];
  const drop = worstDropMonth(ctx);
  if (ctx && cropName) out.push(vi ? `Đất của tôi có quá chua cho ${cropName} không?` : `Is my soil too acid for ${cropName}?`);
  if (ctx && drop) out.push(vi ? `Vì sao điểm năng suất giảm vào tháng ${drop}?` : `Why did the score drop in ${MONTH_EN[drop - 1]}?`);
  if (ctx) out.push(vi ? 'Độ ẩm vùng rễ ở đây nghĩa là gì?' : 'What does root-zone moisture mean here?');
  if (cropName) out.push(vi ? `Có thể luân canh gì với ${cropName}?` : `What could I rotate with ${cropName}?`);
  if (!ctx) {
    out.push(vi ? 'Đậu nành cần điều kiện gì để phát triển tốt?' : 'What conditions does soybean need?');
    out.push(vi ? 'NDVI là gì?' : 'What is NDVI?');
    out.push(vi ? 'Dữ liệu vệ tinh khác số đo tại ruộng thế nào?' : 'How is satellite data different from ground measurements?');
  }
  return out.slice(0, 4);
}

export function followUps(store: KnowledgeStore, a: Analysis, ctx?: FieldContext): string[] {
  const vi = a.lang === 'vi';
  const crop = store.crops.get(a.cropIds[0] ?? ctx?.cropId ?? '');
  const name = crop ? cropShortName(crop, a.lang) : null;
  const other = a.cropIds[1] ? store.crops.get(a.cropIds[1]) : undefined;
  const c: string[] = [];
  switch (a.intent) {
    case 'ideal':
    case 'care':
      if (name && ctx) c.push(vi ? `Ruộng của tôi có phù hợp với ${name} không?` : `Is my field suitable for ${name}?`);
      if (name) c.push(vi ? `Có thể luân canh gì với ${name}?` : `What can I rotate with ${name}?`);
      if (name && a.intent === 'ideal') c.push(vi ? `Khi nào nên gieo ${name}?` : `When should I sow ${name}?`);
      if (name && a.intent === 'care') c.push(vi ? `${name} cần bao nhiêu mưa?` : `How much rain does ${name} need?`);
      break;
    case 'compare':
      if (name && other) c.push(vi ? `${name} hay ${cropShortName(other, 'vi')} chịu hạn tốt hơn?` : `Which copes better with drought, ${name} or ${cropShortName(other, 'en')}?`);
      if (name) c.push(vi ? `Có thể luân canh gì với ${name}?` : `What can I rotate with ${name}?`);
      break;
    case 'field':
      c.push(vi ? 'Làm sao để có số đo pH chính xác cho ruộng?' : 'How do I get an accurate pH for my field?');
      if (name) c.push(vi ? `Có thể luân canh gì với ${name}?` : `What can I rotate with ${name}?`);
      c.push(vi ? 'Dữ liệu vệ tinh khác số đo tại ruộng thế nào?' : 'How is satellite data different from ground measurements?');
      break;
    case 'field-fact':
      if (ctx) {
        c.push(vi ? 'Tháng nào mưa nhiều nhất ở ruộng tôi?' : 'Which month is the wettest on my field?');
        c.push(vi ? 'Tuần tới ruộng tôi có rủi ro thời tiết nào không?' : 'Is there any weather risk on my field next week?');
        c.push(vi ? 'Đất của tôi có bao nhiêu chất hữu cơ?' : 'How much organic matter does my soil have?');
        if (name) c.push(vi ? `Ruộng của tôi có phù hợp với ${name} không?` : `Is my field suitable for ${name}?`);
      } else {
        c.push(...starterQuestions(name, ctx, a.lang));
      }
      break;
    case 'score-change':
      c.push(vi ? 'Độ ẩm vùng rễ ở đây nghĩa là gì?' : 'What does root-zone moisture mean here?');
      c.push(vi ? 'Huy hiệu Độ tin cậy nghĩa là gì?' : 'What does the Confidence Badge mean?');
      break;
    case 'term':
      c.push(vi ? 'Dữ liệu vệ tinh khác số đo tại ruộng thế nào?' : 'How is satellite data different from ground measurements?');
      c.push(vi ? 'Độ lệch độ ẩm đất là gì?' : 'What is a soil-moisture anomaly?');
      c.push(vi ? 'Bốc thoát hơi nước là gì?' : 'What is evapotranspiration?');
      break;
    case 'rotation':
      c.push(vi ? 'Cây che phủ nào hợp với mùa khô?' : 'Which cover crop suits a dry season?');
      if (name) c.push(vi ? `${name} cần điều kiện gì?` : `What conditions does ${name} need?`);
      break;
    default:
      c.push(...starterQuestions(name, ctx, a.lang));
  }
  const q = fold(a.query);
  return [...new Set(c.map(cap))].filter((x) => fold(x) !== q).slice(0, 3);
}
