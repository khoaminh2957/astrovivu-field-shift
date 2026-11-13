/**
 * Layout fixtures, development only. A fixture is invented content: showing it in a normal
 * session would present a fabricated recommendation as real, so it loads only when the dev
 * server runs AND the URL carries `?fixture=1`. Call sites pass the loader behind
 * `import.meta.env.DEV ? () => import(...) : null` so production builds drop the fixture code.
 */
import { useEffect, useState } from 'react';

export function fixtureRequested(): boolean {
  return import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fixture') === '1';
}

export function useFixture<T>(load: (() => Promise<T>) | null): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!load || !fixtureRequested()) return;
    let alive = true;
    // Wrapped so a fixture that is itself a function is stored, not called as an updater.
    void load().then((v) => alive && setValue(() => v));
    return () => {
      alive = false;
    };
    // The loader is a module import: it is stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}
