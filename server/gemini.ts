/**
 * Gemini as a provider for server/llm.ts, through Google's Interactions API
 * (POST https://generativelanguage.googleapis.com/v1beta/interactions), called with `fetch`.
 *
 * Why this API and how it is used (documentation read on 2026-11-15, shapes checked against the
 * live API the same day):
 *  - Google recommends the Interactions API "for all new development"; `generateContent` stays
 *    supported. Pages: aistudio.google.com/docs/migrate-to-interactions,
 *    /docs/function-calling, /api-reference/interactions-api/create-interaction.
 *  - **Stateless.** Every request carries `store: false` and the whole conversation in `input`:
 *    the user turn, every step the model returned (its `thought` steps with their signatures and
 *    its `function_call` steps, exactly as received) and the `function_result` steps. Nothing is
 *    kept on Google's side for a later request to refer to.
 *  - A function is declared as `{ type: "function", name, description, parameters }`; the model
 *    asks for it with a `function_call` step (`id`, `name`, `arguments`) and the interaction has
 *    status `requires_action`; the result goes back as a `function_result` step with that `id` as
 *    `call_id`, and `is_error: true` when the function failed.
 *  - No sampling parameter is sent: the current models ignore `temperature` and are announced to
 *    reject it.
 *
 * The key is read from GEMINI_API_KEY and sent in the `x-goog-api-key` header only: never in a
 * URL, a log line or an error message.
 */
import type { Conversation, ModelTurn, Provider, ToolSpec } from './llm';

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface GeminiConfig {
  provider: 'gemini';
  apiKey: string;
  model: string;
  /** Left out of the request when absent: the model then thinks as much as its own default says. */
  thinkingLevel?: ThinkingLevel;
  /** Cap on the output of one request, thinking included. */
  maxTokens: number;
  timeoutMs: number;
}

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
/**
 * The default model and thinking level, from a trial of six of the live-run questions on
 * 2026-11-15 (docs/RAG.md, "Choice of the Gemini model"): Gemini 3.5 Flash-Lite, which Google's
 * model page recommends for new projects beside Gemini 4 Hydrogen, answered in 3 to 7 s. At its
 * own default level (`minimal`) it skipped the lookup on one question and took a poorer function
 * on another; at `low` it called the right function on all six. `low` is a level every current
 * model accepts.
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_DEFAULT_THINKING: ThinkingLevel = 'low';
const THINKING_LEVELS: ThinkingLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];

/** GEMINI_THINKING_LEVEL: one of the five levels, or `model` to send none and leave it to the model. */
export function geminiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const asked = env.GEMINI_THINKING_LEVEL?.trim().toLowerCase();
  const level = asked === 'model' ? undefined : THINKING_LEVELS.includes(asked as ThinkingLevel) ? (asked as ThinkingLevel) : GEMINI_DEFAULT_THINKING;
  return {
    provider: 'gemini',
    apiKey,
    model: env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL,
    ...(level ? { thinkingLevel: level } : {}),
    maxTokens: Number(env.GEMINI_MAX_TOKENS ?? 8000) || 8000,
    timeoutMs: 55_000,
  };
}

/** One step of an interaction. Steps of the model are kept as received and sent back unread. */
export type Step = { type: string } & Record<string, unknown>;

export interface InteractionRequest {
  model: string;
  input: Step[];
  system_instruction: string;
  tools?: { type: 'function'; name: string; description: string; parameters: Record<string, unknown> }[];
  generation_config: { max_output_tokens: number; thinking_level?: ThinkingLevel };
  store: false;
}

/** Request body; exported so tests can check it without a network call. */
export function geminiRequest(cfg: Pick<GeminiConfig, 'model' | 'thinkingLevel' | 'maxTokens'>, args: { system: string; history: Step[]; tools: ToolSpec[]; maxTokens?: number }): InteractionRequest {
  return {
    model: cfg.model,
    input: args.history,
    system_instruction: args.system,
    ...(args.tools.length ? { tools: args.tools.map((t) => ({ type: 'function' as const, name: t.name, description: t.description, parameters: t.inputSchema })) } : {}),
    generation_config: { max_output_tokens: args.maxTokens ?? cfg.maxTokens, ...(cfg.thinkingLevel ? { thinking_level: cfg.thinkingLevel } : {}) },
    store: false,
  };
}

