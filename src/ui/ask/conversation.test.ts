import { describe, expect, it } from 'vitest';
import type { AskResult } from '@/contracts';
import { EMPTY_CONVERSATION, chatReducer, chatStarters, followUpsOf, isAnswering } from './conversation';

const answer = (followUps: string[] = []): AskResult => ({ answer: 'Soil pH 5.6 [S1]', mode: 'extractive', citations: [], followUps, confidence: 0.7 });

describe('chatReducer', () => {
  it('adds a question as a pending turn and numbers turns in order', () => {
    const s = chatReducer(EMPTY_CONVERSATION, { type: 'ask', query: '  What is NDVI?  ', lang: 'en', aboutField: false });
    expect(s.turns).toEqual([{ id: 1, query: 'What is NDVI?', lang: 'en', aboutField: false, result: null }]);
    expect(s.nextId).toBe(2);
    expect(isAnswering(s)).toBe(true);
  });

  it('ignores an empty question and a second question while one is pending', () => {
    expect(chatReducer(EMPTY_CONVERSATION, { type: 'ask', query: '   ', lang: 'en', aboutField: false })).toBe(EMPTY_CONVERSATION);
    const one = chatReducer(EMPTY_CONVERSATION, { type: 'ask', query: 'a', lang: 'en', aboutField: false });
    expect(chatReducer(one, { type: 'ask', query: 'b', lang: 'en', aboutField: false })).toBe(one);
  });

  it('puts the answer on its turn and frees the composer', () => {
    const asked = chatReducer(EMPTY_CONVERSATION, { type: 'ask', query: 'a', lang: 'vi', aboutField: true });
    const done = chatReducer(asked, { type: 'answer', id: 1, result: answer(['next?']) });
    expect(done.turns[0].result?.answer).toBe('Soil pH 5.6 [S1]');
    expect(isAnswering(done)).toBe(false);
    expect(followUpsOf(done)).toEqual(['next?']);
  });

  it('drops an answer that arrives after New chat, and never reuses an id', () => {
    const asked = chatReducer(EMPTY_CONVERSATION, { type: 'ask', query: 'a', lang: 'en', aboutField: false });
    const cleared = chatReducer(asked, { type: 'clear' });
    expect(cleared.turns).toEqual([]);
    expect(chatReducer(cleared, { type: 'answer', id: 1, result: answer() })).toBe(cleared);
    const again = chatReducer(cleared, { type: 'ask', query: 'b', lang: 'en', aboutField: false });
    expect(again.turns[0].id).toBe(2);
    expect(chatReducer(again, { type: 'answer', id: 1, result: answer() })).toBe(again);
  });

  it('shows follow-ups only under the newest, finished answer', () => {
    let s = chatReducer(EMPTY_CONVERSATION, { type: 'ask', query: 'a', lang: 'en', aboutField: false });
    s = chatReducer(s, { type: 'answer', id: 1, result: answer(['x', 'y', 'z', 'w', 'v']) });
    expect(followUpsOf(s)).toEqual(['x', 'y', 'z', 'w']);
    s = chatReducer(s, { type: 'ask', query: 'b', lang: 'en', aboutField: false });
    expect(followUpsOf(s)).toEqual([]);
  });
});

describe('chatStarters', () => {
  it('leads with the field as a whole when a field is open, then the engine list, four in all', () => {
    const engine = ['Is my soil too acid for robusta coffee?', 'What does root-zone moisture mean here?', 'What could I rotate with robusta coffee?'];
    expect(chatStarters(engine, true, 'en')).toEqual(['How is my field doing?', ...engine]);
  });

  it('fills a short engine list with general questions in the visitor language, without repeats', () => {
    const vi = chatStarters(['NDVI là gì?', 'ndvi là gì? '], false, 'vi');
    expect(vi).toEqual(['NDVI là gì?', 'Có thể luân canh gì với lúa?', 'Cây che phủ nào hợp với mùa khô?']);
    const en = chatStarters(['What conditions does soybean need?', 'What is NDVI?', 'How is satellite data different from ground measurements?'], false, 'en');
    expect(en).toHaveLength(4);
    expect(en[3]).toBe('What can I rotate with rice?');
    expect(en).not.toContain('How is my field doing?');
  });
});
