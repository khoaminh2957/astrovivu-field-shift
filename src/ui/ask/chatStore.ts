/**
 * The assistant's conversation for the session. It lives outside the page so it survives a trip to
 * another page and back; it is never written to storage, so a reload starts a new chat.
 */
import { create } from 'zustand';
import type { AskResult, FieldContext, Lang } from '@/contracts';
import { ask } from '@/rag';
import { useMission } from '@/state/mission';
import { type ChatAction, type Conversation, EMPTY_CONVERSATION, chatReducer, isAnswering } from './conversation';

interface ChatState extends Conversation {
  /** What is typed in the composer, kept with the conversation. */
  draft: string;
  /** Send the open field's data with each question; the visitor can turn it off for general questions. */
  useField: boolean;
  setDraft(draft: string): void;
  setUseField(on: boolean): void;
  dispatch(action: ChatAction): void;
  /** Asks the engine; `failed` is the answer shown when it throws (already translated). */
  send(query: string, lang: Lang, context: FieldContext | undefined, failed: string): Promise<void>;
}

export const useChat = create<ChatState>()((set, get) => ({
  ...EMPTY_CONVERSATION,
  draft: '',
  useField: true,
  setDraft: (draft) => set({ draft }),
  setUseField: (useField) => set({ useField }),
  dispatch: (action) => set((s) => chatReducer(s, action)),
  send: async (query, lang, context, failed) => {
    const before = get();
    if (!query.trim() || isAnswering(before)) return;
    const id = before.nextId;
    get().dispatch({ type: 'ask', query, lang, aboutField: !!context });
    let result: AskResult;
    try {
      result = await ask({ query: query.trim(), lang, context });
    } catch {
      result = { answer: failed, mode: 'extractive', citations: [], followUps: [], confidence: 0 };
    }
    get().dispatch({ type: 'answer', id, result });
  },
}));

/** Opens the assistant's page, optionally with a question already typed in the composer. */
export function openAssistant(draft?: string): void {
  if (draft) useChat.getState().setDraft(draft);
  useMission.getState().setPhase('ask');
}
