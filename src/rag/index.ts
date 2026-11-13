/**
 * Crop-knowledge RAG public API (owner: Agent 6).
 *
 * `ask` retrieves from the static index shipped in `public/rag/` and answers extractively in the
 * browser. When the optional API server reports `generative: true` on `/api/health`, the question
 * goes to `/api/ask` instead (same retrieval, answer written by the language model); any failure
 * there falls back to the extractive answer, so the panel always gets a grounded result.
 */
import type { AskRequest, AskResult, FieldContext, Lang } from '@/contracts';
import { answerExtractive } from './engine';
import { cropShortName } from './facts';
import { starterQuestions } from './followups';
import { fetchLoader, KnowledgeStore } from './store';

export { buildFieldContext, type FieldContextInput } from './fieldContext';
export { KnowledgeStore, type BundleLoader } from './store';

let store: KnowledgeStore | null = null;
function getStore(): KnowledgeStore {
  if (!store) {
    store = new KnowledgeStore(fetchLoader);
    // The first question waits for the small core bundle only; the full EcoCrop index follows.
    void store.ensureCore().then(() => store?.prefetchFull(), () => undefined);
  }
  return store;
}

/** Start loading the core index early (e.g. when the Ask panel opens). */
export function warmUp(): void {
  getStore();
}

let health: { at: number; generative: boolean } | null = null;
async function generativeAvailable(): Promise<boolean> {
  if (health && Date.now() - health.at < 60_000) return health.generative;
  let generative = false;
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(1500) });
    if (res.ok && res.headers.get('content-type')?.includes('json')) {
      const body = (await res.json()) as { ok?: boolean; generative?: boolean };
      generative = Boolean(body.ok && body.generative);
    }
  } catch {
    generative = false;
  }
  health = { at: Date.now(), generative };
  return generative;
}

function isAskResult(x: unknown): x is AskResult {
  const r = x as AskResult;
  return Boolean(r && typeof r.answer === 'string' && Array.isArray(r.citations) && (r.mode === 'generative' || r.mode === 'extractive'));
}

export async function ask(req: AskRequest): Promise<AskResult> {
  const query = req.query.trim();
  if (!query) {
    return { answer: '', mode: 'extractive', citations: [], followUps: suggestQuestions(req.context, req.lang), confidence: 0 };
  }
  if (await generativeAvailable()) {
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...req, query }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        const body: unknown = await res.json();
        if (isAskResult(body)) return body;
      }
    } catch {
      // Fall through to the in-browser answer.
    }
  }
  try {
    const { retrieval: _r, ...result } = await answerExtractive(getStore(), { ...req, query });
    return result;
  } catch {
    return {
      answer: req.lang === 'vi' ? 'Không tải được chỉ mục kiến thức (public/rag). Hãy chạy `npm run rag:build`.' : 'The knowledge index (public/rag) could not be loaded. Run `npm run rag:build`.',
      mode: 'extractive',
      citations: [],
      followUps: [],
      confidence: 0,
    };
  }
}

/** Starter questions tailored to the locked parcel and crop. */
export function suggestQuestions(context: FieldContext | undefined, lang: Lang): string[] {
  const s = store;
  const crop = context?.cropId && s ? s.crops.get(context.cropId) : undefined;
  const name = crop ? cropShortName(crop, lang) : context?.cropId ? context.cropId.replace(/-/g, ' ') : null;
  return starterQuestions(name, context, lang);
}
