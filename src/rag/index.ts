/**
 * Crop-knowledge RAG public API.
 * PLACEHOLDER IMPLEMENTATION (owner: Agent 6). `ask` answers from the retrieval index in the
 * browser (extractive mode) and upgrades to a generative answer when the API server is reachable.
 */
import type { AskRequest, AskResult, FieldContext, Lang } from '@/contracts';

export async function ask(req: AskRequest): Promise<AskResult> {
  return {
    answer:
      req.lang === 'vi'
        ? 'Trợ lý kiến thức cây trồng chưa được kết nối.'
        : 'The crop-knowledge assistant is not connected yet.',
    mode: 'extractive',
    citations: [],
    followUps: [],
    confidence: 0,
  };
}

/** Starter questions tailored to the locked parcel and crop. */
export function suggestQuestions(_context: FieldContext | undefined, _lang: Lang): string[] {
  return [];
}
