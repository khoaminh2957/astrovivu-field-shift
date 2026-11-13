/** The farmer's own journal entries, kept in this browser per parcel. Never simulated. */
import { useCallback, useEffect, useState } from 'react';
import type { JournalEntry } from '@/contracts';

const key = (parcelId: string) => `astrovivu.journal.${parcelId}`;

function read(parcelId: string): JournalEntry[] {
  try {
    const raw = localStorage.getItem(key(parcelId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as JournalEntry[]).map((e) => ({ ...e, simulated: false })) : [];
  } catch {
    return [];
  }
}

export function useOwnJournal(parcelId: string | null) {
  const [entries, setEntries] = useState<JournalEntry[]>(() => (parcelId ? read(parcelId) : []));
  useEffect(() => {
    setEntries(parcelId ? read(parcelId) : []);
  }, [parcelId]);

  const save = useCallback(
    (next: JournalEntry[]) => {
      setEntries(next);
      if (!parcelId) return;
      try {
        localStorage.setItem(key(parcelId), JSON.stringify(next));
      } catch {
        // Storage full or blocked: the entry stays for this session only.
      }
    },
    [parcelId],
  );

  const add = useCallback((e: Omit<JournalEntry, 'id' | 'simulated'>) => save([{ ...e, id: `own-${Date.now()}`, simulated: false }, ...entries]), [entries, save]);
  const remove = useCallback((id: string) => save(entries.filter((e) => e.id !== id)), [entries, save]);
  return { entries, add, remove };
}
