/**
 * Text helpers for crop ids and search. `slugify` must stay identical to `src/rag/text.ts`
 * (crop ids are the slug of the EcoCrop scientific name on both sides).
 */

/** Lower-case and strip diacritics, so `dau phong` finds `Đậu phộng`. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

/** Slug of a scientific name: `Coffea canephora` -> `coffea-canephora`. */
export function slugify(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
