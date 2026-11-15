/**
 * Extractive answers: templates over structured EcoCrop facts, field facts and retrieved
 * passages, in English or Vietnamese. The SYSTEM_INSTRUCTIONS rules are enforced here instead of
 * by a prompt: numbers only from inputs, source on first use, missing facts named with the
 * cheapest way to get them, short quotes with [S#] citations, one concrete next step.
 */
import type { AskResult, FieldContext, KnowledgeChunk, Lang } from '@/contracts';
import { bestSentences, Citer, mentions, quote } from './cite';
import { cropLabel, cropShortName, factLines, viTerm, whereLines } from './facts';
import { composeFieldFact, missingSentence, readingParagraphs } from './fieldAnswer';
import { lookupFieldFacts, parseFieldFact, TERM_FACTS } from './fieldFacts';
import { followUps } from './followups';
import type { Focus, OutOfScope } from './intent';
import type { Analysis, Hit } from './retrieve';
import type { DroppedMention, KnowledgeStore } from './store';
import { assess, type Check, howToGet } from './suitability';
import { cap, fold, terms } from './text';
import type { CropFacts } from './types';
import { chunkKind } from './types';

type L = (en: string, vi: string) => string;
const tr = (lang: Lang): L => (en, vi) => (lang === 'vi' ? vi : en);

const MONTHS: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  vi: Array.from({ length: 12 }, (_, i) => `tháng ${i + 1}`),
};

const FOCUS_KEYS: Record<Focus, string[]> = {
  ph: ['ph'],
  temp: ['temp', 'kill'],
  rain: ['rain'],
  water: ['rain', 'drainage'],
  soil: ['ph', 'texture', 'drainage', 'depth', 'fertility', 'salinity'],
  texture: ['texture'],
  drainage: ['drainage'],
  cycle: ['cycle'],
  frost: ['kill', 'killRest'],
  light: ['light'],
  salinity: ['salinity'],
  altitude: ['alt'],
  // EcoCrop has one fertility class and one depth class; it records nothing on slope or bulk density.
  organic: ['fertility'],
  cec: ['fertility'],
  nitrogen: ['fertility'],
  density: [],
  slope: [],
  depth: ['depth'],
};
const DEFAULT_KEYS = ['temp', 'rain', 'ph', 'texture', 'drainage', 'cycle'];

// Words a quoted sentence must contain to support a requirement answer. English stems match as
// word prefixes; Vietnamese words match whole syllables WITH diacritics, because folded forms
// collide ("đạt" achieve vs "đất" soil, "cát" sand vs "medication").
const FOCUS_WORDS: Record<Focus, string[]> = {
  ph: ['ph', 'acid', 'alkalin', 'lime', 'liming', 'chua', 'kiềm', 'vôi'],
  temp: ['temperat', '°c', 'heat', 'cold', 'warm', 'cool', 'frost', 'nhiệt', 'nóng', 'lạnh'],
  rain: ['rain', 'precipit', 'drought', 'wet', 'dry', 'mưa', 'hạn', 'khô'],
  water: ['water', 'irrigat', 'rain', 'drought', 'moist', 'nước', 'tưới', 'mưa', 'hạn', 'ẩm'],
  soil: ['soil', 'loam', 'clay', 'sand', 'drain', 'đất', 'sét', 'cát'],
  texture: ['soil', 'loam', 'clay', 'sand', 'đất', 'sét', 'cát'],
  drainage: ['drain', 'waterlog', 'flood', 'thoát', 'ngập', 'úng'],
  cycle: ['days', 'month', 'matur', 'harvest', 'ngày', 'tháng', 'hoạch'],
  frost: ['frost', 'freez', 'cold', 'sương', 'lạnh'],
  light: ['light', 'shade', 'sun', 'sáng', 'bóng', 'nắng'],
  salinity: ['salin', 'salt', 'mặn'],
  altitude: ['altitude', 'elevation', 'cao'],
  organic: ['organic', 'humus', 'fertil', 'hữu', 'mùn', 'phì'],
  cec: ['cation', 'fertil', 'phì'],
  nitrogen: ['nitrogen', 'fertil', 'đạm', 'phì'],
  density: ['compact', 'dense', 'chặt'],
  slope: ['slope', 'steep', 'erosion', 'dốc', 'xói'],
  depth: ['deep', 'depth', 'shallow', 'sâu', 'nông'],
};
const REQUIREMENT_WORDS = [...new Set(Object.values(FOCUS_WORDS).flat()), 'climate', 'grow', 'cultivat', 'hậu', 'trồng', 'trưởng'];
const sentenceWords = (focus: Focus[]) => (focus.length ? [...new Set(focus.flatMap((f) => FOCUS_WORDS[f]))] : REQUIREMENT_WORDS);

/** Whole-word test: ASCII stems as prefixes of a word, other words as exact syllables. */
function hasWord(text: string, words: string[]): boolean {
  const toks: string[] = text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}°]+/gu) ?? [];
  return words.some((w) => (/^[a-z°]+$/.test(w) ? toks.some((t) => (w.length <= 3 ? t === w : t.startsWith(w))) : toks.includes(w)));
}

const CHECK_NAME: Record<Check['key'], [string, string]> = {
  ph: ['Soil pH', 'pH đất'],
  temp: ['Mean annual air temperature', 'Nhiệt độ không khí trung bình năm'],
  rain: ['Mean annual rainfall', 'Lượng mưa trung bình năm'],
  texture: ['Soil texture', 'Thành phần cơ giới đất'],
  drainage: ['Drainage', 'Thoát nước'],
  frost: ['Recent minimum air temperature', 'Nhiệt độ tối thấp gần đây'],
  altitude: ['Elevation', 'Độ cao'],
  salinity: ['Soil salinity (electrical conductivity)', 'Độ mặn của đất (độ dẫn điện)'],
  depth: ['Depth to a layer that stops roots', 'Độ sâu đến tầng hạn chế rễ'],
};

function factsChunk(store: KnowledgeStore, id: string, lang: Lang): KnowledgeChunk | undefined {
  return store.chunks.get(`eco:${id}:facts${lang === 'vi' ? '-vi' : ''}`) ?? store.chunks.get(`eco:${id}:facts`);
}

function wantedKeys(focus: Focus[]): string[] {
  const specific = focus.filter((f) => f !== 'soil');
  const keys = (specific.length ? specific : focus).flatMap((f) => FOCUS_KEYS[f]);
  return keys.length ? [...new Set(keys)] : DEFAULT_KEYS;
}

