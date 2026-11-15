/**
 * The live run of the generative mode (issue C4): asks the questions of
 * data/rag/transcripts/questions.json through the server's own app, with the provider the
 * environment configures, and writes one transcript per question beside them, with a summary
 * (data/rag/transcripts/README.md).
 *
 *   npx tsx scripts/rag/live-run.ts            every question
 *   npx tsx scripts/rag/live-run.ts 06 21      only these
 *
 * Needs a key in `.env` (GEMINI_API_KEY or ANTHROPIC_API_KEY): this spends the provider's quota,
 * one question at a time. The app is the one `npm run server` serves (server/app.ts), called
 * without the HTTP listener; the requests to the provider are real.
 *
 * A transcript holds the question, each function called with its input and its result, the
 * answer, the model, the tokens in and out, the time and what the number check found. It holds
 * no key and no header: the trace it is written from never sees one, and the run stops if a
 * written file contains the key all the same.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AskResult, Lang } from '../../src/contracts';
import { type AskTrace, createApp } from '../../server/app';
import { createLlm, llmConfigFromEnv } from '../../server/llm';
import { fileLoader, fileReader } from '../../server/loader';
import { buildSystemPrompt } from '../../src/rag/prompt';
import { KnowledgeStore } from '../../src/rag/store';
import { tableSource } from '../../src/rag/tables';
import { sampleContext, sampleModelInput } from './sample-context';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const TRANSCRIPTS_DIR = path.join(ROOT, 'data/rag/transcripts');

export interface LiveQuestion {
  id: string;
  lang: Lang;
  /** A demo field: its context and its telemetry go with the question. */
  field?: string;
  question: string;
  expect: 'answer' | 'no-data' | 'declined' | 'router';
}

export interface Transcript extends LiveQuestion {
  askedAt: string;
  intent: string;
  mode: AskResult['mode'];
  /** Why no generated answer was given; null when one was. */
  fallback: string | null;
  provider: string | null;
  model: string | null;
  /** Requests made to the model; 0 when it was not asked. */
  requests: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  calls: AskTrace['calls'];
  numberGuard: { passed: boolean; unsupported: string[] };
  /** What the model wrote, when that is not the answer given. */
  modelAnswer?: string;
  answer: string;
  citations: { n: number; chunkId: string; title: string; source: string; license: string }[];
}

export function readQuestions(): LiveQuestion[] {
  return (JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS_DIR, 'questions.json'), 'utf8')) as { questions: LiveQuestion[] }).questions;
}

export function readTranscripts(): Transcript[] {
  return fs
    .readdirSync(TRANSCRIPTS_DIR)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS_DIR, f), 'utf8')) as Transcript);
}

