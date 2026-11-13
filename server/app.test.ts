import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AskResult } from '../src/contracts';
import { buildSystemPrompt } from '../src/rag/prompt';
import { KnowledgeStore } from '../src/rag/store';
import { createApp, renumber } from './app';
import { buildRequest, type GenerateArgs, type Llm, llmConfigFromEnv } from './llm';
import { fileLoader } from './loader';

const ROOT = path.resolve(import.meta.dirname, '..');
const systemPrompt = buildSystemPrompt(fs.readFileSync(path.join(ROOT, 'docs/SYSTEM_INSTRUCTIONS.md'), 'utf8'));
let store: KnowledgeStore;
beforeAll(async () => {
  store = new KnowledgeStore(fileLoader(path.join(ROOT, 'public/rag')));
  await store.ensureFull();
});

const post = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('/api/health', () => {
  it('reports generative false without an LLM', async () => {
    const res = await createApp({ store, llm: null, systemPrompt }).request('/api/health');
    expect(await res.json()).toEqual({ ok: true, generative: false });
  });
});

describe('/api/ask', () => {
  it('answers extractively without an LLM', async () => {
    const res = await post(createApp({ store, llm: null, systemPrompt }), { query: 'What is NDVI?', lang: 'en' });
    const body = (await res.json()) as AskResult;
    expect(body.mode).toBe('extractive');
    expect(body.citations[0].chunkId).toBe('gloss-en:ndvi');
  });

  it('rejects malformed requests', async () => {
    const app = createApp({ store, llm: null, systemPrompt });
    expect((await post(app, { query: '', lang: 'en' })).status).toBe(400);
    expect((await post(app, { query: 'x', lang: 'fr' })).status).toBe(400);
  });

  it('sends the system prompt and grounded user turn to the LLM and maps its citations', async () => {
    const seen: GenerateArgs[] = [];
    const llm: Llm = {
      model: 'fake-model',
      async generate(args) {
        seen.push(args);
        return { text: 'Đất hơi chua nhưng vẫn trong khoảng tối ưu [S2]. Xem thêm [S1].', model: 'fake-model', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 };
      },
    };
    const app = createApp({ store, llm, systemPrompt });
    const res = await post(app, { query: 'Đất của tôi có quá chua cho đậu nành không?', lang: 'vi', context: { parcelName: 'F', location: [108.2, 12.8], areaHa: 2, cropId: 'glycine-max', date: '2026-11-14', facts: { ph: '5.6 (SoilGrids v2.0, 250 m pixel, modelled)' } } });
    const body = (await res.json()) as AskResult;
    expect(seen).toHaveLength(1);
    expect(seen[0].system).toBe(systemPrompt);
    expect(seen[0].user).toContain('<field_context>');
    expect(seen[0].user).toContain('5.6 (SoilGrids v2.0, 250 m pixel, modelled)');
    expect(seen[0].user).toContain('<passage id="S1"');
    expect(body.mode).toBe('generative');
    // [S2] was cited first, so it becomes S1 in the returned answer and citation list.
    expect(body.answer).toBe('Đất hơi chua nhưng vẫn trong khoảng tối ưu [S1]. Xem thêm [S2].');
    expect(body.citations).toHaveLength(2);
    expect(body.followUps.length).toBeGreaterThan(0);
  });

  it('falls back to the extractive answer when the LLM fails', async () => {
    const llm: Llm = {
      model: 'fake-model',
      async generate() {
        throw new Error('network down');
      },
    };
    const res = await post(createApp({ store, llm, systemPrompt }), { query: 'What are the ideal conditions for soybean?', lang: 'en' });
    const body = (await res.json()) as AskResult;
    expect(body.mode).toBe('extractive');
    expect(body.answer).toContain('5.5-6.5');
  });
});

describe('LLM request', () => {
  it('reads configuration from the environment only, defaulting to claude-opus-5-5', () => {
    expect(llmConfigFromEnv({})).toBeNull();
    const cfg = llmConfigFromEnv({ ANTHROPIC_API_KEY: 'test-key' })!;
    expect(cfg.model).toBe('claude-opus-5-5');
    expect(cfg.effort).toBe('low');
    expect(llmConfigFromEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-sonnet-5-5' })!.model).toBe('claude-sonnet-5-5');
  });
  it('builds a cached-system, effort-controlled request with refusal fallback and no sampling params', () => {
    const body = buildRequest({ model: 'claude-opus-5-5', effort: 'low', maxTokens: 8000 }, { system: 'SYS', user: 'USER' });
    expect(body.system).toEqual([{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
    expect(body.messages).toEqual([{ role: 'user', content: 'USER' }]);
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.fallbacks).toBe('default');
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('thinking');
  });
  it('renumbers citation markers to first-use order', () => {
    expect(renumber('a [S3] b [S1, S3] c [S7]', ['S3', 'S1']).text).toBe('a [S1] b [S2, S1] c ');
  });
});
