/**
 * The two providers and the loop over them, without a network call: the Claude provider against
 * a fake SDK client, the Gemini provider against a fake `fetch` that answers with bodies recorded
 * from the live Interactions API on 2026-11-15 (signatures shortened).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createGeminiProvider, type FetchLike, GEMINI_DEFAULT_MODEL, GEMINI_ENDPOINT, type GeminiConfig, GeminiError, geminiConfigFromEnv, geminiRequest, geminiTurn, type InteractionRequest } from './gemini';
import {
  type AnthropicClient,
  type AnthropicConfig,
  anthropicTurn,
  buildRequest,
  createAnthropicProvider,
  echoContent,
  LlmDeadline,
  type LlmTool,
  llmConfigFromEnv,
  llmFromProvider,
  LlmRefusal,
  LlmTooManyRounds,
  LlmTruncated,
  runToolLoop,
  type ToolSpec,
} from './llm';

const SPEC: ToolSpec = { name: 'whereGrown', description: 'Where a crop is grown.', inputSchema: { type: 'object', properties: { crop: { type: 'string' } }, required: ['crop'], additionalProperties: false } };
const lookup = (run: LlmTool['run'] = async () => '{"cite":"S7","ok":true,"rows":[{"iso3":"VNM","areaHa":7089041}]}'): LlmTool => ({ ...SPEC, run });

describe('which provider the environment configures', () => {
  it('is Gemini with a Gemini key alone, with its default model', () => {
    expect(llmConfigFromEnv({ GEMINI_API_KEY: ' k ' })).toMatchObject({ provider: 'gemini', apiKey: 'k', model: GEMINI_DEFAULT_MODEL, thinkingLevel: 'low', maxTokens: 8000 });
    expect(geminiConfigFromEnv({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_THINKING_LEVEL: 'Medium' })).toMatchObject({ model: 'gemini-3.8-flash', thinkingLevel: 'medium' });
    // A level the API does not know is not sent on: the default stands.
    expect(geminiConfigFromEnv({ GEMINI_API_KEY: 'k', GEMINI_THINKING_LEVEL: 'extreme' })).toMatchObject({ thinkingLevel: 'low' });
    // `model` leaves the level to the model: none is sent.
    expect(geminiConfigFromEnv({ GEMINI_API_KEY: 'k', GEMINI_THINKING_LEVEL: 'model' })).not.toHaveProperty('thinkingLevel');
  });

  it('is Claude when both keys are set, unless LLM_PROVIDER says otherwise', () => {
    const both = { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' };
    expect(llmConfigFromEnv(both)!.provider).toBe('anthropic');
    expect(llmConfigFromEnv({ ...both, LLM_PROVIDER: 'gemini' })!.provider).toBe('gemini');
    expect(llmConfigFromEnv({ ...both, LLM_PROVIDER: 'Anthropic' })!.provider).toBe('anthropic');
  });

  it('is nothing when the provider asked for has no key', () => {
    expect(llmConfigFromEnv({ ANTHROPIC_API_KEY: 'a', LLM_PROVIDER: 'gemini' })).toBeNull();
    expect(llmConfigFromEnv({ GEMINI_API_KEY: 'g', LLM_PROVIDER: 'anthropic' })).toBeNull();
    expect(llmConfigFromEnv({ GEMINI_API_KEY: '  ' })).toBeNull();
  });
});

describe('the loop', () => {
  const conversation = (turns: Parameters<typeof scriptedConversation>[0]) => scriptedConversation(turns);
  function scriptedConversation(turns: { stop: 'end' | 'tools' | 'refusal' | 'max_tokens' | 'other'; text?: string; calls?: { id: string; name: string; input: unknown }[] }[]) {
    let i = 0;
    const answered: { id: string; content: string; isError: boolean }[][] = [];
    const timeouts: number[] = [];
    return {
      answered,
      timeouts,
      next: async (timeoutMs: number) => {
        timeouts.push(timeoutMs);
        const t = turns[Math.min(i++, turns.length - 1)];
        return { stopReason: t.stop, text: t.text ?? '', calls: t.calls ?? [], model: 'm', inputTokens: 100, outputTokens: 10, stop: t.stop };
      },
      answer: (results: { id: string; name: string; content: string; isError: boolean }[]) => void answered.push(results),
    };
  }

  it('runs every call of a turn, sends the results back together, and adds up the tokens', async () => {
    const conv = conversation([{ stop: 'tools', calls: [{ id: '1', name: 'whereGrown', input: { crop: 'rice' } }, { id: '2', name: 'whereGrown', input: { crop: 'maize' } }] }, { stop: 'end', text: ' Done. ' }]);
    const inputs: unknown[] = [];
    const out = await runToolLoop(conv, [lookup(async (input) => (inputs.push(input), 'ok'))]);
    expect(inputs).toEqual([{ crop: 'rice' }, { crop: 'maize' }]);
    expect(conv.answered).toEqual([[{ id: '1', name: 'whereGrown', content: 'ok', isError: false }, { id: '2', name: 'whereGrown', content: 'ok', isError: false }]]);
    expect(out).toMatchObject({ text: 'Done.', iterations: 2, inputTokens: 200, outputTokens: 20 });
    expect(out.calls.map((c) => [c.name, c.isError])).toEqual([['whereGrown', false], ['whereGrown', false]]);
  });

  it('turns a thrown error and an unknown function into failed results the model reads', async () => {
    const conv = conversation([{ stop: 'tools', calls: [{ id: '1', name: 'whereGrown', input: {} }, { id: '2', name: 'nope', input: {} }] }, { stop: 'end', text: 'x' }]);
    const out = await runToolLoop(conv, [lookup(async () => Promise.reject(new Error('The table could not be read')))]);
    expect(conv.answered[0]).toEqual([
      { id: '1', name: 'whereGrown', content: 'The table could not be read. Do not call it again with the same input.', isError: true },
      { id: '2', name: 'nope', content: 'There is no function named nope. Do not call it again with the same input.', isError: true },
    ]);
    expect(out.calls.every((c) => c.isError)).toBe(true);
  });

  it('stops after the rounds allowed', async () => {
    const conv = conversation([{ stop: 'tools', calls: [{ id: '1', name: 'whereGrown', input: {} }] }]);
    await expect(runToolLoop(conv, [lookup()], { maxIterations: 3 })).rejects.toBeInstanceOf(LlmTooManyRounds);
    expect(conv.timeouts).toHaveLength(3);
  });

  it('gives each request only the time that is left, and stops at the deadline', async () => {
    let clock = 0;
    const now = () => clock;
    const conv = conversation([{ stop: 'tools', calls: [{ id: '1', name: 'whereGrown', input: {} }] }]);
    const slowLookup = lookup(async () => ((clock += 400), 'ok'));
    await expect(runToolLoop(conv, [slowLookup], { deadlineMs: 1000, now })).rejects.toBeInstanceOf(LlmDeadline);
    // 1000 ms at the start, 600 after one lookup, 200 after two; the fourth request is not made.
    expect(conv.timeouts).toEqual([1000, 600, 200]);
  });

  it('throws on a refusal, a cut-off answer and a turn that is neither answer nor call', async () => {
    await expect(runToolLoop(conversation([{ stop: 'refusal' }]), [])).rejects.toBeInstanceOf(LlmRefusal);
    await expect(runToolLoop(conversation([{ stop: 'max_tokens', text: 'half' }]), [])).rejects.toBeInstanceOf(LlmTruncated);
    await expect(runToolLoop(conversation([{ stop: 'tools', calls: [] }]), [])).rejects.toThrow(/stopped without an answer/);
  });
});

describe('Claude', () => {
  const cfg: AnthropicConfig = { provider: 'anthropic', apiKey: 'test-key', model: 'claude-opus-5-5', effort: 'low', maxTokens: 8000, timeoutMs: 55_000 };
  const usage = { input_tokens: 50, output_tokens: 7 } as Anthropic.Beta.BetaUsage;
  const thinking = { type: 'thinking', thinking: '', signature: 'sig-1' } as Anthropic.Beta.BetaContentBlock;
  const toolUse = (id: string, input: unknown) => ({ type: 'tool_use', id, name: 'whereGrown', input }) as Anthropic.Beta.BetaContentBlock;
  const text = (t: string) => ({ type: 'text', text: t, citations: null }) as Anthropic.Beta.BetaContentBlock;

  it('declares the functions with their schema and leaves the choice of calling to the model', () => {
    const body = buildRequest(cfg, { system: 'SYS', user: 'USER', tools: [SPEC] });
    expect(body.tools).toEqual([{ name: 'whereGrown', description: 'Where a crop is grown.', input_schema: SPEC.inputSchema }]);
    // The current models reject a forced call: `tool_choice` is not sent, which means `auto`.
    expect(body).not.toHaveProperty('tool_choice');
    expect(body.system).toEqual([{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
  });

  it('sends `effort` and the refusal fallback only to the models that take them', () => {
    const body = (model: string) => buildRequest({ ...cfg, model }, { system: 's', user: 'u' });
    for (const model of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929']) expect(body(model)).not.toHaveProperty('output_config');
    for (const model of ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-fable-5-2', 'claude-sonnet-5-5']) expect(body(model).output_config).toEqual({ effort: 'low' });
    for (const model of ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-fable-5-2', 'claude-sonnet-5-5']) expect(body(model).fallbacks).toBe('default');
    // Claude Haiku 5.5 has no server-side fallback.
    for (const model of ['claude-haiku-5-5', 'claude-haiku-4-5']) expect(body(model)).not.toHaveProperty('fallbacks');
  });

  it('reads a response as a turn', () => {
    expect(anthropicTurn({ content: [thinking, text('Looking it up.'), toolUse('toolu_1', { crop: 'rice' })], stop_reason: 'tool_use', model: 'claude-opus-5-5', usage })).toEqual({
      stop: 'tools',
      stopReason: 'tool_use',
      text: 'Looking it up.',
      calls: [{ id: 'toolu_1', name: 'whereGrown', input: { crop: 'rice' } }],
      model: 'claude-opus-5-5',
      inputTokens: 50,
      outputTokens: 7,
    });
    const stopOf = (stop_reason: Anthropic.Beta.BetaMessage['stop_reason']) => anthropicTurn({ content: [], stop_reason, model: 'm', usage }).stop;
    expect([stopOf('end_turn'), stopOf('refusal'), stopOf('max_tokens'), stopOf('model_context_window_exceeded'), stopOf('pause_turn')]).toEqual(['end', 'refusal', 'max_tokens', 'max_tokens', 'other']);
  });

  it('after a server-side fallback, runs and echoes only what the model that finished the turn produced', () => {
    const fallback = { type: 'fallback', from: { model: 'claude-fable-5-2' }, to: { model: 'claude-opus-4-8' }, trigger: { type: 'refusal', category: 'cyber' } } as unknown as Anthropic.Beta.BetaContentBlock;
    const content = [thinking, text('Let me look.'), toolUse('toolu_declined', { crop: 'rice' }), fallback, thinking, toolUse('toolu_kept', { crop: 'maize' })];
    // The call the declining model started is not run.
    expect(anthropicTurn({ content, stop_reason: 'tool_use', model: 'claude-opus-4-8', usage }).calls).toEqual([{ id: 'toolu_kept', name: 'whereGrown', input: { crop: 'maize' } }]);
    // Echoed: its text and the fallback block where it stood, and everything after it.
    expect(echoContent(content)).toEqual([text('Let me look.'), fallback, thinking, toolUse('toolu_kept', { crop: 'maize' })]);
    // Without a fallback nothing is touched.
    const plain = [thinking, toolUse('toolu_1', {})];
    expect(echoContent(plain)).toBe(plain);
  });

  it('sends back the model\'s content unchanged, then one user message holding only the results', async () => {
    const bodies: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    const options: { timeout: number }[] = [];
    const first = [thinking, toolUse('toolu_1', { crop: 'rice' }), toolUse('toolu_2', { crop: 12 })];
    const client: AnthropicClient = {
      async create(body, opts) {
        // The provider reuses one array for the conversation: keep what this request held.
        bodies.push(structuredClone(body));
        options.push(opts);
        return bodies.length === 1 ? { content: first, stop_reason: 'tool_use', model: cfg.model, usage } : { content: [text('Viet Nam harvests 7,089,041 ha [S7].')], stop_reason: 'end_turn', model: cfg.model, usage };
      },
    };
    const tool = lookup(async (input) => {
      if (typeof (input as { crop: unknown }).crop !== 'string') throw new Error('Invalid input for whereGrown: crop: expected string');
      return '{"cite":"S7","rows":[{"iso3":"VNM","areaHa":7089041}]}';
    });
    const out = await llmFromProvider(createAnthropicProvider(cfg, client)).generateWithTools({ system: 'SYS', user: 'USER', tools: [tool], deadlineMs: 10_000 });

    expect(out).toMatchObject({ text: 'Viet Nam harvests 7,089,041 ha [S7].', iterations: 2, inputTokens: 100, outputTokens: 14 });
    expect(bodies[0].messages).toEqual([{ role: 'user', content: 'USER' }]);
    expect(bodies[1].messages).toEqual([
      { role: 'user', content: 'USER' },
      { role: 'assistant', content: first },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"cite":"S7","rows":[{"iso3":"VNM","areaHa":7089041}]}' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: 'Invalid input for whereGrown: crop: expected string. Do not call it again with the same input.', is_error: true },
        ],
      },
    ]);
    // Both requests carry the functions and the cached system prompt; each gets no more than the time left.
    expect(bodies.every((b) => b.tools?.length === 1 && b.system?.length === 1)).toBe(true);
    expect(options.every((o) => o.timeout > 0 && o.timeout <= 10_000)).toBe(true);
  });
});

describe('Gemini', () => {
  const cfg: GeminiConfig = { provider: 'gemini', apiKey: 'test-key-not-real', model: 'gemini-3.5-flash-lite', maxTokens: 8000, timeoutMs: 55_000 };

  // Bodies as the Interactions API returned them (store: false), trimmed to the fields read.
  const REQUIRES_ACTION = {
    status: 'requires_action',
    usage: { total_tokens: 179, total_input_tokens: 163, total_cached_tokens: 0, total_output_tokens: 16, total_tool_use_tokens: 0, total_thought_tokens: 0 },
    steps: [
      { signature: 'c2lnbmF0dXJl', type: 'thought' },
      { id: 'call_11220453196407385556', type: 'function_call', name: 'whereGrown', arguments: { crop: 'rice' } },
    ],
    object: 'interaction',
    model: 'gemini-3.5-flash-lite',
  };
  const COMPLETED = {
    status: 'completed',
    usage: { total_tokens: 420, total_input_tokens: 380, total_output_tokens: 30, total_thought_tokens: 10 },
    steps: [{ signature: 'c2ln', type: 'thought' }, { content: [{ text: 'Viet Nam harvests 7,089,041 ha ', type: 'text' }, { text: '[S7].', type: 'text' }], type: 'model_output' }],
    object: 'interaction',
    model: 'gemini-3.5-flash-lite',
  };
  const INCOMPLETE = { status: 'incomplete', usage: { total_input_tokens: 13, total_output_tokens: 16 }, steps: [{ content: [{ text: 'Rice is far more than a staple grain; it is a', type: 'text' }], type: 'model_output' }], model: 'gemini-3.5-flash-lite' };

  const respond = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  function fakeFetch(answers: ReturnType<typeof respond>[]) {
    const sent: { url: string; headers: Record<string, string>; body: InteractionRequest }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      sent.push({ url, headers: init.headers, body: JSON.parse(init.body) as InteractionRequest });
      return answers[Math.min(sent.length - 1, answers.length - 1)];
    };
    return { sent, fetchImpl };
  }

  it('builds a stateless request: the functions, the system instruction, the cap, and nothing to sample with', () => {
    const body = geminiRequest(cfg, { system: 'SYS', history: [{ type: 'user_input', content: [{ type: 'text', text: 'USER' }] }], tools: [SPEC] });
    expect(body).toEqual({
      model: 'gemini-3.5-flash-lite',
      input: [{ type: 'user_input', content: [{ type: 'text', text: 'USER' }] }],
      system_instruction: 'SYS',
      tools: [{ type: 'function', name: 'whereGrown', description: 'Where a crop is grown.', parameters: SPEC.inputSchema }],
      generation_config: { max_output_tokens: 8000 },
      store: false,
    });
    expect(geminiRequest({ ...cfg, thinkingLevel: 'low' }, { system: 's', history: [], tools: [] })).toMatchObject({ generation_config: { max_output_tokens: 8000, thinking_level: 'low' } });
    expect(geminiRequest(cfg, { system: 's', history: [], tools: [] })).not.toHaveProperty('tools');
  });

  it('reads an interaction as a turn', () => {
    expect(geminiTurn(REQUIRES_ACTION, 'x').turn).toEqual({
      stop: 'tools',
      stopReason: 'requires_action',
      text: '',
      calls: [{ id: 'call_11220453196407385556', name: 'whereGrown', input: { crop: 'rice' } }],
      model: 'gemini-3.5-flash-lite',
      inputTokens: 163,
      outputTokens: 16,
    });
    // Thinking is billed as output: 30 + 10.
    expect(geminiTurn(COMPLETED, 'x').turn).toMatchObject({ stop: 'end', text: 'Viet Nam harvests 7,089,041 ha [S7].', inputTokens: 380, outputTokens: 40 });
    expect(geminiTurn(INCOMPLETE, 'x').turn.stop).toBe('max_tokens');
    expect(geminiTurn({ status: 'failed', errors: [{ code: 'https://ai.google.dev/errors/safety', message: 'blocked' }], steps: [] }, 'fallback-model').turn).toMatchObject({ stop: 'refusal', model: 'fallback-model' });
    expect(geminiTurn({ status: 'failed', steps: [] }, 'x').turn.stop).toBe('other');
    expect(geminiTurn({ status: 'requires_action', steps: [] }, 'x').turn.stop).toBe('other');
    expect(() => geminiTurn({ error: 'x' }, 'x')).toThrow(/not an interaction/);
  });

  it('sends the key in a header, and the whole conversation again with the model\'s steps as received', async () => {
    const { sent, fetchImpl } = fakeFetch([respond(200, REQUIRES_ACTION), respond(200, COMPLETED)]);
    const out = await llmFromProvider(createGeminiProvider(cfg, fetchImpl)).generateWithTools({ system: 'SYS', user: 'USER', tools: [lookup()], deadlineMs: 10_000 });

    expect(out).toMatchObject({ text: 'Viet Nam harvests 7,089,041 ha [S7].', model: 'gemini-3.5-flash-lite', iterations: 2, inputTokens: 543, outputTokens: 56 });
    expect(sent).toHaveLength(2);
    for (const s of sent) {
      expect(s.url).toBe(GEMINI_ENDPOINT);
      expect(s.url).not.toContain('test-key-not-real');
      expect(s.headers['x-goog-api-key']).toBe('test-key-not-real');
      expect(JSON.stringify(s.body)).not.toContain('test-key-not-real');
      expect(s.body.store).toBe(false);
      expect(s.body).not.toHaveProperty('previous_interaction_id');
    }
    expect(sent[0].body.input).toEqual([{ type: 'user_input', content: [{ type: 'text', text: 'USER' }] }]);
    expect(sent[1].body.input).toEqual([
      { type: 'user_input', content: [{ type: 'text', text: 'USER' }] },
      ...REQUIRES_ACTION.steps,
      { type: 'function_result', call_id: 'call_11220453196407385556', name: 'whereGrown', result: [{ type: 'text', text: '{"cite":"S7","ok":true,"rows":[{"iso3":"VNM","areaHa":7089041}]}' }] },
    ]);
  });

  it('marks the result of a failed function with is_error', async () => {
    const { sent, fetchImpl } = fakeFetch([respond(200, REQUIRES_ACTION), respond(200, COMPLETED)]);
    await llmFromProvider(createGeminiProvider(cfg, fetchImpl)).generateWithTools({ system: 's', user: 'u', tools: [lookup(async () => Promise.reject(new Error('The table could not be read')))] });
    expect(sent[1].body.input.at(-1)).toEqual({ type: 'function_result', call_id: 'call_11220453196407385556', name: 'whereGrown', result: [{ type: 'text', text: 'The table could not be read. Do not call it again with the same input.' }], is_error: true });
  });

  it('tries again after a rate limit or a server error, twice at most', async () => {
    const limited = respond(429, { error: { code: 'rate_limit_exceeded', message: 'slow down' } });
    const ok = fakeFetch([limited, respond(503, 'upstream unavailable'), respond(200, COMPLETED)]);
    const out = await llmFromProvider(createGeminiProvider(cfg, ok.fetchImpl, [0, 0])).generate({ system: 's', user: 'u' });
    expect(out.text).toBe('Viet Nam harvests 7,089,041 ha [S7].');
    expect(ok.sent).toHaveLength(3);

    const never = fakeFetch([limited]);
    await expect(llmFromProvider(createGeminiProvider(cfg, never.fetchImpl, [0, 0])).generate({ system: 's', user: 'u' })).rejects.toMatchObject({ status: 429, code: 'rate_limit_exceeded' });
    expect(never.sent).toHaveLength(3);
  });

  it('does not try a bad request again, and keeps the key out of the error', async () => {
    const { sent, fetchImpl } = fakeFetch([respond(404, { error: { code: 'not_found', message: "Model 'x' not found." } })]);
    const err = await llmFromProvider(createGeminiProvider(cfg, fetchImpl, [0, 0]))
      .generate({ system: 's', user: 'u' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect((err as GeminiError).message).toBe("Gemini API 404 not_found: Model 'x' not found.");
    expect((err as GeminiError).message).not.toContain('test-key-not-real');
    expect(sent).toHaveLength(1);
  });

  it('reads content the API will not produce as a refusal', async () => {
    const { fetchImpl } = fakeFetch([respond(400, { error: { code: 'prohibited_content', message: 'blocked' } })]);
    await expect(llmFromProvider(createGeminiProvider(cfg, fetchImpl)).generate({ system: 's', user: 'u' })).rejects.toBeInstanceOf(LlmRefusal);
  });
});
