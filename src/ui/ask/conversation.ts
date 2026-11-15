/**
 * The assistant's conversation as plain data: a reducer over turns, and the choice of the starter
 * questions shown on an empty chat. No React and no engine here, so both are tested in isolation.
 */
import type { AskResult, Lang } from '@/contracts';

export interface ChatTurn {
  id: number;
  query: string;
  lang: Lang;
  /** Whether the question went out with the open field's data. */
  aboutField: boolean;
  /** Null while the answer is being computed. */
  result: AskResult | null;
}

export interface Conversation {
  turns: ChatTurn[];
  nextId: number;
}

export type ChatAction =
  | { type: 'ask'; query: string; lang: Lang; aboutField: boolean }
  | { type: 'answer'; id: number; result: AskResult }
  | { type: 'clear' };

export const EMPTY_CONVERSATION: Conversation = { turns: [], nextId: 1 };

/** One question at a time: the engine answers in order and the composer is locked meanwhile. */
export const isAnswering = (c: Pick<Conversation, 'turns'>): boolean => c.turns.some((turn) => turn.result === null);

export function chatReducer(state: Conversation, action: ChatAction): Conversation {
  switch (action.type) {
    case 'ask': {
      const query = action.query.trim();
      if (!query || isAnswering(state)) return state;
      return {
        turns: [...state.turns, { id: state.nextId, query, lang: action.lang, aboutField: action.aboutField, result: null }],
        nextId: state.nextId + 1,
      };
    }
    case 'answer': {
      // An answer that arrives after "New chat" belongs to a conversation that no longer exists.
      if (!state.turns.some((turn) => turn.id === action.id && turn.result === null)) return state;
      return { ...state, turns: state.turns.map((turn) => (turn.id === action.id ? { ...turn, result: action.result } : turn)) };
    }
    case 'clear':
      // Ids keep counting so a late answer can never land on a new turn with a reused id.
      return { turns: [], nextId: state.nextId };
  }
}

/** Follow-up chips belong under the newest answer only, and not while it is still being written. */
export function followUpsOf(state: Pick<Conversation, 'turns'>): string[] {
  const last = state.turns.at(-1);
  return last?.result ? last.result.followUps.slice(0, 4) : [];
}

const FIELD_STATUS: Record<Lang, string> = { en: 'How is my field doing?', vi: 'Ruộng của tôi thế nào?' };
const GENERAL_EXTRA: Record<Lang, string[]> = {
  en: ['What can I rotate with rice?', 'Which cover crop suits a dry season?'],
  vi: ['Có thể luân canh gì với lúa?', 'Cây che phủ nào hợp với mùa khô?'],
};

/**
 * Four starter questions for an empty chat. `engine` is the engine's own list
 * (`suggestQuestions`), already tailored to the field and its crop; with a field open the chat
 * leads with the question about the field as a whole. Wording the engine routes well was checked
 * against the extractive answers (field status, rotation, comparison).
 */
export function chatStarters(engine: string[], hasField: boolean, lang: Lang): string[] {
  const lead = hasField ? [FIELD_STATUS[lang]] : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of [...lead, ...engine, ...GENERAL_EXTRA[lang]]) {
    const key = q.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q.trim());
    if (out.length === 4) break;
  }
  return out;
}
