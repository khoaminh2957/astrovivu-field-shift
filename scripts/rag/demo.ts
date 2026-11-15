/**
 * `npx tsx scripts/rag/demo.ts "question" [en|vi] [field|<demo field id>]` prints an extractive
 * answer (dev aid). `field` asks with the fixture context of eval.ts; a demo field id
 * (`daklak-coffee`, `cantho-rice`, `iowa-corn-soy`, `nevada-alfalfa`) asks with the context the
 * app builds from that field's cached telemetry.
 */
import { answerExtractive } from '../../src/rag/engine';
import { FIXTURE_CONTEXT, loadStore } from './eval';
import { sampleContext } from './sample-context';

const [q, lang = 'en', field] = process.argv.slice(2);
const store = await loadStore();
const context = !field ? undefined : field === 'field' ? FIXTURE_CONTEXT : sampleContext(field);
const r = await answerExtractive(store, { query: q, lang: lang === 'vi' ? 'vi' : 'en', context });
const a = r.retrieval.analysis;
console.log(`intent=${a.intent}${a.ask ? ` ask=${a.ask}` : ''}${a.outOfScope ? ` declined=${a.outOfScope}` : ''} focus=${a.focus.join(',')} crops=${a.cropIds.join(',')} terms=${a.termIds.join(',')} conf=${r.confidence}`);
console.log(r.answer);
console.log('--- citations');
for (const [i, c] of r.citations.entries()) console.log(`[S${i + 1}] ${c.title} | ${c.source} | ${c.license}`);
console.log('--- follow-ups:', r.followUps.join(' | '));
