/**
 * `npm run server` — optional local API server on port 8787 (Vite proxies /api to it).
 * Generative answers need a key in the environment or in `.env`: ANTHROPIC_API_KEY for Claude or
 * GEMINI_API_KEY for Gemini (server/llm.ts says which wins). Without one the server still answers
 * /api/ask extractively and /api/health reports `generative: false`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { buildSystemPrompt } from '../src/rag/prompt';
import { KnowledgeStore } from '../src/rag/store';
import { tableSource } from '../src/rag/tables';
import { createApp } from './app';
import { createLlm, llmConfigFromEnv } from './llm';
import { fileLoader, fileReader } from './loader';

const ROOT = path.resolve(import.meta.dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const systemPrompt = buildSystemPrompt(fs.readFileSync(path.join(ROOT, 'docs/SYSTEM_INSTRUCTIONS.md'), 'utf8'));
const store = new KnowledgeStore(fileLoader(path.join(ROOT, 'public/rag')));
const cfg = llmConfigFromEnv();
const llm = cfg ? createLlm(cfg) : null;
const port = Number(process.env.PORT ?? 8787);

// The lookup tables are built by `npm run rag:build`. Without them the model answers from the
// passages and the field context alone, as before the lookups existed.
const tables = tableSource(fileReader(path.join(ROOT, 'public')));
const hasTables = await tables.crops().then(
  () => true,
  () => false,
);

const app = createApp({ store, llm, systemPrompt, ...(hasTables ? { tables } : {}), log: (m) => console.log(`[api] ${m}`) });
await store.ensureFull();
serve({ fetch: app.fetch, port }, () => {
  const generative = llm ? `yes, ${llm.provider} ${llm.model}, lookup functions ${hasTables ? 'on' : 'off: public/rag/tables is missing'}` : 'no, neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set';
  console.log(`[api] listening on http://localhost:${port} (generative: ${generative}; ${store.chunks.size} chunks loaded)`);
});
