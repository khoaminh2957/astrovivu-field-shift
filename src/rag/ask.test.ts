/**
 * End-to-end extractive answers over the built index (public/rag). Requires `npm run rag:build`.
 */
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_CONTEXT } from '../../scripts/rag/eval';
import { fileLoader } from '../../server/loader';
import { answerExtractive } from './engine';
import { KnowledgeStore } from './store';

let store: KnowledgeStore;
beforeAll(async () => {
  store = new KnowledgeStore(fileLoader(path.resolve(import.meta.dirname, '../../public/rag')));
  await store.ensureCore();
});

describe('extractive answers', () => {
  it('answers an English crop question with EcoCrop numbers and citations', async () => {
    const r = await answerExtractive(store, { query: 'What are the ideal conditions for soybean?', lang: 'en' });
    expect(r.mode).toBe('extractive');
    expect(r.answer).toContain('Soil pH: optimal 5.5-6.5');
    expect(r.answer).toContain('[S1]');
    expect(r.citations[0].chunkId).toBe('eco:glycine-max:facts');
    expect(r.citations[0].license).toMatch(/FAO/);
    expect(r.followUps.length).toBeGreaterThanOrEqual(2);
  });

  it('answers a Vietnamese crop question in Vietnamese', async () => {
    const r = await answerExtractive(store, { query: 'Cà phê vối cần bao nhiêu lượng mưa?', lang: 'vi' });
    expect(r.answer).toMatch(/Lượng mưa năm: tối ưu \d+-\d+ mm/);
    expect(r.citations[0].chunkId).toBe('eco:coffea-canephora:facts-vi');
  });

  it('compares the field pH with the crop window and names the source', async () => {
    const r = await answerExtractive(store, { query: 'Is my soil too acid for soybean?', lang: 'en', context: FIXTURE_CONTEXT });
    expect(r.retrieval.analysis.intent).toBe('field');
    expect(r.answer).toContain('5.6 (SoilGrids');
    expect(r.answer).toContain("inside soybean's optimal range (optimal 5.5-6.5");
    expect(r.answer).toMatch(/soil test/);
  });

  it('explains a score drop from the monthly score facts', async () => {
    const r = await answerExtractive(store, { query: 'Vì sao điểm năng suất giảm vào tháng 3?', lang: 'vi', context: FIXTURE_CONTEXT });
    expect(r.answer).toContain('giảm 22 điểm');
    expect(r.answer).toContain('Water 0.41');
    expect(r.citations.some((c) => c.chunkId === 'gloss-vi:productivity-score')).toBe(true);
  });

  it('explains a term and ties it to the field reading', async () => {
    const r = await answerExtractive(store, { query: 'What does root-zone moisture mean here?', lang: 'en', context: FIXTURE_CONTEXT });
    expect(r.citations[0].chunkId).toBe('gloss-en:soil-moisture');
    expect(r.answer).toContain('sm_root = 0.21 m³/m³ (SMAP L4, 9 km pixel');
  });

  it('declines off-topic questions without citations', async () => {
    const r = await answerExtractive(store, { query: 'What is the bitcoin price today?', lang: 'en' });
    expect(r.retrieval.analysis.intent).toBe('off-topic');
    expect(r.citations).toEqual([]);
  });

  it('says that a species the atlas dropped is not in the data, and why, without a number', async () => {
    // Aibika (Abelmoschus manihot) is in dropped.csv: no FAOSTAT crop item names it.
    const vi = await answerExtractive(store, { query: 'aibika trồng thế nào?', lang: 'vi' });
    expect(vi.retrieval.analysis.intent).toBe('dropped');
    expect(vi.retrieval.analysis.dropped).toEqual([{ id: 'abelmoschus-manihot', sci: 'Abelmoschus manihot', reason: 'no-item', alias: 'aibika', start: 0, end: 1 }]);
    expect(vi.answer).toMatch(/^Abelmoschus manihot \("aibika"\) không có trong dữ liệu cây trồng của Astrovivu\./);
    expect(vi.answer).toContain('không mặt hàng cây trồng nào của FAOSTAT gọi tên nó');
    expect(vi.answer).not.toMatch(/\d/);
    expect(vi.citations).toEqual([]);
    const en = await answerExtractive(store, { query: 'How do I grow aibika?', lang: 'en' });
    expect(en.answer).toMatch(/^Abelmoschus manihot \("aibika"\) is not in Astrovivu's crop data\./);
    expect(en.answer).toContain('no FAOSTAT crop item names it');
    expect(en.answer).not.toMatch(/\d/);
    // By its scientific name as well, and then the name is not repeated in brackets. "Manihot" alone
    // is cassava, a kept crop; inside the longer name it is not.
    const sci = await answerExtractive(store, { query: 'What does Abelmoschus manihot need?', lang: 'en' });
    expect(sci.retrieval.analysis.cropIds).toEqual([]);
    expect(sci.answer).toMatch(/^Abelmoschus manihot is not in Astrovivu's crop data\./);
    expect((await answerExtractive(store, { query: 'What does manihot need?', lang: 'en' })).retrieval.analysis.cropIds).toEqual(['manihot-esculenta']);
    // "Bush cabbage" is a name of aibika, not a cabbage.
    expect((await answerExtractive(store, { query: 'How do I grow bush cabbage?', lang: 'en' })).retrieval.analysis.intent).toBe('dropped');
  });

  it('gives the other reason for a species named only inside a FAOSTAT group', async () => {
    // Chervil (Anthriscus cerefolium): FAOSTAT counts it in "Other vegetables, fresh n.e.c.", and EcoCrop does not describe it as cultivated.
    const r = await answerExtractive(store, { query: 'What conditions does Anthriscus cerefolium need?', lang: 'en' });
    expect(r.retrieval.analysis.dropped?.[0]).toMatchObject({ id: 'anthriscus-cerefolium', reason: 'group-only' });
    expect(r.answer).toContain('FAOSTAT counts it only inside an item that groups several crops');
    expect(r.answer).not.toMatch(/\d/);
  });

  it('does the same for the four crops that left the curated list, under the names they had', async () => {
    for (const [query, lang, sci] of [
      ['Is macadamia suitable for acid soil?', 'en', 'Macadamia integrifolia'],
      ['Đậu ván cần điều kiện gì?', 'vi', 'Lablab purpureus'],
      ['What can I rotate with white clover?', 'en', 'Trifolium repens'],
      ['Cỏ stylo trồng thế nào?', 'vi', 'Stylosanthes guianensis var. guianensis'],
    ] as const) {
      const r = await answerExtractive(store, { query, lang });
      expect(r.retrieval.analysis.intent, query).toBe('dropped');
      expect(r.answer.startsWith(sci), query).toBe(true);
      expect(r.answer, query).not.toMatch(/\d/);
    }
  });

  it('leaves a kept crop, a term and a field question alone', async () => {
    // Okra is the kept relative of aibika; "bush" and "cabbage" are words of aibika's other names.
    expect((await answerExtractive(store, { query: 'What does okra need?', lang: 'en' })).retrieval.analysis).toMatchObject({ intent: 'ideal', cropIds: ['abelmoschus-esculentus'] });
    expect((await answerExtractive(store, { query: 'What conditions does cabbage need?', lang: 'en' })).retrieval.analysis.intent).toBe('ideal');
    expect((await answerExtractive(store, { query: 'What is NDVI?', lang: 'en' })).retrieval.analysis.intent).toBe('term');
    expect((await answerExtractive(store, { query: 'What is the pH of my soil?', lang: 'en', context: FIXTURE_CONTEXT })).retrieval.analysis.intent).toBe('field-fact');
  });

  it('answers for the crop EcoCrop has no record of with what is known, not with a quote about something else', async () => {
    const r = await answerExtractive(store, { query: 'Cúc vạn thọ cần điều kiện gì?', lang: 'vi' });
    expect(r.retrieval.analysis.cropIds).toEqual(['tagetes-erecta']);
    expect(r.answer).toMatch(/^FAO EcoCrop không có bản ghi nào về cúc vạn thọ \(Tagetes erecta\)/);
    expect(r.citations.map((c) => c.chunkId)).toEqual(['eco:tagetes-erecta:facts']);
    expect(r.citations[0].source).toBe('Astrovivu crop atlas');
  });

  it('reaches a non-curated EcoCrop species through the lazy full index', async () => {
    const r = await answerExtractive(store, { query: 'Does quinoa tolerate salinity?', lang: 'en' });
    expect(store.hasFull).toBe(true);
    expect(r.citations[0].chunkId).toBe('eco:chenopodium-quinoa:facts');
    expect(r.answer).toContain('Salinity');
  });
});
