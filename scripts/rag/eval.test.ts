/** Retrieval regression guard over data/rag/eval.json (see docs/RAG.md for the full table). */
import { beforeAll, describe, expect, it } from 'vitest';
import type { KnowledgeStore } from '../../src/rag/store';
import { analyze } from '../../src/rag/retrieve';
import { FIXTURE_CONTEXT, loadEval, loadStore, runVariant, VARIANTS } from './eval';

let store: KnowledgeStore;
const qs = loadEval();
beforeAll(async () => {
  store = await loadStore();
});

describe('retrieval eval', () => {
  it('has at least 40 questions, half of them Vietnamese, some about the field', () => {
    expect(qs.length).toBeGreaterThanOrEqual(40);
    expect(qs.filter((q) => q.lang === 'vi').length).toBeGreaterThanOrEqual(qs.length / 2 - 1);
    expect(qs.filter((q) => q.field).length).toBeGreaterThanOrEqual(4);
  });

  it('full pipeline keeps recall@5 >= 0.95 and MRR >= 0.90', () => {
    const r = runVariant(store, qs, VARIANTS[VARIANTS.length - 1]);
    expect(r.misses).toEqual([]);
    expect(r.recall5).toBeGreaterThanOrEqual(0.95);
    expect(r.mrr).toBeGreaterThanOrEqual(0.9);
  });

  it('Vietnamese questions do as well as English ones', () => {
    const v = VARIANTS[VARIANTS.length - 1];
    expect(runVariant(store, qs.filter((q) => q.lang === 'vi'), v).recall5).toBeGreaterThanOrEqual(0.95);
  });

  it('routes at least 90% of questions to the expected intent', () => {
    const withIntent = qs.filter((q) => q.intent);
    const ok = withIntent.filter((q) => {
      const ctx = q.field ? FIXTURE_CONTEXT : undefined;
      return analyze(store, q.q, q.lang, Boolean(ctx), ctx?.cropId).intent === q.intent;
    });
    expect(ok.length / withIntent.length).toBeGreaterThanOrEqual(0.9);
  });
});
