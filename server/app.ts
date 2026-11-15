/**
 * Hono app for the optional API server. Kept separate from the listener so tests can call
 * `app.request()` directly.
 *
 *   GET  /api/health -> { ok, generative, model?, provider?, tools? }
 *   POST /api/ask    -> AskResult (generative when an LLM is configured, extractive otherwise)
 *
 * A generated answer is given only when it comes in time, within the rounds allowed, and holds no
 * number that is absent from what the model was given (src/rag/numberGuard.ts). Everything else
 * (no key, a refusal, a cut-off answer, a network error, a number of the model's own) returns the
 * extractive answer, which the request always builds first.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AskResult, Citation, Lang } from '../src/contracts';
import { composeExtractive } from '../src/rag/compose';
import { retrieveFor } from '../src/rag/engine';
import { unsupportedNumbers } from '../src/rag/numberGuard';
import { buildUserTurn, citedIds, numberPassages } from '../src/rag/prompt';
import type { KnowledgeStore } from '../src/rag/store';
import type { TableSource } from '../src/rag/tables';
import { clip } from '../src/rag/text';
import type { AssistantRequest } from '../src/rag/types';
import { DEADLINE_MS, type Llm, type LlmTool, MAX_ITERATIONS } from './llm';
import { askTools, type ToolCitation } from './tools';

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

/**
 * The locked field as the models read it (`ModelInput`). The envelope is checked; the telemetry
 * inside is taken as it comes, because the models already read every reading as possibly missing,
 * and a lookup that throws on a malformed field reaches the model as a failed call, not as a crash.
 */
const FieldSchema = z.looseObject({
  parcel: z.looseObject({
    id: z.string().max(120),
    name: z.string().max(200),
    centroid: z.tuple([z.number(), z.number()]),
    areaHa: z.number(),
    isUS: z.boolean(),
    place: z.looseObject({ iso3: z.string().length(3).optional() }).optional(),
  }),
  telemetry: z.looseObject({ parcelId: z.string().max(120), branches: z.record(z.string(), z.unknown()), sources: z.record(z.string(), z.unknown()) }),
  cropId: z.string().max(120).nullable(),
  groundTruth: z.record(z.string(), z.unknown()),
  priorities: z.array(z.enum(['profit', 'yield', 'water', 'soil', 'risk', 'cost'])).max(6),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const AskSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  lang: z.enum(['en', 'vi']),
  context: FieldContextSchema.optional(),
  topK: z.number().int().min(1).max(10).optional(),
  field: FieldSchema.optional(),
});

/**
 * Largest request body taken. A question with its field context is a few kB; the telemetry of a
 * field, which the field lookups need, is some 260 kB for the demo fields.
 */
export const MAX_BODY_BYTES = 1024 * 1024;

/** One call of a lookup function, as a trace keeps it. */
export interface TracedCall {
  /** The id the result was given for citing, when it had rows. */
  cite?: string;
  name: string;
  input: unknown;
  /** The result as the model read it (parsed), or the error message. */
  output: unknown;
  isError: boolean;
  ms: number;
}

/** What happened in one request to /api/ask: what the transcripts of the live run are made of. Holds no key and no header. */
export interface AskTrace {
  query: string;
  lang: Lang;
  intent: string;
  /** What the client received. */
  mode: AskResult['mode'];
  /** Why no generated answer was given, when the model was asked or would have been. */
  fallback?: string;
  provider?: string;
  model?: string;
  /** Requests made to the model. */
  iterations?: number;
  inputTokens?: number;
  outputTokens?: number;
  ms: number;
  calls: TracedCall[];
  /** The model's answer as it wrote it; null when it gave none. */
  modelAnswer: string | null;
  /** Numbers of the model's answer that are in none of its sources. */
  unsupportedNumbers: string[];
  answer: string;
  citations: string[];
}

export interface AppDeps {
  store: KnowledgeStore;
  llm: Llm | null;
  systemPrompt: string;
  /** The atlas tables. With them, the model may call the lookup functions (server/tools.ts). */
  tables?: TableSource;
  log?: (msg: string) => void;
  trace?: (t: AskTrace) => void;
  /** Time allowed for one generated answer; tests shorten it. */
  deadlineMs?: number;
}