/** The summary of the transcripts on disk, as Markdown. */
export function summary(all: Transcript[]): string {
  const asked = all.filter((t) => t.requests > 0);
  const generated = all.filter((t) => t.mode === 'generative');
  const sum = (f: (t: Transcript) => number) => asked.reduce((a, t) => a + f(t), 0);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const models = [...new Set(asked.map((t) => `${t.provider} ${t.model}`))].join(', ') || 'none';
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const lines = [
    '# Live run of the generative mode',
    '',
    'Written by `npx tsx scripts/rag/live-run.ts` from the transcripts in this folder; do not edit by hand. One file per question of `questions.json`: the question, each function called with its input and result, the answer, the model, the tokens, the time and what the number check found. No key and no header is in any of them.',
    '',
    `- Questions: ${all.length} (${all.filter((t) => t.lang === 'vi').length} in Vietnamese, ${all.filter((t) => t.lang === 'en').length} in English); with a demo field: ${all.filter((t) => t.field).length}.`,
    `- Asked of the model: ${asked.length} (${models}); answered by the router without the model (declined, or a species the atlas dropped): ${all.length - asked.length}.`,
    `- Generated answers given: ${generated.length}. Extractive answer given in place of a generated one: ${asked.length - generated.length}${asked.length - generated.length ? ` (${asked.filter((t) => t.mode !== 'generative').map((t) => `${t.id}: ${t.fallback}`).join('; ')})` : ''}.`,
    `- Number check: ${asked.filter((t) => t.numberGuard.passed).length} of ${asked.length} answers of the model held only numbers of their sources.`,
    `- Function calls: ${sum((t) => t.calls.length)} in all, ${sum((t) => t.calls.filter((c) => c.isError).length)} failed; requests to the model: ${sum((t) => t.requests)}.`,
    `- Tokens: ${sum((t) => t.inputTokens)} in, ${sum((t) => t.outputTokens)} out. Time per answer: median ${(median(asked.map((t) => t.ms)) / 1000).toFixed(1)} s, longest ${(Math.max(0, ...asked.map((t) => t.ms)) / 1000).toFixed(1)} s.`,
    `- Asked between ${all.map((t) => t.askedAt).sort()[0] ?? '-'} and ${all.map((t) => t.askedAt).sort().at(-1) ?? '-'}.`,
    '',
    '| # | Lang | Field | Question | Expect | Mode | Functions called | Requests | Tokens in / out | Time | Numbers without a source |',
    '|---|---|---|---|---|---|---|---:|---:|---:|---|',
    ...all.map((t) =>
      [
        '',
        t.id,
        t.lang,
        t.field ?? '',
        cell(t.question),
        t.expect,
        t.mode === 'generative' ? 'generative' : `extractive (${t.fallback ?? 'no model'})`,
        t.calls.map((c) => `${c.name}${c.isError ? ' (failed)' : ''}`).join(', '),
        String(t.requests),
        t.requests ? `${t.inputTokens} / ${t.outputTokens}` : '',
        t.requests ? `${(t.ms / 1000).toFixed(1)} s` : '',
        t.requests ? (t.numberGuard.unsupported.join(', ') || 'none') : '',
        '',
      ]
        .join(' | ')
        .trim(),
    ),
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const cfg = llmConfigFromEnv();
  if (!cfg) throw new Error('No key is configured: put GEMINI_API_KEY or ANTHROPIC_API_KEY in .env');
  const only = process.argv.slice(2);
  const questions = readQuestions().filter((q) => !only.length || only.includes(q.id));

  const store = new KnowledgeStore(fileLoader(path.join(ROOT, 'public/rag')));
  await store.ensureFull();
  const traces: AskTrace[] = [];
  const app = createApp({
    store,
    llm: createLlm(cfg),
    systemPrompt: buildSystemPrompt(fs.readFileSync(path.join(ROOT, 'docs/SYSTEM_INSTRUCTIONS.md'), 'utf8')),
    tables: tableSource(fileReader(path.join(ROOT, 'public'))),
    trace: (t) => traces.push(t),
  });

  for (const q of questions) {
    const body = { query: q.question, lang: q.lang, ...(q.field ? { context: sampleContext(q.field), field: sampleModelInput(q.field) } : {}) };
    const askedAt = new Date().toISOString();
    const res = await app.request('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Question ${q.id}: HTTP ${res.status}`);
    const result = (await res.json()) as AskResult;
    const t = traces.pop();
    if (!t) throw new Error(`Question ${q.id}: no trace`);
    // The router answers some questions itself (declined, or a species the atlas dropped): the model is then not asked.
    const asked = t.iterations != null || t.modelAnswer != null || (t.fallback != null && !/router/.test(t.fallback));
    const transcript: Transcript = {
      ...q,
      askedAt,
      intent: t.intent,
      mode: result.mode,
      fallback: t.fallback ?? null,
      provider: asked ? (t.provider ?? null) : null,
      model: asked ? (t.model ?? null) : null,
      requests: t.iterations ?? (asked ? Math.max(1, t.calls.length) : 0),
      inputTokens: t.inputTokens ?? 0,
      outputTokens: t.outputTokens ?? 0,
      ms: t.ms,
      calls: t.calls,
      numberGuard: { passed: t.unsupportedNumbers.length === 0, unsupported: t.unsupportedNumbers },
      ...(t.modelAnswer && result.mode !== 'generative' ? { modelAnswer: t.modelAnswer } : {}),
      answer: result.answer,
      citations: result.citations.map((c, i) => ({ n: i + 1, chunkId: c.chunkId, title: c.title, source: c.source, license: c.license })),
    };
    const text = `${JSON.stringify(transcript, null, 1)}\n`;
    if (text.includes(cfg.apiKey)) throw new Error(`Question ${q.id}: the transcript would contain the key; nothing was written`);
    fs.writeFileSync(path.join(TRANSCRIPTS_DIR, `${q.id}.json`), text);
    console.log(`${q.id} ${q.lang} ${result.mode}${t.fallback ? ` (${t.fallback})` : ''}: ${transcript.requests} requests, ${t.calls.map((c) => c.name).join(',') || 'no calls'}, ${transcript.inputTokens}/${transcript.outputTokens} tokens, ${(t.ms / 1000).toFixed(1)} s${t.unsupportedNumbers.length ? `, numbers without a source: ${t.unsupportedNumbers.join(', ')}` : ''}`);
    // One question at a time, with a pause: the provider's rate limit is per minute.
    await new Promise((r) => setTimeout(r, 1500));
  }
  fs.writeFileSync(path.join(TRANSCRIPTS_DIR, 'README.md'), summary(readTranscripts()));
  console.log(`Wrote ${questions.length} transcripts and README.md to ${path.relative(ROOT, TRANSCRIPTS_DIR)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();
