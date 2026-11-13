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

  it('reaches a non-curated EcoCrop species through the lazy full index', async () => {
    const r = await answerExtractive(store, { query: 'Does quinoa tolerate salinity?', lang: 'en' });
    expect(store.hasFull).toBe(true);
    expect(r.citations[0].chunkId).toBe('eco:chenopodium-quinoa:facts');
    expect(r.answer).toContain('Salinity');
  });
});
