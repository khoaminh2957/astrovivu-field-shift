/**
 * FAO EcoCrop -> cleaned structured facts, fact-sheet chunks (EN for every species, VI for curated
 * crops) and narrative chunks from the `notes` column. Defects handled (docs/DATA_SOURCES.md §5):
 * temperatures beyond ±60 °C and latitudes beyond 90° are wrong-scale and dropped, a growing cycle
 * of 0 means missing, pH outside 0-14 is dropped. Every change is recorded in `CropFacts.cleaning`.
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import type { KnowledgeChunk } from '../../src/contracts';
import type { CropFacts, Range4 } from '../../src/rag/types';
import { slugify, wordCount } from '../../src/rag/text';
import { renderFactSheet } from '../../src/rag/facts';
import type { CuratedCrop } from './curated';
import { splitWords } from './chunk';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const ECOCROP_CSV = path.join(ROOT, 'data/ecocrop/ecocrop_2568_plants.csv');
export const ECOCROP_SOURCE = {
  name: 'FAO EcoCrop',
  url: 'https://gaez.fao.org/pages/ecocrop',
  license: 'FAO EcoCrop data, © FAO; used with attribution for non-commercial purposes',
};

type Row = Record<string, string>;

export function readEcoCrop(file = ECOCROP_CSV): Row[] {
  const csv = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  return Papa.parse<Row>(csv, { header: true, skipEmptyLines: true }).data;
}

const blank = (s: string | undefined) => s == null || /^\s*(-+|no input|)\s*$/i.test(s);
const str = (s: string | undefined) => (blank(s) ? undefined : s!.trim());

function num(s: string | undefined): number | null {
  if (blank(s)) return null;
  const v = Number(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function range(row: Row, base: string, clean: (v: number | null) => number | null): Range4 | undefined {
  const r: Range4 = [
    clean(num(row[`${base}_abs_min`])),
    clean(num(row[`${base}_opt_min`])),
    clean(num(row[`${base}_opt_max`])),
    clean(num(row[`${base}_abs_max`])),
  ];
  return r.some((v) => v != null) ? r : undefined;
}

function pair(row: Row, base: string): { opt?: string; abs?: string } | undefined {
  const opt = str(row[`${base}_opt`]);
  const abs = str(row[`${base}_abs`]);
  return opt || abs ? { opt, abs } : undefined;
}

export function toFacts(row: Row, curated?: CuratedCrop): CropFacts {
  const cleaning: string[] = [];
  const guard = (label: string, lim: number) => (v: number | null) => {
    if (v != null && Math.abs(v) > lim) {
      cleaning.push(`${label} value ${v} out of range, dropped`);
      return null;
    }
    return v;
  };
  const cycleMin = num(row.cult_cycle_min);
  const cycleMax = num(row.cult_cycle_max);
  let cycle: [number, number] | null = null;
  if (cycleMin && cycleMax) cycle = [cycleMin, cycleMax];
  else if (cycleMin === 0 || cycleMax === 0) cleaning.push('growing cycle 0 = missing');
  const latMin = guard('latitude', 90)(num(row.eco_latitude_abs_min));
  const latMax = guard('latitude', 90)(num(row.eco_latitude_abs_max));
  const ph = range(row, 'eco_soil_ph', (v) => (v != null && (v < 0 || v > 14) ? (cleaning.push(`pH ${v} dropped`), null) : v));
  const names = (row.common_names ?? '')
    .split(/,\s*/)
    .map((n) => n.trim())
    .filter((n) => n.length > 1);
  return {
    id: slugify(row.name),
    sci: row.name.trim(),
    ecocropId: Number(row.ecocrop_id),
    family: str(row.family)?.split(':').pop(),
    en: curated?.en,
    vi: curated?.vi[0],
    names: names.slice(0, 8),
    category: str(row.desc_category),
    lifeForm: str(row.desc_life_form),
    lifeSpan: str(row.desc_life_span),
    temp: range(row, 'eco_temperat_requir', guard('temperature', 60)),
    rain: range(row, 'eco_rainfall_annual', (v) => (v != null && v < 0 ? null : v)),
    ph,
    texture: pair(row, 'eco_soil_texture'),
    drainage: pair(row, 'eco_soil_drainage'),
    depth: pair(row, 'eco_soil_depth'),
    fertility: pair(row, 'eco_soil_fertility'),
    salinity: pair(row, 'eco_soil_salinity'),
    light: (() => {
      const opt = [str(row.eco_light_intensity_opt_min), str(row.eco_light_intensity_opt_max)].filter(Boolean);
      const abs = [str(row.eco_light_intensity_abs_min), str(row.eco_light_intensity_abs_max)].filter(Boolean);
      return opt.length || abs.length ? { opt: [...new Set(opt)].join(' to ') || undefined, abs: [...new Set(abs)].join(' to ') || undefined } : undefined;
    })(),
    killTempEarly: guard('killing temperature', 60)(num(row.clim_killing_temp_early_growth)),
    killTempRest: guard('killing temperature', 60)(num(row.clim_killing_temp_during_rest)),
    cycle,
    latAbs: latMin != null && latMax != null ? [latMin, latMax] : null,
    altAbsMax: num(row.eco_altitude_abs_max),
    climate: str(row.clim_climate_zone),
    photoperiod: str(row.clim_photoperiod),
    uses: str(row.uses),
    usesMain: str(row.uses_main),
    companions: str(row.cult_companion_species),
    curated: Boolean(curated),
    cleaning: cleaning.length ? cleaning : undefined,
  };
}

