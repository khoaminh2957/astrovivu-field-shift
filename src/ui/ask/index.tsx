/** PLACEHOLDER (owner: Agent 4b, on top of the Agent 6 RAG API). Floating crop-knowledge assistant. */
import { useState } from 'react';
import type { AskResult } from '@/contracts';
import { ask } from '@/rag';
import { useMission } from '@/state/mission';
import { box, btn } from '../_placeholder';

export function AskPanel() {
  const { askOpen, setAskOpen, lang, phase } = useMission();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  if (phase === 'hero') return null;
  if (!askOpen) return <button style={{ ...btn, position: 'absolute', right: 12, bottom: 100, zIndex: 20 }} onClick={() => setAskOpen(true)}>ask</button>;
  return (
    <div style={{ ...box, right: 12, bottom: 100, width: 320, zIndex: 20 }} data-placeholder="ask">
      <button style={btn} onClick={() => setAskOpen(false)}>close</button>
      <form onSubmit={(e) => { e.preventDefault(); void ask({ query, lang }).then(setResult); }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: '100%' }} placeholder="ask about a crop or this field" />
      </form>
      <div>{result?.answer}</div>
    </div>
  );
}