/** One or two quoted sentences from the best non-structured passages about the question. */
function supportingQuotes(hits: Hit[], a: Analysis, cite: Citer, lang: Lang, opts: { max?: number; kinds?: string[]; extra?: string[]; skip?: Set<string>; mustMention?: string[]; sentenceMust?: string[] } = {}): string[] {
  const qTerms = [...terms(a.query), ...a.expansion];
  const out: string[] = [];
  for (const h of hits) {
    if (out.length >= (opts.max ?? 1)) break;
    const kind = chunkKind(h.chunk);
    if (kind === 'facts' || kind === 'where' || opts.skip?.has(h.chunk.id)) continue;
    if (opts.kinds && !opts.kinds.includes(kind)) continue;
    if (opts.mustMention && !mentions(h.chunk.text, opts.mustMention)) continue;
    // Never quote a passage about a different crop than the one asked about.
    if (a.cropIds.length && h.chunk.cropIds?.length && !h.chunk.cropIds.some((id) => a.cropIds.includes(id))) continue;
    if (opts.skip?.has(h.chunk.docId)) continue;
    const s = bestSentences(h.chunk, qTerms, 3, opts.extra).find((x) => !opts.sentenceMust || hasWord(x, opts.sentenceMust));
    if (!s) continue;
    out.push(`${quote(s, h.chunk, lang)} ${cite.cite(h.chunk, s, h.score)}`);
  }
  return out;
}

function sourceCaveat(key: Check['key'], fact: string, lang: Lang): string | null {
  const t = tr(lang);
  if (/measured by the farmer/.test(fact)) return t('This is your own measurement, so it overrides the satellite and model estimates.', 'Đây là số đo của bạn nên được ưu tiên hơn ước tính vệ tinh và mô hình.');
  if (/simulated/i.test(fact)) return t('This value is simulated demo data.', 'Giá trị này là dữ liệu demo mô phỏng.');
  const f = parseFieldFact(key, fact);
  if (f.provenance !== 'modelled' && !/SoilGrids/i.test(fact)) return null;
  const cell = f.pixel ? t(`a ${f.pixel} cell`, `một ô ${f.pixel}`) : t('the neighbourhood', 'khu vực');
  // Only a soil property can be settled by a soil test; rain and temperature are settled by records.
  return key === 'ph' || key === 'texture' || key === 'drainage' || key === 'salinity' || key === 'depth'
    ? t(`It is a model estimate for ${cell}, not a measurement of your field; a soil test would confirm it.`, `Đây là ước tính của mô hình cho ${cell}, không phải số đo của ruộng bạn; phân tích đất sẽ xác nhận.`)
    : t(`It is a model estimate for ${cell}, not a measurement on your field.`, `Đây là ước tính của mô hình cho ${cell}, không phải số đo tại ruộng của bạn.`);
}

const AMEND = /what (should i|to|do i|can i) (apply|add|use|spread)|\bamend|\bfertili[sz]|\blime\b|liming|bon gi|can bon|bon them|bon voi|bon phan|cai tao/;

/**
 * "What should I apply" on a field whose pH is known: what the pH alone says, and what it cannot
 * say. Amounts are never given; they need a soil test (the soil plan of the advisory panel).
 */
function amendNote(ph: Check, crop: CropFacts, lang: Lang): string {
  const t = tr(lang);
  const name = cropShortName(crop, lang);
  const f = parseFieldFact('ph', ph.fact);
  const range = f.interval ? t(` The source's 5-95 % range is ${f.interval[0]} to ${f.interval[1]}, so the true value may lie outside the optimum: a soil test settles it.`, ` Khoảng 5-95 % của nguồn là ${f.interval[0]} đến ${f.interval[1]}, nên giá trị thật có thể nằm ngoài khoảng tối ưu: phân tích đất sẽ cho câu trả lời.`) : '';
  const rest = t(' What else to apply (nitrogen, phosphorus, potassium) cannot be read from these data.', ' Cần bón gì khác (đạm, lân, kali) thì không đọc được từ các số liệu này.');
  if (ph.status === 'optimal') return t(`What to apply: by pH alone, nothing. ${ph.value} is inside ${name}'s optimum, so this number gives no reason to lime.`, `Cần bón gì: nếu chỉ xét pH thì chưa cần. ${ph.value} nằm trong khoảng tối ưu của ${name}, nên con số này chưa cho lý do để bón vôi.`) + range + rest;
  if (ph.status.endsWith('low')) return t('What to apply: lime is what raises a low pH; the amount depends on texture and buffer capacity and has to come from a soil test and local guidance.', 'Cần bón gì: vôi là thứ nâng pH thấp; lượng bón tuỳ thành phần cơ giới và khả năng đệm của đất, phải dựa vào phân tích đất và hướng dẫn địa phương.') + rest;
  return t('What to apply: lime would raise the pH further and is not called for; lowering a high pH is slow and costly, so ask a local agronomist first.', 'Cần bón gì: vôi sẽ làm pH cao thêm nên không nên bón; hạ pH cao thì chậm và tốn kém, nên hỏi cán bộ nông nghiệp địa phương trước.') + rest;
}

