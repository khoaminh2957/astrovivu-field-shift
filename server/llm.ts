/**
 * The one place that calls a language model. Reused by /api/ask and, later, by advisory narratives.
 *
 * Two providers sit behind one interface: Claude (Anthropic Messages API, through
 * `@anthropic-ai/sdk`) and Gemini (Google's Interactions API, in server/gemini.ts). Each is a
 * `Provider` that opens a `Conversation`; the loop that lets the model call the lookup functions
 * (`runToolLoop`) is written once, over that interface, so both providers get the same limits:
 * a number of rounds, one deadline for the whole answer, and a thrown error for a refusal, a
 * truncated answer or anything else that is not an answer. The caller (server/app.ts) turns any
 * thrown error into the extractive answer.
 *
 * Configuration comes from the environment only (never from the browser), and a key is never
 * logged:
 *   ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-opus-5-5), ANTHROPIC_EFFORT (default low:
 *     short grounded answers do not benefit from deep thinking), ANTHROPIC_MAX_TOKENS
 *   GEMINI_API_KEY, GEMINI_MODEL, GEMINI_THINKING_LEVEL, GEMINI_MAX_TOKENS (server/gemini.ts)
 *   LLM_PROVIDER = anthropic | gemini, to choose when both keys are set (default: anthropic)
 *
 * What was run against the live API: the Gemini provider (30 recorded conversations,
 * data/rag/transcripts). The Claude provider is written against @anthropic-ai/sdk 1.8 and the
 * tool-use pages of the Claude API documentation read on 2026-11-15, type-checked and unit-tested
 * with a fake client, but not exercised against the live API: no Anthropic key was configured.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createGeminiProvider, type GeminiConfig, geminiConfigFromEnv } from './gemini';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicConfig {
  provider: 'anthropic';
  apiKey: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  timeoutMs: number;
}

export type LlmConfig = AnthropicConfig | GeminiConfig;

export interface GenerateArgs {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface Generated {
  text: string;
  model: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

/** A function the model may call: its definition, and what runs when it is called. */
export interface ToolSpec {
  /** Letters, digits, `_` and `-`, 128 at most (the rule of both providers). */
  name: string;
  description: string;
  /** JSON Schema of the input object. */
  inputSchema: Record<string, unknown>;
}

export interface LlmTool extends ToolSpec {
  /** Returns the text the model reads as the result. A thrown error reaches the model as a failed call. */
  run(input: unknown): Promise<string>;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  /** The result as the model read it, or the error message. */
  output: string;
  isError: boolean;
  ms: number;
}

export interface GenerateWithToolsArgs extends GenerateArgs {
  tools: LlmTool[];
  /** Requests to the model at most; the answer must come within them. Default 5. */
  maxIterations?: number;
  /** Time for the whole answer, every request and every tool run included. Default 50 s. */
  deadlineMs?: number;
}

export interface GeneratedWithTools extends Generated {
  calls: ToolCallRecord[];
  /** Requests made to the model. */
  iterations: number;
}

export interface Llm {
  readonly model: string;
  readonly provider: string;
  generate(args: GenerateArgs): Promise<Generated>;
  generateWithTools(args: GenerateWithToolsArgs): Promise<GeneratedWithTools>;
}

// ------------------------------------------------------------------------------------------------
// The loop, the same for every provider
// ------------------------------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}