/** All aliases of a species (folded later): scientific name, synonyms, common names, curated names. */
export function aliasesOf(row: Row, curated?: CuratedCrop): string[] {
  const out = new Set<string>([row.name.trim()]);
  for (const s of (row.synonyms ?? '').split(/,\s*/)) if (s.trim().length > 3) out.add(s.trim());
  for (const s of (row.common_names ?? '').split(/,\s*/)) if (s.trim().length > 2) out.add(s.trim().replace(/['‚’]+$/, ''));
  if (curated) {
    out.add(curated.en);
    for (const a of curated.enAliases ?? []) out.add(a);
    for (const v of curated.vi) out.add(v);
  }
  // Species name without the infraspecific part, e.g. "Vicia villosa" for "Vicia villosa ssp. villosa".
  const m = row.name.match(/^([A-Z][a-z]+ [a-z-]+)\s+(?:ssp|var|subsp)\.?/);
  if (m) out.add(m[1]);
  return [...out];
}

const NOTE_HEADS = /(BRIEF DESCRIPTION|DESCRIPTION|USES?|GROWING PERIOD|COMMON NAMES|FURTHER INF\.?|KILLING TEMP[A-Z. ]*|SOURCES?)\s*:?\s+/g;

/** Split the EcoCrop narrative into labelled sections; common names and sources are dropped. */
export function noteSections(notes: string): { head: string; text: string }[] {
  const out: { head: string; text: string }[] = [];
  const parts = notes.split(NOTE_HEADS);
  // split() with a capture group alternates [pre, head, body, head, body...]
  if (parts[0].trim()) out.push({ head: 'Notes', text: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) {
    const head = parts[i].replace(/\.$/, '').trim();
    const text = (parts[i + 1] ?? '').trim();
    if (!text || /^(COMMON NAMES|SOURCES?)$/.test(head)) continue;
    out.push({ head: head === 'BRIEF DESCRIPTION' ? 'DESCRIPTION' : head === 'USE' ? 'USES' : head.startsWith('FURTHER') ? 'FURTHER INFORMATION' : head, text });
  }
  return out;
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function ecoChunks(row: Row, facts: CropFacts, curated?: CuratedCrop): KnowledgeChunk[] {
  const label = facts.en ? `${facts.en} (${facts.sci})` : facts.sci;
  const tagsBase = ['ecocrop', ...(facts.category ? [`cat:${facts.category}`] : []), ...(curated ? [`group:${curated.group}`] : [])];
  const chunks: KnowledgeChunk[] = [
    {
      id: `eco:${facts.id}:facts`,
      docId: `eco:${facts.id}`,
      title: `${label}: ecological requirements`,
      text: renderFactSheet(facts, 'en'),
      lang: 'en',
      source: { ...ECOCROP_SOURCE, url: `${ECOCROP_SOURCE.url}#${facts.ecocropId}` },
      cropIds: [facts.id],
      tags: ['kind:facts', ...tagsBase, 'ideal', 'requirements'],
    },
  ];
  if (curated) {
    chunks.push({
      id: `eco:${facts.id}:facts-vi`,
      docId: `eco:${facts.id}`,
      title: `${facts.vi ?? label} (${facts.sci}): yêu cầu sinh thái`,
      text: renderFactSheet(facts, 'vi'),
      lang: 'vi',
      source: { ...ECOCROP_SOURCE, url: `${ECOCROP_SOURCE.url}#${facts.ecocropId}` },
      cropIds: [facts.id],
      tags: ['kind:facts', ...tagsBase, 'ideal', 'requirements'],
    });
  }
  const secs = noteSections(row.notes ?? '');
  // Pack sections into 150-300 word chunks without splitting a section unless it is longer.
  let buf: string[] = [];
  let heads: string[] = [];
  let n = 0;
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join(' ');
    chunks.push({
      id: `eco:${facts.id}:notes-${n++}`,
      docId: `eco:${facts.id}`,
      title: `${label}: ${heads.map(titleCase).join(', ').toLowerCase()}`,
      text,
      lang: 'en',
      source: { ...ECOCROP_SOURCE, url: `${ECOCROP_SOURCE.url}#${facts.ecocropId}` },
      cropIds: [facts.id],
      tags: ['kind:narrative', ...tagsBase, ...heads.map((h) => `sec:${h.toLowerCase().replace(/\s+/g, '-')}`)],
    });
    buf = [];
    heads = [];
  };
  for (const s of secs) {
    const pieces = wordCount(s.text) > 300 ? splitWords(s.text, 220) : [s.text];
    for (const p of pieces) {
      if (buf.length && wordCount(buf.join(' ')) + wordCount(p) > 300) flush();
      buf.push(`${titleCase(s.head)}: ${p}`);
      if (!heads.includes(s.head)) heads.push(s.head);
    }
  }
  flush();
  return chunks;
}