/** Codes with which the API says it will not produce the content (docs/api-errors): a refusal, not a failure of ours. */
const BLOCKED = /safety|recitation|prohibited_content|blocklist|spii|content_blocked|language/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** An interaction as a turn of the loop, with its steps to send back. Throws on a body that is not an interaction. */
export function geminiTurn(body: unknown, model: string): { turn: ModelTurn; steps: Step[] } {
  if (!isRecord(body) || typeof body.status !== 'string') throw new Error('The Gemini API answered with something that is not an interaction');
  const steps = (Array.isArray(body.steps) ? body.steps : []).filter((s): s is Step => isRecord(s) && typeof s.type === 'string');
  const text = steps
    .filter((s) => s.type === 'model_output' && Array.isArray(s.content))
    .flatMap((s) => s.content as unknown[])
    .map((c) => (isRecord(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('');
  const calls = steps
    .filter((s) => s.type === 'function_call' && typeof s.id === 'string' && typeof s.name === 'string')
    .map((s) => ({ id: s.id as string, name: s.name as string, input: s.arguments ?? {} }));
  const errors = (Array.isArray(body.errors) ? body.errors : []).map((e) => (isRecord(e) ? `${String(e.code ?? '')}` : '')).join(' ');
  const status = body.status;
  const stop: ModelTurn['stop'] =
    status === 'completed' ? 'end' : status === 'requires_action' && calls.length ? 'tools' : status === 'incomplete' ? 'max_tokens' : BLOCKED.test(errors) ? 'refusal' : 'other';
  const usage = isRecord(body.usage) ? body.usage : {};
  return {
    steps,
    turn: {
      stop,
      stopReason: errors.trim() ? `${status}: ${errors.trim()}` : status,
      text,
      calls,
      model: typeof body.model === 'string' ? body.model : model,
      inputTokens: count(usage.total_input_tokens),
      // Thinking is billed as output and reported apart from it.
      outputTokens: count(usage.total_output_tokens) + count(usage.total_thought_tokens),
    },
  };
}

export class GeminiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`Gemini API ${status} ${code}: ${message}`);
  }
}

export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const RETRY_DELAYS_MS = [1000, 3000];
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/** One request. A rate limit or a server error is tried again, twice at most, inside the time allowed. */
async function post(cfg: GeminiConfig, body: InteractionRequest, timeoutMs: number, fetchImpl: FetchLike, delays: number[]): Promise<unknown> {
  const signal = AbortSignal.timeout(timeoutMs);
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(GEMINI_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body: JSON.stringify(body), signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON: an error page of a proxy, for instance. Reported by its status below.
    }
    if (res.ok && json !== null) return json;
    const error = isRecord(json) && isRecord(json.error) ? json.error : {};
    const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
    if (retryable && attempt < delays.length) {
      await sleep(delays[attempt], signal);
      continue;
    }
    throw new GeminiError(res.status, typeof error.code === 'string' ? error.code : 'error', typeof error.message === 'string' ? error.message.slice(0, 300) : 'no message');
  }
}

export function createGeminiProvider(cfg: GeminiConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike, retryDelaysMs: number[] = RETRY_DELAYS_MS): Provider {
  return {
    name: 'gemini',
    model: cfg.model,
    open({ system, user, tools, maxTokens }): Conversation {
      const history: Step[] = [{ type: 'user_input', content: [{ type: 'text', text: user }] }];
      let last: Step[] = [];
      return {
        async next(timeoutMs) {
          let body: unknown;
          try {
            body = await post(cfg, geminiRequest(cfg, { system, history, tools, maxTokens }), timeoutMs, fetchImpl, retryDelaysMs);
          } catch (e) {
            // The API refusing the content is a refusal of the model, like Claude's stop reason.
            if (e instanceof GeminiError && BLOCKED.test(e.code)) return { stop: 'refusal', stopReason: e.code, text: '', calls: [], model: cfg.model, inputTokens: 0, outputTokens: 0 };
            throw e;
          }
          const { turn, steps } = geminiTurn(body, cfg.model);
          last = steps;
          return turn;
        },
        answer(results) {
          history.push(...last);
          for (const r of results) history.push({ type: 'function_result', call_id: r.id, name: r.name, result: [{ type: 'text', text: r.content }], ...(r.isError ? { is_error: true } : {}) });
        },
      };
    },
  };
}