/** One turn of the model, in the terms the loop needs. */
export interface ModelTurn {
  /** `end`: an answer. `tools`: it wants functions run. Anything else is not an answer. */
  stop: 'end' | 'tools' | 'refusal' | 'max_tokens' | 'other';
  /** The provider's own word for why it stopped. */
  stopReason: string | null;
  text: string;
  calls: ToolCall[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Conversation {
  /** Sends what has been said so far and returns the model's turn; gives up after `timeoutMs`. */
  next(timeoutMs: number): Promise<ModelTurn>;
  /** Hands back the results of every call of the last turn, together, as the next message. */
  answer(results: ToolResult[]): void;
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  open(args: { system: string; user: string; tools: ToolSpec[]; maxTokens?: number }): Conversation;
}

export class LlmRefusal extends Error {}
/** The answer was cut off at the token limit. */
export class LlmTruncated extends Error {}
/** The rounds ran out with the model still asking for functions. */
export class LlmTooManyRounds extends Error {}
/** The deadline passed. */
export class LlmDeadline extends Error {}
/** The model stopped for a reason that is neither an answer nor a call. */
export class LlmStopped extends Error {}

export const MAX_ITERATIONS = 5;
/** Under the 60 s the browser waits for /api/ask (src/rag/index.ts). */
export const DEADLINE_MS = 50_000;

/**
 * Lets the model call functions until it answers. Every call of a turn is run, a thrown error
 * becomes a failed result the model can read, and all results of the turn go back in one message.
 * Throws instead of returning anything that is not a finished answer.
 */
export async function runToolLoop(conv: Conversation, tools: LlmTool[], opts: { maxIterations?: number; deadlineMs?: number; now?: () => number } = {}): Promise<GeneratedWithTools> {
  const now = opts.now ?? Date.now;
  const maxIterations = opts.maxIterations ?? MAX_ITERATIONS;
  const end = now() + (opts.deadlineMs ?? DEADLINE_MS);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const calls: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const left = end - now();
    if (left <= 0) throw new LlmDeadline(`No answer within the deadline (${calls.length} calls made)`);
    const turn = await conv.next(left);
    inputTokens += turn.inputTokens;
    outputTokens += turn.outputTokens;
    if (turn.stop === 'end') {
      if (now() > end) throw new LlmDeadline('The answer came after the deadline');
      return { text: turn.text.trim(), model: turn.model, stopReason: turn.stopReason, inputTokens, outputTokens, calls, iterations: iteration };
    }
    if (turn.stop === 'refusal') throw new LlmRefusal('The model declined to answer');
    if (turn.stop === 'max_tokens') throw new LlmTruncated('The answer was cut off at the token limit');
    if (turn.stop !== 'tools' || !turn.calls.length) throw new LlmStopped(`The model stopped without an answer (${turn.stopReason ?? 'no reason given'})`);
    const results: ToolResult[] = [];
    for (const call of turn.calls) {
      const started = now();
      let content: string;
      let isError = false;
      try {
        const tool = byName.get(call.name);
        if (!tool) throw new Error(`There is no function named ${call.name}`);
        if (now() > end) throw new LlmDeadline('The deadline passed before the function ran');
        content = await tool.run(call.input);
      } catch (e) {
        if (e instanceof LlmDeadline) throw e;
        isError = true;
        // The message is for the model: say what failed, and that asking again will not help.
        content = `${e instanceof Error ? e.message : 'The function failed'}. Do not call it again with the same input.`;
      }
      calls.push({ name: call.name, input: call.input, output: content, isError, ms: now() - started });
      results.push({ id: call.id, name: call.name, content, isError });
    }
    conv.answer(results);
  }
  throw new LlmTooManyRounds(`No answer after ${maxIterations} requests (${calls.length} calls made)`);
}

/** An `Llm` over a provider. */
export function llmFromProvider(provider: Provider, defaults: { timeoutMs: number } = { timeoutMs: 55_000 }): Llm {
  return {
    model: provider.model,
    provider: provider.name,
    async generate(args) {
      const turn = await provider.open({ ...args, tools: [] }).next(defaults.timeoutMs);
      if (turn.stop === 'refusal') throw new LlmRefusal('The model declined to answer');
      if (turn.stop === 'max_tokens') throw new LlmTruncated('The answer was cut off at the token limit');
      if (turn.stop !== 'end') throw new LlmStopped(`The model stopped without an answer (${turn.stopReason ?? 'no reason given'})`);
      return { text: turn.text.trim(), model: turn.model, stopReason: turn.stopReason, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens };
    },
    generateWithTools(args) {
      return runToolLoop(provider.open(args), args.tools, { maxIterations: args.maxIterations, deadlineMs: args.deadlineMs });
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------------------------------------

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
// Models that take the server-side refusal fallback (`fallbacks: "default"`), from the page
// "Refusals and fallback" of the Claude API documentation, read on 2026-11-15. Claude Haiku 5.5 has
// no server-side fallback and is rightly absent; the Mythos models are left out because the page
// shows the default mode for none of them.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-fable-5-2', 'claude-sonnet-5-5']);
// Models that are not among those the "Effort" page lists as supporting `effort` (read on
// 2026-11-15) and that this server may still be pointed at; their dated ids start the same way.
const NO_EFFORT = ['claude-haiku-4-5', 'claude-sonnet-4-5'];

function anthropicConfigFromEnv(env: NodeJS.ProcessEnv): AnthropicConfig | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const effort = (env.ANTHROPIC_EFFORT ?? 'low') as Effort;
  return {
    provider: 'anthropic',
    apiKey,
    model: env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5',
    effort: EFFORTS.includes(effort) ? effort : 'low',
    // Room for adaptive thinking plus a two-to-five paragraph answer.
    maxTokens: Number(env.ANTHROPIC_MAX_TOKENS ?? 8000) || 8000,
    timeoutMs: 55_000,
  };
}

/**
 * The provider the environment configures, or null without a key. With both keys set, Claude is
 * used unless LLM_PROVIDER says `gemini`; LLM_PROVIDER naming a provider whose key is missing
 * gives null, not the other provider.
 */
export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const wanted = env.LLM_PROVIDER?.trim().toLowerCase();
  if (wanted === 'gemini') return geminiConfigFromEnv(env);
  if (wanted === 'anthropic') return anthropicConfigFromEnv(env);
  return anthropicConfigFromEnv(env) ?? geminiConfigFromEnv(env);
}

// ------------------------------------------------------------------------------------------------
// Claude
// ------------------------------------------------------------------------------------------------

export interface AnthropicRequestArgs extends GenerateArgs {
  tools?: ToolSpec[];
  /** The conversation so far, when it is longer than the one user turn. */
  messages?: Anthropic.Beta.BetaMessageParam[];
}

/** Request body for the Messages API; exported so tests can check it without a network call. */
export function buildRequest(cfg: Pick<AnthropicConfig, 'model' | 'effort' | 'maxTokens'>, args: AnthropicRequestArgs): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const body: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: cfg.model,
    max_tokens: args.maxTokens ?? cfg.maxTokens,
    // The system prompt is identical across requests: cache it. Tools render before it, so the
    // same breakpoint covers their definitions.
    system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
    messages: args.messages ?? [{ role: 'user', content: args.user }],
  };
  // `tool_choice` stays at its default (`auto`): the current models reject a forced call.
  if (args.tools?.length) body.tools = args.tools.map((t) => ({ name: t.name, description: t.description, input_schema: { type: 'object' as const, ...t.inputSchema } }));
  if (!NO_EFFORT.some((m) => cfg.model.startsWith(m))) body.output_config = { effort: cfg.effort };
  if (FALLBACK_MODELS.has(cfg.model)) {
    body.betas = ['server-side-fallback-2026-07-01'];
    body.fallbacks = 'default';
  }
  return body;
}

