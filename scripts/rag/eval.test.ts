/** Retrieval regression guard over data/rag/eval.json (see docs/RAG.md for the full table). */
import { beforeAll, describe, expect, it } from 'vitest';
import type { KnowledgeStore } from '../../src/rag/store';
import { hasTarget, loadEval, loadStore, routingErrors, runVariant, VARIANTS } from './eval';

let store: KnowledgeStore;
const all = loadEval();
/** Retrieval is scored on the questions that have something to retrieve. */
const qs = all.filter(hasTarget);
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
    const withIntent = all.filter((q) => q.intent);
    const ok = withIntent.filter((q) => !routingErrors(store, { id: q.id, lang: q.lang, q: q.q, field: q.field, intent: q.intent }).length);
    expect(ok.length / withIntent.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('questions about the field itself (scope table of docs/RAG.md)', () => {
  const field = all.filter((q) => q.group);

  it('has at least four questions for every group, in both languages', () => {
    const groups = new Set(field.map((q) => q.group));
    expect(groups).toEqual(new Set(['soil', 'terrain', 'climate', 'risk', 'source', 'contrast', 'declined']));
    for (const g of groups) {
      const sub = field.filter((q) => q.group === g);
      expect(sub.length, g).toBeGreaterThanOrEqual(4);
      expect(sub.some((q) => q.lang === 'en'), g).toBe(true);
      expect(sub.some((q) => q.lang === 'vi'), g).toBe(true);
    }
  });

  it('routes every one to the expected intent, kind of question and focus', () => {
    expect(field.flatMap((q) => routingErrors(store, q).map((e) => `${q.id}: ${e}`))).toEqual([]);
  });
});
