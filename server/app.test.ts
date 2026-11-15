import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AskResult } from '../src/contracts';
import { sampleContext, sampleModelInput } from '../scripts/rag/sample-context';
import { buildSystemPrompt } from '../src/rag/prompt';
import { KnowledgeStore } from '../src/rag/store';
import { tableSource } from '../src/rag/tables';
import { type AskTrace, createApp, MAX_BODY_BYTES, renumber, tidy } from './app';
import { buildRequest, type GenerateArgs, type Llm, llmConfigFromEnv, llmFromProvider, type ModelTurn, type Provider, type ToolResult, type ToolSpec } from './llm';
import { fileLoader, fileReader } from './loader';

const ROOT = path.resolve(import.meta.dirname, '..');
const systemPrompt = buildSystemPrompt(fs.readFileSync(path.join(ROOT, 'docs/SYSTEM_INSTRUCTIONS.md'), 'utf8'));
const tables = tableSource(fileReader(path.join(ROOT, 'public')));
let store: KnowledgeStore;
beforeAll(async () => {
  store = new KnowledgeStore(fileLoader(path.join(ROOT, 'public/rag')));
  await store.ensureFull();
});

// Expected numbers are read from the atlas, not typed in.
type Row = Record<string, string>;
const cropCountry = Papa.parse<Row>(fs.readFileSync(path.join(ROOT, 'data/crops/atlas/crop_country.csv'), 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
const riceVnm = Number(cropCountry.find((r) => r.crop_id === 'oryza-sativa' && r.iso3 === 'VNM')!.area_ha);

const post = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** An `Llm` that only writes: for the requests that offer no lookup functions. */
const writer = (generate: Llm['generate']): Llm => ({
  model: 'fake-model',
  provider: 'fake',
  generate,
  generateWithTools: () => Promise.reject(new Error('no lookup functions were offered to this model')),
});

const turn = (t: Partial<ModelTurn>): ModelTurn => ({ stop: 'end', stopReason: 'end_turn', text: '', calls: [], model: 'fake-model', inputTokens: 10, outputTokens: 5, ...t });

/**
 * A fake model behind the real loop: each entry of the script is one turn, given the results of
 * the calls of the turn before. Records what it was offered and what it was handed back.
 */
function scripted(script: ((results: ToolResult[]) => ModelTurn | Promise<ModelTurn>)[]) {
  const seen = { tools: [] as ToolSpec[], user: '', results: [] as ToolResult[][], requests: 0 };
  const provider: Provider = {
    name: 'fake',
    model: 'fake-model',
    open({ user, tools }) {
      seen.tools = tools;
      seen.user = user;
      let last: ToolResult[] = [];
      return {
        next: async () => script[Math.min(seen.requests++, script.length - 1)](last),
        answer(results) {
          last = results;
          seen.results.push(results);
        },
      };
    },
  };
  return { llm: llmFromProvider(provider), seen };
}

const askRice = { query: 'Việt Nam trồng bao nhiêu lúa?', lang: 'vi' };
const callWhereGrown = () => turn({ stop: 'tools', stopReason: 'tool_use', calls: [{ id: 'call-1', name: 'whereGrown', input: { crop: 'lúa', country: 'VNM' } }] });
const result = (r: ToolResult) => JSON.parse(r.content) as { cite?: string; ok: boolean; rows: { iso3: string; areaHa: number }[] };

describe('/api/health', () => {
  it('reports generative false without an LLM', async () => {
    const res = await createApp({ store, llm: null, systemPrompt }).request('/api/health');
    expect(await res.json()).toEqual({ ok: true, generative: false });
  });

  it('names the model and the provider, and says whether the lookup functions are on', async () => {
    const { llm } = scripted([() => turn({ text: 'x' })]);
    expect(await (await createApp({ store, llm, systemPrompt, tables }).request('/api/health')).json()).toEqual({ ok: true, generative: true, model: 'fake-model', provider: 'fake', tools: true });
    expect(await (await createApp({ store, llm, systemPrompt }).request('/api/health')).json()).toMatchObject({ generative: true, tools: false });
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
    // A field that is not a field: the envelope is checked before any model code sees it.
    expect((await post(app, { query: 'x', lang: 'en', field: { parcel: { id: 'p' } } })).status).toBe(400);
  });

  it('refuses a body larger than the limit', async () => {
    const app = createApp({ store, llm: null, systemPrompt });
    const res = await post(app, { query: 'x', lang: 'en', padding: 'x'.repeat(MAX_BODY_BYTES) });
    expect(res.status).toBe(413);
  });

  it('takes the telemetry of a demo field: the largest is well under the limit', () => {
    const size = Buffer.byteLength(JSON.stringify({ query: 'x', lang: 'vi', context: sampleContext('iowa-corn-soy'), field: sampleModelInput('iowa-corn-soy') }));
    expect(size).toBeGreaterThan(200_000);
    expect(size).toBeLessThan(MAX_BODY_BYTES / 2);
  });

  it('sends the system prompt and grounded user turn to the LLM and maps its citations', async () => {
    const seen: GenerateArgs[] = [];
    const llm = writer(async (args) => {
      seen.push(args);
      return { text: 'Đất hơi chua nhưng vẫn trong khoảng tối ưu [S2]. Xem thêm [S1].', model: 'fake-model', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 };
    });
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
    const llm = writer(async () => {
      throw new Error('network down');
    });
    const res = await post(createApp({ store, llm, systemPrompt }), { query: 'What are the ideal conditions for soybean?', lang: 'en' });
    const body = (await res.json()) as AskResult;
    expect(body.mode).toBe('extractive');
    expect(body.answer).toContain('5.5-6.5');
  });

  it('does not ask the model a question the router declines', async () => {
    const { llm, seen } = scripted([() => turn({ text: 'x' })]);
    const traces: AskTrace[] = [];
    const res = await post(createApp({ store, llm, systemPrompt, tables, trace: (t) => traces.push(t) }), { query: 'Giá cà phê tuần sau lên hay xuống?', lang: 'vi' });
    expect(((await res.json()) as AskResult).mode).toBe('extractive');
    expect(seen.requests).toBe(0);
    expect(traces[0]).toMatchObject({ intent: 'off-topic', mode: 'extractive', fallback: 'declined by the router' });
  });
});

describe('/api/ask with lookup functions', () => {
  it('does not ask the model about a species the atlas dropped: the rule says why it is not in the data', async () => {
    const { llm, seen } = scripted([() => turn({ text: 'x' })]);
    const traces: AskTrace[] = [];
    const body = (await (await post(createApp({ store, llm, systemPrompt, tables, trace: (t) => traces.push(t) }), { query: 'Aibika trồng thế nào?', lang: 'vi' })).json()) as AskResult;
    expect(seen.requests).toBe(0);
    expect(body.mode).toBe('extractive');
    expect(body.answer).toMatch(/không có trong dữ liệu cây trồng của Astrovivu/);
    expect(traces[0]).toMatchObject({ intent: 'dropped', fallback: 'answered by the router: species not in the atlas' });
  });

  it('lets the model call whereGrown, read the result and answer with a citation of the table', async () => {
    const { llm, seen } = scripted([
      callWhereGrown,
      ([r]) => {
        const data = result(r);
        const vnm = data.rows.find((x) => x.iso3 === 'VNM')!;
        return turn({ text: `Việt Nam thu hoạch ${vnm.areaHa.toLocaleString('vi-VN')} ha lúa [${data.cite}].`, inputTokens: 20, outputTokens: 9 });
      },
    ]);
    const traces: AskTrace[] = [];
    const res = await post(createApp({ store, llm, systemPrompt, tables, trace: (t) => traces.push(t) }), askRice);
    const body = (await res.json()) as AskResult;

    // The model was offered the lookups under their own names, with a schema each: without a
    // field in the request, the four that need no field.
    expect(seen.tools.map((t) => t.name)).toEqual(['cropsInPlace', 'whereGrown', 'cropFigures', 'compareCrops']);
    expect(seen.tools.every((t) => t.inputSchema.type === 'object' && t.description.length > 100)).toBe(true);
    // The function ran with the model's input: "lúa" was found to be rice, and the row is the atlas's.
    expect(seen.results).toHaveLength(1);
    expect(seen.results[0][0]).toMatchObject({ id: 'call-1', name: 'whereGrown', isError: false });
    const data = result(seen.results[0][0]);
    expect(data.ok).toBe(true);
    expect(data.rows.find((x) => x.iso3 === 'VNM')!.areaHa).toBe(riceVnm);
    // The result's id follows the passages of the user turn.
    const passages = (seen.user.match(/<passage id="S\d+"/g) ?? []).length;
    expect(data.cite).toBe(`S${passages + 1}`);

    expect(body.mode).toBe('generative');
    expect(body.answer).toBe(`Việt Nam thu hoạch ${riceVnm.toLocaleString('vi-VN')} ha lúa [S1].`);
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0].chunkId).toBe('table:crop-countries:oryza-sativa:VNM');
    expect(body.citations[0].source).toContain('FAOSTAT');
    expect(body.citations[0].license).toMatch(/CC BY/);
    expect(body.citations[0].url).toMatch(/^https:\/\//);
    expect(body.citations[0].snippet).toContain('ha');

    expect(traces[0]).toMatchObject({ mode: 'generative', provider: 'fake', model: 'fake-model', iterations: 2, inputTokens: 30, outputTokens: 14, unsupportedNumbers: [] });
    expect(traces[0].calls).toHaveLength(1);
    expect(traces[0].calls[0]).toMatchObject({ name: 'whereGrown', input: { crop: 'lúa', country: 'VNM' }, isError: false, cite: data.cite });
  });

  it('drops an answer with a number that is in no function result, and gives the extractive answer', async () => {
    const { llm } = scripted([callWhereGrown, () => turn({ text: 'Việt Nam thu hoạch 9.999.999 ha lúa.' })]);
    const traces: AskTrace[] = [];
    const logs: string[] = [];
    const res = await post(createApp({ store, llm, systemPrompt, tables, trace: (t) => traces.push(t), log: (m) => logs.push(m) }), askRice);
    const body = (await res.json()) as AskResult;
    expect(body.mode).toBe('extractive');
    expect(body.answer).not.toContain('9.999.999');
    expect(traces[0]).toMatchObject({ mode: 'extractive', fallback: 'UnsupportedNumbers', unsupportedNumbers: ['9.999.999'], modelAnswer: 'Việt Nam thu hoạch 9.999.999 ha lúa.' });
    expect(logs.join('\n')).toMatch(/1 numbers without a source \(9\.999\.999\); 1 answers dropped so far/);
  });

  it('hands a failed call to the model as an error result, and the model can still answer', async () => {
    const { llm, seen } = scripted([
      // `crop` is required and must be text; `areaHa` is not an input at all.
      () => turn({ stop: 'tools', calls: [{ id: 'a', name: 'whereGrown', input: { crop: 42 } }, { id: 'b', name: 'cropFigures', input: { crop: 'lúa', areaHa: 1 } }, { id: 'c', name: 'noSuchFunction', input: {} }] }),
      () => turn({ text: 'Không tra được số liệu cho câu này.' }),
    ]);
    const traces: AskTrace[] = [];
    const body = (await (await post(createApp({ store, llm, systemPrompt, tables, trace: (t) => traces.push(t) }), askRice)).json()) as AskResult;
    // All three results went back together, each marked as failed, with what was wrong.
    expect(seen.results).toHaveLength(1);
    expect(seen.results[0].map((r) => [r.id, r.isError])).toEqual([['a', true], ['b', true], ['c', true]]);
    expect(seen.results[0][0].content).toMatch(/Invalid input for whereGrown: crop/);
    expect(seen.results[0][1].content).toMatch(/Invalid input for cropFigures/);
    expect(seen.results[0][2].content).toMatch(/no function named noSuchFunction/);
    expect(seen.results[0][0].content).toMatch(/Do not call it again with the same input/);
    expect(body.mode).toBe('generative');
    expect(traces[0].calls.filter((c) => c.isError)).toHaveLength(2);
  });

  it('gives the extractive answer when the model is still calling after five requests', async () => {
    const { llm, seen } = scripted([callWhereGrown]);
    const traces: AskTrace[] = [];
    const body = (await (await post(createApp({ store, llm, systemPrompt, tables, trace: (t) => traces.push(t) }), askRice)).json()) as AskResult;
    expect(seen.requests).toBe(5);
    expect(body.mode).toBe('extractive');
    expect(traces[0]).toMatchObject({ fallback: 'LlmTooManyRounds', modelAnswer: null });
    // The calls made are kept even though no answer came.
    expect(traces[0].calls).toHaveLength(5);
  });

  it('gives the extractive answer when the deadline passes', async () => {
    const slow = (ms: number, t: ModelTurn) => () => new Promise<ModelTurn>((resolve) => setTimeout(() => resolve(t), ms));
    // The answer arrives, but late.
    const late = scripted([slow(80, turn({ text: 'Trễ rồi.' }))]);
    const traces: AskTrace[] = [];
    let body = (await (await post(createApp({ store, llm: late.llm, systemPrompt, tables, deadlineMs: 30, trace: (t) => traces.push(t) }), askRice)).json()) as AskResult;
    expect(body.mode).toBe('extractive');
    expect(traces[0].fallback).toBe('LlmDeadline');
    // The first turn used up the time: no second request is made.
    const twoTurns = scripted([slow(80, callWhereGrown()), () => turn({ text: 'x' })]);
    body = (await (await post(createApp({ store, llm: twoTurns.llm, systemPrompt, tables, deadlineMs: 30, trace: (t) => traces.push(t) }), askRice)).json()) as AskResult;
    expect(body.mode).toBe('extractive');
    expect(twoTurns.seen.requests).toBe(1);
    expect(traces[1].fallback).toBe('LlmDeadline');
  });

  it('gives the extractive answer on a refusal and on an answer cut off at the token limit', async () => {
    for (const [stop, name] of [['refusal', 'LlmRefusal'], ['max_tokens', 'LlmTruncated'], ['other', 'LlmStopped']] as const) {
      const traces: AskTrace[] = [];
      const { llm } = scripted([() => turn({ stop, text: 'Một nửa câu trả' })]);
      const body = (await (await post(createApp({ store, llm, systemPrompt, tables, trace: (t) => traces.push(t) }), askRice)).json()) as AskResult;
      expect(body.mode).toBe('extractive');
      expect(traces[0].fallback).toBe(name);
    }
  });

  it('offers the lookups that read the field only when the request brings the field, and runs them on it', async () => {
    const rotations = () => turn({ stop: 'tools', calls: [{ id: 'r', name: 'rotationOptions', input: {} }] });
    // The field context alone is not the field as the models read it: the four lookups are not offered.
    const without = scripted([rotations, () => turn({ text: 'Chưa có số liệu để tính phương án.' })]);
    await post(createApp({ store, llm: without.llm, systemPrompt, tables }), { query: 'Tôi nên luân canh thế nào?', lang: 'vi', context: sampleContext('daklak-coffee') });
    expect(without.seen.tools.map((t) => t.name)).toEqual(['cropsInPlace', 'whereGrown', 'cropFigures', 'compareCrops']);
    expect(without.seen.results[0][0]).toMatchObject({ isError: true, content: expect.stringContaining('no function named rotationOptions') });

    const withField = scripted([
      rotations,
      ([r]) => {
        const data = JSON.parse(r.content) as { cite: string; rows: { name: string }[] };
        return turn({ text: `Phương án đầu tiên là "${data.rows[0].name}" [${data.cite}].` });
      },
    ]);
    const res = await post(createApp({ store, llm: withField.llm, systemPrompt, tables }), { query: 'Tôi nên luân canh thế nào?', lang: 'vi', context: sampleContext('daklak-coffee'), field: sampleModelInput('daklak-coffee') });
    const body = (await res.json()) as AskResult;
    expect(withField.seen.tools.map((t) => t.name)).toEqual(['cropsInPlace', 'whereGrown', 'cropFigures', 'compareCrops', 'fieldSuitability', 'rotationOptions', 'soilPlan', 'priceAndMargin']);
    const data = JSON.parse(withField.seen.results[0][0].content) as { ok: boolean; rows: { name: string; kind: string }[]; field: string };
    expect(data.ok).toBe(true);
    expect(data.rows[0]).toMatchObject({ kind: 'current', name: 'Cách làm hiện tại' });
    expect(body.mode).toBe('generative');
    expect(body.citations[0].chunkId).toBe('table:rotations:daklak-coffee');
  });

  it('gives the field its country table on the server, whatever the request carried', async () => {
    const field = { ...sampleModelInput('cantho-rice'), country: { iso3: 'VNM', prevalence: {} } };
    const { llm, seen } = scripted([() => turn({ stop: 'tools', calls: [{ id: 'r', name: 'rotationOptions', input: {} }] }), () => turn({ text: 'x' })]);
    await post(createApp({ store, llm, systemPrompt, tables }), { query: 'Tôi nên luân canh thế nào?', lang: 'vi', context: sampleContext('cantho-rice'), field });
    // With the atlas table of Viet Nam the water-saver rotation takes daikon radish; with an empty table it would take buckwheat.
    const rows = (JSON.parse(seen.results[0][0].content) as { rows: { kind: string; seasons: { crop: string }[] }[] }).rows;
    const waterSaver = rows.find((r) => r.kind === 'water-saver')!;
    expect(waterSaver.seasons.map((x) => x.crop).join(' ')).not.toMatch(/kiều mạch/i);
  });

  it('takes out a citation that names a function instead of a source', async () => {
    const { llm } = scripted([callWhereGrown, ([r]) => turn({ text: `Xem bảng [${result(r).cite}]. Không có số riêng [whereGrown].` })]);
    const body = (await (await post(createApp({ store, llm, systemPrompt, tables }), askRice)).json()) as AskResult;
    expect(body.answer).toBe('Xem bảng [S1]. Không có số riêng.');
  });

  it('gives the same result, under the same id, when the model asks twice for the same thing', async () => {
    const { llm, seen } = scripted([callWhereGrown, callWhereGrown, ([r]) => turn({ text: `Xem bảng [${result(r).cite}].` })]);
    const body = (await (await post(createApp({ store, llm, systemPrompt, tables }), askRice)).json()) as AskResult;
    expect(seen.results[1][0].content).toBe(seen.results[0][0].content);
    expect(body.citations).toHaveLength(1);
  });
});

describe('the answer as the panel shows it', () => {
  it('renumbers citation markers to first-use order, one mark per source', () => {
    expect(renumber('a [S3] b [S1, S3] c [S7]', ['S3', 'S1']).text).toBe('a [S1] b [S2][S1] c ');
  });

  it('turns bullets and headings into the marks the panel draws, and touches nothing else', () => {
    expect(tidy('### Phương án 1\n\n* Lợi ích: 7614 USD/ha\n  * Rủi ro: **cao**\n\n\n\nHết.')).toBe('**Phương án 1**\n\n- Lợi ích: 7614 USD/ha\n- Rủi ro: **cao**\n\nHết.');
    expect(tidy('## **Đã đậm**')).toBe('**Đã đậm**');
    expect(tidy('Mặt hàng `Other tropical fruits, n.e.c.` gồm 31 cây.')).toBe('Mặt hàng Other tropical fruits, n.e.c. gồm 31 cây.');
    expect(tidy('pH 5.6 * 2 không phải là gạch đầu dòng.')).toBe('pH 5.6 * 2 không phải là gạch đầu dòng.');
    expect(tidy('- *Lý do và bằng chứng:* rất phù hợp, **100/100**.')).toBe('- Lý do và bằng chứng: rất phù hợp, **100/100**.');
  });
});

describe('LLM request', () => {
  it('reads configuration from the environment only, defaulting to claude-opus-5-5', () => {
    expect(llmConfigFromEnv({})).toBeNull();
    const cfg = llmConfigFromEnv({ ANTHROPIC_API_KEY: 'test-key' })!;
    expect(cfg).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' });
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
    expect(body).not.toHaveProperty('tools');
  });
});