/** A generated answer that holds numbers found in none of its sources. */
export class UnsupportedNumbers extends Error {
  constructor(readonly numbers: string[]) {
    super(`${numbers.length} numbers without a source`);
  }
}

/**
 * Renumber [S#] markers to the order of first use and return the matching citations. A mark that
 * names several sources (`[S3, S1]`) is written as one mark per source (`[S1][S2]`): the answer
 * panel draws a mark only for a single id (src/ui/ask/Answer.tsx).
 */
export function renumber(answer: string, cited: string[]): { text: string; order: string[] } {
  const map = new Map(cited.map((id, i) => [id, `S${i + 1}`]));
  const text = answer.replace(/\[(S\d+(?:\s*[,;]\s*S\d+)*)\]/g, (_m, inner: string) =>
    inner
      .split(/\s*[,;]\s*/)
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((id) => `[${id}]`)
      .join(''),
  );
  return { text, order: cited };
}

/**
 * The answer in the few marks the answer panel draws: paragraphs, one-level `- ` lists, `**bold**`
 * and citation marks. Models also write `*` bullets, `#` headings, italics and code marks; those
 * become `- ` lines, bold lines and plain words. Words and numbers are not touched.
 */
export function tidy(answer: string): string {
  return answer
    .replace(/^[ \t]*[*+•][ \t]+/gm, '- ')
    .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, (_m, title: string) => (/^\*\*.*\*\*$/.test(title) ? title : `**${title.replace(/\*\*/g, '')}**`))
    .replace(/`([^`\n]+)`/g, '$1')
    // Italics: one asterisk on each side, tight against the words. `**bold**` and "5 * 2" are left alone.
    .replace(/(?<![*\w])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![*\w])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const log = deps.log ?? (() => undefined);
  let dropped = 0;

  app.get('/api/health', (c) => c.json({ ok: true, generative: deps.llm != null, ...(deps.llm ? { model: deps.llm.model, provider: deps.llm.provider, tools: deps.tables != null } : {}) }));

  app.use('/api/ask', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'request too large' }, 413) }));

  app.post('/api/ask', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const checked = AskSchema.safeParse(body);
    if (!checked.success) return c.json({ error: 'invalid request', issues: checked.error.issues.slice(0, 5).map((i) => i.message) }, 400);
    // The schema checks the envelope of `field`; see FieldSchema for why that is enough.
    const req = checked.data as unknown as AssistantRequest;
    const started = Date.now();

    const retrieval = await retrieveFor(deps.store, req);
    const extractive = composeExtractive(deps.store, retrieval.analysis, retrieval.hits, req.context);
    const trace = (t: Partial<AskTrace> & Pick<AskTrace, 'mode' | 'answer' | 'citations'>) =>
      deps.trace?.({ query: req.query, lang: req.lang, intent: retrieval.analysis.intent, ms: Date.now() - started, calls: [], modelAnswer: null, unsupportedNumbers: [], ...t });
    const giveExtractive = (fallback?: string, more: Partial<AskTrace> = {}) => {
      trace({ mode: 'extractive', answer: extractive.answer, citations: extractive.citations.map((x) => x.chunkId), ...(fallback ? { fallback } : {}), ...more });
      return c.json(extractive satisfies AskResult);
    };
    if (!deps.llm) return giveExtractive();
    // A question outside the scope is declined by rule: the model is not asked.
    if (retrieval.analysis.intent === 'off-topic') return giveExtractive('declined by the router');
    // So is a question about a species the atlas dropped: why it is not in the data is a fact of
    // the atlas, which the rule states exactly; the model has no source to say more from.
    if (retrieval.analysis.intent === 'dropped') return giveExtractive('answered by the router: species not in the atlas');

    const llm = deps.llm;
    const passages = numberPassages(retrieval.hits.map((h) => h.chunk));
    const user = buildUserTurn(req.query, req.lang, req.context, passages);

    // Each result with rows gets the next citation id after the passages; asking twice for the same thing gives the same result.
    const cited = new Map<string, ToolCitation>();
    const given = new Map<string, string>();
    const calls: TracedCall[] = [];
    // The four lookups that read the field are offered only when the request brings it: with the
    // field context alone (a client that does not send the field yet) the model answers from that
    // context, and is not handed a function that could only say "no field".
    const tools: LlmTool[] = deps.tables
      ? askTools({ store: deps.store, tables: deps.tables, field: req.field ?? null, lang: req.lang })
          .filter((t) => !t.needsField || req.field != null)
          .map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            async run(input) {
              const t0 = Date.now();
              const key = `${t.name} ${JSON.stringify(input)}`;
              try {
                let text = given.get(key);
                if (text == null) {
                  const out = await t.run(input);
                  const sid = out.citation ? `S${passages.length + cited.size + 1}` : undefined;
                  if (sid && out.citation) cited.set(sid, out.citation);
                  text = JSON.stringify(sid ? { cite: sid, ...out.result } : out.result);
                  given.set(key, text);
                }
                const data = parsed(text) as { cite?: string };
                calls.push({ ...(data.cite ? { cite: data.cite } : {}), name: t.name, input, output: data, isError: false, ms: Date.now() - t0 });
                return text;
              } catch (e) {
                calls.push({ name: t.name, input, output: e instanceof Error ? e.message : 'the function failed', isError: true, ms: Date.now() - t0 });
                throw e;
              }
            },
          }))
      : [];

    // `calls` fills as the model asks, so a trace has them even when no answer came.
    const base: Partial<AskTrace> = { provider: llm.provider, model: llm.model, calls };
    try {
      const out = tools.length
        ? await llm.generateWithTools({ system: deps.systemPrompt, user, tools, maxIterations: MAX_ITERATIONS, deadlineMs: deps.deadlineMs ?? DEADLINE_MS })
        : { ...(await llm.generate({ system: deps.systemPrompt, user })), calls: [], iterations: 1 };
      Object.assign(base, { model: out.model, iterations: out.iterations, inputTokens: out.inputTokens, outputTokens: out.outputTokens, modelAnswer: out.text || null });
      if (!out.text) throw new Error('empty answer');

      // Every number of the answer has to be in what the model was given: the user turn (question,
      // field context, passages) and the results of the functions it called.
      const strangers = unsupportedNumbers(out.text, [user, ...out.calls.map((call) => call.output)]);
      if (strangers.length) {
        base.unsupportedNumbers = strangers;
        throw new UnsupportedNumbers(strangers);
      }

      const known = new Set([...passages.map((p) => p.sid), ...cited.keys()]);
      const used = citedIds(out.text, known);
      // A model sometimes cites a function by its name: that is no mark the panel knows.
      const named = new RegExp(`\\s*\\[(?:${tools.map((t) => t.name).join('|') || 'none'})\\]`, 'g');
      const { text } = renumber(tidy(out.text).replace(named, ''), used);
      const bySid = new Map(passages.map((p, i) => [p.sid, { p, score: retrieval.hits[i].score }]));
      const citations: Citation[] = used.map((sid) => {
        const table = cited.get(sid);
        // A looked-up table is not ranked against the question: it was asked for by name.
        if (table) return { ...table, score: 1 };
        const { p, score } = bySid.get(sid)!;
        return { chunkId: p.chunk.id, title: p.chunk.title, source: p.chunk.source.name, url: p.chunk.source.url, license: p.chunk.source.license, snippet: clip(p.chunk.text, 280), score: Number(score.toFixed(3)) };
      });
      log(`ask ok: ${out.model}, ${out.inputTokens} in / ${out.outputTokens} out, ${out.iterations} requests, ${out.calls.length} lookups, ${citations.length} citations`);
      const result: AskResult = {
        answer: text,
        mode: 'generative',
        citations,
        followUps: extractive.followUps,
        // The model's answer rests on the same grounding; with no citation at all, trust it less.
        confidence: Number((citations.length ? Math.max(extractive.confidence, 0.6) : 0.35).toFixed(2)),
      };
      trace({ ...base, mode: 'generative', answer: text, citations: citations.map((x) => x.chunkId) });
      return c.json(result);
    } catch (e) {
      const reason = e instanceof Error ? e.constructor.name : 'error';
      if (e instanceof UnsupportedNumbers) {
        dropped++;
        log(`ask: generated answer dropped, ${e.numbers.length} numbers without a source (${e.numbers.slice(0, 8).join(', ')}); ${dropped} answers dropped so far; extractive fallback`);
      } else log(`ask: generative failed (${reason}), extractive fallback`);
      return giveExtractive(reason, base);
    }
  });

  return app;
}
