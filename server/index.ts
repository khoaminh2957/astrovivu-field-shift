/**
 * `npm run server` — optional local API server on port 8787 (Vite proxies /api to it).
 * Generative answers need ANTHROPIC_API_KEY in the environment or in `.env`; without it the
 * server still answers /api/ask extractively and /api/health reports `generative: false`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { buildSystemPrompt } from '../src/rag/prompt';
import { KnowledgeStore } from '../src/rag/store';
import { createApp } from './app';
import { createLlm, llmConfigFromEnv } from './llm';
import { fileLoader } from './loader';

const ROOT = path.resolve(import.meta.dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const systemPrompt = buildSystemPrompt(fs.readFileSync(path.join(ROOT, 'docs/SYSTEM_INSTRUCTIONS.md'), 'utf8'));
const store = new KnowledgeStore(fileLoader(path.join(ROOT, 'public/rag')));
const cfg = llmConfigFromEnv();
const llm = cfg ? createLlm(cfg) : null;
const port = Number(process.env.PORT ?? 8787);

const app = createApp({ store, llm, systemPrompt, log: (m) => console.log(`[api] ${m}`) });
await store.ensureFull();
serve({ fetch: app.fetch, port }, () => {
  console.log(`[api] listening on http://localhost:${port} (generative: ${llm ? `yes, ${llm.model}` : 'no, ANTHROPIC_API_KEY not set'}; ${store.chunks.size} chunks loaded)`);
});
