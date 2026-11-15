import { describe, expect, it } from 'vitest';
import type { PlaceHit } from '@/contracts';
import { fold, highlight, matchesQuery, mergeSuggestions, moveIndex, parseLatLon, splitPlaceLabel, type FieldEntry } from './searchModel';

const demo: FieldEntry = { id: 'nevada-alfalfa', name: 'Diamond Valley alfalfa pivot', centroid: [-115.96894, 39.71961], place: { label: 'Nevada, United States' } };
const own: FieldEntry = { id: 'p1', name: 'Ruộng nhà', centroid: [106.03, 10.4], place: { label: 'Cai Lậy, Tiền Giang, Việt Nam' } };
const place = (label: string, lon: number, lat: number): PlaceHit => ({ label, location: [lon, lat] });
const caiLay = place('Cai Lậy, Tiền Giang, Việt Nam', 106.1167, 10.4);
const caiBe = place('Cái Bè, Tiền Giang, Việt Nam', 105.9333, 10.3333);

describe('parseLatLon', () => {
  it('reads latitude first, with a comma, a semicolon or a space', () => {
    expect(parseLatLon('12.68, 108.05')).toEqual([108.05, 12.68]);
    expect(parseLatLon(' 39.71961 -115.96894 ')).toEqual([-115.96894, 39.71961]);
    expect(parseLatLon('10.4;106.1')).toEqual([106.1, 10.4]);
  });
  it('reads the minus sign U+2212 that fmtNum writes, so a picked point put back in the box is still a coordinate', () => {
    expect(parseLatLon('34.77275, −96.79985')).toEqual([-96.79985, 34.77275]);
    expect(parseLatLon('−8.05, −35.2')).toEqual([-35.2, -8.05]);
  });
  it('rejects text and values off the globe', () => {
    expect(parseLatLon('Cai Lậy')).toBeNull();
    expect(parseLatLon('95, 10')).toBeNull();
    expect(parseLatLon('10, 190')).toBeNull();
    expect(parseLatLon('12.68')).toBeNull();
  });
});

describe('fold and matchesQuery', () => {
  it('drops case and Vietnamese diacritics, in composed and decomposed form', () => {
    expect(fold('Đắk Lắk')).toBe('dak lak');
    expect(fold('Cai Lậy'.normalize('NFD'))).toBe('cai lay');
  });
  it('wants every typed word to begin a word of the text', () => {
    expect(matchesQuery('Diamond Valley alfalfa pivot Nevada, United States', 'nev')).toBe(true);
    expect(matchesQuery('Diamond Valley alfalfa pivot Nevada, United States', 'valley dia')).toBe(true);
    expect(matchesQuery('Diamond Valley alfalfa pivot Nevada, United States', 'lfa')).toBe(false);
    expect(matchesQuery('Diamond Valley alfalfa pivot Nevada, United States', 'diamond hanoi')).toBe(false);
    expect(matchesQuery('Cai Lậy, Tiền Giang', 'cai lay tien')).toBe(true);
    expect(matchesQuery('anything', '  ')).toBe(false);
  });
});

describe('highlight', () => {
  it('marks the typed part and keeps the text whole', () => {
    expect(highlight('Cai Lậy', 'Cai')).toEqual([
      { text: 'Cai', bold: true },
      { text: ' Lậy', bold: false },
    ]);
  });
  it('matches without diacritics and keeps them in the bold part', () => {
    const parts = highlight('Cái Bè', 'cai b');
    expect(parts).toEqual([
      { text: 'Cái', bold: true },
      { text: ' ', bold: false },
      { text: 'B', bold: true },
      { text: 'è', bold: false },
    ]);
    expect(parts.map((p) => p.text).join('')).toBe('Cái Bè');
  });
  it('keeps a combining mark with its letter', () => {
    const nfd = 'Lậy'.normalize('NFD');
    const parts = highlight(nfd, 'la');
    expect(parts[0]).toEqual({ text: nfd.slice(0, 4), bold: true });
    expect(parts.map((p) => p.text).join('')).toBe(nfd);
  });
  it('leaves text with no match in one plain part', () => {
    expect(highlight('Nevada', 'xyz')).toEqual([{ text: 'Nevada', bold: false }]);
    expect(highlight('Nevada', '')).toEqual([{ text: 'Nevada', bold: false }]);
  });
  it('does not mark the middle of a word', () => {
    expect(highlight('alfalfa', 'fa')).toEqual([{ text: 'alfalfa', bold: false }]);
  });
});

