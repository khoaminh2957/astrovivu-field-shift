/**
 * Hono app for the optional API server. Kept separate from the listener so tests can call
 * `app.request()` directly.
 *
 *   GET  /api/health -> { ok, generative, model? }
 *   POST /api/ask    -> AskResult (generative when an LLM is configured, extractive otherwise)
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AskRequest, AskResult, Citation } from '../src/contracts';
import { composeExtractive } from '../src/rag/compose';
import { retrieveFor } from '../src/rag/engine';
import { buildUserTurn, citedIds, numberPassages } from '../src/rag/prompt';
import type { KnowledgeStore } from '../src/rag/store';
import { clip } from '../src/rag/text';
import type { Llm } from './llm';

const FieldContextSchema = z.object({
  parcelName: z.string().max(200),
  place: z.string().max(300).optional(),
  location: z.tuple([z.number(), z.number()]),
  areaHa: z.number(),
  cropId: z.string().max(120).nullable(),
  date: z.string().max(10),
  facts: z.record(z.string().max(80), z.string().max(800)).refine((f) => Object.keys(f).length <= 250, 'too many facts'),
  limitingFactor: z.string().max(400).optional(),
  productivity: z.number().optional(),
});

const AskSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  lang: z.enum(['en', 'vi']),
  context: FieldContextSchema.optional(),
  topK: z.number().int().min(1).max(10).optional(),
});

export interface AppDeps {
  store: KnowledgeStore;
  llm: Llm | null;
  systemPrompt: string;
  log?: (msg: string) => void;
}

/** Renumber [S#] markers to the order of first use and return the matching citations. */
export function renumber(answer: string, cited: string[]): { text: string; order: string[] } {
  const map = new Map(cited.map((id, i) => [id, `S${i + 1}`]));
  const text = answer.replace(/\[(S\d+(?:\s*[,;]\s*S\d+)*)\]/g, (_m, inner: string) => {
    const ids = inner.split(/\s*[,;]\s*/).map((id) => map.get(id)).filter(Boolean);
    return ids.length ? `[${ids.join(', ')}]` : '';
  });
  return { text, order: cited };
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const log = deps.log ?? (() => undefined);

  app.get('/api/health', (c) => c.json({ ok: true, generative: deps.llm != null, ...(deps.llm ? { model: deps.llm.model } : {}) }));

  app.post('/api/ask', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const parsed = AskSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5).map((i) => i.message) }, 400);
    const req = parsed.data as AskRequest;

    const retrieval = await retrieveFor(deps.store, req);
    const extractive = composeExtractive(deps.store, retrieval.analysis, retrieval.hits, req.context);
    if (!deps.llm || retrieval.analysis.intent === 'off-topic') return c.json(extractive satisfies AskResult);

    const passages = numberPassages(retrieval.hits.map((h) => h.chunk));
    const user = buildUserTurn(req.query, req.lang, req.context, passages);
    try {
      const out = await deps.llm.generate({ system: deps.systemPrompt, user });
      if (!out.text) throw new Error('empty answer');
      const known = new Set(passages.map((p) => p.sid));
      const cited = citedIds(out.text, known);
      const { text } = renumber(out.text, cited);
      const bySid = new Map(passages.map((p, i) => [p.sid, { p, score: retrieval.hits[i].score }]));
      const citations: Citation[] = cited.map((sid) => {
        const { p, score } = bySid.get(sid)!;
        return { chunkId: p.chunk.id, title: p.chunk.title, source: p.chunk.source.name, url: p.chunk.source.url, license: p.chunk.source.license, snippet: clip(p.chunk.text, 280), score: Number(score.toFixed(3)) };
      });
      log(`ask ok: ${out.model}, ${out.inputTokens} in / ${out.outputTokens} out, ${citations.length} citations`);
      const result: AskResult = {
        answer: text,
        mode: 'generative',
        citations,
        followUps: extractive.followUps,
        // The model's answer rests on the same grounding; with no citation at all, trust it less.
        confidence: Number((citations.length ? Math.max(extractive.confidence, 0.6) : 0.35).toFixed(2)),
      };
      return c.json(result);
    } catch (e) {
      log(`ask: generative failed (${e instanceof Error ? e.constructor.name : 'error'}), extractive fallback`);
      return c.json(extractive satisfies AskResult);
    }
  });

  return app;
}
