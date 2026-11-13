/**
 * The one place that calls Claude. Reused by /api/ask and, later, by advisory narratives.
 *
 * Configuration comes from the environment only (never from the browser): ANTHROPIC_API_KEY,
 * ANTHROPIC_MODEL (default claude-opus-5-5), ANTHROPIC_EFFORT (default low: short grounded
 * answers do not benefit from deep thinking). The key is never logged.
 *
 * NOTE: written against @anthropic-ai/sdk 1.8 and type-checked, but not exercised against the
 * live API (no key was configured when it was built).
 */
import Anthropic from '@anthropic-ai/sdk';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LlmConfig {
  apiKey: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  timeoutMs: number;
}

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

export interface Llm {
  readonly model: string;
  generate(args: GenerateArgs): Promise<Generated>;
}

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-fable-5-2', 'claude-sonnet-5-5']);
// Models without the `effort` parameter.
const NO_EFFORT = new Set(['claude-haiku-4-5', 'claude-sonnet-4-5']);

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const effort = (env.ANTHROPIC_EFFORT ?? 'low') as Effort;
  return {
    apiKey,
    model: env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5',
    effort: EFFORTS.includes(effort) ? effort : 'low',
    // Room for adaptive thinking plus a two-to-five paragraph answer.
    maxTokens: Number(env.ANTHROPIC_MAX_TOKENS ?? 8000) || 8000,
    timeoutMs: 55_000,
  };
}

/** Request body for the Messages API; exported so tests can check it without a network call. */
export function buildRequest(cfg: Pick<LlmConfig, 'model' | 'effort' | 'maxTokens'>, args: GenerateArgs): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const body: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: cfg.model,
    max_tokens: args.maxTokens ?? cfg.maxTokens,
    // The system prompt is identical across requests: cache it.
    system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: args.user }],
  };
  if (!NO_EFFORT.has(cfg.model)) body.output_config = { effort: cfg.effort };
  if (FALLBACK_MODELS.has(cfg.model)) {
    body.betas = ['server-side-fallback-2026-07-01'];
    body.fallbacks = 'default';
  }
  return body;
}

export class LlmRefusal extends Error {}

export function createLlm(cfg: LlmConfig): Llm {
  const client = new Anthropic({ apiKey: cfg.apiKey, timeout: cfg.timeoutMs, maxRetries: 2 });
  return {
    model: cfg.model,
    async generate(args) {
      const res = await client.beta.messages.create(buildRequest(cfg, args));
      if (res.stop_reason === 'refusal') throw new LlmRefusal('The model declined to answer');
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      return { text, model: res.model, stopReason: res.stop_reason, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    },
  };
}
