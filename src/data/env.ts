/**
 * Runtime detection shared by the isomorphic adapters. The same TypeScript runs in the browser
 * (Vite bundle) and in Node 24 (tsx scripts, vitest), so nothing here may statically import a Node
 * built-in.
 */

export const isNode: boolean =
  typeof process !== 'undefined' && typeof process.versions === 'object' && !!process.versions?.node && typeof window === 'undefined';

/** Server/script-only secrets. Always undefined in the browser bundle (rule 6 of AGENTS.md). */
export function serverSecret(name: 'EARTHDATA_TOKEN'): string | undefined {
  if (!isNode) return undefined;
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

interface ViteEnvLike {
  BASE_URL?: string;
  VITE_DATA_MODE?: string;
}

/** `import.meta.env` exists under Vite and vitest but not under plain tsx. */
export function viteEnv(): ViteEnvLike {
  try {
    return ((import.meta as unknown as { env?: ViteEnvLike }).env ?? {}) as ViteEnvLike;
  } catch {
    return {};
  }
}

/**
 * Dynamic import that bundlers must not follow (Node-only modules such as `node:fs` or `pngjs`).
 * The specifier is passed through a variable so Vite leaves it alone.
 */
export async function nodeImport<T>(specifier: string): Promise<T> {
  const spec = specifier;
  return (await import(/* @vite-ignore */ spec)) as T;
}
