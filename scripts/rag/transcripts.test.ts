/**
 * The transcripts of the live run (data/rag/transcripts, written by scripts/rag/live-run.ts): that
 * they are all there, that each says which model answered and what it cost, and that none of them
 * holds a key or a header.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readQuestions, readTranscripts, summary, TRANSCRIPTS_DIR } from './live-run';

const questions = readQuestions();
const transcripts = readTranscripts();
const files = fs.readdirSync(TRANSCRIPTS_DIR);

describe('the questions of the live run', () => {
  it('are 30: 15 in Vietnamese and 15 in English, on the four demo fields and on none', () => {
    expect(questions).toHaveLength(30);
    expect(questions.filter((q) => q.lang === 'vi')).toHaveLength(15);
    expect(questions.filter((q) => q.lang === 'en')).toHaveLength(15);
    expect(new Set(questions.map((q) => q.field).filter(Boolean))).toEqual(new Set(['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa']));
    expect(questions.filter((q) => q.expect === 'declined').length).toBeGreaterThanOrEqual(4);
    expect(questions.filter((q) => q.expect === 'no-data').length).toBeGreaterThanOrEqual(3);
  });
});

describe('the transcripts', () => {
  it('are one per question, of that question', () => {
    expect(transcripts.map((t) => t.id)).toEqual(questions.map((q) => q.id));
    for (const [i, t] of transcripts.entries()) expect({ lang: t.lang, field: t.field, question: t.question }).toEqual({ lang: questions[i].lang, field: questions[i].field, question: questions[i].question });
  });

  it('name the model and count the tokens of every answer the model was asked for', () => {
    const asked = transcripts.filter((t) => t.requests > 0);
    expect(asked.length).toBeGreaterThanOrEqual(20);
    for (const t of asked) {
      expect(t.provider, t.id).toMatch(/^(gemini|anthropic)$/);
      expect(t.model, t.id).toMatch(/^(gemini|claude)-/);
      expect(t.inputTokens, t.id).toBeGreaterThan(0);
      expect(t.outputTokens, t.id).toBeGreaterThan(0);
      expect(t.ms, t.id).toBeGreaterThan(0);
      expect(t.requests, t.id).toBeLessThanOrEqual(5);
      expect(Date.parse(t.askedAt), t.id).toBeGreaterThan(Date.parse('2026-11-15'));
    }
  });

  it('record each function called with its input and its result', () => {
    const calls = transcripts.flatMap((t) => t.calls.map((c) => ({ id: t.id, ...c })));
    expect(calls.length).toBeGreaterThanOrEqual(15);
    for (const c of calls) {
      expect(c.name, c.id).toMatch(/^(cropsInPlace|whereGrown|cropFigures|compareCrops|fieldSuitability|rotationOptions|soilPlan|priceAndMargin)$/);
      expect(c.input, c.id).toBeTypeOf('object');
      expect(c.output, c.id).toBeDefined();
    }
    // Lookups of more than one kind were used, some on a locked field.
    expect(new Set(calls.map((c) => c.name)).size).toBeGreaterThanOrEqual(5);
  });

  it('give a generated answer only where the number check passed, and say why where none was given', () => {
    for (const t of transcripts) {
      if (t.mode === 'generative') {
        expect(t.numberGuard, t.id).toEqual({ passed: true, unsupported: [] });
        expect(t.fallback, t.id).toBeNull();
      } else expect(t.fallback, t.id).toBeTruthy();
      if (!t.numberGuard.passed) expect(t.fallback, t.id).toBe('UnsupportedNumbers');
      // Every citation mark of the answer has its source.
      for (const m of t.answer.matchAll(/\[S(\d+)\]/g)) expect(Number(m[1]), t.id).toBeLessThanOrEqual(t.citations.length);
    }
  });

  it('do not ask the model what the router declines', () => {
    for (const t of transcripts.filter((x) => x.expect === 'declined' || x.expect === 'router')) {
      expect(t.requests, t.id).toBe(0);
      expect(t.model, t.id).toBeNull();
      expect(t.fallback, t.id).toMatch(/router/);
    }
  });

  it('hold no key and no header', () => {
    // Shapes of keys of the two providers, and the names of the headers that carry them. The
    // patterns are put together here so that this file does not itself match a search for a key.
    const secrets = [new RegExp(`sk-${'ant'}`), /AIza[0-9A-Za-z_-]{20,}/, /\bAQ\.[0-9A-Za-z_-]{20,}/, /x-goog-api-key/i, /x-api-key/i, /authorization/i, /bearer /i];
    const envFile = path.resolve(TRANSCRIPTS_DIR, '../../../.env');
    const keys = fs.existsSync(envFile) ? [...fs.readFileSync(envFile, 'utf8').matchAll(/^[A-Z_]*(?:KEY|TOKEN)[A-Z_]*=(.{12,})$/gm)].map((m) => m[1].trim()) : [];
    for (const f of files) {
      const text = fs.readFileSync(path.join(TRANSCRIPTS_DIR, f), 'utf8');
      for (const re of secrets) expect(re.test(text), `${f} matches ${re}`).toBe(false);
      for (const key of keys) expect(text.includes(key), `${f} holds a key of .env`).toBe(false);
    }
  });

  it('are summarised by the README beside them', () => {
    expect(fs.readFileSync(path.join(TRANSCRIPTS_DIR, 'README.md'), 'utf8')).toBe(summary(transcripts));
  });
});