function checkSentence(c: Check, crop: CropFacts, lang: Lang, marker: string): string {
  const t = tr(lang);
  const name = cropShortName(crop, lang);
  const what = t(CHECK_NAME[c.key][0], CHECK_NAME[c.key][1]);
  const src = c.fact.replace(/^[^(]*\(/, '(').replace(/\)\s*$/, ')');
  const req = lang === 'vi' ? viTerm(c.required).replace('optimal', 'tối ưu').replace('tolerated', 'chịu được').replace('killing temperature in early growth', 'nhiệt độ gây chết giai đoạn đầu').replace('up to', 'tối đa') : c.required;
  const lead = `${what} ${t('on your field is', 'của ruộng bạn là')} ${c.value} ${src}`;
  const phWord = c.key === 'ph' ? (c.status.endsWith('low') ? t(' (on the acid side)', ' (hơi chua)') : c.status.endsWith('high') ? t(' (on the alkaline side)', ' (hơi kiềm)') : '') : '';
  switch (c.status) {
    case 'optimal':
    case 'match':
      return `${lead}: ${t(`inside ${name}'s optimal range`, `nằm trong khoảng tối ưu của ${name}`)} (${req}) ${marker}.`;
    case 'tolerated-low':
    case 'tolerated-high':
      return `${lead}: ${t(`outside the optimum but within what ${name} tolerates`, `ngoài khoảng tối ưu nhưng ${name} vẫn chịu được`)}${phWord} (${req}) ${marker}.`;
    case 'outside-low':
    case 'outside-high':
      return `${lead}: ${t(`beyond what ${name} tolerates`, `vượt ngưỡng ${name} chịu được`)}${phWord} (${req}) ${marker}.`;
    case 'mismatch':
      return `${lead}: ${t(`not a texture or drainage class listed for ${name}`, `không thuộc nhóm phù hợp với ${name}`)} (${req}) ${marker}.`;
  }
}

function manageNote(c: Check, lang: Lang): string | null {
  const t = tr(lang);
  if (c.key === 'ph' && c.status.endsWith('low'))
    return t('pH is manageable: agricultural lime raises it over months, but the amount depends on texture and buffer capacity and must come from a soil test and local guidance.', 'pH có thể cải thiện: bón vôi nông nghiệp nâng pH trong vài tháng, nhưng lượng vôi phụ thuộc thành phần cơ giới và khả năng đệm của đất, cần dựa vào phân tích đất và hướng dẫn địa phương.');
  if (c.key === 'ph' && c.status.endsWith('high'))
    return t('Lowering pH is slow and costly (sulphur, acidifying fertilisers, organic matter); a local agronomist should confirm whether it is worth it.', 'Hạ pH chậm và tốn kém (lưu huỳnh, phân có tính axit, chất hữu cơ); nên hỏi cán bộ nông nghiệp địa phương xem có đáng làm không.');
  if (c.key === 'rain' && c.status.endsWith('low'))
    return t('Rainfall is fixed, but irrigation can make up the shortfall where water is available.', 'Lượng mưa không thay đổi được, nhưng tưới có thể bù phần thiếu nếu có nguồn nước.');
  if (c.key === 'drainage' && c.status === 'mismatch') return t('Drainage can be improved with raised beds, ridges or drains.', 'Có thể cải thiện thoát nước bằng luống cao, vồng hoặc rãnh.');
  if (c.key === 'temp' && c.status !== 'optimal') return t('Temperature cannot be changed; the sowing month and variety are the levers.', 'Nhiệt độ không thay đổi được; tháng gieo và giống là những lựa chọn có thể điều chỉnh.');
  return null;
}

function monthList(months: number[], lang: Lang): string {
  if (months.length === 12) return lang === 'vi' ? 'cả 12 tháng' : 'all twelve months';
  return months.map((m) => (lang === 'vi' ? `T${m}` : MONTHS.en[m - 1].slice(0, 3))).join(', ');
}

// ------------------------------------------------------------------------------------------------

function composeIdeal(store: KnowledgeStore, a: Analysis, hits: Hit[], cite: Citer, ctx?: FieldContext): string[] {
  const t = tr(a.lang);
  const crop = store.crops.get(a.cropIds[0]);
  if (!crop) return [];
  const fc = factsChunk(store, crop.id, a.lang);
  const marker = fc ? cite.cite(fc) : '';
  const name = cropShortName(crop, a.lang);
  // A crop the atlas keeps that EcoCrop has no record of: there is nothing to list, and no quote stands in for it.
  if (crop.ecocropId == null)
    return [
      t(`FAO EcoCrop has no record of ${name} (${crop.sci}), so I have no temperature, rainfall or soil thresholds for it ${marker}.`, `FAO EcoCrop không có bản ghi nào về ${name} (${crop.sci}), nên tôi không có ngưỡng nhiệt độ, lượng mưa hay đất cho cây này ${marker}.`),
      t('Next step: ask the local extension office or a seed supplier what the crop needs where you are.', 'Bước tiếp theo: hỏi trạm khuyến nông địa phương hoặc nơi bán giống về yêu cầu của cây ở vùng bạn.'),
    ];
  const lines = factLines(crop, a.lang);
  const keys = wantedKeys(a.focus);
  const chosen = keys.map((k) => lines.find((l) => l.key === k)).filter((l): l is { key: string; line: string } => Boolean(l));
  const paras: string[] = [];
  if (chosen.length) {
    paras.push(`${t(`What ${name} needs (FAO EcoCrop)`, `${cropLabel(crop, 'vi')} cần gì (FAO EcoCrop)`)} ${marker}:\n${chosen.map((l) => `- ${l.line}`).join('\n')}`);
  } else if (a.focus.length) {
    paras.push(t(`EcoCrop does not record ${a.focus.join(', ')} requirements for ${name}.`, `EcoCrop không ghi yêu cầu về ${a.focus.join(', ')} cho ${name}.`) + ` ${marker}`);
  } else {
    paras.push(t(`EcoCrop records no requirements for ${name}.`, `EcoCrop không ghi yêu cầu nào cho ${name}.`) + ` ${marker}`);
  }
  const missingKeys = keys.filter((k) => !lines.some((l) => l.key === k) && ['temp', 'rain', 'ph'].includes(k));
  if (missingKeys.length && chosen.length) paras.push(t(`EcoCrop has no ${missingKeys.join(', ')} values for ${name}; a local extension office can fill the gap.`, `EcoCrop không có giá trị ${missingKeys.join(', ')} cho ${name}; trạm khuyến nông địa phương có thể bổ sung.`));
  const q = supportingQuotes(hits, a, cite, a.lang, { max: 2, extra: [crop.sci, crop.en ?? ''], sentenceMust: sentenceWords(a.focus) });
  if (q.length) paras.push(q.join(' '));
  if (ctx) {
    const as = assess(crop, ctx);
    if (as.checks.length) {
      const ok = as.checks.filter((c) => c.status === 'optimal' || c.status === 'match').map((c) => t(CHECK_NAME[c.key][0], CHECK_NAME[c.key][1]).toLowerCase());
      const marginal = as.checks.filter((c) => c.status.startsWith('tolerated')).map((c) => t(CHECK_NAME[c.key][0], CHECK_NAME[c.key][1]).toLowerCase());
      const bad = as.checks.filter((c) => c.status.startsWith('outside') || c.status === 'mismatch').map((c) => t(CHECK_NAME[c.key][0], CHECK_NAME[c.key][1]).toLowerCase());
      paras.push(
        t(
          `Against your field (${ctx.parcelName}): optimal for ${ok.join(', ') || 'none'}${marginal.length ? `; tolerated but not optimal for ${marginal.join(', ')}` : ''}${bad.length ? `; outside the tolerated range for ${bad.join(', ')}` : ''}.`,
          `So với ruộng của bạn (${ctx.parcelName}): tối ưu về ${ok.join(', ') || 'không mục nào'}${marginal.length ? `; chịu được nhưng chưa tối ưu về ${marginal.join(', ')}` : ''}${bad.length ? `; vượt ngưỡng chịu được về ${bad.join(', ')}` : ''}.`,
        ),
      );
    }
  }
  paras.push(t(`Next step: compare these ranges with a soil test and your local season before committing land to ${name}.`, `Bước tiếp theo: đối chiếu các ngưỡng này với kết quả phân tích đất và mùa vụ địa phương trước khi quyết định trồng ${name}.`));
  return paras;
}

function composeCompare(store: KnowledgeStore, a: Analysis, hits: Hit[], cite: Citer, ctx?: FieldContext): string[] {
  const t = tr(a.lang);
  const crops = a.cropIds.slice(0, 3).map((id) => store.crops.get(id)).filter((c): c is CropFacts => Boolean(c));
  if (crops.length < 2) return composeIdeal(store, a, hits, cite, ctx);
  const markers = crops.map((c) => {
    const fc = factsChunk(store, c.id, a.lang);
    return fc ? cite.cite(fc) : '';
  });
  const keys = wantedKeys(a.focus);
  const rows: string[] = [];
  for (const k of keys) {
    const parts = crops.map((c, i) => {
      const l = factLines(c, a.lang).find((x) => x.key === k);
      return l ? `${cropShortName(c, a.lang)} ${l.line.replace(/^[^:]+:\s*/, '').replace(/\.$/, '')} ${markers[i]}` : null;
    });
    if (parts.every((p) => p == null)) continue;
    const label = factLines(crops.find((c) => factLines(c, a.lang).some((x) => x.key === k))!, a.lang).find((x) => x.key === k)!.line.split(':')[0];
    rows.push(`- ${label}: ${parts.map((p, i) => p ?? `${cropShortName(crops[i], a.lang)} ${t('not recorded', 'không có số liệu')}`).join('; ')}.`);
  }
  const paras = [`${t('Side by side (FAO EcoCrop):', 'So sánh (FAO EcoCrop):')}\n${rows.join('\n')}`];
  // A plain-language verdict for the focused factor, from the tolerated limits only.
  const verdict = (k: 'ph' | 'rain' | 'temp', lowWins: boolean, en: string, vi: string) => {
    const vals = crops.map((c) => ({ c, v: (k === 'ph' ? c.ph : k === 'rain' ? c.rain : c.temp)?.[0] ?? null })).filter((x) => x.v != null);
    if (vals.length < 2) return;
    vals.sort((x, y) => (lowWins ? x.v! - y.v! : y.v! - x.v!));
    if (vals[0].v === vals[1].v) return;
    paras.push(t(`${cap(cropShortName(vals[0].c, 'en'))} ${en} (tolerated minimum ${vals[0].v} vs ${vals[1].v}).`, `${cap(cropShortName(vals[0].c, 'vi'))} ${vi} (ngưỡng chịu được thấp nhất ${vals[0].v} so với ${vals[1].v}).`));
  };
  if (a.focus.includes('ph')) verdict('ph', true, 'tolerates more acid soil', 'chịu đất chua tốt hơn');
  if (a.focus.includes('rain') || a.focus.includes('water')) verdict('rain', true, 'copes with less rain', 'chịu được ít mưa hơn');
  if (a.focus.includes('temp') || a.focus.includes('frost')) verdict('temp', true, 'tolerates cooler conditions', 'chịu lạnh tốt hơn');
  if (ctx) {
    const summary = crops.map((c) => {
      const as = assess(c, ctx);
      const ok = as.checks.filter((x) => x.status === 'optimal' || x.status === 'match').length;
      return t(`${cropShortName(c, 'en')} is optimal on ${ok} of ${as.checks.length} checked requirements`, `${cropShortName(c, 'vi')} tối ưu ở ${ok}/${as.checks.length} yêu cầu đã kiểm tra`);
    });
    paras.push(`${t('On your field:', 'Trên ruộng của bạn:')} ${summary.join('; ')}.`);
  }
  const q = supportingQuotes(hits, a, cite, a.lang, { max: 1, sentenceMust: sentenceWords(a.focus) });
  if (q.length) paras.push(q.join(' '));
  paras.push(t('Next step: weigh these ranges against water, market and your rotation; the advisory panel compares full strategies.', 'Bước tiếp theo: cân nhắc thêm nguồn nước, thị trường và luân canh; bảng tư vấn so sánh đầy đủ các phương án.'));
  return paras;
}

function composeField(store: KnowledgeStore, a: Analysis, hits: Hit[], cite: Citer, ctx: FieldContext): string[] {
  const t = tr(a.lang);
  const crop = store.crops.get(a.cropIds[0] ?? ctx.cropId ?? '');
  if (!crop) {
    // A field question with no crop to compare with: the readings themselves.
    return [
      ...composeFieldFact(store, { ...a, ask: 'value' }, cite, ctx),
      t('Choose a crop (or name one in the question) and I can compare the readings with what it needs.', 'Hãy chọn cây trồng (hoặc nêu tên trong câu hỏi) để tôi so sánh các số liệu này với yêu cầu của cây.'),
    ];
  }
  const fc = factsChunk(store, crop.id, a.lang);
  const marker = fc ? cite.cite(fc) : '';
  const as = assess(crop, ctx);
  // 'soil' is a broad word: when a specific factor is named too ("soil too acid"), keep only that one.
  const specific = a.focus.filter((f) => f !== 'soil');
  const fs = specific.length ? specific : a.focus;
  const focusKeys = new Set(fs.flatMap((f) => (f === 'water' ? ['rain', 'drainage'] : f === 'soil' ? ['ph', 'texture', 'drainage'] : [f])));
  const primary = focusKeys.size ? as.checks.filter((c) => focusKeys.has(c.key)) : as.checks;
  const others = focusKeys.size ? as.checks.filter((c) => !focusKeys.has(c.key)) : [];
  const paras: string[] = [];
  const name = cropShortName(crop, a.lang);
  if (primary.length) {
    for (const c of primary) {
      const s = [checkSentence(c, crop, a.lang, marker), sourceCaveat(c.key, c.fact, a.lang), manageNote(c, a.lang)].filter(Boolean).join(' ');
      paras.push(s);
      if (c.key === 'temp' && c.goodMonths && c.goodMonths.length < 12)
        paras.push(t(`Months whose normal mean temperature is inside the optimum: ${monthList(c.goodMonths, 'en') || 'none'}.`, `Các tháng có nhiệt độ trung bình nằm trong khoảng tối ưu: ${monthList(c.goodMonths, 'vi') || 'không có'}.`));
    }
  } else if (focusKeys.size) {
    const k = [...focusKeys].find((x) => as.missing.includes(x as Check['key'])) ?? [...focusKeys][0];
    if (CHECK_NAME[k as Check['key']]) {
      // What the crop asks for is still said, so that the missing reading has something to be held against.
      const asked = factLines(crop, a.lang).find((l) => l.key === k)?.line;
      paras.push(
        t(`Your field has no ${CHECK_NAME[k as Check['key']][0].toLowerCase()} reading to compare with ${name}'s requirement ${marker}.`, `Ruộng của bạn chưa có số đo ${CHECK_NAME[k as Check['key']][1].toLowerCase()} để so với yêu cầu của ${name} ${marker}.`) +
          (asked ? ` ${t(`EcoCrop gives for ${name}:`, `EcoCrop ghi cho ${name}:`)} ${asked}` : ''),
      );
    }
  }
  // A reading EcoCrop has nothing comparable for: the field's value on its own, so that the
  // question is answered about the reading that was asked for. EcoCrop knows soil fertility as a
  // class (high, moderate, low), which cannot be held against a figure for organic matter, CEC or
  // nitrogen; it records nothing on slope or bulk density.
  const FERTILITY: Focus[] = ['organic', 'cec', 'nitrogen'];
  const unchecked = fs.filter((f) => FERTILITY.includes(f) || f === 'slope' || f === 'density');
  if (unchecked.length) {
    const { readings, missing } = lookupFieldFacts(ctx, unchecked, [], a.lang);
    paras.push(...readingParagraphs(store, readings, ctx, cite, a.lang), ...missing.map((m) => missingSentence(m, a.lang)));
    const fertility = unchecked.some((f) => FERTILITY.includes(f)) ? factLines(crop, a.lang).find((l) => l.key === 'fertility')?.line : undefined;
    if (fertility)
      paras.push(t(`EcoCrop describes what ${name} needs as a fertility class, not as a figure: ${fertility} A class cannot be held against the reading, so it is given without a verdict.`, `EcoCrop mô tả nhu cầu của ${name} bằng một mức độ phì, không bằng con số: ${fertility} Không so được một mức với số liệu, nên tôi chỉ nêu số liệu, không kết luận.`) + ` ${marker}`);
    else if (readings.length) paras.push(t(`EcoCrop records no requirement on this for ${name}, so the reading is given without a verdict.`, `EcoCrop không ghi yêu cầu nào về mục này cho ${name}, nên tôi chỉ nêu số liệu, không kết luận.`));
  }
  const ph = as.checks.find((c) => c.key === 'ph');
  if (ph && AMEND.test(fold(a.query))) paras.push(amendNote(ph, crop, a.lang));
  if (others.length) {
    const desc = others.map((c) => `${t(CHECK_NAME[c.key][0], CHECK_NAME[c.key][1]).toLowerCase()} ${c.status === 'optimal' || c.status === 'match' ? t('optimal', 'tối ưu') : c.status.startsWith('tolerated') ? t('tolerated', 'chịu được') : t('outside the range', 'ngoài ngưỡng')}`);
    paras.push(`${t('Other requirements for', 'Các yêu cầu khác của')} ${name}: ${desc.join(', ')}.`);
  }
  // Salinity and soil depth come from the US soil survey only: elsewhere they are missing on every
  // field, so they are named as missing when the question is about them and not in every answer.
  const missingHere = as.missing.filter((k) => (k !== 'salinity' && k !== 'depth') || focusKeys.has(k));
  if (missingHere.length) {
    const ms = missingHere.map((k) => `${t(CHECK_NAME[k][0], CHECK_NAME[k][1]).toLowerCase()} (${howToGet(k, a.lang)})`);
    paras.push(`${t('Missing for this comparison:', 'Còn thiếu để so sánh:')} ${ms.join('; ')}.`);
  }
  const q = supportingQuotes(hits, a, cite, a.lang, { max: 1, extra: [crop.sci], sentenceMust: sentenceWords(a.focus) });
  if (q.length) paras.push(q.join(' '));
  if (ctx.facts.data_mode) paras.push(t(`Note: ${ctx.facts.data_mode}.`, `Lưu ý: dữ liệu đang dùng là ${/simulated/.test(ctx.facts.data_mode) ? 'mô phỏng' : 'bộ demo lưu sẵn'}.`));
  const next = as.missing.includes('ph') || /SoilGrids|modelled/i.test(ctx.facts.ph ?? '')
    ? t('Next step: a soil test for pH and texture, then enter it in the Ground-Truth panel so every score uses it.', 'Bước tiếp theo: phân tích pH và thành phần cơ giới đất, rồi nhập vào bảng Số đo thực địa để mọi điểm số dùng giá trị đó.')
    : t(`Next step: check the sowing window for ${name} in the advisory panel.`, `Bước tiếp theo: xem khung thời vụ gieo ${name} trong bảng tư vấn.`);
  paras.push(next);
  return paras;
}

function composeScoreChange(store: KnowledgeStore, a: Analysis, hits: Hit[], cite: Citer, ctx: FieldContext): string[] {
  const t = tr(a.lang);
  const keys = Object.keys(ctx.facts).filter((k) => /^score_\d{4}-\d{2}$/.test(k)).sort();
  if (!keys.length) return [t('There is no score history for this field yet: choose a crop and let the telemetry load, then ask again.', 'Ruộng này chưa có lịch sử điểm: hãy chọn cây trồng và chờ dữ liệu tải xong rồi hỏi lại.')];
  const val = (k: string) => Number(ctx.facts[k].match(/^(\d+)/)?.[1] ?? NaN);
  let idx: number;
  if (a.months.length) {
    const m = String(a.months[0]).padStart(2, '0');
    idx = keys.map((k, i) => ({ k, i })).filter((x) => x.k.endsWith(`-${m}`)).pop()?.i ?? -1;
  } else {
    // No month named: the largest month-on-month drop.
    idx = -1;
    let worst = 0;
    for (let i = 1; i < keys.length; i++) {
      const d = val(keys[i]) - val(keys[i - 1]);
      if (d < worst) {
        worst = d;
        idx = i;
      }
    }
  }
  const paras: string[] = [];
  const g = store.chunks.get(`gloss-${a.lang}:productivity-score`);
  const gm = g ? cite.cite(g) : '';
  if (idx < 0) {
    paras.push(t(`I have monthly scores for ${keys[0].slice(6)} to ${keys[keys.length - 1].slice(6)}, but none for that month.`, `Tôi có điểm theo tháng từ ${keys[0].slice(6)} đến ${keys[keys.length - 1].slice(6)}, nhưng không có tháng đó.`));
  } else {
    const k = keys[idx];
    const [y, mm] = k.slice(6).split('-').map(Number);
    const monthName = `${MONTHS[a.lang][mm - 1]} ${y}`;
    const cur = ctx.facts[k];
    const prevK = keys[idx - 1];
    const lim = cur.match(/limiting (.+)$/)?.[1];
    let s = t(`In ${monthName} the productivity score was ${cur.split(';')[0]}`, `Vào ${monthName}, điểm năng suất là ${cur.split(';')[0]}`);
    if (prevK) {
      const d = val(k) - val(prevK);
      s += d < 0 ? t(`, down ${-d} points from ${val(prevK)} the month before`, `, giảm ${-d} điểm so với ${val(prevK)} của tháng trước`) : d > 0 ? t(`, up ${d} points from ${val(prevK)}`, `, tăng ${d} điểm so với ${val(prevK)}`) : t(', unchanged from the month before', ', không đổi so với tháng trước');
    }
    s += lim ? t(`. The limiting factor that month was ${lim} (0 = fails, 1 = ideal).`, `. Yếu tố giới hạn trong tháng đó là ${lim} (0 = không đạt, 1 = lý tưởng).`) : '.';
    paras.push(`${s} ${t('(field score timeline)', '(dòng thời gian điểm của ruộng)')}`);
    const prevLim = prevK ? ctx.facts[prevK].match(/limiting (.+)$/)?.[1] : undefined;
    if (lim && prevLim && prevLim.split(' ')[0] !== lim.split(' ')[0]) paras.push(t(`The month before, the limiting factor was ${prevLim}.`, `Tháng trước đó, yếu tố giới hạn là ${prevLim}.`));
    if (lim && /water|moisture|rain|nước|ẩm|mưa/i.test(lim)) {
      const sm = store.chunks.get(`gloss-${a.lang}:soil-moisture-anomaly`) ?? store.chunks.get(`gloss-${a.lang}:soil-moisture`);
      if (sm) paras.push(t(`Water limits usually mean root-zone moisture fell below its normal band for the season; SMAP's 9 km pixel shows that regional departure, not the field's exact water content ${cite.cite(sm)}.`, `Giới hạn về nước thường nghĩa là độ ẩm vùng rễ xuống dưới mức bình thường của mùa; điểm ảnh 9 km của SMAP cho thấy độ lệch của cả vùng, không phải lượng nước chính xác trong ruộng ${cite.cite(sm)}.`));
    }
  }
  paras.push(t(`The score combines site compatibility with the growing condition at each date; the limiting factor is the one holding it down most ${gm}.`, `Điểm kết hợp mức phù hợp của khu đất với điều kiện sinh trưởng tại từng ngày; yếu tố giới hạn là yếu tố kéo điểm xuống nhiều nhất ${gm}.`));
  if (ctx.facts.data_mode) paras.push(t(`Note: ${ctx.facts.data_mode}.`, 'Lưu ý: dữ liệu đang dùng không phải dữ liệu trực tiếp.'));
  paras.push(t('Next step: move the timeline cursor to that month and open the limiting branch to see the reading and its confidence.', 'Bước tiếp theo: kéo con trỏ thời gian đến tháng đó và mở nhánh giới hạn để xem số đo và độ tin cậy.'));
  void hits;
  return paras;
}

function composeTerm(store: KnowledgeStore, a: Analysis, hits: Hit[], cite: Citer, ctx?: FieldContext): string[] {
  const t = tr(a.lang);
  const paras: string[] = [];
  const termId = a.termIds[0] ?? hits.find((h) => chunkKind(h.chunk) === 'glossary')?.chunk.tags?.find((x) => x.startsWith('term:'))?.slice(5);
  const g = termId ? (store.chunks.get(`gloss-${a.lang}:${termId}`) ?? store.chunks.get(`gloss-${a.lang}:${termId}:0`)) : undefined;
  const used = new Set<string>();
  if (g) {
    used.add(g.id);
    used.add(g.docId);
    // The opening of a glossary entry is the definition; keep it intact rather than cherry-picking.
    const ss = g.text.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
    paras.push(`${ss} ${cite.cite(g, ss)}`);
    const rest = bestSentences({ ...g, text: g.text.split(/(?<=[.!?])\s+/).slice(3).join(' ') }, [...terms(a.query), ...a.expansion], 2, ['pixel', 'normal', 'điểm ảnh', 'bình thường']);
    if (rest.length) paras.push(`${rest.join(' ')} ${cite.cite(g)}`);
  }
  const q = supportingQuotes(hits, a, cite, a.lang, { max: g ? 1 : 2, kinds: ['concept', 'glossary', 'wiki'], skip: used });
  if (q.length) paras.push(q.join(' '));
  if (ctx && termId) {
    const lines = (TERM_FACTS[termId] ?? []).filter((k) => ctx.facts[k]).map((k) => `${k} = ${ctx.facts[k]}`);
    if (lines.length) paras.push(`${t('On your field:', 'Trên ruộng của bạn:')} ${lines.join('; ')}.`);
  }
  if (!paras.length) return [];
  paras.push(t('Next step: open the matching HUD branch to see this reading over the year against its normal band.', 'Bước tiếp theo: mở nhánh tương ứng trên HUD để xem số đo này trong năm so với dải bình thường.'));
  return paras;
}

function rotationCandidates(store: KnowledgeStore, crop: CropFacts, ctx?: FieldContext): CropFacts[] {
  const legume = /fabaceae|leguminosae|papilionaceae|mimosaceae|caesalpiniaceae/i.test(crop.family ?? '');
  const perennial = /perennial/.test(crop.lifeSpan ?? '') && !/annual/.test(crop.lifeSpan ?? '');
  const pool = [...store.crops.values()].filter((c) => c.curated && c.id !== crop.id && c.family !== crop.family);
  const isLegume = (c: CropFacts) => /fabaceae|leguminosae|papilionaceae/i.test(c.family ?? '');
  const shortCycle = (c: CropFacts) => !(/perennial/.test(c.lifeSpan ?? '') && !/annual/.test(c.lifeSpan ?? ''));
  const coverLike = (c: CropFacts) => /forage|pasture|manure|cover/i.test(c.category ?? '') || /cover|forage|green manure/i.test(c.usesMain ?? '');
  let cands = perennial ? pool.filter((c) => isLegume(c) && (coverLike(c) || shortCycle(c))).sort((x, y) => Number(coverLike(y)) - Number(coverLike(x))) : legume ? pool.filter((c) => !isLegume(c) && shortCycle(c)) : pool.filter((c) => isLegume(c) && shortCycle(c));
  const fits = (c: CropFacts) => {
    if (ctx) {
      const as = assess(c, ctx);
      return as.checks.filter((x) => x.status.startsWith('outside') || x.status === 'mismatch').length === 0 ? as.checks.filter((x) => x.status === 'optimal' || x.status === 'match').length + 1 : 0;
    }
    // Without a field: overlap of optimal temperature windows with the crop being rotated.
    const a = crop.temp;
    const b = c.temp;
    if (!a || !b || a[1] == null || a[2] == null || b[1] == null || b[2] == null) return 0.5;
    return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[1], b[1]));
  };
  cands = cands.map((c) => ({ c, s: fits(c) > 0 ? fits(c) + (perennial && coverLike(c) ? 10 : 0) : 0 })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.c);
  return cands.slice(0, 3);
}

