/**
 * Retrieval + extractive answering over a KnowledgeStore. Shared by the browser (`ask`) and the
 * API server, so both modes ground on exactly the same passages.
 */
import type { AskRequest, AskResult } from '@/contracts';
import { composeExtractive } from './compose';
import { analyze, type Analysis, type Hit, search } from './retrieve';
import type { KnowledgeStore } from './store';

export interface Retrieval {
  analysis: Analysis;
  hits: Hit[];
}

export async function retrieveFor(store: KnowledgeStore, req: AskRequest): Promise<Retrieval> {
  await store.ensureCore();
  const ctxCrop = req.context?.cropId ?? null;
  if (ctxCrop && !store.crops.has(ctxCrop)) await store.ensureFull().catch(() => undefined);
  let analysis = analyze(store, req.query, req.lang, Boolean(req.context), ctxCrop);
  let hits = search(store, analysis, req.topK ?? 6);
  // The core bundle only knows curated crops: an unrecognised question may name one of the other
  // ~2,500 EcoCrop species, so retry once against the full index.
  if (!store.hasFull && (analysis.intent === 'general' || hits.length === 0)) {
    try {
      await store.ensureFull();
      analysis = analyze(store, req.query, req.lang, Boolean(req.context), ctxCrop);
      hits = search(store, analysis, req.topK ?? 6);
    } catch {
      // Core-only answers are still valid; the full bundle is an enhancement.
    }
  }
  return { analysis, hits };
}

export async function answerExtractive(store: KnowledgeStore, req: AskRequest): Promise<AskResult & { retrieval: Retrieval }> {
  const retrieval = await retrieveFor(store, req);
  const result = composeExtractive(store, retrieval.analysis, retrieval.hits, req.context);
  return { ...result, retrieval };
}