type Content = Anthropic.Beta.BetaMessage['content'];

/** Where the model that finished the turn begins: after the last `fallback` block, or at the start. */
function afterFallback(content: Content): number {
  // `as string`: the comparison must hold whether or not the installed SDK types name the block.
  return content.reduce((at, b, i) => ((b.type as string) === 'fallback' ? i + 1 : at), 0);
}

/**
 * The model's content as it goes back on the next turn. Unchanged, except after a server-side
 * fallback: what the declining model left before the last `fallback` block (its thinking and a
 * call it did not finish) is dropped, as the documentation's table for echoing a turn says; the
 * `fallback` block itself and the text stay where they were.
 */
export function echoContent(content: Content): Content {
  const start = afterFallback(content);
  if (!start) return content;
  const dropped = new Set(['thinking', 'redacted_thinking', 'connector_text', 'tool_use']);
  return content.filter((b, i) => i >= start - 1 || !dropped.has(b.type as string));
}

/** A response of the Messages API as a turn of the loop. */
export function anthropicTurn(res: Pick<Anthropic.Beta.BetaMessage, 'content' | 'stop_reason' | 'model' | 'usage'>): ModelTurn {
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  // Only the calls of the model that finished the turn are run: one a declining model started is not.
  const calls = res.content
    .slice(afterFallback(res.content))
    .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  const reason = res.stop_reason;
  // `stop_sequence` cannot happen (none is sent); `pause_turn` belongs to server tools, of which there are none.
  const stop: ModelTurn['stop'] =
    reason === 'end_turn' ? 'end' : reason === 'tool_use' ? 'tools' : reason === 'refusal' ? 'refusal' : reason === 'max_tokens' || reason === 'model_context_window_exceeded' ? 'max_tokens' : 'other';
  return { stop, stopReason: reason, text, calls, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
}

/** The part of the SDK client the provider uses; a test passes a fake. */
export interface AnthropicClient {
  create(body: Anthropic.Beta.MessageCreateParamsNonStreaming, options: { timeout: number; signal: AbortSignal }): Promise<Pick<Anthropic.Beta.BetaMessage, 'content' | 'stop_reason' | 'model' | 'usage'>>;
}

export function createAnthropicProvider(cfg: AnthropicConfig, client?: AnthropicClient): Provider {
  const api: AnthropicClient =
    client ??
    (() => {
      const sdk = new Anthropic({ apiKey: cfg.apiKey, timeout: cfg.timeoutMs, maxRetries: 2 });
      return { create: (body, options) => sdk.beta.messages.create(body, options) };
    })();
  return {
    name: 'anthropic',
    model: cfg.model,
    open({ system, user, tools, maxTokens }) {
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: user }];
      let last: Anthropic.Beta.BetaMessage['content'] = [];
      return {
        async next(timeoutMs) {
          // The SDK retries a timed-out request; the signal keeps the retries inside the time left.
          const res = await api.create(buildRequest(cfg, { system, user, tools, maxTokens, messages }), { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) });
          last = res.content;
          return anthropicTurn(res);
        },
        answer(results) {
          // The model's own content goes back whole and unchanged (thinking blocks included), then
          // one user message holding nothing but the results of every call.
          messages.push({ role: 'assistant', content: echoContent(last) as Anthropic.Beta.BetaContentBlockParam[] });
          messages.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })) });
        },
      };
    },
  };
}

export function createLlm(cfg: LlmConfig): Llm {
  return llmFromProvider(cfg.provider === 'gemini' ? createGeminiProvider(cfg) : createAnthropicProvider(cfg), { timeoutMs: cfg.timeoutMs });
}