function composeRotation(store: KnowledgeStore, a: Analysis, hits: Hit[], cite: Citer, ctx?: FieldContext): string[] {
  const t = tr(a.lang);
  const paras: string[] = [];
  const crop = store.crops.get(a.cropIds[0] ?? ctx?.cropId ?? '');
  const basics = store.chunks.get(`gloss-${a.lang}:${/cover|che phu|phan xanh/i.test(a.query) ? 'cover-crop-basics' : 'crop-rotation-basics'}`);
  if (crop) {
    const name = cropShortName(crop, a.lang);
    const perennial = /perennial/.test(crop.lifeSpan ?? '') && !/annual/.test(crop.lifeSpan ?? '');
    const cands = rotationCandidates(store, crop, ctx);
    if (cands.length) {
      const list = cands.map((c) => {
        const fc = factsChunk(store, c.id, a.lang);
        const ph = factLines(c, a.lang).find((l) => l.key === 'ph')?.line.replace(/\.$/, '');
        return `- ${cropShortName(c, a.lang)} (${c.family ?? '?'}${ph ? `; ${ph}` : ''}) ${fc ? cite.cite(fc) : ''}`;
      });
      const why = perennial
        ? t(`${cap(name)} is a perennial, so the usual partner is a low legume cover or intercrop between rows rather than a rotation. Candidates from a different family that`, `${cap(name)} là cây lâu năm, nên thường dùng cây họ đậu thấp che phủ hoặc trồng xen giữa hàng thay vì luân canh. Các cây khác họ`)
        : /fabaceae|leguminosae/i.test(crop.family ?? '')
          ? t(`${cap(name)} is a legume, so a non-legume (cereal, root or vegetable) is the usual next crop to use the nitrogen it leaves. Candidates that`, `${cap(name)} là cây họ đậu, nên vụ sau thường là cây không thuộc họ đậu (ngũ cốc, củ hoặc rau) để tận dụng đạm để lại. Các cây`)
          : t(`After ${name}, a legume that fixes nitrogen and breaks pest cycles is the usual partner. Candidates from a different family that`, `Sau ${name}, cây họ đậu cố định đạm và cắt vòng sâu bệnh là lựa chọn thường gặp. Các cây khác họ`);
      paras.push(`${why} ${ctx ? t('fit your field\'s readings (EcoCrop):', 'phù hợp số đo ruộng bạn (EcoCrop):') : t(`share ${name}'s temperature window (EcoCrop):`, `có cùng khoảng nhiệt độ với ${name} (EcoCrop):`)}\n${list.join('\n')}`);
    } else {
      paras.push(t(`I found no curated crop from another family that fits ${ctx ? 'your field' : `${name}'s climate window`} without a hard limit.`, `Tôi không tìm thấy cây nào khác họ phù hợp ${ctx ? 'ruộng của bạn' : `khí hậu của ${name}`} mà không vượt ngưỡng.`));
    }
  }
  const ROT = ['rotation', 'luan canh', 'nitrogen', 'dam', 'cover crop', 'che phu', 'intercrop', 'xen canh', 'green manure', 'phan xanh', 'legume', 'ho dau'];
  const q = supportingQuotes(hits, a, cite, a.lang, { max: 2, extra: ROT, mustMention: ROT });
  if (q.length) paras.push(q.join(' '));
  else if (basics) {
    const s = basics.text.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
    paras.push(`${s} ${cite.cite(basics, s)}`);
  }
  paras.push(t('Rotation choices also depend on water, market and labour; check them with the advisory panel and a local agronomist.', 'Lựa chọn luân canh còn phụ thuộc nguồn nước, thị trường và nhân công; hãy kiểm tra với bảng tư vấn và cán bộ nông nghiệp địa phương.'));
  return paras;
}

const CARE_WORDS = ['sow', 'plant', 'harvest', 'fertili', 'prun', 'spacing', 'weed', 'irrigat', 'seed', 'transplant', 'gieo', 'trong', 'thu hoach', 'bon', 'tia', 'tuoi', 'mat do', 'cay con', 'giong'];

/** A question about how much of a crop there is, or where: "harvested area", "diện tích", "which countries". */
const WHERE_WORDS = /\b(area|hectares?|countr(?:y|ies)|where|dien tich|hecta|nuoc nao|o dau)\b|\bha\b/;

function composeCare(store: KnowledgeStore, a: Analysis, hits: Hit[], cite: Citer, ctx?: FieldContext): string[] {
  const t = tr(a.lang);
  const crop = store.crops.get(a.cropIds[0] ?? ctx?.cropId ?? '');
  const paras: string[] = [];
  if (crop) {
    const fc = factsChunk(store, crop.id, a.lang);
    const name = cropShortName(crop, a.lang);
    if (crop.cycle && fc) paras.push(t(`${cap(name)} takes ${crop.cycle[0]}-${crop.cycle[1]} days from sowing to harvest ${cite.cite(fc)}.`, `${cap(name)} cần ${crop.cycle[0]}-${crop.cycle[1]} ngày từ gieo đến thu hoạch ${cite.cite(fc)}.`));
    const monthlyRain = ctx?.facts.climate_monthly_rain;
    if (monthlyRain && !/perennial/.test(crop.lifeSpan ?? '')) {
      const r = monthlyRain.match(/(\w{3}) (\d+(?:\.\d+)?)/g)?.map((x) => Number(x.split(' ')[1])) ?? [];
      const starts: number[] = [];
      for (let m = 0; m < r.length; m++) if (r[m] >= 100 && r[(m + 11) % 12] < 100) starts.push(m + 1);
      if (starts.length) paras.push(t(`On your field the rains normally pick up (above 100 mm/month) in ${monthList(starts, 'en')} (${monthlyRain.replace(/^.*\(/, '(')}); rain-fed sowing is usually timed to that start. The advisory panel's sowing window scores each month.`, `Ở ruộng của bạn, mùa mưa thường bắt đầu (trên 100 mm/tháng) vào ${monthList(starts, 'vi')} (${monthlyRain.replace(/^.*\(/, '(')}); gieo nhờ mưa thường căn theo thời điểm này. Khung thời vụ trong bảng tư vấn chấm điểm từng tháng.`));
    }
  }
  // The sheet on where the crop is grown is given whole or not at all: two sentences picked from
  // it would leave out the one that says whose figures they are (an item shared by several crops).
  // It is taken by its id, not from the hits: a question about the area may rank other passages first.
  const where = crop && WHERE_WORDS.test(fold(a.query)) ? store.chunks.get(`eco:${crop.id}:where${a.lang === 'vi' ? '-vi' : ''}`) : undefined;
  if (crop && where) {
    const lines = whereLines(crop, a.lang);
    if (lines.length) paras.push(`${lines.join(' ')} ${cite.cite(where, lines.join(' '), hits.find((h) => h.chunk.id === where.id)?.score)}`);
  }
  const qTerms = [...terms(a.query), ...a.expansion];
  let n = 0;
  for (const h of hits) {
    if (n >= 2) break;
    const kind = chunkKind(h.chunk);
    if (kind === 'facts' || kind === 'where' || !mentions(h.chunk.text, CARE_WORDS)) continue;
    const ss = bestSentences(h.chunk, qTerms, 2, CARE_WORDS);
    if (!ss.length) continue;
    paras.push(`${ss.map((s) => quote(s, h.chunk, a.lang)).join(' ')} ${cite.cite(h.chunk, ss.join(' '), h.score)}`);
    n++;
  }
  paras.push(t('Do not take pesticide products or doses from here: describe the problem to the local plant-protection office, which knows the registered options.', 'Không lấy tên thuốc hay liều lượng từ đây: hãy mô tả vấn đề với trạm bảo vệ thực vật địa phương, nơi nắm các thuốc được phép sử dụng.'));
  return paras;
}

function composeGeneral(_store: KnowledgeStore, a: Analysis, hits: Hit[], cite: Citer): string[] {
  const t = tr(a.lang);
  const q = supportingQuotes(hits, a, cite, a.lang, { max: 3 });
  if (!q.length) return [];
  return [
    t('Here is what the knowledge base says:', 'Đây là thông tin trong cơ sở kiến thức:'),
    ...q,
    t('If this does not answer it, name the crop or the reading you mean and I can be more specific.', 'Nếu chưa đúng ý, hãy nêu tên cây trồng hoặc số đo bạn muốn hỏi để tôi trả lời cụ thể hơn.'),
  ];
}

/**
 * A species the crop atlas does not keep: say so, and why, in the words of the atlas's two reasons
 * (data/crops/atlas/dropped.csv). No number is given: the assistant holds none for the species.
 */
function composeDropped(dropped: DroppedMention[], lang: Lang): string[] {
  const t = tr(lang);
  const named = dropped.slice(0, 2);
  const paras = named.map((d) => {
    const alias = fold(d.alias) === fold(d.sci) ? '' : t(` ("${d.alias}")`, ` ("${d.alias}")`);
    const why =
      d.reason === 'group-only'
        ? t(
            'FAOSTAT counts it only inside an item that groups several crops, and FAO EcoCrop does not describe it as grown on a large or a small scale, so the crop atlas did not keep it.',
            'FAOSTAT chỉ tính loài này trong một mặt hàng gộp nhiều cây, và FAO EcoCrop không mô tả nó là cây được trồng trên quy mô lớn hay nhỏ, nên atlas cây trồng không giữ lại.',
          )
        : t(
            // What the atlas found, and no more: no item names the species. That is not a finding that nobody grows it.
            'FAO EcoCrop describes it, but no statistical item of FAOSTAT names it, by its scientific name or by a common name, so the crop atlas has no figures for it and does not keep it. That says nothing about whether it is grown.',
            'FAO EcoCrop có mô tả loài này, nhưng không mặt hàng thống kê nào của FAOSTAT nêu tên nó, theo tên khoa học hay tên thường gọi, nên atlas cây trồng không có số liệu về loài này và không giữ lại. Điều đó không nói lên loài này có được trồng hay không.',
          );
    return t(`${d.sci}${alias} is not in Astrovivu's crop data. ${why}`, `${d.sci}${alias} không có trong dữ liệu cây trồng của Astrovivu. ${why}`);
  });
  paras.push(
    t(
      'I therefore have no requirements, countries or prices for it, and I will not answer from a look-alike. If it is grown where you are, ask the local extension office; name another crop and I can answer for that one.',
      'Vì vậy tôi không có yêu cầu sinh thái, nước trồng hay giá của loài này, và sẽ không trả lời thay bằng một cây trông giống. Nếu nơi bạn có trồng, hãy hỏi trạm khuyến nông địa phương; hãy nêu một cây khác và tôi sẽ trả lời cho cây đó.',
    ),
  );
  return paras;
}

/** What the assistant says when it declines, by reason (docs/RAG.md, scope table). */
function declined(reason: OutOfScope, lang: Lang): string {
  const t = tr(lang);
  switch (reason) {
    case 'photo-diagnosis':
      return t(
        'I cannot look at a photo or diagnose a pest or disease from a description. I can tell you what the readings of your field say (soil, moisture, weather risk) and what a crop needs; for a diagnosis take a sample or a photo to the local plant-protection office.',
        'Tôi không xem được ảnh và không chẩn đoán được sâu bệnh qua mô tả. Tôi có thể cho biết số liệu của ruộng bạn (đất, độ ẩm, rủi ro thời tiết) và yêu cầu của cây trồng; để chẩn đoán, hãy mang mẫu hoặc ảnh tới trạm bảo vệ thực vật địa phương.',
      );
    case 'price-forecast':
      return t(
        'I do not forecast prices. The prices in the economics panel are published reference values with their year and source, not predictions; for the coming days ask a local buyer or the commodity exchange.',
        'Tôi không dự báo giá. Giá trong bảng kinh tế là giá tham chiếu đã công bố, có năm và nguồn, không phải dự đoán; giá những ngày tới hãy hỏi thương lái địa phương hoặc sàn giao dịch nông sản.',
      );
    case 'legal':
      return t(
        'I do not give legal advice (land rights, contracts, disputes). The commune or district office and a lawyer are the right places; I can help with the crop, soil and water side of the question.',
        'Tôi không tư vấn pháp lý (quyền sử dụng đất, hợp đồng, tranh chấp). Hãy hỏi uỷ ban xã, phường hoặc luật sư; tôi có thể giúp phần cây trồng, đất và nước của câu hỏi.',
      );
    case 'pesticide-dose':
      return t(
        'I do not name pesticide products or doses: describe the problem to the local plant-protection office, which knows the registered options. I can tell you what the crop needs and what the readings of your field say.',
        'Tôi không nêu tên thuốc hay liều lượng thuốc bảo vệ thực vật: hãy mô tả vấn đề với trạm bảo vệ thực vật địa phương, nơi nắm các thuốc được phép sử dụng. Tôi có thể cho biết yêu cầu của cây và số liệu của ruộng bạn.',
      );
    default:
      return t('That is outside what I can help with here: I answer questions about crops, soil, water and the readings for your field.', 'Câu hỏi này nằm ngoài phạm vi tôi có thể giúp: tôi trả lời về cây trồng, đất, nước và các số đo của ruộng bạn.');
  }
}

// ------------------------------------------------------------------------------------------------

export function composeExtractive(store: KnowledgeStore, a: Analysis, hits: Hit[], ctx?: FieldContext): AskResult {
  const t = tr(a.lang);
  const cite = new Citer();
  let paras: string[] = [];
  let confidence = 0;
  if (a.intent === 'off-topic') {
    paras = [declined(a.outOfScope ?? 'other', a.lang)];
  } else if (a.intent === 'dropped' && a.dropped?.length) {
    paras = composeDropped(a.dropped, a.lang);
    confidence = 0.6;
  } else {
    const run = (): string[] => {
      switch (a.intent) {
        case 'ideal':
          return composeIdeal(store, a, hits, cite, ctx);
        case 'compare':
          return composeCompare(store, a, hits, cite, ctx);
        case 'field':
          return ctx ? composeField(store, a, hits, cite, ctx) : composeIdeal(store, a, hits, cite);
        case 'field-fact':
          return composeFieldFact(store, a, cite, ctx);
        case 'score-change':
          return ctx ? composeScoreChange(store, a, hits, cite, ctx) : [];
        case 'term':
          return composeTerm(store, a, hits, cite, ctx);
        case 'rotation':
          return composeRotation(store, a, hits, cite, ctx);
        case 'care':
          return composeCare(store, a, hits, cite, ctx);
        default:
          return composeGeneral(store, a, hits, cite);
      }
    };
    paras = run();
    if (!paras.length) paras = composeGeneral(store, a, hits, cite);
    const base: Record<string, number> = { ideal: 0.8, compare: 0.75, field: 0.7, 'field-fact': 0.7, 'score-change': 0.65, term: 0.75, rotation: 0.6, care: 0.5, general: 0.4 };
    confidence = paras.length ? (base[a.intent] ?? 0.4) * (cite.list.length ? 1 : 0.6) : 0;
    if (!ctx && a.intent !== 'field-fact' && (a.intent === 'field' || a.aboutField)) paras.push(t('No field is locked, so this answer uses reference knowledge only.', 'Chưa khoá thửa ruộng nào, nên câu trả lời chỉ dựa trên kiến thức tham khảo.'));
  }
  if (!paras.length) {
    paras = [t("I could not find this in Astrovivu's knowledge base. Try naming the crop (for example 'soybean') or the reading (for example 'root-zone moisture').", "Tôi không tìm thấy thông tin này trong cơ sở kiến thức của Astrovivu. Hãy thử nêu tên cây (ví dụ 'đậu nành') hoặc số đo (ví dụ 'độ ẩm vùng rễ').")];
    confidence = 0.1;
  }
  return {
    answer: paras.join('\n\n'),
    mode: 'extractive',
    citations: cite.list,
    followUps: followUps(store, a, ctx),
    confidence: Number(confidence.toFixed(2)),
  };
}
