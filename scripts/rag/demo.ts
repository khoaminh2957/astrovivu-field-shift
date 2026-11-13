/** `npx tsx scripts/rag/demo.ts "question" [vi] [field]` — print an extractive answer (dev aid). */
import { answerExtractive } from '../../src/rag/engine';
import { FIXTURE_CONTEXT, loadStore } from './eval';

const [q, lang = 'en', field] = process.argv.slice(2);
const store = await loadStore();
const r = await answerExtractive(store, { query: q, lang: lang === 'vi' ? 'vi' : 'en', context: field ? FIXTURE_CONTEXT : undefined });
console.log(`intent=${r.retrieval.analysis.intent} crops=${r.retrieval.analysis.cropIds.join(',')} terms=${r.retrieval.analysis.termIds.join(',')} conf=${r.confidence}`);
console.log(r.answer);
console.log('--- citations');
for (const [i, c] of r.citations.entries()) console.log(`[S${i + 1}] ${c.title} | ${c.source} | ${c.license}`);
console.log('--- follow-ups:', r.followUps.join(' | '));