describe('splitPlaceLabel', () => {
  it('takes the first part as the title and the last two as the detail', () => {
    expect(splitPlaceLabel('Cai Lậy, Tiền Giang, Việt Nam')).toEqual({ title: 'Cai Lậy', detail: 'Tiền Giang, Việt Nam' });
    expect(splitPlaceLabel('Eureka, Eureka County, Nevada, 89316, United States')).toEqual({ title: 'Eureka', detail: 'Nevada, United States' });
    expect(splitPlaceLabel('Cai Lậy, Cai Lậy, Tiền Giang')).toEqual({ title: 'Cai Lậy', detail: 'Tiền Giang' });
    expect(splitPlaceLabel('Vietnam')).toEqual({ title: 'Vietnam', detail: undefined });
    expect(splitPlaceLabel('Caius College, Cambridge, CB2 1TA, United Kingdom')).toEqual({ title: 'Caius College', detail: 'Cambridge, United Kingdom' });
    expect(splitPlaceLabel('Chợ Bến Thành, Quận 1, Việt Nam')).toEqual({ title: 'Chợ Bến Thành', detail: 'Quận 1, Việt Nam' });
  });
});

describe('mergeSuggestions', () => {
  it('returns nothing for an empty query', () => {
    expect(mergeSuggestions({ query: '  ', own, demo, places: [caiLay] })).toEqual([]);
  });
  it('orders own field, demo field, then places', () => {
    const rows = mergeSuggestions({ query: 'cai', own, demo: { ...demo, name: 'Cai Lậy rice field' }, places: [caiLay, caiBe] });
    expect(rows.map((r) => r.kind)).toEqual(['own', 'demo', 'place', 'place']);
    expect(rows[2]).toMatchObject({ title: 'Cai Lậy', detail: 'Tiền Giang, Việt Nam', location: [106.1167, 10.4] });
  });
  it('lists a field only when its name, its place or its kind word matches', () => {
    expect(mergeSuggestions({ query: 'cai', own: null, demo, places: [caiLay] }).map((r) => r.kind)).toEqual(['place']);
    expect(mergeSuggestions({ query: 'nevada', demo }).map((r) => r.kind)).toEqual(['demo']);
    expect(mergeSuggestions({ query: 'thửa mẫu', demo, demoWords: 'Thửa mẫu' }).map((r) => r.kind)).toEqual(['demo']);
    expect(mergeSuggestions({ query: 'your', own, ownWords: 'Your field' }).map((r) => r.kind)).toEqual(['own']);
  });
  it('does not list the same field twice when the demo is the open field', () => {
    expect(mergeSuggestions({ query: 'diamond', own: demo, demo }).map((r) => r.kind)).toEqual(['own']);
  });
  it('adds one row for typed coordinates and drops the geocoder echo of them', () => {
    const rows = mergeSuggestions({ query: '39.71961, -115.96894', demo, places: [place('Eureka County, Nevada', -115.96894, 39.71961)] });
    expect(rows).toEqual([{ kind: 'coords', id: 'coords', title: '39.71961, -115.96894', location: [-115.96894, 39.71961] }]);
  });
  it('keeps at most six rows and drops repeated places', () => {
    const many = Array.from({ length: 9 }, (_, i) => place(`Cai ${i}, Việt Nam`, 105 + i, 10));
    const rows = mergeSuggestions({ query: 'cai', own, places: [caiLay, caiLay, ...many] });
    expect(rows).toHaveLength(6);
    expect(rows[0].kind).toBe('own');
    expect(rows.filter((r) => r.title === 'Cai Lậy')).toHaveLength(1);
    expect(new Set(rows.map((r) => r.id)).size).toBe(6);
  });
});

describe('moveIndex', () => {
  it('wraps at both ends and has nothing to point at in an empty list', () => {
    expect(moveIndex(0, 1, 3)).toBe(1);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(-1, 1, 3)).toBe(0);
    expect(moveIndex(0, 1, 0)).toBe(-1);
  });
});
